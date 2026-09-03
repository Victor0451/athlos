import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DebtDetail } from '@/lib/api/dues'
import { SettlementActions } from './SettlementActions'

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
const renderActions = (actionDebt = debt, onReverse = vi.fn()) =>
  render(
    <SettlementActions
      debt={actionDebt}
      shifts={shifts}
      shiftAvailability="ready"
      onPayment={vi.fn()}
      onRefreshDebt={vi.fn()}
      onReverse={onReverse}
    />,
  )

describe('SettlementActions', () => {
  it('opens and closes the payment dialog through the payment action', async () => {
    const user = userEvent.setup()
    renderActions()

    await user.click(screen.getByRole('button', { name: /registrar pago/i }))
    expect(screen.getByRole('dialog', { name: /revisar pago/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog', { name: /revisar pago/i })).not.toBeInTheDocument()
  })

  it('uses human reversal labels without exposing settlement identifiers and retains callback IDs', async () => {
    const settlementId = 'a6c9531b-831f-4d11-8c63-67c2f3c3f4cb'
    const onReverse = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderActions(
      {
        ...debt,
        obligations: [
          {
            ...debt.obligations[0]!,
            period_start: '2026-07-01',
            allocations: [
              {
                id: 'a4c599fc-d754-4788-bae5-2974f792a443',
                settlement_id: settlementId,
                settlement_kind: 'MONETARY',
                settlement_amount_cents: 200000,
                currency: 'ARS',
                amount_cents: 200000,
                kind: 'ALLOCATION',
                compensates_allocation_id: null,
                reversal_eligible: true,
              },
            ],
          },
        ],
      },
      onReverse,
    )

    await user.click(
      screen.getByRole('button', { name: /revertir pago 1 · julio de 2026 · \$\s*2\.000,00/i }),
    )
    expect(screen.queryByText(settlementId, { exact: false })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Motivo de reversión'), 'Ingreso duplicado')
    await user.click(screen.getByRole('button', { name: 'Confirmar reversión' }))

    expect(onReverse).toHaveBeenCalledWith({
      settlement_id: settlementId,
      reason: 'Ingreso duplicado',
    })
  })
})
