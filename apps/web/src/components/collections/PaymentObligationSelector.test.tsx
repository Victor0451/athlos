import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PaymentObligationSelector } from './PaymentObligationSelector'

const obligations = [
  {
    id: 'a26f7d79-69d8-4f3d-a3b5-7e650c7b8119',
    period_start: '2026-08-01',
    outstanding_cents: 6_000,
  },
  {
    id: 'bf933765-a39d-4eef-95d6-2af847ae9ef6',
    period_start: '2026-09-01',
    outstanding_cents: 4_000,
  },
]

describe('PaymentObligationSelector', () => {
  it('renders ARS obligations and delegates clear and subset selection', async () => {
    const user = userEvent.setup()
    const onSelectedIdsChange = vi.fn()
    const { rerender } = render(
      <PaymentObligationSelector
        obligations={obligations}
        selectedIds={obligations.map(({ id }) => id)}
        onSelectedIdsChange={onSelectedIdsChange}
      />,
    )

    expect(screen.getByLabelText(/período agosto de 2026/i)).toBeChecked()
    expect(
      screen.queryByText(/2026-08-01|a26f7d79-69d8-4f3d-a3b5-7e650c7b8119/i),
    ).not.toBeInTheDocument()
    expect(screen.getByText(/60,00/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /quitar selección/i }))
    expect(onSelectedIdsChange).toHaveBeenCalledWith([])

    rerender(
      <PaymentObligationSelector
        obligations={obligations}
        selectedIds={[]}
        onSelectedIdsChange={onSelectedIdsChange}
      />,
    )
    await user.click(screen.getByLabelText(/período agosto de 2026/i))
    expect(onSelectedIdsChange).toHaveBeenLastCalledWith(['a26f7d79-69d8-4f3d-a3b5-7e650c7b8119'])
  })
})
