import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import { DuesOperationError, type DebtDetail } from '@/lib/api/dues'
import { PaymentDialog } from './PaymentDialog'

const debt = {
  status: 'ready',
  socio_id: 'socio-1',
  currency: 'ARS',
  total_debt_cents: 20_000,
  obligations: [
    {
      id: 'obligation-1',
      period_start: '2026-01-01',
      period_end: '2026-02-01',
      original_amount_cents: 10_000,
      outstanding_cents: 10_000,
      currency: 'ARS',
      status: 'OPEN',
      components: [],
      benefits: [],
      allocations: [],
    },
    {
      id: 'obligation-2',
      period_start: '2026-02-01',
      period_end: '2026-03-01',
      original_amount_cents: 10_000,
      outstanding_cents: 10_000,
      currency: 'ARS',
      status: 'OPEN',
      components: [],
      benefits: [],
      allocations: [],
    },
  ],
} as DebtDetail
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

const renderDialog = (
  onPayment = vi.fn().mockResolvedValue(undefined),
  onRefreshDebt = vi.fn().mockResolvedValue(undefined),
) => {
  const onClose = vi.fn()
  render(
    <PaymentDialog
      open
      debt={debt}
      shifts={shifts}
      shiftAvailability="ready"
      onPayment={onPayment}
      onRefreshDebt={onRefreshDebt}
      onClose={onClose}
    />,
  )
  return { onClose }
}

const confirm = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: /confirmar pago/i }))

describe('PaymentDialog', () => {
  it('defaults to all obligations, submits the selection fingerprint, and reports replayed success', async () => {
    const user = userEvent.setup()
    const onPayment = vi.fn().mockResolvedValue({ replayed: true })
    const { onClose } = renderDialog(onPayment)

    expect(screen.getByLabelText(/período enero de 2026/i)).toBeChecked()
    expect(screen.getByLabelText(/período febrero de 2026/i)).toBeChecked()
    await user.click(screen.getByLabelText(/período febrero de 2026/i))
    await confirm(user)

    expect(onPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        obligation_ids: ['obligation-1'],
        shift_id: 'shift-1',
        tender: 'CASH',
        selection_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    )
    expect(onClose).toHaveBeenCalledOnce()
    expect(await screen.findByText('Pago repetido.')).toBeInTheDocument()
  })

  it.each([new DuesOperationError('conflict', 'stale'), new ApiError(409, 'CONFLICT', 'stale')])(
    'keeps stale payment blocked until authoritative refresh succeeds without retrying',
    async (cause) => {
      const user = userEvent.setup()
      const onPayment = vi.fn().mockRejectedValue(cause)
      const onRefreshDebt = vi.fn()
      renderDialog(onPayment, onRefreshDebt)

      await confirm(user)

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'El saldo cambió. Revisá la deuda actualizada antes de volver a confirmar.',
      )
      expect(screen.getByRole('button', { name: /confirmar pago/i })).toBeDisabled()
      onRefreshDebt.mockResolvedValueOnce(undefined)
      await user.click(screen.getByRole('button', { name: /actualizar deuda/i }))
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /confirmar pago/i })).toBeEnabled(),
      )
      expect(onPayment).toHaveBeenCalledTimes(1)
    },
  )

  it('keeps payment unavailable until the open shifts can be refreshed', () => {
    render(
      <PaymentDialog
        open={false}
        debt={debt}
        shifts={[]}
        shiftAvailability="unavailable"
        onPayment={vi.fn()}
        onRefreshDebt={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('No se pudo cargar los turnos de caja abiertos.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })

  it('reports a non-conflict payment error without offering an automatic retry', async () => {
    const user = userEvent.setup()
    renderDialog(vi.fn().mockRejectedValue(new Error('offline')))

    await confirm(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo registrar el pago.')
    expect(screen.queryByRole('button', { name: /actualizar deuda/i })).not.toBeInTheDocument()
  })
})
