import { expect, it, vi } from 'vitest'
import { AuditAction } from '@athlos/audit'
import { ErrorCode } from '@athlos/errors'
import { CommunityWorkService } from './community-work.ts'
import type { AuditContext } from './service.ts'

// prettier-ignore
const context: AuditContext = { actorId: '00000000-0000-4000-8000-000000000001', role: 'TESORERO', permissions: ['dues:community-work'], sourceIp: '127.0.0.1', callerKey: 'work-1', requestFingerprint: 'b'.repeat(64), authorizationEvidence: { role: 'TESORERO' } }
// prettier-ignore
const db = () => ({ transaction: vi.fn(async (work: (value: unknown) => unknown) => work({})) }) as never

// prettier-ignore
it('records approved work as a non-cash settlement and explicit allocation', async () => {
  const audit = vi.fn().mockResolvedValue({ inserted: true as const, id: 'audit-1' }), repository = { claimSettlement: vi.fn().mockResolvedValue({ status: 'claimed', settlement: { id: 'settlement-1', socioId: 'socio-1', kind: 'NON_CASH', amountCents: 4_000, currency: 'ARS' } }), insertAllocation: vi.fn().mockResolvedValue({ id: 'allocation-1', obligationId: 'obligation-1', amountCents: 4_000, kind: 'ALLOCATION' }), createCommunityWork: vi.fn().mockResolvedValue({ id: 'work-1', settlementId: 'settlement-1', amountCents: 4_000, obligationId: 'obligation-1' }), findCommunityWork: vi.fn() }
  const result = await new CommunityWorkService(db(), { repository, audit }).create({ ...context, socioId: 'socio-1', obligationId: 'obligation-1', agreementId: 'agreement-1', amountCents: 4_000, evidence: { approvalId: 'approval-1' }, reason: 'Approved work' })
  expect(result).toMatchObject({ settlementId: 'settlement-1', allocationId: 'allocation-1', agreementId: 'agreement-1', replayed: false })
  expect(repository.claimSettlement).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'NON_CASH', amountCents: 4_000 }))
  expect(repository.createCommunityWork).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ agreementId: 'agreement-1', evidence: { approvalId: 'approval-1' }, reason: 'Approved work' }))
  expect(audit.mock.calls.map(([, record]) => record.action)).toEqual([AuditAction.DUES_SETTLEMENT_CREATED, AuditAction.DUES_ALLOCATION_CREATED, AuditAction.DUES_COMMUNITY_WORK_CREATED])
  expect(audit.mock.calls[2]![1]).toEqual(expect.objectContaining({ newValue: expect.objectContaining({ agreementId: 'agreement-1', evidence: { approvalId: 'approval-1' }, reason: 'Approved work' }) }))
})

// prettier-ignore
it('replays an existing community-work claim without creating a second allocation', async () => {
  const repository = { claimSettlement: vi.fn().mockResolvedValue({ status: 'replayed', settlement: { id: 'settlement-1' }, allocations: [{ id: 'allocation-1' }] }), insertAllocation: vi.fn(), createCommunityWork: vi.fn(), findCommunityWork: vi.fn().mockResolvedValue({ id: 'work-1', settlementId: 'settlement-1', obligationId: 'obligation-1', amountCents: 4_000 }) }
  const result = await new CommunityWorkService(db(), { repository, audit: vi.fn() }).create({ ...context, socioId: 'socio-1', obligationId: 'obligation-1', agreementId: 'agreement-1', amountCents: 4_000, evidence: { approvalId: 'approval-1' }, reason: 'Retry approved work' })
  expect(result).toMatchObject({ id: 'work-1', allocationId: 'allocation-1', agreementId: 'agreement-1', replayed: true })
  expect(repository.insertAllocation).not.toHaveBeenCalled()
})

// prettier-ignore
it('rejects an unsafe community-work value before claiming a settlement', async () => { const repository = { claimSettlement: vi.fn() }; await expect(new CommunityWorkService(db(), { repository }).create({ ...context, amountCents: Number.MAX_SAFE_INTEGER, socioId: 'socio-1', obligationId: 'obligation-1', evidence: { approvalId: 'approval-1' }, reason: 'Approved work' })).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR }); expect(repository.claimSettlement).not.toHaveBeenCalled() })
