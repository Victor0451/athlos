import { beforeEach, expect, it, vi } from 'vitest'
import { ErrorCode } from '@athlos/errors'
import { emitAudit } from '@athlos/audit'
import { CommunityWorkExecutionService } from './community-work-execution.ts'

vi.mock('@athlos/audit', () => ({
  AuditAction: { COMMUNITY_WORK_EXECUTED: 'COMMUNITY_WORK_EXECUTED' },
  emitAudit: vi.fn().mockResolvedValue({ inserted: true, id: 'audit-1' }),
}))

const ids = {
  execution: '00000000-0000-4000-8000-000000000001',
  approval: '00000000-0000-4000-8000-000000000002',
  socio: '00000000-0000-4000-8000-000000000003',
  actor: '00000000-0000-4000-8000-000000000004',
  obligation: '00000000-0000-4000-8000-000000000005',
  work: '00000000-0000-4000-8000-000000000006',
  settlement: '00000000-0000-4000-8000-000000000007',
  allocation: '00000000-0000-4000-8000-000000000008',
  agreement: '00000000-0000-4000-8000-000000000009',
}
const command = {
  requestId: 'request-1',
  executionId: ids.execution,
  actorId: ids.actor,
  role: 'TESORERO' as const,
  permissions: ['dues:community-work'],
  callerKey: 'http-key-1',
  sourceIp: '127.0.0.1',
}
const approval = {
  id: ids.approval,
  actionId: 'request-1',
  status: 'approved' as const,
  usedAt: null,
  expiresAt: new Date(Date.now() + 60_000),
  executionId: ids.execution,
  decidedByOperatorId: ids.actor,
  requesterKey: 'requester-key-1',
  agreementUuid: null,
  termsVersion: null,
  actorFingerprint: 'fp-1',
  communitySnapshot: {
    memberId: ids.socio,
    obligations: [{ obligationId: ids.obligation, currency: 'ARS', outstandingAmountCents: 6000 }],
  },
  requestReason: 'Approved work',
  requestEvidence: 'case-1',
  decisionReason: 'Approved',
}
const composed = {
  id: ids.work,
  socioId: ids.socio,
  obligationId: ids.obligation,
  agreementId: null,
  settlementId: ids.settlement,
  amountCents: 6000,
  allocationId: ids.allocation,
  replayed: false,
}
const receipt = {
  executionId: ids.execution,
  approvalId: ids.approval,
  requestId: 'request-1',
  socioId: ids.socio,
  obligationId: ids.obligation,
  amountCents: 6000,
  currency: 'ARS',
  workId: ids.work,
  settlementId: ids.settlement,
  allocationId: ids.allocation,
  requesterKey: 'requester-key-1',
  outstandingBeforeCents: 6000,
  outstandingAfterCents: 0,
}
beforeEach(() => vi.mocked(emitAudit).mockClear())

function setup(
  overrides: Record<string, unknown> = {},
  approvalOverrides: Record<string, unknown> = {},
) {
  const repository = {
    findReceipt: vi.fn().mockResolvedValue(null),
    lockApproval: vi.fn().mockResolvedValue({ ...approval, ...approvalOverrides }),
    lockAgreement: vi.fn(),
    outstanding: vi.fn().mockResolvedValue({ currency: 'ARS', outstandingAmountCents: 6000 }),
    composeWork: vi.fn().mockResolvedValue(composed),
    appendExecution: vi
      .fn()
      .mockResolvedValue({ executionReceiptId: '00000000-0000-4000-8000-00000000000b' }),
    consumeApproval: vi.fn().mockResolvedValue(true),
    ...overrides,
  }
  const db = { transaction: vi.fn(async (work: (tx: unknown) => unknown) => work({})) } as never
  return { repository, db, service: new CommunityWorkExecutionService(db, { repository }) }
}

it('executes an approved request once through the transaction primitive and audits exactly once', async () => {
  const { repository, service } = setup()
  const result = await service.executeApproved(command)
  expect(result).toMatchObject({
    executionId: ids.execution,
    workId: ids.work,
    settlementId: ids.settlement,
    allocationId: ids.allocation,
    amountCents: 6000,
    status: 'executed',
  })
  expect(repository.composeWork).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      socioId: ids.socio,
      obligationId: ids.obligation,
      amountCents: 6000,
      callerKey: ids.execution,
      actorId: ids.actor,
      reason: 'Approved work',
      requestFingerprint: expect.any(String),
    }),
  )
  expect(repository.appendExecution).toHaveBeenCalledTimes(1)
  expect(repository.consumeApproval).toHaveBeenCalledWith(expect.anything(), ids.approval)
  expect(emitAudit).toHaveBeenCalledTimes(1)
  expect(vi.mocked(emitAudit).mock.calls[0]![1]).toEqual(
    expect.objectContaining({
      action: 'COMMUNITY_WORK_EXECUTED',
      operatorId: ids.actor,
      callerKey: 'http-key-1',
      entityType: 'community_work_execution',
      entityId: ids.execution,
    }),
  )
})

it('replays the durable receipt without composing, writing, or auditing again', async () => {
  const { repository, service } = setup({ findReceipt: vi.fn().mockResolvedValue(receipt) })
  const result = await service.executeApproved(command)
  expect(result).toMatchObject({
    status: 'replayed',
    workId: ids.work,
    settlementId: ids.settlement,
  })
  expect(repository.composeWork).not.toHaveBeenCalled()
  expect(repository.appendExecution).not.toHaveBeenCalled()
  expect(repository.consumeApproval).not.toHaveBeenCalled()
  expect(emitAudit).not.toHaveBeenCalled()
})

it.each([
  ['a pending approval', { status: 'pending' }],
  ['a rejected approval', { status: 'rejected' }],
  ['an already consumed approval', { usedAt: new Date() }],
  ['an expired approval', { expiresAt: new Date(Date.now() - 1000) }],
  ['a different deciding actor', { decidedByOperatorId: '00000000-0000-4000-8000-00000000000a' }],
])('refuses execution of %s without composing or writing', async (_label, override) => {
  const { repository, service } = setup({}, override)
  await expect(service.executeApproved(command)).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
  expect(repository.composeWork).not.toHaveBeenCalled()
  expect(repository.appendExecution).not.toHaveBeenCalled()
})

it('rejects a request identity mismatch without composing', async () => {
  const { repository, service } = setup({}, { actionId: 'other-request' })
  await expect(service.executeApproved(command)).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
  expect(repository.composeWork).not.toHaveBeenCalled()
})

it('rejects a lost approval claim', async () => {
  const { repository, service } = setup({ lockApproval: vi.fn().mockResolvedValue(null) })
  await expect(service.executeApproved(command)).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
  expect(repository.composeWork).not.toHaveBeenCalled()
})

it.each([
  [5000, 'ARS'],
  [6000, 'USD'],
])(
  'detects a stale snapshot when outstanding drops to %i or currency becomes %s',
  async (outstanding, currency) => {
    const { repository, service } = setup({
      outstanding: vi.fn().mockResolvedValue({ currency, outstandingAmountCents: outstanding }),
    })
    await expect(service.executeApproved(command)).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
    })
    expect(repository.composeWork).not.toHaveBeenCalled()
    expect(repository.appendExecution).not.toHaveBeenCalled()
  },
)

it('revalidates the frozen agreement context at execution time', async () => {
  const agreed = { agreementUuid: ids.agreement, termsVersion: 2 }
  const missing = setup({ lockAgreement: vi.fn().mockResolvedValue(null) }, agreed)
  await expect(missing.service.executeApproved(command)).rejects.toMatchObject({
    code: ErrorCode.CONFLICT,
  })
  expect(missing.repository.composeWork).not.toHaveBeenCalled()
  const drifted = setup({ lockAgreement: vi.fn().mockResolvedValue({ termsVersion: 3 }) }, agreed)
  await expect(drifted.service.executeApproved(command)).rejects.toMatchObject({
    code: ErrorCode.CONFLICT,
  })
  expect(drifted.repository.composeWork).not.toHaveBeenCalled()
  const matching = setup({ lockAgreement: vi.fn().mockResolvedValue({ termsVersion: 2 }) }, agreed)
  const result = await matching.service.executeApproved(command)
  expect(result.status).toBe('executed')
  expect(matching.repository.composeWork).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ agreementId: ids.agreement }),
  )
})

it('refuses a concurrently consumed approval without auditing', async () => {
  const { service } = setup({ consumeApproval: vi.fn().mockResolvedValue(false) })
  await expect(service.executeApproved(command)).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
  expect(emitAudit).not.toHaveBeenCalled()
})

it('requires the execution identity before touching the repository', async () => {
  const { repository, service } = setup()
  for (const field of ['requestId', 'executionId', 'actorId', 'callerKey'] as const) {
    await expect(service.executeApproved({ ...command, [field]: '' })).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
    })
  }
  expect(repository.lockApproval).not.toHaveBeenCalled()
})
