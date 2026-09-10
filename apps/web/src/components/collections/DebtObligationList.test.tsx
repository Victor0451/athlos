import React from 'react'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import type { DebtDetail } from '@/lib/api/dues'
import { DebtObligationList } from './DebtObligationList'
import { mapDebtPresentation } from './debt-presentation'

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
      original_amount_cents: 12_500,
      outstanding_cents: 10_000,
      currency: 'ARS',
      status: 'OPEN',
      components: [
        { id: 'component-1', kind: 'BASE', component_key: 'base', amount_cents: 12_500 },
      ],
      benefits: [{ id: 'benefit-1', component_key: 'benefit-1', amount_cents: -2_500 }],
      allocations: [
        {
          id: 'allocation-1',
          settlement_id: 'settlement-1',
          settlement_kind: 'MONETARY',
          settlement_amount_cents: 2_500,
          currency: 'ARS',
          amount_cents: 2_500,
          kind: 'ALLOCATION',
          compensates_allocation_id: null,
          reversal_eligible: true,
        },
      ],
    },
  ],
} satisfies DebtDetail

describe('DebtObligationList', () => {
  it('renders localized obligation summaries with sensitive composition, benefits, and history collapsed', () => {
    render(<DebtObligationList obligations={mapDebtPresentation(debt).obligations} />)

    const card = screen.getByRole('listitem', { name: /enero de 2026/i })
    expect(card).toHaveTextContent(/pendiente/i)
    expect(card).toHaveTextContent(/importe pendiente/i)
    expect(card).toHaveTextContent(/importe original/i)
    expect(card).toHaveTextContent(/1 de enero de 2026/i)
    const details = within(card).getAllByRole('group')
    expect(details).toHaveLength(3)
    details.forEach((detail) => expect(detail).not.toHaveAttribute('open'))
    expect(
      screen.queryByText(/obligation-1|allocation-1|MONETARY|2026-01-01/i),
    ).not.toBeInTheDocument()
  })

  it('recovers one constancia per original monetary payment, including reversed payments', async () => {
    const obligation = debt.obligations[0]!
    const original = { ...obligation.allocations[0]!, reversal_eligible: false }
    const receiptDebt = {
      ...debt,
      obligations: [
        {
          ...obligation,
          allocations: [
            original,
            {
              ...original,
              id: 'compensation',
              kind: 'COMPENSATION',
              settlement_id: 'reversal',
              compensates_allocation_id: original.id,
            },
            {
              ...original,
              id: 'non-cash',
              settlement_id: 'treatment',
              settlement_kind: 'NON_CASH',
            },
          ],
        },
        {
          ...obligation,
          id: 'obligation-2',
          allocations: [{ ...original, id: 'another-allocation' }],
        },
      ],
    } satisfies DebtDetail
    const onViewSettlement = vi.fn()
    render(
      <DebtObligationList
        obligations={mapDebtPresentation(receiptDebt).obligations}
        debt={receiptDebt}
        onViewSettlement={onViewSettlement}
      />,
    )
    const user = userEvent.setup()
    for (const summary of screen.getAllByText('Historial de movimientos', { selector: 'summary' }))
      await user.click(summary)
    const actions = screen.getAllByRole('button', { name: 'Ver constancia' })
    expect(actions).toHaveLength(1)
    await user.click(actions[0]!)
    expect(onViewSettlement).toHaveBeenCalledWith(original.settlement_id)
  })

  it('explains when there are no obligations to detail', () => {
    render(<DebtObligationList obligations={[]} />)

    expect(screen.getByRole('status')).toHaveTextContent(/no hay obligaciones para detallar/i)
  })
})
