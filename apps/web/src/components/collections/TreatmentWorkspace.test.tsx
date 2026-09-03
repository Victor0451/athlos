import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DuesOperationError } from '@/lib/api/dues'
import { TreatmentWorkspace } from './TreatmentWorkspace'
import type { DebtDetail } from './DebtPanel'

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

const debt = {
  status: 'ready',
  socio_id: 'socio-1',
  currency: 'ARS',
  total_debt_cents: 10_000,
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
  ],
} satisfies DebtDetail

describe('TreatmentWorkspace', () => {
  it('presents four labelled treatments without payment controls for an operator', () => {
    render(
      <TreatmentWorkspace
        memberId="socio-1"
        debt={debt}
        role="OPERADOR"
        agreementsEnabled
        agreementStates={{}}
        onCreateAgreement={vi.fn()}
        onRefreshAgreement={vi.fn()}
        onRefreshDebt={vi.fn()}
        onRequestCondonation={vi.fn()}
      />,
    )

    expect(screen.getByRole('region', { name: /tratamientos de deuda/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Pago' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Trabajo comunitario' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Acuerdo' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Condonación' })).toBeInTheDocument()
    expect(screen.getByText(/mediante una liquidación/i)).toBeInTheDocument()
    expect(screen.getByText(/comando aceptado/i)).toBeInTheDocument()
    expect(screen.getByText(/no reduce la deuda/i)).toBeInTheDocument()
    expect(screen.getByText(/ejecución aprobada/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /registrar pago/i })).not.toBeInTheDocument()
    const workspace = screen.getByRole('region', { name: /tratamientos de deuda/i })
    expect(workspace).toHaveClass('min-w-0')
    expect(workspace.firstElementChild?.nextElementSibling).toHaveClass('lg:grid-cols-2')
    for (const [heading, tone] of [
      ['Pago', 'border-l-ink-700'],
      ['Trabajo comunitario', 'border-l-ink-400'],
      ['Acuerdo', 'border-l-ink-400'],
      ['Condonación', 'border-l-ink-400'],
    ] as const) {
      const treatment = screen.getByRole('heading', { name: heading }).closest('section')
      expect(treatment).toHaveClass('border-l-4', tone)
    }
    expect(
      screen.queryByRole('button', { name: 'Enviar solicitud de condonación' }),
    ).not.toBeInTheDocument()
  })

  it('forwards unavailable open-shift state to payment actions', () => {
    render(
      <TreatmentWorkspace
        memberId="socio-1"
        debt={debt}
        role="ADMIN"
        canSettle
        agreementStates={{}}
        shifts={[]}
        shiftAvailability="unavailable"
        onPayment={vi.fn()}
        onReverse={vi.fn()}
        onRefreshDebt={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /registrar pago/i })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'No se pudo cargar los turnos de caja abiertos.',
    )
  })

  it('forwards debt refresh to payment conflict recovery without retrying payment', async () => {
    const user = userEvent.setup()
    const onPayment = vi.fn().mockRejectedValue(new DuesOperationError('conflict', 'stale'))
    const onRefreshDebt = vi.fn().mockResolvedValue(undefined)

    render(
      <TreatmentWorkspace
        memberId="socio-1"
        debt={debt}
        role="ADMIN"
        canSettle
        agreementStates={{}}
        shifts={shifts}
        onPayment={onPayment}
        onReverse={vi.fn()}
        onRefreshDebt={onRefreshDebt}
      />,
    )

    await user.click(screen.getByRole('button', { name: /registrar pago/i }))
    await user.click(screen.getByRole('button', { name: /confirmar pago/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'El saldo cambió. Revisá la deuda actualizada antes de volver a confirmar.',
    )
    await user.click(screen.getByRole('button', { name: /actualizar deuda/i }))
    await waitFor(() => expect(onRefreshDebt).toHaveBeenCalledTimes(1))
    expect(onRefreshDebt).toHaveBeenCalledWith()
    expect(onPayment).toHaveBeenCalledTimes(1)
  })
})
