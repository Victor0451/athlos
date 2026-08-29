import { describe, expect, it, vi } from 'vitest'
vi.mock('@athlos/audit', async (load) => ({ ...(await load()), emitAudit: vi.fn() }))
import {
  reconcileTenders,
  recordSettlementTenderInTransaction,
  type SettlementTenderInput,
} from './cash-desk.ts'

const db = (...results: { rows?: Record<string, unknown>[] }[]) => {
  let calls = 0
  return { execute: async () => results[calls++] ?? { rows: [] }, calls: () => calls }
}
const call = (tx: object, input: SettlementTenderInput) =>
  recordSettlementTenderInTransaction(tx as never, input)
const tenders = ['CASH', 'DEBIT', 'CREDIT', 'TRANSFER'] as const
const tenderMovements = tenders.map((tender, index) => ({
  tender,
  direction: 'INCOME' as const,
  amountCents: index + 1,
}))
const fixture = (tender = 'CASH') => {
  const now = new Date().toISOString()
  const shift = {
    id: 'shift-1',
    status: 'OPEN',
    assigned_operator_id: 'operator-1',
    opened_at: now,
  }
  const row = {
    id: 'tender-1',
    shift_id: shift.id,
    direction: 'INCOME',
    tender,
    amount: '12.50',
    source_type: 'SETTLEMENT',
    source_id: 'settlement-1',
  }
  const input: SettlementTenderInput = {
    actorId: 'operator-1',
    role: 'ADMIN',
    permissions: ['dues:settle'],
    sourceIp: '127.0.0.1',
    callerKey: 'settlement-key',
    requestFingerprint: 'a'.repeat(64),
    authorizationEvidence: { role: 'ADMIN' },
    shiftId: shift.id,
    settlementId: row.source_id,
    tender: 'CASH',
  }
  return {
    input,
    row,
    shift,
    success: db(
      { rows: [] },
      { rows: [shift] },
      { rows: [{ kind: 'MONETARY', amount: '12.50' }] },
      { rows: [row] },
    ),
  }
}
const failure = (name: string) => {
  const { shift } = fixture()
  const empty = { rows: [] }
  const cases = {
    'unsupported tender': db(),
    'missing shift': db(empty, empty),
    'closed shift': db(empty, { rows: [{ ...shift, status: 'CLOSED' }] }),
    'expired shift': db(empty, { rows: [{ ...shift, opened_at: '2000-01-01T00:00:00.000Z' }] }),
    'missing settlement': db(empty, { rows: [shift] }, empty),
    'NON_CASH settlement': db(
      empty,
      { rows: [shift] },
      { rows: [{ kind: 'NON_CASH', amount: '1.00' }] },
    ),
  }
  return cases[name as keyof typeof cases]
}

describe('recordSettlementTenderInTransaction', () => {
  it('uses only its caller transaction and derives a MONETARY SETTLEMENT amount', async () => {
    const { input, success } = fixture()
    await expect(call(success, input)).resolves.toMatchObject({
      amountCents: 1250,
      sourceType: 'SETTLEMENT',
      sourceId: 'settlement-1',
    })
    expect(success.calls()).toBe(4)
  })
  it.each(tenders)('%s is supported', async (tender) => {
    const { input, success } = fixture(tender)
    await expect(call(success, { ...input, tender })).resolves.toMatchObject({ tender })
  })
  it('replays or conflicts deterministically', async () => {
    const { input, row } = fixture()
    const replay = { ...row, request_fingerprint: 'a'.repeat(64) }
    await expect(call(db({ rows: [replay] }), input)).resolves.toMatchObject({ id: row.id })
    await expect(
      call(db({ rows: [{ ...replay, request_fingerprint: 'b'.repeat(64) }] }), input),
    ).rejects.toThrow('different tender')
  })
  it.each([
    ['unsupported tender', 'CARD', 'supported'],
    ['missing shift', 'CASH', 'shift'],
    ['closed shift', 'CASH', 'shift'],
    ['expired shift', 'CASH', '24 hours'],
    ['missing settlement', 'CASH', 'Settlement'],
    ['NON_CASH settlement', 'CASH', 'Non-cash'],
  ])('rejects %s', async (name, tender, message) => {
    const { input } = fixture()
    await expect(call(failure(name), { ...input, tender: tender as never })).rejects.toThrow(
      message,
    )
  })
  it('counts only CASH as expected physical balance', () =>
    expect(reconcileTenders({}, tenderMovements, { CASH: 1 })).toMatchObject({
      expected: { CASH: 1 },
    }))
})
