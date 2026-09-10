import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetchMock = vi.fn()
vi.mock('@/lib/api', () => ({ apiFetch: apiFetchMock }))
const { getSettlementDetail } = await import('./settlement-detail')
const settlementId = '00000000-0000-4000-8000-000000000014'
const socioId = '00000000-0000-4000-8000-000000000010'
const allocation = {
  id: '00000000-0000-4000-8000-000000000018',
  obligation_id: '00000000-0000-4000-8000-000000000011',
  period_start: '2026-01-01',
  period_end: '2026-02-01',
  amount_cents: 10000,
}
const detail = {
  settlement_id: settlementId,
  socio_id: socioId,
  member: { id: socioId, numero_socio: '42', nombre: 'Ana', apellido: 'Gorriti' },
  confirmed_at: '2026-01-15T12:00:00.000Z',
  amount_cents: 10000,
  currency: 'ARS',
  tender: 'CASH',
  allocations: [allocation],
  reversal: null,
}

describe('settlement detail API client', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
  })

  it('retrieves current member identity and stored payment facts with GET only', async () => {
    apiFetchMock.mockResolvedValueOnce(detail)
    await expect(getSettlementDetail(settlementId, socioId)).resolves.toEqual(detail)
    expect(apiFetchMock).toHaveBeenCalledTimes(1)
    expect(apiFetchMock).toHaveBeenCalledWith(`/api/v1/dues/settlements/${settlementId}`, {
      method: 'GET',
      headers: { 'cache-control': 'no-store' },
    })
  })

  it('retains the original payment and linked reversal', async () => {
    const reversed = {
      ...detail,
      reversal: {
        settlement_id: '00000000-0000-4000-8000-000000000019',
        confirmed_at: '2026-01-16T12:00:00.000Z',
      },
    }
    apiFetchMock.mockResolvedValueOnce(reversed)
    await expect(getSettlementDetail(settlementId, socioId)).resolves.toEqual(reversed)
  })

  it.each([
    null,
    {},
    { ...detail, member: null },
    { ...detail, member: { ...detail.member, apellido: undefined } },
    { ...detail, settlement_id: socioId },
    { ...detail, socio_id: settlementId },
    { ...detail, member: { ...detail.member, id: settlementId } },
    { ...detail, amount_cents: 10001 },
    { ...detail, amount_cents: 10000.1 },
    { ...detail, amount_cents: 100000000000000 },
    { ...detail, allocations: [] },
    { ...detail, allocations: [{ ...allocation, amount_cents: 9999 }] },
    { ...detail, allocations: [{ ...allocation, id: '' }] },
    { ...detail, tender: 'CHECK' },
    { ...detail, currency: 'pesos' },
    { ...detail, confirmed_at: 'not-a-date' },
    { ...detail, allocations: [{ ...allocation, period_start: '2026-02-30' }] },
    { ...detail, allocations: [{ ...allocation, period_end: '2026-01-01' }] },
    { ...detail, reversal: undefined },
    { ...detail, reversal: {} },
    { ...detail, reversal: { settlement_id: settlementId, confirmed_at: 'invalid' } },
  ])('rejects incomplete or inconsistent data: %#', async (payload) => {
    apiFetchMock.mockResolvedValueOnce(payload)
    await expect(getSettlementDetail(settlementId, socioId)).rejects.toThrow(
      'Settlement detail response was incomplete',
    )
  })

  it('propagates a failed read without a write or automatic retry', async () => {
    apiFetchMock.mockRejectedValueOnce(new Error('Network unavailable'))
    await expect(getSettlementDetail(settlementId, socioId)).rejects.toThrow('Network unavailable')
    expect(apiFetchMock).toHaveBeenCalledTimes(1)
  })
})
