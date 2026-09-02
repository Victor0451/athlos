import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReversalConfirmation } from './ReversalConfirmation'

describe('ReversalConfirmation', () => {
  it('does not expose reversal identifiers or ISO periods in visible text', () => {
    render(
      <ReversalConfirmation
        settlement={{
          id: 'd1e3aee4-a9da-43b9-8e7d-06b3ee1f6d43',
          amount_cents: 10_000,
          allocations: [
            {
              id: '9c3a9112-a6e4-411f-9972-13c7904c87b6',
              period_start: '2026-08-01',
              amount_cents: 10_000,
            },
          ],
        }}
        reason=""
        busy={false}
        error=""
        onReasonChange={vi.fn()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByText(/obligación agosto de 2026/i)).toBeInTheDocument()
    expect(
      screen.queryByText(
        /d1e3aee4-a9da-43b9-8e7d-06b3ee1f6d43|9c3a9112-a6e4-411f-9972-13c7904c87b6|2026-08-01/i,
      ),
    ).not.toBeInTheDocument()
  })
})
