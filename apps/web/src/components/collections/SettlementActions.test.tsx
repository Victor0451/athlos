import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import type { DebtDetail } from '@/lib/api/dues'
import { SettlementActions } from './SettlementActions'

// prettier-ignore
const debt={status:'ready',socio_id:'socio-1',currency:'ARS',total_debt_cents:10_000,obligations:[{id:'obligation-1',period_start:'2026-01-01',period_end:'2026-02-01',original_amount_cents:6_000,outstanding_cents:6_000,currency:'ARS',status:'OPEN',components:[],benefits:[],allocations:[]},{id:'obligation-2',period_start:'2026-02-01',period_end:'2026-03-01',original_amount_cents:4_000,outstanding_cents:4_000,currency:'ARS',status:'OPEN',components:[],benefits:[],allocations:[{id:'allocation-1',settlement_id:'settlement-1',settlement_kind:'MONETARY',settlement_amount_cents:2_000,currency:'ARS',amount_cents:2_000,kind:'ALLOCATION',compensates_allocation_id:null,reversal_eligible:true}]}]} as DebtDetail
const shifts = [
  {
    id: 'shift-1',
    desk_id: 'desk-1',
    status: 'OPEN' as const,
    business_date: '2026-01-01',
    assigned_operator_id: 'operator-1',
    opened_at: '2026-01-01T08:00:00.000Z',
    closed_at: null,
  },
]
const renderActions = (onPayment = vi.fn(), onReverse = vi.fn(), openShifts = shifts) =>
  render(
    <SettlementActions
      debt={debt}
      shifts={openShifts}
      onPayment={onPayment}
      onReverse={onReverse}
    />,
  )

describe('SettlementActions', () => {
  it('reviews complete selected obligations and submits no caller amounts', async () => {
    const user = userEvent.setup(),
      onPayment = vi.fn().mockResolvedValue({ replayed: false })
    renderActions(onPayment)
    await user.click(screen.getByRole('button', { name: /registrar pago/i }))
    await user.click(screen.getByLabelText(/período 2026-01-01/i))
    await user.click(screen.getByLabelText(/período 2026-02-01/i))
    await user.click(screen.getByLabelText(/débito/i))
    expect(screen.getByLabelText(/total a registrar/i)).toHaveTextContent(/^100\.00 ARS$/)
    await user.click(screen.getByRole('button', { name: /confirmar pago/i }))
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(onPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        obligation_ids: ['obligation-1', 'obligation-2'],
        shift_id: 'shift-1',
        tender: 'DEBIT',
      }),
    )
    expect(onPayment.mock.calls[0]![0]).not.toHaveProperty('amount_cents')
    expect(onPayment.mock.calls[0]![0]).not.toHaveProperty('allocations')
  })
  it('blocks an unavailable shift and requires conflict review before retrying', async () => {
    const user = userEvent.setup(),
      onPayment = vi
        .fn()
        .mockRejectedValueOnce(new ApiError(409, 'CONFLICT', 'Balance changed'))
        .mockResolvedValueOnce({ replayed: true })
    const view = renderActions(onPayment)
    await user.click(screen.getByRole('button', { name: /registrar pago/i }))
    await user.click(screen.getByLabelText(/período 2026-01-01/i))
    await user.click(screen.getByRole('button', { name: /confirmar pago/i }))
    expect(screen.getByRole('alert')).toHaveFocus()
    await user.click(screen.getByRole('button', { name: /revisar saldos actualizados/i }))
    await user.click(screen.getByRole('button', { name: /confirmar pago/i }))
    expect(onPayment).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('status')).toHaveTextContent(/repetido/i)
    view.unmount()
    renderActions(vi.fn(), vi.fn(), [])
    expect(screen.getByRole('button', { name: /registrar pago/i })).toBeDisabled()
  })
  it('requires a reason and submits a whole-settlement reversal without allocation selection', async () => {
    const user = userEvent.setup(),
      onReverse = vi.fn().mockResolvedValue({ replayed: false })
    renderActions(vi.fn(), onReverse)
    await user.click(screen.getByRole('button', { name: /revertir liquidación settlement-1/i }))
    const confirm = screen.getByRole('button', { name: /confirmar reversión/i })
    expect(confirm).toBeDisabled()
    await user.type(screen.getByLabelText(/motivo de reversión/i), 'Asignación incorrecta')
    await user.click(confirm)
    expect(onReverse).toHaveBeenCalledWith({
      settlement_id: 'settlement-1',
      reason: 'Asignación incorrecta',
    })
    expect(screen.getByRole('status')).toHaveTextContent(/compensación/i)
    expect(screen.queryByText(/caja|conciliación/i)).not.toBeInTheDocument()
  })
  it('reviews every affected obligation before submitting the eligible settlement reversal', async () => {
    const user = userEvent.setup(),
      onReverse = vi.fn().mockResolvedValue({})
    renderActions(vi.fn(), onReverse)

    await user.click(screen.getByRole('button', { name: /revertir liquidación settlement-1/i }))

    expect(screen.getByRole('alertdialog', { name: /revisar reversión/i })).toBeInTheDocument()
    expect(screen.getByText(/liquidación settlement-1/i)).toBeInTheDocument()
    expect(screen.getAllByText(/20.00 ARS/i)).not.toHaveLength(0)
    expect(screen.getByRole('list', { name: /asignaciones afectadas/i })).toHaveTextContent(
      /obligación 2026-02-01/i,
    )
    expect(screen.getByText(/estado actual: apta para reversión/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirmar reversión/i })).toBeDisabled()

    const reason = screen.getByLabelText(/motivo de reversión/i)
    expect(reason).toHaveFocus()
    await user.type(reason, 'Registro duplicado')
    await user.click(screen.getByRole('button', { name: /confirmar reversión/i }))

    expect(onReverse).toHaveBeenCalledWith({
      settlement_id: 'settlement-1',
      reason: 'Registro duplicado',
    })
    expect(screen.getByRole('status')).toHaveFocus()
  })
})
