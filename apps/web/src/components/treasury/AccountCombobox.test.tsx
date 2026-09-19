// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountCombobox } from './AccountCombobox'

const mocks = vi.hoisted(() => ({ fetchAllEligibleAccounts: vi.fn() }))
vi.mock('@/lib/api/account-chart', () => ({
  fetchAllEligibleAccounts: mocks.fetchAllEligibleAccounts,
  normalizedAccount: (value: string) =>
    value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase(),
}))

import type { AccountChartItem } from '@/lib/api/account-chart'

const caja: AccountChartItem = {
  code: '1.1.1.01',
  name: 'Caja (Pesos)',
  parent: { code: '1.1.1', name: 'Caja y Bancos' },
  root: { code: '1', name: 'Activo' },
  path: [{ code: '1', name: 'Activo' }],
  active: true,
  imputable: true,
  eligible: true,
}

const valores: AccountChartItem = {
  code: '1.1.3.02',
  name: 'Valores a Depositar',
  parent: { code: '1.1.3', name: 'Créditos' },
  root: { code: '1', name: 'Activo' },
  path: [{ code: '1', name: 'Activo' }],
  active: true,
  imputable: true,
  eligible: true,
}

const setup = (selected: AccountChartItem | null = null) => {
  const onSelect = vi.fn()
  render(<AccountCombobox selected={selected} onSelect={onSelect} />)
  return onSelect
}

describe('AccountCombobox', () => {
  beforeEach(() => {
    mocks.fetchAllEligibleAccounts.mockReset()
    mocks.fetchAllEligibleAccounts.mockResolvedValue([caja, valores])
  })

  it('shows the placeholder trigger and fetches the catalog once on first open', async () => {
    setup()
    expect(screen.getByRole('button', { name: 'Seleccione una cuenta' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Seleccione una cuenta' }))
    expect(await screen.findByRole('option', { name: '1.1.1.01 — Caja (Pesos)' })).toBeTruthy()
    await waitFor(() => expect(mocks.fetchAllEligibleAccounts).toHaveBeenCalledTimes(1))
    // Reopening reuses the already-fetched catalog.
    fireEvent.click(screen.getByRole('button', { name: 'Seleccione una cuenta' }))
    fireEvent.click(screen.getByRole('button', { name: 'Seleccione una cuenta' }))
    expect(mocks.fetchAllEligibleAccounts).toHaveBeenCalledTimes(1)
  })

  it('filters the list client-side by code or name as the query changes', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Seleccione una cuenta' }))
    await screen.findByRole('option', { name: '1.1.3.02 — Valores a Depositar' })
    fireEvent.change(screen.getByPlaceholderText('Buscar cuenta…'), {
      target: { value: 'valores' },
    })
    expect(screen.getByRole('option', { name: '1.1.3.02 — Valores a Depositar' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: '1.1.1.01 — Caja (Pesos)' })).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('Buscar cuenta…'), { target: { value: '1.1.1' } })
    expect(screen.getByRole('option', { name: '1.1.1.01 — Caja (Pesos)' })).toBeTruthy()
  })

  it('selects with a click, closes the dropdown and reports the choice', async () => {
    const onSelect = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Seleccione una cuenta' }))
    fireEvent.click(await screen.findByRole('option', { name: '1.1.3.02 — Valores a Depositar' }))
    expect(onSelect).toHaveBeenCalledWith(valores)
    // Selection display is the parent's job (it owns the `selected` prop); here the
    // contract is: dropdown closed, trigger back to placeholder, no selection performed.
    const trigger = screen.getByRole('button', { name: 'Seleccione una cuenta' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('selects with the keyboard: arrows move the highlight and Enter confirms', async () => {
    const onSelect = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Seleccione una cuenta' }))
    const search = await screen.findByPlaceholderText('Buscar cuenta…')
    // The dropdown renders in a portal; the search input bubbles key events to the panel's
    // shared key handler.
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(valores)
  })

  it('closes on Escape without selecting', async () => {
    const onSelect = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Seleccione una cuenta' }))
    const search = await screen.findByPlaceholderText('Buscar cuenta…')
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('shows the empty state when nothing matches the query', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Seleccione una cuenta' }))
    await screen.findByRole('option', { name: '1.1.1.01 — Caja (Pesos)' })
    fireEvent.change(screen.getByPlaceholderText('Buscar cuenta…'), { target: { value: 'zzz' } })
    expect(screen.getByText('Sin cuentas para la búsqueda.')).toBeTruthy()
  })

  it('surfaces a load error as an alert inside the dropdown', async () => {
    mocks.fetchAllEligibleAccounts.mockRejectedValue(new Error('boom'))
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Seleccione una cuenta' }))
    expect(await screen.findByRole('alert').then((node) => node.textContent)).toContain(
      'No se pudieron cargar las cuentas.',
    )
  })

  it('marks the selected account with aria-selected', async () => {
    setup(valores)
    fireEvent.click(screen.getByRole('button', { name: '1.1.3.02 — Valores a Depositar' }))
    const option = await screen.findByRole('option', { name: '1.1.3.02 — Valores a Depositar' })
    expect(option.getAttribute('aria-selected')).toBe('true')
  })
})
