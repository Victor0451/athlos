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

// prettier-ignore
it('composes every claim, allocation, work, and audit write on the one transaction it opens', async () => {
  const tx = Symbol('tx'), audit = vi.fn().mockResolvedValue({ inserted: true as const, id: 'audit-1' }), repository = { claimSettlement: vi.fn().mockResolvedValue({ status: 'claimed', settlement: { id: 'settlement-1' }, allocations: [{ id: 'allocation-1' }] }), insertAllocation: vi.fn().mockResolvedValue({ id: 'allocation-1' }), createCommunityWork: vi.fn().mockResolvedValue({ id: 'work-1', settlementId: 'settlement-1', amountCents: 4_000, obligationId: 'obligation-1' }), findCommunityWork: vi.fn() }
  const transaction = vi.fn(async (work: (value: unknown) => unknown) => work(tx))
  await new CommunityWorkService({ transaction } as never, { repository, audit }).create({ ...context, socioId: 'socio-1', obligationId: 'obligation-1', amountCents: 4_000, evidence: { approvalId: 'approval-1' }, reason: 'Approved work' })
  expect(transaction).toHaveBeenCalledTimes(1)
  for (const call of [...repository.claimSettlement.mock.calls, ...repository.insertAllocation.mock.calls, ...repository.createCommunityWork.mock.calls, ...audit.mock.calls]) expect(call[0]).toBe(tx)
})

// prettier-ignore
it('emits the community-work audit with actor, caller key, fingerprint, and time metadata', async () => {
  const audit = vi.fn().mockResolvedValue({ inserted: true as const, id: 'audit-1' }), repository = { claimSettlement: vi.fn().mockResolvedValue({ status: 'claimed', settlement: { id: 'settlement-1' }, allocations: [{ id: 'allocation-1' }] }), insertAllocation: vi.fn().mockResolvedValue({ id: 'allocation-1' }), createCommunityWork: vi.fn().mockResolvedValue({ id: 'work-1', settlementId: 'settlement-1', amountCents: 4_000, obligationId: 'obligation-1' }), findCommunityWork: vi.fn() }
  await new CommunityWorkService(db(), { repository, audit, now: () => new Date('2026-09-16T12:00:00Z') }).create({ ...context, socioId: 'socio-1', obligationId: 'obligation-1', amountCents: 4_000, evidence: { approvalId: 'approval-1' }, reason: 'Approved work' })
  expect(audit.mock.calls[2]![1]).toEqual(expect.objectContaining({ action: AuditAction.DUES_COMMUNITY_WORK_CREATED, operatorId: context.actorId, sourceIp: context.sourceIp, callerKey: context.callerKey, metadata: expect.objectContaining({ actorId: context.actorId, role: 'TESORERO', permissions: context.permissions, authorizationEvidence: context.authorizationEvidence, callerKey: context.callerKey, requestFingerprint: context.requestFingerprint, reason: 'Approved work', time: '2026-09-16T12:00:00.000Z' }) }))
})

// prettier-ignore
it.each([['a whitespace-only reason', { reason: '   ' }], ['an evidence-free command', { evidence: {} }]])('rejects a community-work command with %s before opening a transaction', async (_label, override) => {
  const repository = { claimSettlement: vi.fn() }
  await expect(new CommunityWorkService(db(), { repository }).create({ ...context, socioId: 'socio-1', obligationId: 'obligation-1', amountCents: 4_000, evidence: { approvalId: 'approval-1' }, reason: 'Approved work', ...override })).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })
  expect(repository.claimSettlement).not.toHaveBeenCalled()
})

// prettier-ignore
it('exposes a transaction-accepting primitive that composes the same writes without opening its own transaction', async () => {
  const tx = Symbol('tx'), audit = vi.fn().mockResolvedValue({ inserted: true as const, id: 'audit-1' }), repository = { claimSettlement: vi.fn().mockResolvedValue({ status: 'claimed', settlement: { id: 'settlement-1' }, allocations: [{ id: 'allocation-1' }] }), insertAllocation: vi.fn().mockResolvedValue({ id: 'allocation-1' }), createCommunityWork: vi.fn().mockResolvedValue({ id: 'work-1', settlementId: 'settlement-1', amountCents: 4_000, obligationId: 'obligation-1' }), findCommunityWork: vi.fn() }
  const transaction = vi.fn(async (work: (value: unknown) => unknown) => work(tx))
  const result = await new CommunityWorkService({ transaction } as never, { repository, audit }).createInTransaction(tx as never, { ...context, socioId: 'socio-1', obligationId: 'obligation-1', amountCents: 4_000, evidence: { approvalId: 'approval-1' }, reason: 'Approved work' })
  expect(result).toMatchObject({ settlementId: 'settlement-1', allocationId: 'allocation-1', replayed: false })
  for (const call of [...repository.claimSettlement.mock.calls, ...repository.insertAllocation.mock.calls, ...repository.createCommunityWork.mock.calls, ...audit.mock.calls]) expect(call[0]).toBe(tx)
  expect(transaction).not.toHaveBeenCalled()
})

// prettier-ignore
it('writes no community work or audit after an allocation failure inside the primitive', async () => {
  const audit = vi.fn(), repository = { claimSettlement: vi.fn().mockResolvedValue({ status: 'claimed', settlement: { id: 'settlement-1' }, allocations: [] }), insertAllocation: vi.fn().mockRejectedValue(new Error('allocation guard')), createCommunityWork: vi.fn(), findCommunityWork: vi.fn() }
  await expect(new CommunityWorkService(db(), { repository, audit }).createInTransaction({} as never, { ...context, socioId: 'socio-1', obligationId: 'obligation-1', amountCents: 4_000, evidence: { approvalId: 'approval-1' }, reason: 'Approved work' })).rejects.toThrow('allocation guard')
  expect(repository.createCommunityWork).not.toHaveBeenCalled()
  expect(audit).not.toHaveBeenCalled()
})
