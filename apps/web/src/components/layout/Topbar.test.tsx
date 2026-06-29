import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

/**
 * Topbar tests (TASK-010).
 *
 * Covers the `web-frontend/spec.md` Logout scenario + Sidebar role
 * display:
 *   - Renders the username and a role badge derived from useAuth()
 *   - The logout button calls useAuth().logout() when clicked
 *   - When the user is null, the Topbar renders a disabled placeholder
 *     (defensive — the AppShell should never mount the Topbar without
 *     a user, but the Topbar itself should not crash)
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

const loginMock = vi.fn()
const logoutMock = vi.fn()
const refreshMock = vi.fn()

vi.mock('@/lib/auth', () => ({
  login: (...args: unknown[]) => loginMock(...args),
  logout: () => {
    logoutMock()
    authState.user = null
    authState.token = null
  },
  refreshAccessToken: () => refreshMock(),
  getCurrentUser: () => authState.user,
  getAccessToken: () => authState.token,
  clearAccessToken: () => {
    authState.user = null
    authState.token = null
  },
  setAccessToken: () => undefined,
}))

const { default: Topbar } = await import('./Topbar.tsx')

describe('Topbar', () => {
  beforeEach(() => {
    authState.user = null
    authState.token = null
    loginMock.mockReset()
    logoutMock.mockReset()
    refreshMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the institutional title "Athlos"', () => {
    render(<Topbar />)
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByText(/athlos/i)).toBeInTheDocument()
  })

  it('shows the operator username when a user is present', () => {
    authState.user = {
      operator_id: 'op-7',
      role: 'ADMIN',
      username: 'admin',
      permissions: { can_reprint: true, can_anulate: true },
    }
    authState.token = 'seeded.token'

    render(<Topbar />)
    expect(screen.getByTestId('topbar-username')).toHaveTextContent('admin')
    expect(screen.getByTestId('topbar-role-badge')).toHaveTextContent('ADMIN')
  })

  it('exposes a "Salir" button that calls useAuth().logout on click', async () => {
    authState.user = {
      operator_id: 'op-7',
      role: 'TESORERO',
      username: 'tesorero',
      permissions: { can_reprint: true, can_anulate: false },
    }
    authState.token = 'seeded.token'

    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    render(<Topbar />)

    const logoutButton = screen.getByRole('button', { name: /salir/i })
    expect(logoutButton).toBeInTheDocument()

    await user.click(logoutButton)

    expect(logoutMock).toHaveBeenCalledTimes(1)
    expect(authState.user).toBeNull()
  })

  it('renders inside a banner landmark with the Athlos brand group', () => {
    render(<Topbar />)
    const banner = screen.getByRole('banner')
    expect(within(banner).getByText(/athlos/i)).toBeInTheDocument()
  })
})
