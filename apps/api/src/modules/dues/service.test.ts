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
      listEligibleMembers: vi.fn(),
      listEffectivePrices: vi.fn(),
      findObligation: vi.fn(),
      insertObligation: vi.fn(),
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
})
