import { describe, expect, it, vi } from 'vitest'
import { AuditAction, type AuditRecord } from '@athlos/audit'
import { ErrorCode } from '@athlos/errors'
import {
  AssessmentService,
  PricingService,
  type AuditContext,
  type PlanGenerationCommand,
} from './service.ts'
import { BenefitService } from './dues-benefits.ts'

const context: AuditContext = {
  actorId: '00000000-0000-4000-8000-000000000001',
  role: 'ADMIN',
  permissions: ['dues:write'],
  sourceIp: '127.0.0.1',
  callerKey: 'caller-1',
  requestFingerprint: 'a'.repeat(64),
  authorizationEvidence: { role: 'ADMIN', permission: 'dues:write' },
}
const price = {
  id: 'price-1',
  kind: 'BASE' as const,
  disciplinaId: null,
  amountCents: 10_000,
  currency: 'ARS',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  rule: 'FULL_MONTH' as const,
}
// prettier-ignore
function db() {
  const tx = {}
  return { transaction: vi.fn(async (work: (value: unknown) => unknown) => work(tx)) } as never
}
// prettier-ignore
function auditLog() {
  const records: AuditRecord[] = []
  return {
    records,
    emit: vi.fn(async (_db: unknown, record: AuditRecord) => {
      records.push(record)
      return { inserted: true as const, id: `audit-${records.length}` }
    }),
  }
}

// prettier-ignore
describe('dues services', () => {
  it('orchestrates authorized price actions and emits their canonical events', async () => {
    const audit = auditLog()
    const repository = {
      createPrice: vi.fn().mockResolvedValue(price),
      revokePrice: vi.fn().mockResolvedValue({ ...price, revokedBy: context.actorId }),
    }
    const service = new PricingService(db(), { repository, audit: audit.emit })

    await service.create({ ...context, kind: 'BASE', amountCents: 10_000, effectiveFrom: price.effectiveFrom, rule: price.rule })
    await service.revoke({ ...context, priceVersionId: price.id, revokeReason: 'Correction' })

    expect(audit.records.map((record) => record.action)).toEqual([
      AuditAction.DUES_PRICE_CREATED,
      AuditAction.DUES_PRICE_REVOKED,
    ])
    expect(repository.createPrice).toHaveBeenCalledOnce()
    expect(repository.revokePrice).toHaveBeenCalledOnce()
  })

  it('returns an exact replay without loading obligations or emitting audit', async () => {
    const audit = auditLog()
    const result = { period: { start: '2026-01-01', end: '2026-02-01' }, obligationIds: ['ob-1'] }
    const repository = {
      claimReceipt: vi.fn().mockResolvedValue({ status: 'replayed', receipt: {}, result }),
      finalizeReceipt: vi.fn(),
      lockPeriod: vi.fn(),
      lockRange: vi.fn(),
      listEligibleMembers: vi.fn(),
      listEffectivePrices: vi.fn(),
      findObligation: vi.fn(),
      insertObligation: vi.fn(),
      insertObligationInTransaction: vi.fn(),
    }
    const service = new AssessmentService(db(), { repository, audit: audit.emit })

    await expect(service.generate({ ...context, period: result.period, planFingerprint: 'f'.repeat(64) })).resolves.toEqual(result)
    expect(repository.claimReceipt).toHaveBeenCalledOnce()
    expect(audit.records).toEqual([])
  })

  it('rejects price mutation by a non-admin operator', async () => {
    const service = new PricingService(db(), {
      repository: { createPrice: vi.fn(), revokePrice: vi.fn() },
      audit: auditLog().emit,
    })

    await expect(
      service.create({ ...context, role: 'TESORERO', kind: 'BASE', amountCents: 1, effectiveFrom: price.effectiveFrom, rule: price.rule }),
    ).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_PERMISSIONS })
  })

  it('audits benefit creation and revocation while enforcing ADMIN mutation authority', async () => {
    const audit = auditLog()
    const benefit = { id: 'benefit-1', kind: 'FIXED_DISCOUNT', priority: 10, combinability: 'COMBINABLE', exclusiveGroup: null, percentageBasis: null }
    const service = new BenefitService(db(), { repository: { createBenefitRule: vi.fn().mockResolvedValue(benefit), revokeBenefitRule: vi.fn().mockResolvedValue(benefit), listEffectiveBenefitRules: vi.fn() }, audit: audit.emit })
    await service.create({ ...context, kind: 'FIXED_DISCOUNT', socioId: 'member-1', amountCents: 500, currency: 'ARS', effectiveFrom: '2026-01-01', priority: 10, combinability: 'COMBINABLE', reason: 'Approved' })
    await service.revoke({ ...context, benefitRuleId: benefit.id, revokeReason: 'Replaced' })
    expect(audit.records.map((record) => record.action)).toEqual([AuditAction.DUES_BENEFIT_CREATED, AuditAction.DUES_BENEFIT_REVOKED])
    await expect(service.create({ ...context, role: 'TESORERO', kind: 'FIXED_DISCOUNT', socioId: 'member-1', amountCents: 500, currency: 'ARS', effectiveFrom: '2026-01-01', priority: 10, combinability: 'COMBINABLE', reason: 'Denied' })).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_PERMISSIONS })
  })

  it('builds a repeatable complete read-only preview without mutating facts', async () => {
const repository = {
listAssessmentFacts: vi.fn().mockResolvedValue({
member: { socioId: 'member-1', fechaAlta: '2026-01-10', enrollments: [] },
prices: [{ versionId: 'base-1', kind: 'BASE', disciplinaId: null, amountCents: 3100, currency: 'ARS', rule: 'FULL_MONTH', effectiveFrom: '2026-01-01', effectiveTo: null }],
obligations: [{ id: 'ob-1', periodStart: '2026-01-01', amountCents: 3100 }],
}),
resolveBenefitRuleCandidates: vi.fn().mockResolvedValue([]),
}
const database = db()
const service = new AssessmentService(database, { repository: repository as never, now: () => new Date('2026-02-15T12:00:00Z') })
const input = { ...context, role: 'TESORERO' as const, socioId: 'member-1', fromPeriod: '2026-01', throughPeriod: '2026-02' }
const [first, second] = await Promise.all([service.preview(input), service.preview(input)])
expect(first).toEqual(second)
    expect(first).toMatchObject({ executable: true, fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/), periods: [{ existingObligationId: 'ob-1' }, { pendingAmountCents: 3100 }] })
    expect(first.issues).toEqual([])
    expect(first.periods[0]).toMatchObject({
      pendingAmountCents: 0,
      components: expect.arrayContaining([expect.objectContaining({ status: 'ALREADY_GENERATED' })]),
    })
    expect(repository.listAssessmentFacts).toHaveBeenCalledTimes(2)
expect((database as { transaction: ReturnType<typeof vi.fn> }).transaction).not.toHaveBeenCalled()
  })

  it('retains existing-period pricing conflicts while excluding its obligation from pending creation', async () => {
    const service = new AssessmentService(db(), {
      repository: {
        listAssessmentFacts: vi.fn().mockResolvedValue({
          member: { socioId: 'member-1', fechaAlta: '2026-01-01', enrollments: [] },
          prices: [
            {
              versionId: 'late',
              kind: 'BASE',
              disciplinaId: null,
              amountCents: 100,
              currency: 'ARS',
              rule: 'FULL_MONTH',
              effectiveFrom: '2026-02-01',
              effectiveTo: null,
            },
          ],
          obligations: [{ id: 'ob-1', periodStart: '2026-01-01', amountCents: 100 }],
        }),
        resolveBenefitRuleCandidates: vi.fn().mockResolvedValue([]),
      } as never,
      now: () => new Date('2026-02-15T12:00:00Z'),
    })

    const result = await service.preview({
      ...context,
      role: 'TESORERO',
      socioId: 'member-1',
      fromPeriod: '2026-01',
      throughPeriod: '2026-02',
    })

    expect(result.executable).toBe(false)
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PRICE_GAP', period: '2026-01' })]),
    )
    expect(result.periods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          period: '2026-01',
          existingObligationId: 'ob-1',
          pendingAmountCents: 0,
          components: expect.arrayContaining([expect.objectContaining({ status: 'ALREADY_GENERATED' })]),
        }),
      ]),
    )
  })

  it.each(['PRICE_GAP', 'PRICE_OVERLAP'] as const)('retains %s across the complete non-executable range', async (expected) => {
const prices = expected === 'PRICE_GAP'
    ? [{ versionId: 'late', kind: 'BASE' as const, disciplinaId: null, amountCents: 100, currency: 'ARS', rule: 'FULL_MONTH' as const, effectiveFrom: '2026-02-01', effectiveTo: null }]
    : ['a', 'b'].map((versionId) => ({ versionId, kind: 'BASE' as const, disciplinaId: null, amountCents: 100, currency: 'ARS', rule: 'FULL_MONTH' as const, effectiveFrom: '2026-01-01', effectiveTo: null }))
const service = new AssessmentService(db(), { repository: { listAssessmentFacts: vi.fn().mockResolvedValue({ member: { socioId: 'member-1', fechaAlta: '2026-01-01', enrollments: [] }, prices, obligations: [] }), resolveBenefitRuleCandidates: vi.fn().mockResolvedValue([]) } as never, now: () => new Date('2026-02-15T12:00:00Z') })
const result = await service.preview({ ...context, role: 'TESORERO', socioId: 'member-1', fromPeriod: '2026-01', throughPeriod: '2026-02' })
expect(result).toMatchObject({ executable: false, issues: expect.arrayContaining([expect.objectContaining({ code: expected })]) })
expect(result.periods).toHaveLength(2)
  })

  it('returns an authorized generation presentation without transactions, receipts, locks, or audit', async () => {
const loadPlan = vi.fn().mockResolvedValue(generationPlan())
const database = db(), repository = generationRepository()
const service = new AssessmentService(database, { repository, loadPlan } as never)
const command: PlanGenerationCommand = { role: 'TESORERO', period }
await expect(service.planGeneration(command)).resolves.toEqual({ ...generationPlan().presentation, fingerprint: 'f'.repeat(64), canGenerate: true })
await expect(service.planGeneration({ ...command, role: 'ADMIN' })).resolves.toEqual({ ...generationPlan().presentation, fingerprint: 'f'.repeat(64), canGenerate: true })
await expect(service.planGeneration({ role: 'OPERADOR', period })).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_PERMISSIONS })
expect((database as { transaction: ReturnType<typeof vi.fn> }).transaction).not.toHaveBeenCalled()
expect(repository.claimReceipt).not.toHaveBeenCalled()
expect(repository.lockPeriod).not.toHaveBeenCalled()
  })

  it('executes READY payloads verbatim in a repeatable-read transaction and audits benefits', async () => {
const audit = auditLog(), repository = generationRepository(), payload = readyPayload()
const database = db(), loadPlan = vi.fn().mockResolvedValue(generationPlan([readyEntry(payload)]))
const service = new AssessmentService(database, { repository, audit: audit.emit, loadPlan, now: () => new Date('2026-02-10T00:00:00Z') } as never)
    await expect(service.generate({ ...context, period, planFingerprint: 'f'.repeat(64) })).resolves.toEqual({ period, generatedObligationCount: 1, retainedExistingCount: 0, reviewCount: 0, generatedTotalCents: 3100 })
    expect((database as { transaction: ReturnType<typeof vi.fn> }).transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'repeatable read' })
    const calls = [
      repository.claimReceipt.mock.invocationCallOrder[0],
      repository.lockPeriod.mock.invocationCallOrder[0],
      loadPlan.mock.invocationCallOrder[0],
      repository.insertObligationInTransaction.mock.invocationCallOrder[0],
    ].map((order) => {
      expect(order).toBeDefined()
      return order!
    })
    expect(calls).toEqual([...calls].sort((left, right) => left - right))
    const insertion = repository.insertObligationInTransaction.mock.calls[0]?.[1] as { components: unknown; snapshot: { payload: unknown } }
    expect(insertion.components).toEqual(payload.components)
    expect(insertion.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'BASE', disciplinaId: null }),
        expect.objectContaining({ kind: 'SPORT', disciplinaId: 'discipline-1' }),
      ]),
    )
    expect(insertion.snapshot.payload).toEqual(payload.snapshot)
    expect(audit.records.find((record) => record.action === AuditAction.DUES_BENEFIT_APPLIED)).toMatchObject({
      entityId: payload.benefitAudits[0]?.id,
      newValue: { obligationId: 'created-1', benefit: payload.benefitAudits[0] },
      payload: { obligationId: 'created-1', benefit: payload.benefitAudits[0] },
    })
  })

  it('replays a finalized generation before loading its plan', async () => {
const result = { period, generatedObligationCount: 1, retainedExistingCount: 0, reviewCount: 0, generatedTotalCents: 3100 }
const repository = generationRepository({ status: 'replayed', receipt: {}, result }), loadPlan = vi.fn()
const service = new AssessmentService(db(), { repository, loadPlan } as never)
await expect(service.generate({ ...context, period, planFingerprint: 'f'.repeat(64) })).resolves.toEqual(result)
expect(repository.lockPeriod).not.toHaveBeenCalled()
expect(loadPlan).not.toHaveBeenCalled()
expect(repository.insertObligationInTransaction).not.toHaveBeenCalled()
expect(repository.finalizeReceipt).not.toHaveBeenCalled()
  })

  it.each([['stale', generationPlan(), '0'.repeat(64)], ['conflict', generationPlan([{ ...readyEntry(readyPayload()), status: 'CONFLICT' }]), 'f'.repeat(64)]])('rejects %s plans before inserts', async (_case, plan, planFingerprint) => {
const audit = auditLog(), repository = generationRepository()
const service = new AssessmentService(db(), { repository, audit: audit.emit, loadPlan: vi.fn().mockResolvedValue(plan) } as never)
await expect(service.generate({ ...context, period, planFingerprint })).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
expect(repository.insertObligationInTransaction).not.toHaveBeenCalled()
expect(audit.records).toEqual([])
expect(repository.finalizeReceipt).not.toHaveBeenCalled()
  })

  it('skips REVIEW entries, retaining existing obligations without inserting them', async () => {
const repository = generationRepository(), audit = auditLog()
const review = { ...readyEntry(readyPayload()), status: 'REVIEW', existingObligationId: 'existing', insertion: { disposition: 'SKIP' } }
const service = new AssessmentService(db(), { repository, audit: audit.emit, loadPlan: vi.fn().mockResolvedValue(generationPlan([review])) } as never)
await expect(service.generate({ ...context, period, planFingerprint: 'f'.repeat(64) })).resolves.toMatchObject({ retainedExistingCount: 1, reviewCount: 1, generatedObligationCount: 0, generatedTotalCents: 0 })
expect(repository.insertObligationInTransaction).not.toHaveBeenCalled()
  })
})

const period = { start: '2026-02-01', end: '2026-03-01' }
const readyPayload = () => ({
  amountCents: 3100,
  components: [
    {
      kind: 'BASE',
      componentKey: 'base',
      amountCents: 3100,
      disciplinaId: null,
      calculationInputs: { source: 'payload' },
      eligibilitySnapshot: { eligible: true },
      priceSnapshot: { price: 'p' },
    },
    {
      kind: 'SPORT',
      componentKey: 'sport:enrollment-1',
      amountCents: 1200,
      disciplinaId: 'discipline-1',
      enrollmentId: 'enrollment-1',
      calculationInputs: { source: 'payload' },
      eligibilitySnapshot: { enrollment: { disciplineId: 'discipline-1' } },
      priceSnapshot: { price: 'sport-p' },
    },
  ],
  benefitAudits: [
    {
      id: 'benefit-1',
      requestedAmountCents: 500,
      appliedAmountCents: 500,
      truncatedAmountCents: 0,
      remainingBeforeCents: 3100,
      remainingAfterCents: 2600,
      ruleSnapshot: { kind: 'FIXED_DISCOUNT' },
      sourceSnapshot: { benefitId: 'benefit-1' },
    },
  ],
  snapshot: { immutable: 'payload' },
})
const readyEntry = (payload: ReturnType<typeof readyPayload>) => ({
  memberId: 'member-1',
  existingObligationId: null,
  status: 'READY' as const,
  insertion: { disposition: 'INSERT' as const, payload },
})
const generationPlan = (entries: Array<{ status: string }> = [readyEntry(readyPayload())]) => ({
  internal: { fingerprint: 'f'.repeat(64), entries },
  presentation: {
    period: '2026-02',
    currency: 'ARS',
    summary: {
      memberCount: entries.length,
      readyCount: entries.filter((entry) => entry.status === 'READY').length,
      reviewCount: entries.filter((entry) => entry.status === 'REVIEW').length,
      conflictCount: entries.filter((entry) => entry.status === 'CONFLICT').length,
      estimatedNewTotalCents: 3100,
    },
    members: [],
  },
})
const generationRepository = (
  claim: unknown = {
    status: 'claimed',
    receipt: { id: 'receipt-1', requestFingerprint: context.requestFingerprint },
  },
) => ({
  claimReceipt: vi.fn().mockResolvedValue(claim),
  finalizeReceipt: vi.fn(),
  lockPeriod: vi.fn(),
  lockRange: vi.fn(),
  listEligibleMembers: vi.fn(),
  listEffectivePrices: vi.fn(),
  findObligation: vi.fn(),
  insertObligation: vi.fn(),
  insertObligationInTransaction: vi.fn().mockResolvedValue({ obligation: { id: 'created-1' } }),
})
