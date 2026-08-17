import { AuditAction, emitAudit, type AuditRecord, type EmitAuditResult } from '@athlos/audit'
import type { Db } from '@athlos/db'
import { BusinessError, ErrorCode } from '@athlos/errors'
// prettier-ignore
import { calculateAssessment, type AssessmentInput, type AssessmentResult as CalculationResult, type SportInput } from './calculator.ts'
import { applyBenefits, type AppliedBenefit, type BenefitComponent } from './benefits.ts'
import * as repository from './repository.ts'
import { resolveBenefitRuleCandidates as resolveBenefitRuleCandidatesDefault } from './repository.ts'

type Json = Record<string, unknown>
type Role = 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA'
type DuesDb = Db | repository.DuesTransaction
type Clock = () => Date
type AuditEmitter = (db: DuesDb, record: AuditRecord) => Promise<EmitAuditResult>
type Price = Awaited<ReturnType<typeof repository.createPrice>>
type EffectivePrices = Awaited<ReturnType<typeof repository.listEffectivePrices>>
type EffectivePrice = EffectivePrices['base'][number]
// prettier-ignore
type Member = Awaited<ReturnType<typeof repository.listEligibleMembers>>[number] & { familyGroupId?: string | null }

// prettier-ignore
export type AuditContext = { actorId: string; role: Role; permissions: string[]; sourceIp: string | null; callerKey: string; requestFingerprint: string; authorizationEvidence: Json }
// prettier-ignore
export type CreatePriceCommand = AuditContext & Omit<repository.PriceInput, 'createdBy' | 'authorizationEvidence'>
// prettier-ignore
export type RevokePriceCommand = AuditContext & Omit<repository.PriceRevocationInput, 'revokedBy'>
// prettier-ignore
export type GenerateAssessmentCommand = AuditContext & { period: repository.Period; currency?: string }
export type GenerationResult = { period: repository.Period; obligationIds: string[] }
// prettier-ignore
export type PricingRepository = Pick<typeof repository, 'createPrice' | 'revokePrice'>
// prettier-ignore
export type AssessmentRepository = Pick<typeof repository, 'claimReceipt' | 'finalizeReceipt' | 'lockPeriod' | 'listEligibleMembers' | 'listEffectivePrices' | 'findObligation' | 'insertObligation'> & Partial<Pick<typeof repository, 'resolveBenefitRuleCandidates'>>
type Dependencies<T> = { repository?: T; audit?: AuditEmitter; now?: Clock }

const CALCULATOR_VERSION = 'dues-calculator-v1'
const ROUNDING = 'nearest-cent-half-up'

// prettier-ignore
function authorize(role: Role, allowed: Role[]) {
  if (!allowed.includes(role)) throw BusinessError(ErrorCode.INSUFFICIENT_PERMISSIONS, 'Dues action is not authorized')
}
// prettier-ignore
type AuditValues = Pick<AuditRecord, 'entityType' | 'entityId' | 'oldValue' | 'newValue' | 'payload'>
// prettier-ignore
async function auditAction(audit: AuditEmitter, db: DuesDb, action: string, context: AuditContext, values: AuditValues, now: string) {
  await audit(db, {
    ...values,
    action,
    operatorId: context.actorId,
    sourceIp: context.sourceIp,
    callerKey: context.callerKey,
    metadata: { actorId: context.actorId, role: context.role, permissions: context.permissions, authorizationEvidence: context.authorizationEvidence, callerKey: context.callerKey, requestFingerprint: context.requestFingerprint, time: now },
  })
}

// prettier-ignore
export class PricingService {
  private readonly repository: PricingRepository
  private readonly audit: AuditEmitter
  private readonly now: Clock
  constructor(private readonly db: Db, dependencies: Dependencies<PricingRepository> = {}) {
    this.repository = dependencies.repository ?? repository
    this.audit = dependencies.audit ?? emitAudit
    this.now = dependencies.now ?? (() => new Date())
  }
  async create(input: CreatePriceCommand): Promise<Price> {
    authorize(input.role, ['ADMIN'])
    return this.db.transaction(async (tx) => {
      const price = await this.repository.createPrice(tx, { ...input, createdBy: input.actorId, authorizationEvidence: input.authorizationEvidence })
      await auditAction(this.audit, tx, AuditAction.DUES_PRICE_CREATED, input, { entityType: 'dues_price_version', entityId: price.id, oldValue: null, newValue: price, payload: input }, this.now().toISOString())
      return price
    })
  }
  async revoke(input: RevokePriceCommand): Promise<Price> {
    authorize(input.role, ['ADMIN'])
    return this.db.transaction(async (tx) => {
      const price = await this.repository.revokePrice(tx, { ...input, revokedBy: input.actorId })
      await auditAction(this.audit, tx, AuditAction.DUES_PRICE_REVOKED, input, { entityType: 'dues_price_version', entityId: price.id, oldValue: null, newValue: price, payload: input }, this.now().toISOString())
      return price
    })
  }
}

// prettier-ignore
type SportSource = { enrollment: Member['sports'][number]; price: EffectivePrice; input: SportInput }
type AssessmentSource = { input: AssessmentInput; base?: EffectivePrice; sports: SportSource[] }
// prettier-ignore
function calculatorPrice(price: EffectivePrice) {
  return { amountCents: price.amountCents, currency: price.currency, rule: price.rule, versionId: price.versionId }
}
// prettier-ignore
function assessmentSource(member: Member, prices: EffectivePrices, period: repository.Period, currency: string): AssessmentSource {
  const base = prices.base[0]
  const sports = member.sports.flatMap((enrollment) => {
    const price = prices.sports.find((candidate) => candidate.disciplinaId === enrollment.disciplinaId)
    if (!price) return []
    return [{ enrollment, price, input: { active: true, componentKey: `sport:${enrollment.id}`, eligibleFrom: enrollment.eligibleFrom, eligibleTo: enrollment.eligibleTo, price: calculatorPrice(price) } }]
  })
  return { input: { period, currency, ...(base ? { base: { eligible: member.baseEligible, price: calculatorPrice(base) } } : {}), sports: sports.map(({ input }) => input) }, ...(base ? { base } : {}), sports }
}
// prettier-ignore
function snapshot(context: AuditContext, member: Member, source: AssessmentSource, calculation: CalculationResult, benefits: AppliedBenefit[], receiptFingerprint: string, generatedAt: string) {
  return {
    calculatorVersion: CALCULATOR_VERSION, rounding: ROUNDING, period: source.input.period, inputs: source.input,
    enrollmentEvidence: member.sports, benefits, rule: calculation.components.map(({ componentKey, rule }) => ({ componentKey, rule })),
    actor: { id: context.actorId, role: context.role, permissions: context.permissions }, actorId: context.actorId, role: context.role, permissions: context.permissions,
    time: generatedAt, sourceIp: context.sourceIp, callerKey: context.callerKey, requestFingerprint: context.requestFingerprint, receiptFingerprint,
  }
}
// prettier-ignore
function obligationComponents(member: Member, source: AssessmentSource, calculation: CalculationResult, benefits: BenefitComponent[]) {
  return [...calculation.components.map((component) => {
    const sport = source.sports.find(({ input }) => input.componentKey === component.componentKey)
    const price = component.kind === 'BASE' ? source.base : sport?.price
    return { ...component, disciplinaId: sport?.enrollment.disciplinaId ?? null, enrollmentId: sport?.enrollment.id ?? null, calculationInputs: { ...component, assessment: source.input }, eligibilitySnapshot: sport?.enrollment ?? { baseEligible: member.baseEligible }, priceSnapshot: price ?? {} }
  }), ...benefits]
}

// prettier-ignore
export class AssessmentService {
  private readonly repository: AssessmentRepository
  private readonly audit: AuditEmitter
  private readonly now: Clock
  constructor(private readonly db: Db, dependencies: Dependencies<AssessmentRepository> = {}) {
    this.repository = dependencies.repository ?? { ...repository, resolveBenefitRuleCandidates: repository.resolveBenefitRuleCandidates }
    this.audit = dependencies.audit ?? emitAudit
    this.now = dependencies.now ?? (() => new Date())
  }
  async generate(input: GenerateAssessmentCommand): Promise<GenerationResult> {
    authorize(input.role, ['ADMIN', 'TESORERO'])
    return this.db.transaction(async (tx) => {
      const claim = await this.repository.claimReceipt(tx, { operatorId: input.actorId, callerKey: input.callerKey, requestFingerprint: input.requestFingerprint, periodStart: input.period.start, periodEnd: input.period.end, authorizationEvidence: input.authorizationEvidence })
      if (claim.status === 'replayed') return claim.result as GenerationResult
      await this.repository.lockPeriod(tx, input.period.start)
      const members = await this.repository.listEligibleMembers(tx, input.period)
      const prices = await this.repository.listEffectivePrices(tx, input.period)
      const currency = input.currency ?? prices.base[0]?.currency ?? prices.sports[0]?.currency ?? 'ARS'
      const obligationIds: string[] = [], snapshots: Json[] = []
      let created = false, existing = false
      const generatedAt = this.now().toISOString()
      for (const member of members) {
        const source = assessmentSource(member, prices, input.period, currency)
        const calculation = calculateAssessment(source.input)
        if (calculation.totalCents === 0) continue
        const prior = await this.repository.findObligation(tx, member.socioId, input.period.start)
        if (prior) { existing = true; obligationIds.push(prior.obligation.id); continue }
        // prettier-ignore
        const resolveBenefitRuleCandidates = this.repository.resolveBenefitRuleCandidates ?? resolveBenefitRuleCandidatesDefault
        const applicable = await resolveBenefitRuleCandidates(tx, { socioId: member.socioId, ...(member.familyGroupId !== undefined ? { familyGroupId: member.familyGroupId } : {}), period: input.period })
        const benefitResult = applyBenefits(calculation.totalCents, applicable, currency)
        if (benefitResult.totalCents === 0) continue
        const obligationSnapshot = snapshot(input, member, source, calculation, benefitResult.applied, claim.receipt.requestFingerprint, generatedAt)
        const inserted = await this.repository.insertObligation(tx, { periodStart: input.period.start, periodEnd: input.period.end, socioId: member.socioId, amountCents: benefitResult.totalCents, generationReceiptId: claim.receipt.id, actorId: input.actorId, snapshot: obligationSnapshot, authorizationEvidence: input.authorizationEvidence, components: obligationComponents(member, source, calculation, benefitResult.components) })
        for (const benefit of benefitResult.applied) await auditAction(this.audit, tx, AuditAction.DUES_BENEFIT_APPLIED, input, { entityType: 'dues_benefit_application', entityId: benefit.id, oldValue: null, newValue: { obligationId: inserted.obligation.id, appliedAmountCents: benefit.appliedAmountCents, truncatedAmountCents: benefit.truncatedAmountCents }, payload: { benefitId: benefit.id, obligationId: inserted.obligation.id } }, generatedAt)
        created = true; obligationIds.push(inserted.obligation.id); snapshots.push(obligationSnapshot)
      }
      const result = { period: input.period, obligationIds }
      if (created || !existing) await auditAction(this.audit, tx, AuditAction.DUES_PERIOD_GENERATED, input, { entityType: 'dues_period', entityId: input.period.start, oldValue: null, newValue: { ...result, snapshots }, payload: { period: input.period, obligationIds, snapshots } }, generatedAt)
      await this.repository.finalizeReceipt(tx, claim.receipt.id, result)
      return result
    })
  }
}
