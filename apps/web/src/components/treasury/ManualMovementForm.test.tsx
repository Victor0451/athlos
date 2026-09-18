// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ManualMovementForm } from './ManualMovementForm'
import { ApiError } from '@/lib/api'

const mocks = vi.hoisted(() => ({
  recordCashTender: vi.fn(),
  fetchAllEligibleAccounts: vi.fn(),
}))
vi.mock('@/lib/api/treasury', () => ({ recordCashTender: mocks.recordCashTender }))
vi.mock('@/lib/api/account-chart', () => ({
  fetchAllEligibleAccounts: mocks.fetchAllEligibleAccounts,
  normalizedAccount: (value: string) =>
    value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase(),
}))

const account = {
  code: '4.1.01',
  name: 'Cuotas sociales',
  parent: { code: '4.1', name: 'Ingresos Operativos' },
  root: { code: '4', name: 'Ingresos' },
  path: [{ code: '4.1.01', name: 'Cuotas sociales' }],
  active: true,
  imputable: true,
  eligible: true,
}

const setup = (onRecorded = vi.fn(), initialDirection: 'INCOME' | 'EXPENSE' = 'INCOME') => {
  render(
    <ManualMovementForm
      shiftId="shift-1"
      operatorId="operator-1"
      onRecorded={onRecorded}
      initialDirection={initialDirection}
    />,
  )
  return onRecorded
}

const selectAccount = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Seleccione una cuenta' }))
  const option = await screen.findByRole('option', { name: '4.1.01 — Cuotas sociales' })
  fireEvent.click(option)
  expect(
    screen.getByRole('button', { name: '4.1.01 — Cuotas sociales' }).getAttribute('aria-expanded'),
  ).toBe('false')
}

describe('ManualMovementForm', () => {
  beforeEach(() => {
    mocks.recordCashTender.mockReset()
    mocks.fetchAllEligibleAccounts.mockReset()
    mocks.fetchAllEligibleAccounts.mockResolvedValue([account])
  })

  it('offers the income matrix by default (the dialog opening button implies the direction)', () => {
    setup()
    const method = screen.getByLabelText('Método de pago')
    expect(withinOptions(method)).toEqual([
      'Efectivo',
      'Tarjeta de débito',
      'Tarjeta de crédito',
      'Transferencia',
    ])
  })

  it('offers the expense matrix with bank debit and its note on expense dialogs', () => {
    setup(undefined, 'EXPENSE')
    const method = screen.getByLabelText('Método de pago')
    expect(withinOptions(method)).toEqual([
      'Efectivo',
      'Tarjeta de débito',
      'Tarjeta de crédito',
      'Transferencia',
      'Débito bancario',
    ])
    expect(screen.getByText(/no integra con el banco/i)).toBeTruthy()
  })

  it('searches eligible accounts and requires one selection before recording', async () => {
    setup()
    fireEvent.change(screen.getByLabelText(/^Importe \(pesos\)/), { target: { value: '3000,00' } })
    fireEvent.change(screen.getByLabelText('Descripción / motivo'), {
      target: { value: 'Cuota septiembre' },
    })
    fireEvent.submit(screen.getByRole('form', { name: 'Registrar movimiento manual' }))
    expect(mocks.recordCashTender).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toBeTruthy()
    await selectAccount()
    fireEvent.submit(screen.getByRole('form', { name: 'Registrar movimiento manual' }))
    await waitFor(() => expect(mocks.recordCashTender).toHaveBeenCalledTimes(1))
  })

  it('records a manual income with account attribution and exact cents', async () => {
    const onRecorded = setup()
    fireEvent.change(screen.getByLabelText(/^Importe \(pesos\)/), { target: { value: '3000,00' } })
    fireEvent.change(screen.getByLabelText('Descripción / motivo'), {
      target: { value: 'Cuota septiembre' },
    })
    await selectAccount()
    mocks.recordCashTender.mockResolvedValue({ id: 'tender-1' })
    fireEvent.submit(screen.getByRole('form', { name: 'Registrar movimiento manual' }))
    await waitFor(() => expect(mocks.recordCashTender).toHaveBeenCalledTimes(1))
    const [shiftId, body, key] = mocks.recordCashTender.mock.calls[0]!
    expect(shiftId).toBe('shift-1')
    expect(body).toEqual({
      direction: 'INCOME',
      tender: 'CASH',
      amount_cents: 300000,
      source_type: 'MANUAL',
      account_code: '4.1.01',
      description: 'Cuota septiembre',
      reason: 'Cuota septiembre',
    })
    expect(typeof key).toBe('string')
    expect(key.length).toBeGreaterThan(0)
    await waitFor(() => expect(onRecorded).toHaveBeenCalled())
    // Form resets after a confirmed record so the next movement starts clean.
    expect(screen.getByLabelText(/^Importe \(pesos\)/).getAttribute('value')).toBe('0')
  })

  it('records an expense bank debit with its own tender identity', async () => {
    setup(undefined, 'EXPENSE')
    fireEvent.change(screen.getByLabelText('Método de pago'), { target: { value: 'BANK_DEBIT' } })
    fireEvent.change(screen.getByLabelText(/^Importe \(pesos\)/), { target: { value: '500' } })
    fireEvent.change(screen.getByLabelText('Descripción / motivo'), {
      target: { value: 'Débito de servicio' },
    })
    await selectAccount()
    mocks.recordCashTender.mockResolvedValue({ id: 'tender-2' })
    fireEvent.submit(screen.getByRole('form', { name: 'Registrar movimiento manual' }))
    await waitFor(() => expect(mocks.recordCashTender).toHaveBeenCalledTimes(1))
    expect(mocks.recordCashTender.mock.calls[0]![1]).toMatchObject({
      direction: 'EXPENSE',
      tender: 'BANK_DEBIT',
      amount_cents: 50000,
    })
  })

  it('rejects an invalid amount without calling the API', async () => {
    setup()
    fireEvent.change(screen.getByLabelText(/^Importe \(pesos\)/), { target: { value: '-5' } })
    fireEvent.change(screen.getByLabelText('Descripción / motivo'), { target: { value: 'x' } })
    await selectAccount()
    fireEvent.submit(screen.getByRole('form', { name: 'Registrar movimiento manual' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(mocks.recordCashTender).not.toHaveBeenCalled()
  })

  it('surfaces API failures and keeps the idempotency key for an immediate retry', async () => {
    setup()
    fireEvent.change(screen.getByLabelText(/^Importe \(pesos\)/), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('Descripción / motivo'), {
      target: { value: 'Reintento' },
    })
    await selectAccount()
    mocks.recordCashTender
      .mockRejectedValueOnce(new ApiError(409, 'CONFLICT', 'Turno no disponible'))
      .mockResolvedValueOnce({ id: 'tender-3' })
    const form = screen.getByRole('form', { name: 'Registrar movimiento manual' })
    fireEvent.submit(form)
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Turno no disponible'),
    )
    fireEvent.submit(form)
    await waitFor(() => expect(mocks.recordCashTender).toHaveBeenCalledTimes(2))
    expect(mocks.recordCashTender.mock.calls[0]![2]).toBe(mocks.recordCashTender.mock.calls[1]![2])
  })
})

function withinOptions(select: HTMLElement): string[] {
  return Array.from(select.querySelectorAll('option')).map((option) => option.textContent ?? '')
}
