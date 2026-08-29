import { describe, expect, it, vi } from 'vitest'
import { AuditAction, type AuditRecord } from '@athlos/audit'
import { ErrorCode } from '@athlos/errors'
import { AssessmentService, PricingService, type AuditContext } from './service.ts'
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

    await expect(service.generate({ ...context, period: result.period })).resolves.toEqual(result)
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
const service = new AssessmentService(db(), { repository: { listAssessmentFacts: vi.fn().mockResolvedValue({ member: { socioId: 'member-1', fechaAlta: '2026-01-01', enrollments: [] }, prices, obligations: [] }) } as never, now: () => new Date('2026-02-15T12:00:00Z') })
const result = await service.preview({ ...context, role: 'TESORERO', socioId: 'member-1', fromPeriod: '2026-01', throughPeriod: '2026-02' })
expect(result).toMatchObject({ executable: false, issues: expect.arrayContaining([expect.objectContaining({ code: expected })]) })
expect(result.periods).toHaveLength(2)
  })
})
