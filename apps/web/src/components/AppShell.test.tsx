import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

/**
 * AppShell tests (TASK-009).
 *
 * Covers the `web-frontend/spec.md` Protected Routing + AppShell
 * Layout scenarios:
 *   - When useAuth().isAuthenticated is true → renders Topbar +
 *     Sidebar + children, no redirect
 *   - When isAuthenticated is false → calls router.replace('/login')
 *     and renders a loading placeholder instead of children
 *   - When isAuthenticated is false but refresh() succeeds → renders
 *     the shell without a redirect
 *   - When refresh() fails → still calls router.replace('/login')
 */

const authState = vi.hoisted(() => {
  return {
    user: null as null | {
      operator_id: string
      role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA'
      username: string
      permissions: { can_reprint: boolean; can_anulate: boolean }
    },
    token: null as string | null,
  }
})

const refreshMock = vi.fn()

vi.mock('@/lib/auth', () => ({
  getCurrentUser: () => authState.user,
  getAccessToken: () => authState.token,
  refreshAccessToken: () => refreshMock(),
  login: vi.fn(),
  logout: vi.fn(),
  clearAccessToken: () => {
    authState.user = null
    authState.token = null
  },
  setAccessToken: () => undefined,
}))

const replaceMock = vi.fn()
const pushMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, back: vi.fn() }),
  usePathname: () => '/socios',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}))

const { default: AppShell } = await import('./AppShell.tsx')

describe('AppShell', () => {
  beforeEach(() => {
    authState.user = null
    authState.token = null
    refreshMock.mockReset()
    refreshMock.mockResolvedValue('new.token')
    replaceMock.mockReset()
    pushMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders Topbar, Sidebar, and children when the user is authenticated', () => {
    authState.user = {
      operator_id: 'op-1',
      role: 'ADMIN',
      username: 'admin',
      permissions: { can_reprint: true, can_anulate: true },
    }
    authState.token = 'present.token'

    render(
      <AppShell>
        <div>page content</div>
      </AppShell>,
    )

    expect(screen.getByRole('banner')).toBeInTheDocument() // Topbar
    expect(screen.getByRole('complementary')).toBeInTheDocument() // Sidebar
    expect(screen.getByText('page content')).toBeInTheDocument()
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('attempts a silent refresh and renders the shell when refresh succeeds', async () => {
    // token is null in memory, but refresh returns a new one. We mirror
    // the real auth.ts behavior in the mock by writing the token to
    // authState so the next render of useAuth sees it.
    refreshMock.mockImplementation(async () => {
      authState.token = 'refreshed.token'
      return 'refreshed.token'
    })

    render(
      <AppShell>
        <div>page content</div>
      </AppShell>,
    )

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalled()
    })

    expect(screen.getByText('page content')).toBeInTheDocument()
  })

  it('redirects to /login when no token and refresh fails', async () => {
    // React 19 strict mode runs effects twice, so the mock must reject
    // on every call (not just once).
    refreshMock.mockRejectedValue(new Error('refresh failed'))

    render(
      <AppShell>
        <div>page content</div>
      </AppShell>,
    )

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith(expect.stringMatching(/\/login/))
    })

    expect(screen.queryByText('page content')).not.toBeInTheDocument()
  })
})
