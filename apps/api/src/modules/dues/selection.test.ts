import { expect, it, vi, type Mock } from 'vitest'
import { ErrorCode } from '@athlos/errors'
import { selectFullOutstanding } from './allocations.ts'

const socioId = '00000000-0000-4000-8000-000000000001'
const first = '00000000-0000-4000-8000-000000000002'
const second = '00000000-0000-4000-8000-000000000003'
const db = (rows: unknown[]) =>
  ({ execute: vi.fn().mockResolvedValue({ rows }) }) as never as Parameters<
    typeof selectFullOutstanding
  >[0] & { execute: Mock }
const open = (id: string, overrides = {}) => ({
  id,
  socioId,
  currency: 'ARS',
  outstanding: '100.00',
  ...overrides,
})

it('requires explicit non-empty unique obligation ids before any read', async () => {
  const database = db([])
  await expect(
    selectFullOutstanding(database, { socioId, obligationIds: [] }),
  ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })
  await expect(
    selectFullOutstanding(database, { socioId, obligationIds: [first, first] }),
  ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })
  expect(database.execute).not.toHaveBeenCalled()
})

it('locks canonical ids and derives exact full outstanding allocations and a stable fingerprint', async () => {
  const database = db([open(second, { outstanding: '25.00' }), open(first)])
  const selection = await selectFullOutstanding(database, {
    socioId,
    obligationIds: [second, first],
  })
  expect(selection).toMatchObject({
    socioId,
    currency: 'ARS',
    totalCents: 12_500,
    allocations: [
      { obligationId: first, amountCents: 10_000 },
      { obligationId: second, amountCents: 2_500 },
    ],
  })
  expect(selection.fingerprint).toMatch(/^[a-f0-9]{64}$/)
  const replay = await selectFullOutstanding(
    db([open(first), open(second, { outstanding: '25.00' })]),
    { socioId, obligationIds: [first, second] },
  )
  expect(replay.fingerprint).toBe(selection.fingerprint)
  expect(database.execute).toHaveBeenCalledOnce()
})

it.each([
  ['foreign', [open(first, { socioId: 'other' })]],
  ['paid', [open(first, { outstanding: '0.00' })]],
  ['over-allocated', [open(first, { outstanding: '-1.00' })]],
  ['mixed-currency', [open(first), open(second, { currency: 'USD' })]],
  ['missing', [open(first)]],
])('rejects %s selection without financial mutation', async (_case, rows) => {
  const database = db(rows)
  await expect(
    selectFullOutstanding(database, {
      socioId,
      obligationIds:
        _case === 'missing' ? [first, second] : [first, ...(rows.length > 1 ? [second] : [])],
    }),
  ).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
  expect(database.execute).toHaveBeenCalledTimes(1)
})

it('rejects a stale reviewed fingerprint after locked facts change', async () => {
  const reviewed = await selectFullOutstanding(db([open(first)]), {
    socioId,
    obligationIds: [first],
  })
  await expect(
    selectFullOutstanding(db([open(first, { outstanding: '99.00' })]), {
      socioId,
      obligationIds: [first],
      selectionFingerprint: reviewed.fingerprint,
    }),
  ).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
})
