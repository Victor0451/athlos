import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * ApprovalCard component tests (TASK-037, PR 8c.2).
 *
 * `<ApprovalCard>` displays a single approval context (action_type +
 * action_id + summary + expires + status) with an optional action
 * button area (Approve / Reject). Used by the detail page at
 * `/admin/approvals/[token]` to present the token context + the
 * decision controls.
 *
 * Contract:
 *   - Renders action_type as a label (translated copy)
 *   - Renders action_id in mono font (small, ink-500)
 *   - Renders context_summary as the body text
 *   - Renders the expires_at timestamp in es-AR locale
 *   - Renders a StatusBadge derived from the status field
 *     (Pendiente / Aprobada / Rechazada / Vencida)
 *   - When status='pending', renders the Approve + Reject buttons
 *     and fires the corresponding callbacks
 *   - When status is NOT 'pending', hides the action buttons
 *     (already decided or expired)
 *   - Action buttons are disabled while `pending` is true
 *     (the parent holds in-flight state)
 *   - Click on Approve fires onApprove(token); Reject fires
 *     onReject(token)
 *
 * The component is pure presentation — no data fetching. The
 * parent page owns the mutation lifecycle (TanStack Query) and
 * passes `pending` to disable the buttons during in-flight calls.
 */

const { ApprovalCard } = await import('./ApprovalCard')

const SAMPLE_APPROVAL = {
  action_type: 'ctacte.anulate',
  action_id: 'mov-12345',
  context_summary: 'Anulación de movimiento por error de carga',
  created_by: { operator_id: 'op-tesorero-1' },
  expires_at: '2026-06-30T10:00:00.000Z',
  status: 'pending' as const,
}

describe('ApprovalCard', () => {
  let onApprove: ReturnType<typeof vi.fn>
  let onReject: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onApprove = vi.fn()
    onReject = vi.fn()
  })

  it('renders the action_type translated as the primary label', () => {
    render(
      <ApprovalCard
        token="abc123"
        approval={SAMPLE_APPROVAL}
        onApprove={onApprove}
        onReject={onReject}
      />,
    )
    // 'ctacte.anulate' → "Anulación en cuenta corriente"
    expect(screen.getByText(/anulación en cuenta corriente/i)).toBeInTheDocument()
  })

  it('renders the action_id in a mono font (small)', () => {
    render(
      <ApprovalCard
        token="abc123"
        approval={SAMPLE_APPROVAL}
        onApprove={onApprove}
        onReject={onReject}
      />,
    )
    const actionIdEl = screen.getByTestId('approval-action-id')
    expect(actionIdEl).toHaveTextContent('mov-12345')
  })

  it('renders the context_summary as the body text', () => {
    render(
      <ApprovalCard
        token="abc123"
        approval={SAMPLE_APPROVAL}
        onApprove={onApprove}
        onReject={onReject}
      />,
    )
    expect(screen.getByText('Anulación de movimiento por error de carga')).toBeInTheDocument()
  })

  it('renders the expires_at timestamp in es-AR locale', () => {
    render(
      <ApprovalCard
        token="abc123"
        approval={SAMPLE_APPROVAL}
        onApprove={onApprove}
        onReject={onReject}
      />,
    )
    const expiresEl = screen.getByTestId('approval-expires-at')
    // es-AR short renders "30/6/26" — match day/month prefix only
    expect(expiresEl.textContent).toMatch(/30\/6/)
  })

  it('renders the Pendiente status badge when status is pending', () => {
    render(
      <ApprovalCard
        token="abc123"
        approval={SAMPLE_APPROVAL}
        onApprove={onApprove}
        onReject={onReject}
      />,
    )
    expect(screen.getByText('Pendiente')).toBeInTheDocument()
  })

  it('renders Approve + Reject buttons when status is pending', () => {
    render(
      <ApprovalCard
        token="abc123"
        approval={SAMPLE_APPROVAL}
        onApprove={onApprove}
        onReject={onReject}
      />,
    )
    expect(screen.getByRole('button', { name: /aprobar/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /rechazar/i })).toBeInTheDocument()
  })

  it('fires onApprove(token) when the Approve button is clicked', async () => {
    const user = userEvent.setup()
    render(
      <ApprovalCard
        token="abc123"
        approval={SAMPLE_APPROVAL}
        onApprove={onApprove}
        onReject={onReject}
      />,
    )
    await user.click(screen.getByRole('button', { name: /aprobar/i }))
    expect(onApprove).toHaveBeenCalledTimes(1)
    expect(onApprove).toHaveBeenCalledWith('abc123')
  })

  it('fires onReject(token) when the Reject button is clicked', async () => {
    const user = userEvent.setup()
    render(
      <ApprovalCard
        token="abc123"
        approval={SAMPLE_APPROVAL}
        onApprove={onApprove}
        onReject={onReject}
      />,
    )
    await user.click(screen.getByRole('button', { name: /rechazar/i }))
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject).toHaveBeenCalledWith('abc123')
  })

  it('disables the action buttons while pending=true', () => {
    render(
      <ApprovalCard
        token="abc123"
        approval={SAMPLE_APPROVAL}
        onApprove={onApprove}
        onReject={onReject}
        pending
      />,
    )
    expect(screen.getByRole('button', { name: /aprobar/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /rechazar/i })).toBeDisabled()
  })

  it('hides the action buttons and renders the Aprobada badge when status=approved', () => {
    render(
      <ApprovalCard
        token="abc123"
        approval={{ ...SAMPLE_APPROVAL, status: 'approved' }}
        onApprove={onApprove}
        onReject={onReject}
      />,
    )
    expect(screen.getByText('Aprobada')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /aprobar/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /rechazar/i })).not.toBeInTheDocument()
  })

  it('hides the action buttons and renders the Rechazada badge when status=rejected', () => {
    render(
      <ApprovalCard
        token="abc123"
        approval={{ ...SAMPLE_APPROVAL, status: 'rejected' }}
        onApprove={onApprove}
        onReject={onReject}
      />,
    )
    expect(screen.getByText('Rechazada')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /aprobar/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /rechazar/i })).not.toBeInTheDocument()
  })

  it('hides the action buttons and renders the Vencida badge when status=expired', () => {
    render(
      <ApprovalCard
        token="abc123"
        approval={{ ...SAMPLE_APPROVAL, status: 'expired' }}
        onApprove={onApprove}
        onReject={onReject}
      />,
    )
    const card = screen.getByRole('region', { name: /token de aprobación/i })
    expect(within(card).getByText('Vencida')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /aprobar/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /rechazar/i })).not.toBeInTheDocument()
  })
})
