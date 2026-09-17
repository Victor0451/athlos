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

  it('blocks searching and selecting while disabled', () => {
    const onSelect = vi.fn()
    render(<EligibleAccountPicker selected={null} onSelect={onSelect} disabled />)
    expect(screen.getByLabelText('Buscar cuenta')).toBeDisabled()
    const searchButton = screen.getByRole('button', { name: 'Buscar cuenta' })
    expect(searchButton).toBeDisabled()
    fireEvent.click(searchButton)
    // Whether or not the synthetic click reaches the handler (react-dom
    // suppresses pointer events on disabled form elements), the disabled
    // contract holds on the observable state: no search runs, no results
    // render, no error surfaces, no busy state, and nothing gets selected.
    expect(mocks.searchEligibleAccounts).not.toHaveBeenCalled()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Buscar cuenta' })).toBeDisabled()
    expect(onSelect).not.toHaveBeenCalled()
  })
})
