import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetchMock = vi.fn()
vi.mock('@/lib/api', () => ({ apiFetch: apiFetchMock }))
const {
  createDuesPrice,
  createDuesSettlement,
  generateDuesAssessments,
  getDuesPrices,
  getDebt,
  reverseDuesSettlement,
  revokeDuesPrice,
} = await import('./dues')

describe('typed native dues client', () => {
  beforeEach(() => apiFetchMock.mockReset())
  it('uses the prices wire query', async () => {
    await getDuesPrices('2026-01')
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/dues/prices', {
      query: { period: '2026-01' },
    })
  })
  it('sends the stable generation key', async () => {
    await generateDuesAssessments('2026-01', 'retry-key-1')
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/dues/assessments/generate', {
      method: 'POST',
      headers: { 'idempotency-key': 'retry-key-1' },
      body: { period: '2026-01' },
    })
  })

  it('sends ADMIN pricing creation and revocation through the native routes', async () => {
    await createDuesPrice({
      kind: 'BASE',
      amount_cents: 12500,
      currency: 'ARS',
      effective_from: '2026-01-01',
      effective_to: null,
      rule: 'FULL_MONTH',
    })
    await revokeDuesPrice('price-1', 'Correction')

    expect(apiFetchMock).toHaveBeenNthCalledWith(1, '/api/v1/dues/prices', {
      method: 'POST',
      body: {
        kind: 'BASE',
        amount_cents: 12500,
        currency: 'ARS',
        effective_from: '2026-01-01',
        effective_to: null,
        rule: 'FULL_MONTH',
      },
    })
    expect(apiFetchMock).toHaveBeenNthCalledWith(2, '/api/v1/dues/prices/price-1/revoke', {
      method: 'POST',
      body: { revoke_reason: 'Correction' },
    })
  })

  it('uses the typed debt detail read for the selected socio', async () => {
    await getDebt('socio-1')

    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/dues/debt/socio-1', { query: {} })
  })

  // prettier-ignore
  it('sends explicit monetary allocations with a stable key',async()=>{await createDuesSettlement({socio_id:'socio-1',kind:'MONETARY',amount_cents:5_000,currency:'ARS',allocations:[{obligation_id:'obligation-1',amount_cents:2_000},{obligation_id:'obligation-2',amount_cents:3_000}]},'settlement-key-1');expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/dues/settlements',{method:'POST',headers:{'idempotency-key':'settlement-key-1'},body:expect.objectContaining({amount_cents:5_000})})})
  // prettier-ignore
  it('sends a selected allocation reversal reason with a stable key',async()=>{await reverseDuesSettlement('settlement-1',{allocation_id:'allocation-1',reason:'Incorrect allocation'},'reversal-key-1');expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/dues/settlements/settlement-1/reverse',{method:'POST',headers:{'idempotency-key':'reversal-key-1'},body:{allocation_id:'allocation-1',reason:'Incorrect allocation'}})})
})
