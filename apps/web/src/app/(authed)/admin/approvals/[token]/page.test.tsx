import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Approval detail page tests (TASK-036, PR 8c.2).
 *
 * `/admin/approvals/[token]` is the ADMIN's view of one approval
 * token. It loads the context from `GET /api/v1/approval/:token`
 * via TanStack Query and renders `<ApprovalCard>` with the
 * Approve / Reject controls.
 *
 * CRITICAL UX contract — the approval executor is a backend STUB
 * (see `apps/api/src/routes/approval.ts:91-133`). When the user
 * clicks Approve, the API records the decision but does NOT
 * execute the underlying ctacte.anulate / payment_order action.
 * The UI MUST show "Aprobación registrada — la ejecución real
 * queda pendiente" rather than "Anulación aplicada" to keep
 * operator trust honest. This is a trust issue — the user MUST
 * know what the system actually did.
 *
 * Contract:
 *   - ADMIN-only: non-ADMIN operators see "Sin permisos" copy
 *     and do NOT fire getApproval
 *   - Fires a single getApproval(token) call on mount with the
 *     URL param
 *   - Renders the ApprovalCard once the context resolves
 *   - Renders a back link to /admin/approvals
 *   - Renders the loading skeleton while the query is pending
 *   - Renders the error state when the API rejects (e.g., 410
 *     token expired/used → "Token vencido o ya utilizado")
 *   - Clicking Approve fires recordApprovalDecision(token, 'approve')
 *     and on success shows the "Aprobación registrada" copy
 *   - Clicking Reject opens an inline confirm form; submitting
 *     the reason fires recordApprovalDecision(token, 'reject', reason)
 *   - Clicking Approve while pending=true disables the button
 *   - The "Aprobación registrada" copy is the ONLY success
 *     message — never "Anulación aplicada" or "Aprobado"
 */

const pushMock = vi.fn()
const backMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: backMock }),
  useParams: () => ({ token: 'abc123token' }),
  usePathname: () => '/admin/approvals/abc123token',
  useSearchParams: () => new URLSearchParams(),
}))

const useAuthMock = vi.fn()
vi.mock('@/lib/use-auth', () => ({
  useAuth: () => useAuthMock(),
}))

const getApprovalMock = vi.fn()
const recordApprovalDecisionMock = vi.fn()
vi.mock('@/lib/api/approvals', () => ({
  getApproval: (...args: unknown[]) => getApprovalMock(...args),
  recordApprovalDecision: (...args: unknown[]) => recordApprovalDecisionMock(...args),
}))

const { default: ApprovalDetailPage } = await import('./page')

function makeAdminUser() {
  return {
    user: {
      operator_id: 'op-admin',
      role: 'ADMIN' as const,
      username: 'admin',
      permissions: { can_reprint: true, can_anulate: true },
    },
    token: 'fake.jwt',
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  }
}

function makeOperadorUser() {
  return {
    user: {
      operator_id: 'op-1',
      role: 'OPERADOR' as const,
      username: 'operador',
      permissions: { can_reprint: false, can_anulate: false },
    },
    token: 'fake.jwt',
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  }
}

const SAMPLE_APPROVAL = {
  action_type: 'ctacte.anulate',
  action_id: 'mov-12345',
  context_summary: 'Anulación de movimiento por error de carga',
  created_by: { operator_id: 'op-tesorero-1' },
  expires_at: '2026-06-30T10:00:00.000Z',
  status: 'pending' as const,
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ApprovalDetailPage />
    </QueryClientProvider>,
  )
}

describe('Approval detail page', () => {
  beforeEach(() => {
    pushMock.mockReset()
    backMock.mockReset()
    useAuthMock.mockReset()
    useAuthMock.mockReturnValue(makeAdminUser())
    getApprovalMock.mockReset()
    recordApprovalDecisionMock.mockReset()
    getApprovalMock.mockResolvedValue(SAMPLE_APPROVAL)
    recordApprovalDecisionMock.mockImplementation(
      (_token: string, decision: 'approve' | 'reject') =>
        Promise.resolve({
          decision: decision === 'approve' ? 'approved' : 'rejected',
          action_type: 'ctacte.anulate',
          action_id: 'mov-12345',
          decided_at: '2026-06-28T12:00:00.000Z',
        }),
    )
  })

  it('renders the page heading + intro copy for ADMIN', async () => {
    renderPage()
    expect(
      await screen.findByRole('heading', { name: /aprobaciones/i, level: 1 }),
    ).toBeInTheDocument()
  })

  it('fires a single getApproval call on mount for ADMIN with the URL token', async () => {
    renderPage()
    await waitFor(() => {
      expect(getApprovalMock).toHaveBeenCalledTimes(1)
    })
    expect(getApprovalMock).toHaveBeenCalledWith('abc123token')
  })

  it('does NOT fire getApproval for a non-ADMIN operator', () => {
    useAuthMock.mockReturnValue(makeOperadorUser())
    renderPage()
    expect(getApprovalMock).not.toHaveBeenCalled()
  })

  it('renders the "Sin permisos" copy for a non-ADMIN operator', () => {
    useAuthMock.mockReturnValue(makeOperadorUser())
    renderPage()
    expect(screen.getByText(/sin permisos/i)).toBeInTheDocument()
  })

  it('renders the ApprovalCard once getApproval resolves', async () => {
    renderPage()
    expect(await screen.findByTestId('approval-card')).toBeInTheDocument()
    expect(screen.getByTestId('approval-action-id')).toHaveTextContent('mov-12345')
  })

  it('renders a back link to /admin/approvals', async () => {
    renderPage()
    expect(await screen.findByTestId('approval-back-link')).toBeInTheDocument()
  })

  it('renders the loading skeleton while getApproval is pending', () => {
    getApprovalMock.mockReturnValue(new Promise(() => {})) // never resolves
    renderPage()
    expect(screen.getByText(/cargando/i)).toBeInTheDocument()
  })

  it('renders the "Token vencido o ya utilizado" state when getApproval rejects with 410', async () => {
    getApprovalMock.mockRejectedValue(
      Object.assign(new Error('APPROVAL_TOKEN_GONE: token used or expired'), {
        status: 410,
        code: 'APPROVAL_TOKEN_GONE',
        name: 'ApiError',
      }),
    )
    renderPage()
    const matches = await screen.findAllByText(/token vencido/i)
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('renders a generic error state for non-410 failures', async () => {
    getApprovalMock.mockRejectedValue(
      Object.assign(new Error('internal error'), { status: 500, code: 'INTERNAL_ERROR' }),
    )
    renderPage()
    const matches = await screen.findAllByText(/no se pudo cargar el token/i)
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('clicking Approve fires recordApprovalDecision(token, "approve") with no reason', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByTestId('approval-card')
    await user.click(screen.getByTestId('approval-approve'))
    await waitFor(() => {
      expect(recordApprovalDecisionMock).toHaveBeenCalledWith('abc123token', 'approve', undefined)
    })
  })

  it('after a successful approve, renders the "Aprobación registrada — ejecución real pendiente" copy (STUB note)', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByTestId('approval-card')
    await user.click(screen.getByTestId('approval-approve'))
    const matches = await screen.findAllByText((_, el) =>
      Boolean(
        el?.textContent?.includes('Aprobación registrada — la ejecución real queda pendiente'),
      ),
    )
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('does NOT render "Anulación aplicada" or "Aprobado" anywhere (trust UX)', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByTestId('approval-card')
    await user.click(screen.getByTestId('approval-approve'))
    await screen.findAllByText((_, el) =>
      Boolean(el?.textContent?.includes('Aprobación registrada')),
    )
    expect(screen.queryByText(/anulación aplicada/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^aprobado$/i)).not.toBeInTheDocument()
  })

  it('clicking Reject opens an inline confirm form with a reason textarea', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByTestId('approval-card')
    await user.click(screen.getByTestId('approval-reject'))
    expect(await screen.findByTestId('approval-reject-reason')).toBeInTheDocument()
  })

  it('submitting the reject form fires recordApprovalDecision(token, "reject", reason)', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByTestId('approval-card')
    await user.click(screen.getByTestId('approval-reject'))
    const reasonInput = await screen.findByTestId('approval-reject-reason')
    await user.type(reasonInput, 'Operación no procede')
    await user.click(screen.getByTestId('approval-reject-confirm'))
    await waitFor(() => {
      expect(recordApprovalDecisionMock).toHaveBeenCalledWith(
        'abc123token',
        'reject',
        'Operación no procede',
      )
    })
  })

  it('after a successful reject, renders the "Rechazo registrado" copy', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByTestId('approval-card')
    await user.click(screen.getByTestId('approval-reject'))
    const reasonInput = await screen.findByTestId('approval-reject-reason')
    await user.type(reasonInput, 'No procede')
    await user.click(screen.getByTestId('approval-reject-confirm'))
    const matches = await screen.findAllByText((_, el) =>
      Boolean(el?.textContent?.includes('Rechazo registrado — la ejecución real queda pendiente')),
    )
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('disables the Approve button while the decision POST is in-flight', async () => {
    const user = userEvent.setup()
    // Make recordApprovalDecision never resolve so the click stays pending.
    recordApprovalDecisionMock.mockReturnValue(new Promise(() => {}))
    renderPage()
    await screen.findByTestId('approval-card')
    await user.click(screen.getByTestId('approval-approve'))
    expect(screen.getByTestId('approval-approve')).toBeDisabled()
  })

  it('renders the error message when the decision POST fails', async () => {
    const user = userEvent.setup()
    recordApprovalDecisionMock.mockRejectedValue(
      Object.assign(new Error('network down'), { status: 500, code: 'INTERNAL_ERROR' }),
    )
    renderPage()
    await screen.findByTestId('approval-card')
    await user.click(screen.getByTestId('approval-approve'))
    expect(await screen.findByText(/no se pudo registrar la decisión/i)).toBeInTheDocument()
  })

  it('for status=approved, hides the action buttons (read-only)', async () => {
    getApprovalMock.mockResolvedValue({ ...SAMPLE_APPROVAL, status: 'approved' })
    renderPage()
    await screen.findByTestId('approval-card')
    expect(screen.queryByTestId('approval-approve')).not.toBeInTheDocument()
    expect(screen.queryByTestId('approval-reject')).not.toBeInTheDocument()
  })

  it('for status=expired, hides the action buttons (read-only)', async () => {
    getApprovalMock.mockResolvedValue({ ...SAMPLE_APPROVAL, status: 'expired' })
    renderPage()
    await screen.findByTestId('approval-card')
    expect(screen.queryByTestId('approval-approve')).not.toBeInTheDocument()
    expect(screen.queryByTestId('approval-reject')).not.toBeInTheDocument()
  })
})
