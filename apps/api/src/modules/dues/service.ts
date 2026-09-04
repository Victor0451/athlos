import { createHash } from 'node:crypto'
import { AuditAction, emitAudit, type AuditRecord, type EmitAuditResult } from '@athlos/audit'
import type { Db } from '@athlos/db'
import { BusinessError, ErrorCode } from '@athlos/errors'
// prettier-ignore
import { loadGenerationPlan } from './generation-plan-loader.ts'
import { applyBenefits, type ApplicableBenefit } from './benefits.ts'
import { planAssessmentRange } from './range-planner.ts'
import * as repository from './repository.ts'

type Json = Record<string, unknown>
type Role = 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA'
type DuesDb = Db | repository.DuesTransaction
type Clock = () => Date
type AuditEmitter = (db: DuesDb, record: AuditRecord) => Promise<EmitAuditResult>
type Price = Awaited<ReturnType<typeof repository.createPrice>>

const nextMonthStart = (period: string) => {
  const next = new Date(`${period}-01T00:00:00Z`)
  next.setUTCMonth(next.getUTCMonth() + 1)
  return next.toISOString().slice(0, 10)
}

// prettier-ignore
export type AuditContext = { actorId: string; role: Role; permissions: string[]; sourceIp: string | null; callerKey: string; requestFingerprint: string; authorizationEvidence: Json }
// prettier-ignore
export type CreatePriceCommand = AuditContext & Omit<repository.PriceInput, 'createdBy' | 'authorizationEvidence'>
// prettier-ignore
export type RevokePriceCommand = AuditContext & Omit<repository.PriceRevocationInput, 'revokedBy'>
// prettier-ignore
export type GenerateAssessmentCommand = AuditContext & { period: repository.Period; currency?: string; planFingerprint: string }
export type PlanGenerationCommand = { role: Role; period: repository.Period; currency?: string }
export type PreviewAssessmentCommand = AuditContext & {
  socioId: string
  fromPeriod: string
  throughPeriod: string
}
export type ExecuteRangeCommand = PreviewAssessmentCommand & { previewFingerprint: string }
export type GenerationResult = {
  period: repository.Period
  generatedObligationCount: number
  retainedExistingCount: number
  reviewCount: number
  generatedTotalCents: number
}
export type RangeExecutionResult = { createdObligationIds: string[]; periods: string[] }
// prettier-ignore
export type PricingRepository = Pick<typeof repository, 'createPrice' | 'revokePrice'>
// prettier-ignore
export type AssessmentRepository = Pick<typeof repository, 'claimReceipt' | 'finalizeReceipt' | 'lockPeriod' | 'lockRange' | 'listEligibleMembers' | 'listEffectivePrices' | 'findObligation' | 'insertObligation' | 'insertObligationInTransaction'> & Partial<Pick<typeof repository, 'resolveBenefitRuleCandidates' | 'listAssessmentFacts' | 'listGenerationMembers' | 'listGenerationPrices'>>
type Dependencies<T> = {
  repository?: T
  audit?: AuditEmitter
  now?: Clock
  loadPlan?: (
    db: DuesDb,
    input: { period: repository.Period; currency: string },
  ) => ReturnType<typeof loadGenerationPlan>
}

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
export class AssessmentService {
  private readonly repository: AssessmentRepository
  private readonly audit: AuditEmitter
  private readonly now: Clock
  private readonly loadPlan: NonNullable<Dependencies<AssessmentRepository>['loadPlan']>
  constructor(private readonly db: Db, dependencies: Dependencies<AssessmentRepository> = {}) {
    this.repository = dependencies.repository ?? { ...repository, resolveBenefitRuleCandidates: repository.resolveBenefitRuleCandidates }
    this.audit = dependencies.audit ?? emitAudit
    this.now = dependencies.now ?? (() => new Date())
    this.loadPlan = dependencies.loadPlan ?? ((db, input) => loadGenerationPlan({
      listGenerationMembers: (period) => (this.repository.listGenerationMembers ?? repository.listGenerationMembers)(db, period),
      listGenerationPrices: (period) => (this.repository.listGenerationPrices ?? repository.listGenerationPrices)(db, period),
      resolveBenefitRuleCandidates: (input) => (this.repository.resolveBenefitRuleCandidates ?? repository.resolveBenefitRuleCandidates)(db, input),
    }, input))
  }
  async preview(input: PreviewAssessmentCommand) {
    return this.plan(input, this.db)
  }
  private async plan(input: PreviewAssessmentCommand, db: DuesDb) {
    authorize(input.role, ['ADMIN', 'TESORERO'])
    const current = this.now().toISOString().slice(0, 7)
    if (input.fromPeriod > input.throughPeriod || input.throughPeriod > current) throw BusinessError(ErrorCode.VALIDATION_ERROR, 'El rango de evaluación es inválido o futuro')
    const range = { start: `${input.fromPeriod}-01`, end: nextMonthStart(input.throughPeriod) }
    const facts = await (this.repository.listAssessmentFacts ?? repository.listAssessmentFacts)(db, input.socioId, range)
    if (!facts.member) throw BusinessError(ErrorCode.NOT_FOUND, 'Socio no encontrado para la evaluación')
    const periods = [] as Array<Record<string, unknown>>, issues: unknown[] = [], periodBenefits: Array<{ period: string; benefits: ApplicableBenefit[] }> = []
    for (let period = input.fromPeriod; period <= input.throughPeriod;) {
      const start = `${period}-01`, end = nextMonthStart(period)
      const components = [{ key: 'base', kind: 'BASE' as const, alta: facts.member.fechaAlta, baja: null, prices: facts.prices.filter((price) => price.kind === 'BASE').map((price) => ({ priceVersionId: price.versionId, amountCents: price.amountCents, currency: price.currency, from: price.effectiveFrom, to: price.effectiveTo ?? end, rule: price.rule })) }, ...facts.member.enrollments.map((enrollment) => ({ key: `sport:${enrollment.id}`, kind: 'SPORT' as const, alta: enrollment.fechaAlta, baja: enrollment.fechaBaja, prices: facts.prices.filter((price) => price.kind === 'SPORT' && price.disciplinaId === enrollment.disciplinaId).map((price) => ({ priceVersionId: price.versionId, amountCents: price.amountCents, currency: price.currency, from: price.effectiveFrom, to: price.effectiveTo ?? end, rule: price.rule })) }))]
      const plan = planAssessmentRange({ period: { start, end }, components }), existing = facts.obligations.find((obligation) => obligation.periodStart === start)
      const benefits = await (this.repository.resolveBenefitRuleCandidates ?? repository.resolveBenefitRuleCandidates)(db, { socioId: input.socioId, familyGroupId: facts.member.familyGroupId, period: { start, end } })
      const benefitResult = plan.executable ? applyBenefits(plan.totalCents!, benefits, facts.prices[0]?.currency ?? 'ARS') : null
      periodBenefits.push({ period, benefits })
      issues.push(...plan.issues.map((issue) => ({ ...issue, period })))
      periods.push({ period, start, end, calendarDays: plan.components[0]?.calendarDays ?? 0, components: [...plan.components.map((component) => ({ ...component, kind: component.componentKey === 'base' ? 'BASE' : 'SPORT', status: existing ? 'ALREADY_GENERATED' : component.status })), ...(benefitResult?.components.map((component) => ({ ...component, eligibleFrom: start, eligibleTo: end, eligibleDays: plan.components[0]?.calendarDays ?? 0, calendarDays: plan.components[0]?.calendarDays ?? 0, segments: [], numerator: component.amountCents, remainder: 0, status: existing ? 'ALREADY_GENERATED' : 'PENDING' })) ?? [])], existingObligationId: existing?.id ?? null, pendingAmountCents: existing || !plan.executable ? 0 : benefitResult!.totalCents })
      period = end.slice(0, 7)
    }
    const sourceSnapshot = { member: facts.member, prices: facts.prices, benefits: periodBenefits, obligations: facts.obligations, range: input.fromPeriod + ':' + input.throughPeriod }
    const executable = issues.length === 0 && periods.every((period) => (period.pendingAmountCents !== null)) && !periods.some((period) => (period.components as Array<{ status: string }>).some((component) => component.status === 'CONFLICT'))
    const result = { socioId: input.socioId, fromPeriod: input.fromPeriod, throughPeriod: input.throughPeriod, executable, currency: facts.prices[0]?.currency ?? null, periods, issues, sourceSnapshot }
    return { ...result, fingerprint: createHash('sha256').update(JSON.stringify(result)).digest('hex') }
  }
  async executeRange(input: ExecuteRangeCommand): Promise<RangeExecutionResult> {
    authorize(input.role, ['ADMIN', 'TESORERO'])
    return this.db.transaction(async (tx) => {
      // Range receipt: start is inclusive and end is exclusive, in canonical UTC months.
      const claim = await this.repository.claimReceipt(tx, { operatorId: input.actorId, callerKey: input.callerKey, requestFingerprint: input.requestFingerprint, periodStart: `${input.fromPeriod}-01`, periodEnd: nextMonthStart(input.throughPeriod), authorizationEvidence: input.authorizationEvidence })
      if (claim.status === 'replayed') return claim.result as RangeExecutionResult
      await this.repository.lockRange(tx, input.socioId)
      const plan = await this.plan(input, tx)
      if (!plan.executable) throw BusinessError(ErrorCode.CONFLICT, 'La evaluación revisada ya no es ejecutable')
      if (plan.fingerprint !== input.previewFingerprint) throw BusinessError(ErrorCode.CONFLICT, 'Los datos de la evaluación cambiaron; generá una nueva vista previa')
      const createdObligationIds: string[] = [], periods: string[] = []
      for (const period of plan.periods as Array<{ period: string; start: string; end: string; pendingAmountCents: number; components: Array<Record<string, unknown>> }>) {
        periods.push(period.period)
        if (period.pendingAmountCents <= 0) continue
        const components = period.components.map((component) => ({ kind: component.kind as 'BASE' | 'SPORT' | 'BENEFIT', componentKey: component.componentKey as string, amountCents: component.amountCents as number, priceVersionId: null, calculationInputs: component, eligibilitySnapshot: { eligibleFrom: component.eligibleFrom, eligibleTo: component.eligibleTo }, priceSnapshot: component.kind === 'BENEFIT' ? component.priceSnapshot as Json : { segments: component.segments } }))
        const inserted = await this.repository.insertObligationInTransaction(tx, { periodStart: period.start, periodEnd: period.end, socioId: input.socioId, amountCents: period.pendingAmountCents, generationReceiptId: claim.receipt.id, actorId: input.actorId, snapshot: { planFingerprint: plan.fingerprint, period, sourceSnapshot: plan.sourceSnapshot }, authorizationEvidence: input.authorizationEvidence, components })
        createdObligationIds.push(inserted.obligation.id)
      }
      const result = { createdObligationIds, periods }
      await auditAction(this.audit, tx, AuditAction.DUES_PERIOD_GENERATED, input, { entityType: 'dues_range', entityId: `${input.socioId}:${input.fromPeriod}:${input.throughPeriod}`, oldValue: null, newValue: result, payload: { fingerprint: plan.fingerprint, result } }, this.now().toISOString())
      await this.repository.finalizeReceipt(tx, claim.receipt.id, result)
      return result
    })
  }
  async planGeneration(input: PlanGenerationCommand) {
    authorize(input.role, ['ADMIN', 'TESORERO'])
    const plan = await this.loadPlan(this.db, { period: input.period, currency: input.currency ?? 'ARS' })
    return { ...plan.presentation, fingerprint: plan.internal.fingerprint, canGenerate: !plan.internal.entries.some((entry) => entry.status === 'CONFLICT') }
  }
  async generate(input: GenerateAssessmentCommand): Promise<GenerationResult> {
    authorize(input.role, ['ADMIN', 'TESORERO'])
    return this.db.transaction(async (tx) => {
      const claim = await this.repository.claimReceipt(tx, { operatorId: input.actorId, callerKey: input.callerKey, requestFingerprint: input.requestFingerprint, periodStart: input.period.start, periodEnd: input.period.end, authorizationEvidence: input.authorizationEvidence })
      if (claim.status === 'replayed') return claim.result as GenerationResult
      await this.repository.lockPeriod(tx, input.period.start)
      const plan = await this.loadPlan(tx, { period: input.period, currency: input.currency ?? 'ARS' })
      if (plan.internal.fingerprint !== input.planFingerprint) throw BusinessError(ErrorCode.CONFLICT, 'Los datos de generación cambiaron; generá una nueva vista previa')
      if (plan.internal.entries.some((entry) => entry.status === 'CONFLICT')) throw BusinessError(ErrorCode.CONFLICT, 'El plan contiene conflictos que requieren revisión')
      const generatedAt = this.now().toISOString()
      let generatedObligationCount = 0, generatedTotalCents = 0
      for (const entry of plan.internal.entries) {
        if (entry.status !== 'READY' || entry.insertion.disposition !== 'INSERT') continue
        const payload = entry.insertion.payload
        const inserted = await this.repository.insertObligationInTransaction(tx, { periodStart: input.period.start, periodEnd: input.period.end, socioId: entry.memberId, amountCents: payload.amountCents, generationReceiptId: claim.receipt.id, actorId: input.actorId, snapshot: { payload: payload.snapshot, evidence: { actor: { id: input.actorId, role: input.role, permissions: input.permissions }, request: { callerKey: input.callerKey, fingerprint: input.requestFingerprint }, receiptFingerprint: claim.receipt.requestFingerprint, generatedAt } }, authorizationEvidence: input.authorizationEvidence, components: payload.components })
        for (const benefit of payload.benefitAudits) await auditAction(this.audit, tx, AuditAction.DUES_BENEFIT_APPLIED, input, { entityType: 'dues_benefit_application', entityId: benefit.id, oldValue: null, newValue: { obligationId: inserted.obligation.id, benefit }, payload: { obligationId: inserted.obligation.id, benefit } }, generatedAt)
        generatedObligationCount++; generatedTotalCents += payload.amountCents
      }
      const result = { period: input.period, generatedObligationCount, retainedExistingCount: plan.internal.entries.filter((entry) => entry.existingObligationId !== null).length, reviewCount: plan.internal.entries.filter((entry) => entry.status === 'REVIEW').length, generatedTotalCents }
      await auditAction(this.audit, tx, AuditAction.DUES_PERIOD_GENERATED, input, { entityType: 'dues_period', entityId: input.period.start, oldValue: null, newValue: result, payload: { planFingerprint: plan.internal.fingerprint, result } }, generatedAt)
      await this.repository.finalizeReceipt(tx, claim.receipt.id, result)
      return result
    }, { isolationLevel: 'repeatable read' })
  }
}
