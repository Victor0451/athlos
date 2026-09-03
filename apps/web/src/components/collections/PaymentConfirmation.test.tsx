import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { CashShift } from '@/lib/api/treasury'
import { PaymentConfirmation } from './PaymentConfirmation'

const shifts: CashShift[] = [
  {
    id: 'a26f7d79-69d8-4f3d-a3b5-7e650c7b8119',
    desk_id: 'bf933765-a39d-4eef-95d6-2af847ae9ef6',
    status: 'OPEN',
    business_date: '2026-09-02',
    assigned_operator_id: 'c6ee6211-3f92-4d87-bd9d-890ff1a1be00',
    opened_at: '2026-01-01T08:00:00.000Z',
    closed_at: null,
  },
]

describe('PaymentConfirmation', () => {
  it.each([
    [
      'loading',
      'Cargando turnos de caja abiertos.',
      'Esperá a que se carguen los turnos de caja abiertos.',
    ],
    [
      'ready',
      'No hay turnos de caja abiertos para registrar el pago.',
      'No hay turnos de caja abiertos para registrar el pago.',
    ],
    [
      'unavailable',
      'No se pudo cargar los turnos de caja abiertos.',
      'No se puede confirmar el pago hasta cargar los turnos de caja abiertos.',
    ],
  ] as const)(
    'disables confirmation when open shifts are %s with an honest reason',
    (shiftAvailability, status, confirmationReason) => {
      const onRefreshDebt = vi.fn()
      render(
        <PaymentConfirmation
          open
          total={10_000}
          shifts={[]}
          shiftId=""
          shiftAvailability={shiftAvailability}
          confirmationReason={confirmationReason}
          busy={false}
          paymentConflict={false}
          error=""
          onShiftChange={vi.fn()}
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
          onRefreshDebt={onRefreshDebt}
        />,
      )

      expect(screen.getByRole('button', { name: /confirmar pago/i })).toBeDisabled()
      expect(screen.getByText(status)).toBeInTheDocument()
      if (shiftAvailability === 'unavailable') {
        expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
      } else expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument()
    },
  )

  it('renders indexed human-readable shifts while emitting the exact shift ID', async () => {
    const user = userEvent.setup()
    const onShiftChange = vi.fn()
    const shift = shifts[0]!
    render(
      <PaymentConfirmation
        open
        total={10_000}
        shifts={shifts}
        shiftId=""
        shiftAvailability="ready"
        confirmationReason="Seleccioná un turno de caja abierto."
        busy={false}
        paymentConflict={false}
        error=""
        onShiftChange={onShiftChange}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        onRefreshDebt={vi.fn()}
      />,
    )

    expect(
      screen.getByRole('option', { name: 'Turno 1 · 2 de septiembre de 2026' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(
        /a26f7d79-69d8-4f3d-a3b5-7e650c7b8119|bf933765-a39d-4eef-95d6-2af847ae9ef6|c6ee6211-3f92-4d87-bd9d-890ff1a1be00|2026-09-02/i,
      ),
    ).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText(/turno de caja/i), shift.id)
    expect(onShiftChange).toHaveBeenCalledWith(shift.id)
  })

  it('requires an open shift and explains why confirmation is disabled', () => {
    render(
      <PaymentConfirmation
        open
        total={10_000}
        shifts={shifts}
        shiftId=""
        shiftAvailability="ready"
        confirmationReason="Seleccioná un turno de caja abierto."
        busy={false}
        paymentConflict={false}
        error=""
        onShiftChange={vi.fn()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        onRefreshDebt={vi.fn()}
      />,
    )

    expect(screen.getByLabelText(/turno de caja/i)).toBeInTheDocument()
    expect(screen.getByText(/registra y audita el movimiento/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirmar pago/i })).toBeDisabled()
    expect(screen.getByText(/seleccioná un turno de caja abierto/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirmar pago/i })).toHaveAttribute(
      'aria-describedby',
      'payment-confirmation-reason',
    )
  })
})
