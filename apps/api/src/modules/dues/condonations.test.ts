import { expect, it, vi } from 'vitest'
import { ErrorCode } from '@athlos/errors'
import { CondonationExecutionService } from './condonations.ts'

const ids = {
  execution: '00000000-0000-4000-8000-000000000001',
  approval: '00000000-0000-4000-8000-000000000002',
  member: '00000000-0000-4000-8000-000000000003',
  actor: '00000000-0000-4000-8000-000000000004',
  obligation: '00000000-0000-4000-8000-000000000005',
}
const command = {
  executionId: ids.execution,
  actorId: ids.actor,
  memberId: ids.member,
  obligationIds: [ids.obligation],
}
const approval = {
  id: ids.approval,
  status: 'approved' as const,
  usedAt: null,
  expiresAt: new Date(Date.now() + 60_000),
  executionId: ids.execution,
  decidedByOperatorId: ids.actor,
  condonationSnapshot: {
    memberId: ids.member,
    obligations: [{ obligationId: ids.obligation, currency: 'ARS', outstandingAmountCents: 12500 }],
  },
  requestReason: 'Hardship',
  requestEvidence: 'case-1',
  decisionReason: 'Approved',
  decisionEvidence: 'note-1',
}
const selection = {
  memberId: ids.member,
  currency: 'ARS',
  treatments: [{ obligationId: ids.obligation, amountCents: 12500 }],
}
const receipt = {
  executionId: ids.execution,
  approvalId: ids.approval,
  memberId: ids.member,
  actorId: ids.actor,
  currency: 'ARS',
  totalAmountCents: 12500,
  treatments: selection.treatments,
}

function setup() {
  const repository = {
    findReceipt: vi.fn().mockResolvedValue(null),
    lockApproval: vi.fn().mockResolvedValue(approval),
    lockOutstanding: vi.fn().mockResolvedValue(selection),
    appendReceipt: vi.fn().mockResolvedValue(receipt),
    appendTreatments: vi.fn(),
    consumeApproval: vi.fn().mockResolvedValue(true),
  }
  const db = { transaction: vi.fn(async (work: (tx: unknown) => unknown) => work({})) } as never
  return { repository, db, service: new CondonationExecutionService(db, { repository }) }
}

it('executes the immutable approved snapshot once and replays its exact receipt', async () => {
  const { repository, service } = setup()
  await expect(service.execute(command)).resolves.toEqual({ ...receipt, status: 'executed' })
  expect(repository.appendTreatments).toHaveBeenCalledWith(expect.anything(), {
    ...receipt,
    snapshot: approval.condonationSnapshot,
    reason: approval.requestReason,
    evidence: approval.requestEvidence,
  })
  repository.findReceipt.mockResolvedValue(receipt)
  await expect(service.execute(command)).resolves.toEqual({ ...receipt, status: 'replayed' })
  expect(repository.lockApproval).toHaveBeenCalledTimes(1)
  expect(repository.appendTreatments).toHaveBeenCalledTimes(1)
})

it.each([
  ['pending', { ...approval, status: 'pending' as const }],
  ['expired', { ...approval, expiresAt: new Date(Date.now() - 1) }],
  ['used', { ...approval, usedAt: new Date() }],
  [
    'stale',
    approval,
    { ...selection, treatments: [{ obligationId: ids.obligation, amountCents: 12499 }] },
  ],
])('rejects %s authorization without writes', async (_name, locked, current = selection) => {
  const { repository, service } = setup()
  repository.lockApproval.mockResolvedValue(locked)
  repository.lockOutstanding.mockResolvedValue(current)
  await expect(service.execute(command)).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
  expect(repository.appendReceipt).not.toHaveBeenCalled()
  expect(repository.appendTreatments).not.toHaveBeenCalled()
  expect(repository.consumeApproval).not.toHaveBeenCalled()
})

it('rejects conflicting replay identity or targets without any new treatment', async () => {
  const { repository, service } = setup()
  repository.findReceipt.mockResolvedValue(receipt)
  await expect(service.execute({ ...command, actorId: ids.member })).rejects.toMatchObject({
    code: ErrorCode.CONFLICT,
  })
  await expect(service.execute({ ...command, obligationIds: [] })).rejects.toMatchObject({
    code: ErrorCode.CONFLICT,
  })
  expect(repository.appendTreatments).not.toHaveBeenCalled()
})
