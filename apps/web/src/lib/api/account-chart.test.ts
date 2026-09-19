import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetchMock = vi.fn()
vi.mock('@/lib/api', () => ({ apiFetch: apiFetchMock }))

const item = {
  code: '4.1.01',
  name: 'Cuotas sociales',
  parent: { code: '4.1', name: 'Ingresos Operativos' },
  root: { code: '4', name: 'Ingresos' },
  path: [{ code: '4', name: 'Ingresos' }],
  active: true,
  imputable: true,
  eligible: true,
}

describe('account chart client', () => {
  beforeEach(() => apiFetchMock.mockReset())

  it('fetches the active chart and keeps only eligible leaves', async () => {
    const { fetchAllEligibleAccounts } = await import('./account-chart')
    apiFetchMock.mockResolvedValue({
      items: [item, { ...item, code: '4', imputable: false, eligible: false }],
    })
    await expect(fetchAllEligibleAccounts()).resolves.toEqual([item])
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/account-chart?active=true')
  })

  it('drops duplicated eligible codes keeping the first occurrence', async () => {
    const { fetchAllEligibleAccounts } = await import('./account-chart')
    apiFetchMock.mockResolvedValue({ items: [item, { ...item, name: 'Otra' }] })
    await expect(fetchAllEligibleAccounts()).resolves.toEqual([item])
  })

  it('rejects malformed items instead of guessing', async () => {
    const { fetchAllEligibleAccounts } = await import('./account-chart')
    apiFetchMock.mockResolvedValue({ items: [{ code: '4.1.01' }] })
    await expect(fetchAllEligibleAccounts()).rejects.toThrow(
      'Account chart response was incomplete',
    )
  })

  it('rejects a response without an items array', async () => {
    const { fetchAllEligibleAccounts } = await import('./account-chart')
    apiFetchMock.mockResolvedValue({})
    await expect(fetchAllEligibleAccounts()).rejects.toThrow(
      'Account chart response was incomplete',
    )
  })

  it('normalizes needles for client-side filtering', async () => {
    const { normalizedAccount } = await import('./account-chart')
    expect(normalizedAccount('Cajón Útil')).toBe('cajon util')
  })
})
