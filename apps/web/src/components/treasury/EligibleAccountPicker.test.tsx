import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EligibleAccountPicker } from './EligibleAccountPicker'
import type { AccountChartItem } from '@/lib/api/account-chart'

const mocks = vi.hoisted(() => ({ searchEligibleAccounts: vi.fn() }))
vi.mock('@/lib/api/account-chart', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  searchEligibleAccounts: mocks.searchEligibleAccounts,
}))

const account: AccountChartItem = {
  code: '4.1.01',
  name: 'Cuotas sociales',
  parent: { code: '4.1', name: 'Ingresos Operativos' },
  root: { code: '4', name: 'Ingresos' },
  path: [{ code: '4.1.01', name: 'Cuotas sociales' }],
  active: true,
  imputable: true,
  eligible: true,
}

const setup = (onSelect = vi.fn()) => {
  render(<EligibleAccountPicker selected={null} onSelect={onSelect} />)
  return onSelect
}

describe('EligibleAccountPicker', () => {
  beforeEach(() => {
    mocks.searchEligibleAccounts.mockReset()
    mocks.searchEligibleAccounts.mockResolvedValue([account])
  })

  it('searches and exposes eligible results as a single-choice list', async () => {
    const onSelect = setup()
    fireEvent.change(screen.getByLabelText('Buscar cuenta'), { target: { value: 'cuota' } })
    fireEvent.click(screen.getByRole('button', { name: 'Buscar cuenta' }))
    fireEvent.click(await screen.findByRole('radio', { name: /4\.1\.01 — Cuotas sociales/ }))
    expect(mocks.searchEligibleAccounts).toHaveBeenCalledWith('cuota')
    expect(onSelect).toHaveBeenCalledWith(account)
  })

  it('reports an empty search without offering a selection', async () => {
    setup()
    mocks.searchEligibleAccounts.mockResolvedValue([])
    fireEvent.change(screen.getByLabelText('Buscar cuenta'), { target: { value: 'zzz' } })
    fireEvent.click(screen.getByRole('button', { name: 'Buscar cuenta' }))
    expect(await screen.findByText(/sin cuentas elegibles/i)).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })

  it('surfaces a search failure as an alert', async () => {
    setup()
    mocks.searchEligibleAccounts.mockRejectedValue(new Error('network'))
    fireEvent.change(screen.getByLabelText('Buscar cuenta'), { target: { value: 'cuota' } })
    fireEvent.click(screen.getByRole('button', { name: 'Buscar cuenta' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
