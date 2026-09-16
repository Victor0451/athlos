import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetchMock = vi.fn()
vi.mock('@/lib/api', () => ({ apiFetch: apiFetchMock }))
const { searchEligibleAccounts } = await import('./account-chart')

const item = {
  code: '4.1.01',
  name: 'Cuotas sociales',
  parent: { code: '4.1', name: 'Ingresos Operativos' },
  root: { code: '4', name: 'Ingresos' },
  path: [
    { code: '4', name: 'Ingresos' },
    { code: '4.1', name: 'Ingresos Operativos' },
    { code: '4.1.01', name: 'Cuotas sociales' },
  ],
  active: true,
  imputable: true,
  eligible: true,
}

describe('account chart client', () => {
  beforeEach(() => apiFetchMock.mockReset())

  it('searches active accounts by name and keeps only eligible leaves', async () => {
    apiFetchMock.mockResolvedValue({
      items: [item, { ...item, code: '4', imputable: false, eligible: false }],
    })
    await expect(searchEligibleAccounts('cuota')).resolves.toEqual([item])
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/account-chart?name=cuota&active=true')
  })

  it('does not call the API for an empty query', async () => {
    await expect(searchEligibleAccounts('   ')).resolves.toEqual([])
    expect(apiFetchMock).not.toHaveBeenCalled()
  })

  it('rejects malformed items instead of guessing', async () => {
    apiFetchMock.mockResolvedValue({ items: [{ code: '4.1.01' }] })
    await expect(searchEligibleAccounts('cuota')).rejects.toThrow(
      'Account chart response was incomplete',
    )
  })

  it('rejects a response without an items array', async () => {
    apiFetchMock.mockResolvedValue({})
    await expect(searchEligibleAccounts('cuota')).rejects.toThrow(
      'Account chart response was incomplete',
    )
  })
})
