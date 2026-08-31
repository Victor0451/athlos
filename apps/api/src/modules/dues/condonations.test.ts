import { expect, it, vi } from 'vitest'
import { ErrorCode } from '@athlos/errors'
import { emitAudit } from '@athlos/audit'
import { CondonationExecutionService } from './condonations.ts'

vi.mock('@athlos/audit', () => ({
  AuditAction: { CONDONATION_EXECUTED: 'CONDONATION_EXECUTED' },
  emitAudit: vi.fn().mockResolvedValue({ inserted: true, id: 'audit-1' }),
}))

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
  actionId: '00000000-0000-4000-8000-000000000006',
}
const selection = {
  memberId: ids.member,
  currency: 'ARS',
  treatments: [{ obligationId: ids.obligation, amountCents: 12500 }],
}
const treatmentIds = ['00000000-0000-4000-8000-000000000007']
const receipt = {
  executionId: ids.execution,
  approvalId: ids.approval,
  memberId: ids.member,
  actorId: ids.actor,
  currency: 'ARS',
  totalAmountCents: 12500,
  treatments: selection.treatments,
  treatmentIds: [],
}

function setup() {
  const repository = {
    findReceipt: vi.fn().mockResolvedValue(null),
    lockApproval: vi.fn().mockResolvedValue(approval),
    lockOutstanding: vi.fn().mockResolvedValue(selection),
    appendReceipt: vi.fn().mockResolvedValue(receipt),
    appendTreatments: vi.fn().mockResolvedValue(treatmentIds),
    consumeApproval: vi.fn().mockResolvedValue(true),
  }
  const db = { transaction: vi.fn(async (work: (tx: unknown) => unknown) => work({})) } as never
  return { repository, db, service: new CondonationExecutionService(db, { repository }) }
}

it('executes the immutable approved snapshot once and replays its exact receipt', async () => {
  const { repository, service } = setup()
  await expect(service.execute(command)).resolves.toEqual({
    ...receipt,
    treatmentIds,
    status: 'executed',
  })
  expect(repository.appendTreatments).toHaveBeenCalledWith(expect.anything(), {
    ...receipt,
    snapshot: approval.condonationSnapshot,
    reason: approval.requestReason,
    evidence: approval.requestEvidence,
  })
  repository.findReceipt.mockResolvedValue({ ...receipt, treatmentIds })
  await expect(service.execute(command)).resolves.toEqual({
    ...receipt,
    treatmentIds,
    status: 'replayed',
  })
  expect(repository.lockApproval).toHaveBeenCalledTimes(1)
  expect(repository.appendTreatments).toHaveBeenCalledTimes(1)
})

it('audits only the first successful approved execution without cash claims', async () => {
  const { repository, service } = setup()
  await expect(
    service.executeApproved({
      requestId: approval.actionId,
      executionId: ids.execution,
      actorId: ids.actor,
      callerKey: 'condonation-execution-1',
      sourceIp: '127.0.0.1',
    }),
  ).resolves.toEqual({ ...receipt, treatmentIds, status: 'executed' })
  expect(emitAudit).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      action: 'CONDONATION_EXECUTED',
      oldValue: { debt_amount_cents: 12500 },
      newValue: { debt_amount_cents: 0 },
      callerKey: 'condonation-execution-1',
    }),
  )
  repository.findReceipt.mockResolvedValue({ ...receipt, treatmentIds })
  await service.executeApproved({
    requestId: approval.actionId,
    executionId: ids.execution,
    actorId: ids.actor,
    callerKey: 'condonation-execution-1',
    sourceIp: '127.0.0.1',
  })
  expect(emitAudit).toHaveBeenCalledTimes(1)
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
