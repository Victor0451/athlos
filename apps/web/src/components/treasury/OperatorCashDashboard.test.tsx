// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OperatorCashDashboard } from './OperatorCashDashboard'

const mocks = vi.hoisted(() => ({ getCashShiftDetail: vi.fn() }))
vi.mock('@/lib/api/treasury', () => ({ getCashShiftDetail: mocks.getCashShiftDetail }))

const detail = {
  shift: {
    id: 'shift-1',
    desk_id: 'ventanilla-2',
    status: 'OPEN',
    assigned_operator_id: 'operator-1',
    business_date: '2026-09-17',
    opened_at: new Date().toISOString(),
    closed_at: null,
  },
  close: null,
  opening_tenders: { CASH: 10000 },
  expected_tenders: { CASH: 27500 },
  movements: [
    {
      id: 'm1',
      direction: 'INCOME',
      tender: 'CASH',
      amount_cents: 23000,
      source_type: 'SETTLEMENT',
      created_at: new Date().toISOString(),
    },
    {
      id: 'm2',
      direction: 'INCOME',
      tender: 'CASH',
      amount_cents: 1000,
      source_type: 'MANUAL',
      account_code_snapshot: '4.1.03',
      account_name_snapshot: 'Ventas de Servicios',
      description: 'Alquiler de quincho',
      created_at: new Date().toISOString(),
    },
    {
      id: 'm3',
      direction: 'EXPENSE',
      tender: 'CASH',
      amount_cents: 6500,
      source_type: 'MANUAL',
      account_code_snapshot: '5.2.04',
      account_name_snapshot: 'Servicios (Luz, Agua, Internet)',
      description: 'Luz del club',
      created_at: new Date().toISOString(),
    },
  ],
}

const setup = () => {
  const handlers = { onLoadIncome: vi.fn(), onLoadExpense: vi.fn() }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <OperatorCashDashboard
        shiftId="shift-1"
        refreshToken={0}
        onLoadIncome={handlers.onLoadIncome}
        onLoadExpense={handlers.onLoadExpense}
      />
    </QueryClientProvider>,
  )
  return handlers
}

describe('OperatorCashDashboard', () => {
  beforeEach(() => {
    mocks.getCashShiftDetail.mockReset()
    mocks.getCashShiftDetail.mockResolvedValue(detail)
  })

  it('renders the color KPI row from opening, cash flows and server-expected cash', async () => {
    setup()
    expect(await screen.findByText('Saldo Inicial')).toBeInTheDocument()
    // es-AR currency formatting includes a space after the peso sign.
    expect(screen.getByText('$ 100,00')).toBeInTheDocument()
    expect(screen.getByText('$ 240,00')).toBeInTheDocument() // cash income 23000 + 1000
    expect(screen.getByText('$ 65,00')).toBeInTheDocument() // cash expense
    expect(screen.getByText('$ 275,00')).toBeInTheDocument() // server-expected
  })

  it('groups automatic production with its subtotal and lists manual income separately', async () => {
    setup()
    expect(await screen.findByText(/Producción automática \(1 movimiento\)/)).toBeInTheDocument()
    expect(screen.getByText('Subtotal producción: $ 230,00')).toBeInTheDocument()
    expect(screen.getByText('Subtotal manuales: $ 10,00')).toBeInTheDocument()
  })

  it('lists expenses with their account attribution and description', async () => {
    setup()
    expect(await screen.findByText('Luz del club')).toBeInTheDocument()
    expect(screen.getByText(/5\.2\.04 Servicios \(Luz, Agua, Internet\)/)).toBeInTheDocument()
  })

  it('hides reversed pairs from the lists and shows them in a collapsed audit summary', async () => {
    mocks.getCashShiftDetail.mockResolvedValue({
      ...detail,
      // The server-computed expected cash is unchanged: the pair nets exactly zero.
      movements: [
        ...detail.movements,
        {
          id: 'm4',
          direction: 'INCOME',
          tender: 'CASH',
          amount_cents: 2000,
          source_type: 'MANUAL',
          account_code_snapshot: '4.1.03',
          account_name_snapshot: 'Ventas de Servicios',
          description: 'Alquiler quincho',
          created_at: new Date().toISOString(),
        },
        {
          id: 'm5',
          direction: 'EXPENSE',
          tender: 'CASH',
          amount_cents: 2000,
          source_type: 'MANUAL',
          reason: 'Me equivoqué en el importe',
          reverses_tender_id: 'm4',
          created_at: new Date().toISOString(),
        },
      ],
    })
    setup()
    expect(await screen.findByText('Saldo Inicial')).toBeInTheDocument()
    // The pair nets zero: totals stay as if the movement never existed...
    expect(screen.getByText('Subtotal manuales: $ 10,00')).toBeInTheDocument()
    expect(screen.getByText('$ 275,00')).toBeInTheDocument() // unchanged server-expected
    // ...and neither row of the pair appears in the operator lists: the reversal reason
    // exists exactly once — inside the audit summary, never as a movement-row title.
    expect(screen.queryByText('Alquiler quincho')).not.toBeInTheDocument()
    expect(screen.getAllByText('Me equivoqué en el importe')).toHaveLength(1)
    // The audit trail stays discoverable in the collapsed summary: the pair is listed as
    // original → reason. The line renders as sibling spans, so assert them individually.
    fireEvent.click(screen.getByText(/1 movimiento editado o eliminado en este turno/))
    expect(screen.getByText('Alquiler quincho ($ 20,00)')).toBeInTheDocument()
  })

  it('opens the load modals from the column-header buttons', async () => {
    const handlers = setup()
    fireEvent.click(await screen.findByRole('button', { name: '+ Cargar Ingreso' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Cargar Egreso' }))
    await waitFor(() => {
      expect(handlers.onLoadIncome).toHaveBeenCalledTimes(1)
      expect(handlers.onLoadExpense).toHaveBeenCalledTimes(1)
    })
  })

  it('shows empty states when the shift has no movements yet', async () => {
    mocks.getCashShiftDetail.mockResolvedValue({
      ...detail,
      opening_tenders: { CASH: 0 },
      expected_tenders: { CASH: 0 },
      movements: [],
    })
    setup()
    expect(
      await screen.findByText('No hay producción registrada en este turno todavía.'),
    ).toBeInTheDocument()
    expect(screen.getByText('No hay egresos registrados.')).toBeInTheDocument()
  })

  it('surfaces detail fetch failures as an alert', async () => {
    mocks.getCashShiftDetail.mockRejectedValue(new Error('boom'))
    setup()
    expect(
      await screen.findByText('No se pudieron cargar los movimientos del turno.'),
    ).toBeInTheDocument()
  })
})
