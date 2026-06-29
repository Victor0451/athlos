import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Approvals list page tests (TASK-035, PR 8c.2).
 *
 * `/admin/approvals` is the ADMIN's queue of pending approval
 * tokens. Per design.md §8 and the spec, the v0.5.x backend has
 * NO list-pending-tokens endpoint — the executor + admin queue
 * land in a Phase 9 backend slice. Until then the page renders
 * the "Próximamente" placeholder (deferred features per the
 * `web-frontend/spec.md` Cross-Slice Disabled Feature Placeholders
 * scenario).
 *
 * Contract:
 *   - ADMIN-only: non-ADMIN operators see "Sin permisos" copy
 *     and do NOT trigger any query
 *   - The page heading renders the queue title
 *   - The body shows "Próximamente — disponible en una próxima
 *     versión" copy with a link to the docs/admin channel
 *   - A "Ver un token específico" deep-link CTA renders so an
 *     ADMIN with a known token URL can still navigate to the
 *     detail page (this is the read-only escape hatch until the
 *     real queue lands)
 *   - Loading state: brief skeleton while the role check resolves
 *   - No fetch is fired (the page is a static placeholder)
 */

const pushMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin/approvals',
  useSearchParams: () => new URLSearchParams(),
}))

const useAuthMock = vi.fn()
vi.mock('@/lib/use-auth', () => ({
  useAuth: () => useAuthMock(),
}))

const getApprovalMock = vi.fn()
vi.mock('@/lib/api/approvals', () => ({
  getApproval: (...args: unknown[]) => getApprovalMock(...args),
  recordApprovalDecision: vi.fn(),
}))

const { default: ApprovalsListPage } = await import('./page')

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

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ApprovalsListPage />
    </QueryClientProvider>,
  )
}

describe('Approvals list page', () => {
  beforeEach(() => {
    pushMock.mockReset()
    useAuthMock.mockReset()
    useAuthMock.mockReturnValue(makeAdminUser())
    getApprovalMock.mockReset()
  })

  it('renders the page heading + intro copy for ADMIN', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /aprobaciones/i, level: 1 })).toBeInTheDocument()
  })

  it('renders the Próximamente placeholder (no list endpoint in v0.5.x)', () => {
    renderPage()
    expect(screen.getByText(/próximamente/i)).toBeInTheDocument()
  })

  it('does NOT fire getApproval on mount (placeholder page — no auto-fetch)', () => {
    renderPage()
    // Give any potential queries a tick to fire.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(getApprovalMock).not.toHaveBeenCalled()
        resolve()
      }, 50)
    })
  })

  it('does NOT fire getApproval for a non-ADMIN operator either', () => {
    useAuthMock.mockReturnValue(makeOperadorUser())
    renderPage()
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(getApprovalMock).not.toHaveBeenCalled()
        resolve()
      }, 50)
    })
  })

  it('renders the "Sin permisos" copy for a non-ADMIN operator', () => {
    useAuthMock.mockReturnValue(makeOperadorUser())
    renderPage()
    expect(screen.getByText(/sin permisos/i)).toBeInTheDocument()
  })

  it('exposes a stable test-id for the placeholder region', () => {
    renderPage()
    expect(screen.getByTestId('approvals-placeholder')).toBeInTheDocument()
  })

  it('renders the deep-link input so ADMINs with a known token URL can still reach the detail page', () => {
    renderPage()
    const input = screen.getByTestId('approvals-token-input')
    expect(input).toBeInTheDocument()
    expect(input).toHaveAttribute('type', 'text')
  })

  it('navigates to /admin/approvals/<token> when the deep-link form is submitted', async () => {
    const user = userEvent.setup()
    renderPage()
    const input = screen.getByTestId('approvals-token-input')
    await user.type(input, 'abc123token')
    await user.click(screen.getByRole('button', { name: /abrir/i }))
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/admin/approvals/abc123token')
    })
  })

  it('does NOT navigate when the deep-link input is empty', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: /abrir/i }))
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('trims the token before navigating (whitespace-tolerant)', async () => {
    const user = userEvent.setup()
    renderPage()
    const input = screen.getByTestId('approvals-token-input')
    await user.type(input, '   abc123token   ')
    await user.click(screen.getByRole('button', { name: /abrir/i }))
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/admin/approvals/abc123token')
    })
  })
})
