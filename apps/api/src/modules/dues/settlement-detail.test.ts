import { describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '@athlos/errors'
import { getSettlementDetail } from './settlement-detail.ts'

const settlementId = '00000000-0000-4000-8000-000000000040'
const socioId = '00000000-0000-4000-8000-000000000001'
const allocation = {
  id: '00000000-0000-4000-8000-000000000050',
  obligationId: '00000000-0000-4000-8000-000000000060',
  socioId,
  currency: 'ARS',
  periodStart: '2026-01-01',
  periodEnd: '2026-02-01',
  amount: '125.00',
}
const facts = (overrides: Record<string, unknown> = {}) => ({
  id: settlementId,
  socioId,
  operatorId: socioId,
  kind: 'MONETARY',
  reversalOfSettlementId: null,
  amount: '125.00',
  currency: 'ARS',
  createdAt: new Date('2026-01-15T12:30:00.000Z'),
  memberId: socioId,
  memberNumber: '123',
  memberFirstName: 'Ada',
  memberLastName: 'Lovelace',
  tenders: [{ tender: 'TRANSFER', amount: '125.00', operatorId: socioId }],
  allocations: [allocation],
  reversal: [],
  ...overrides,
})
const db = (row: unknown) => ({ execute: vi.fn().mockResolvedValue({ rows: row ? [row] : [] }) })

describe('getSettlementDetail', () => {
  it('authorizes before querying', async () => {
    const database = db(facts())
    await expect(
      getSettlementDetail(database as never, 'OPERADOR', settlementId),
    ).rejects.toMatchObject({
      code: ErrorCode.INSUFFICIENT_PERMISSIONS,
    })
    expect(database.execute).not.toHaveBeenCalled()
  })

  it('reads current identity and original financial facts in one snapshot', async () => {
    const database = db(facts())
    const result = await getSettlementDetail(database as never, 'TESORERO', settlementId)
    expect(result).toEqual({
      settlement_id: settlementId,
      socio_id: socioId,
      member: { id: socioId, numero_socio: '123', nombre: 'Ada', apellido: 'Lovelace' },
      confirmed_at: '2026-01-15T12:30:00.000Z',
      amount_cents: 12500,
      currency: 'ARS',
      tender: 'TRANSFER',
      allocations: [
        {
          id: allocation.id,
          obligation_id: allocation.obligationId,
          period_start: '2026-01-01',
          period_end: '2026-02-01',
          amount_cents: 12500,
        },
      ],
      reversal: null,
    })
    expect(database.execute).toHaveBeenCalledTimes(1)
  })

  it('decodes the reversal timestamp as serialized by PostgreSQL JSON', async () => {
    const result = await getSettlementDetail(
      db(
        facts({
          reversal: [
            {
              settlementId: '00000000-0000-4000-8000-000000000041',
              createdAt: '2026-01-16T09:00:00+00:00',
            },
          ],
        }),
      ) as never,
      'ADMIN',
      settlementId,
    )
    expect(result.reversal).toEqual({
      settlement_id: '00000000-0000-4000-8000-000000000041',
      confirmed_at: '2026-01-16T09:00:00.000Z',
    })
  })

  it.each([
    ['missing', null],
    ['non-monetary', facts({ kind: 'NON_CASH' })],
    ['reversal record', facts({ reversalOfSettlementId: settlementId })],
  ])('does not expose a %s payment', async (_name, row) => {
    await expect(
      getSettlementDetail(db(row) as never, 'ADMIN', settlementId),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
  })

  it.each([
    ['no tender', { tenders: [] }],
    ['duplicate tender', { tenders: [...facts().tenders, ...facts().tenders] }],
    ['wrong tender amount', { tenders: [{ ...facts().tenders[0], amount: '124.99' }] }],
    ['wrong tender operator', { tenders: [{ ...facts().tenders[0], operatorId: settlementId }] }],
    ['unsupported tender', { tenders: [{ ...facts().tenders[0], tender: 'UNKNOWN' }] }],
    ['no allocations', { allocations: [] }],
    ['wrong allocation total', { allocations: [{ ...allocation, amount: '124.99' }] }],
    ['wrong allocation currency', { allocations: [{ ...allocation, currency: 'USD' }] }],
    ['wrong allocation member', { allocations: [{ ...allocation, socioId: settlementId }] }],
    ['invalid period', { allocations: [{ ...allocation, periodStart: '2026-02-30' }] }],
    ['inverted period', { allocations: [{ ...allocation, periodEnd: '2025-01-01' }] }],
    ['missing member', { memberId: null }],
    ['wrong member', { memberId: settlementId }],
    ['invalid timestamp', { createdAt: 'not-a-date' }],
    ['zero amount', { amount: '0.00' }],
    ['fractional cents', { amount: '125.001' }],
    ['amount beyond database bound', { amount: '1000000000000.00' }],
    ['unsafe amount', { amount: '90071992547409.92' }],
  ])('fails closed for %s', async (_name, overrides) => {
    await expect(
      getSettlementDetail(db(facts(overrides)) as never, 'ADMIN', settlementId),
    ).rejects.toMatchObject({ code: ErrorCode.SERVICE_UNAVAILABLE })
  })

  it('does not expose database errors', async () => {
    const database = { execute: vi.fn().mockRejectedValue(new Error('internal database details')) }
    await expect(
      getSettlementDetail(database as never, 'ADMIN', settlementId),
    ).rejects.toMatchObject({
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: 'Settlement detail is unavailable',
    })
  })
})
