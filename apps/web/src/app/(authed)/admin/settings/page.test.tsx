import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Settings page tests (TASK-038, PR 8c.2).
 *
 * `/admin/settings` is the ADMIN-only settings surface. It renders
 * the current operator's profile (via `<OperatorProfile>`) + a
 * "Cambiar contraseña" placeholder card (the form lands in a
 * follow-up slice; for PR 8c.2 the button is disabled with a
 * "Próximamente" copy).
 *
 * Contract:
 *   - ADMIN-only: non-ADMIN operators see "Sin permisos" copy
 *   - Page heading renders "Configuración"
 *   - On mount, fires a single `getMe()` call (TanStack Query)
 *   - Renders the OperatorProfile once the profile resolves
 *   - Renders the loading skeleton while getMe is pending
 *   - Renders the "Próximamente" copy for the change-password card
 *     (the button is disabled)
 *   - Renders the error state when getMe fails (network/API error)
 */

const useAuthMock = vi.fn()
vi.mock('@/lib/use-auth', () => ({
  useAuth: () => useAuthMock(),
}))

const getMeMock = vi.fn()
const changePasswordMock = vi.fn()
vi.mock('@/lib/api/auth', () => ({
  getMe: (...args: unknown[]) => getMeMock(...args),
  changePassword: (...args: unknown[]) => changePasswordMock(...args),
}))

const { default: SettingsPage } = await import('./page')

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
      <SettingsPage />
    </QueryClientProvider>,
  )
}

const SAMPLE_ME = {
  id: 'op-1',
  username: 'admin',
  role: 'ADMIN' as const,
  can_reprint: true,
  can_anulate: true,
  is_active: true,
  last_login_at: '2026-06-28T10:00:00.000Z',
  created_at: '2024-01-15T08:00:00.000Z',
}

describe('Settings page', () => {
  beforeEach(() => {
    useAuthMock.mockReset()
    useAuthMock.mockReturnValue(makeAdminUser())
    getMeMock.mockReset()
    changePasswordMock.mockReset()
    getMeMock.mockResolvedValue(SAMPLE_ME)
  })

  it('renders the page heading + intro copy for ADMIN', async () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /configuración/i, level: 1 })).toBeInTheDocument()
  })

  it('fires a single getMe call on mount for ADMIN', async () => {
    renderPage()
    await waitFor(() => {
      expect(getMeMock).toHaveBeenCalledTimes(1)
    })
  })

  it('does NOT fire getMe for a non-ADMIN operator', () => {
    useAuthMock.mockReturnValue(makeOperadorUser())
    renderPage()
    expect(getMeMock).not.toHaveBeenCalled()
  })

  it('renders the "Sin permisos" copy for a non-ADMIN operator', () => {
    useAuthMock.mockReturnValue(makeOperadorUser())
    renderPage()
    expect(screen.getByText(/sin permisos/i)).toBeInTheDocument()
  })

  it('renders the OperatorProfile once getMe resolves', async () => {
    renderPage()
    expect(await screen.findByTestId('operator-profile')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'admin', level: 2 })).toBeInTheDocument()
  })

  it('renders the loading skeleton while getMe is pending', () => {
    getMeMock.mockReturnValue(new Promise(() => {})) // never resolves
    renderPage()
    expect(screen.getByText(/cargando/i)).toBeInTheDocument()
  })

  it('renders the error state when getMe rejects', async () => {
    getMeMock.mockRejectedValue(Object.assign(new Error('network down'), { status: 500 }))
    renderPage()
    expect(await screen.findByText(/no se pudo cargar el perfil/i)).toBeInTheDocument()
  })

  it('renders the "Próximamente" placeholder for the change-password card', async () => {
    renderPage()
    await screen.findByTestId('operator-profile')
    expect(screen.getByTestId('change-password-placeholder')).toBeInTheDocument()
    expect(screen.getByText(/próximamente/i)).toBeInTheDocument()
  })

  it('renders a disabled "Cambiar contraseña" button (form lands in a follow-up slice)', async () => {
    renderPage()
    await screen.findByTestId('operator-profile')
    const btn = screen.getByTestId('change-password-button')
    expect(btn).toBeDisabled()
  })
})
