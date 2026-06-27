import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const pushMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}))

const loginMock = vi.fn()

vi.mock('@/lib/auth', () => ({
  login: (...args: unknown[]) => loginMock(...args),
  getAccessToken: () => null,
  logout: vi.fn(),
  refreshAccessToken: vi.fn(),
  clearAccessToken: vi.fn(),
  setAccessToken: vi.fn(),
}))

const { default: LoginPage } = await import('../page.tsx')

describe('LoginPage', () => {
  beforeEach(() => {
    pushMock.mockReset()
    loginMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the form with username + password fields and a submit button', () => {
    render(<LoginPage />)
    expect(screen.getByLabelText(/usuario/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/contraseña/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ingresar/i })).toBeInTheDocument()
  })

  it('shows the institutional title and tagline on the left panel', () => {
    render(<LoginPage />)
    expect(screen.getByRole('heading', { name: /athlos/i })).toBeInTheDocument()
    expect(screen.getByText(/consola de operaciones/i)).toBeInTheDocument()
  })

  it('rejects empty submissions with field-level validation errors', async () => {
    const user = userEvent.setup()
    render(<LoginPage />)

    await user.click(screen.getByRole('button', { name: /ingresar/i }))

    await waitFor(() => {
      expect(screen.getByText(/ingresá tu usuario/i)).toBeInTheDocument()
      expect(screen.getByText(/ingresá tu contraseña/i)).toBeInTheDocument()
    })

    expect(loginMock).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('calls auth.login with the entered credentials on submit', async () => {
    loginMock.mockResolvedValueOnce({
      access_token: 'token',
      refresh_token: 'refresh',
      expires_in: 900,
      operator_id: 'op-1',
      role: 'ADMIN',
      permissions: { can_reprint: true, can_anulate: true },
    })

    const user = userEvent.setup()
    render(<LoginPage />)

    await user.type(screen.getByLabelText(/usuario/i), 'admin')
    await user.type(screen.getByLabelText(/contraseña/i), 'secret123')
    await user.click(screen.getByRole('button', { name: /ingresar/i }))

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith('admin', 'secret123')
    })
  })

  it('redirects to /dashboard on successful login', async () => {
    loginMock.mockResolvedValueOnce({
      access_token: 'token',
      refresh_token: 'refresh',
      expires_in: 900,
      operator_id: 'op-1',
      role: 'ADMIN',
      permissions: { can_reprint: true, can_anulate: true },
    })

    const user = userEvent.setup()
    render(<LoginPage />)

    await user.type(screen.getByLabelText(/usuario/i), 'admin')
    await user.type(screen.getByLabelText(/contraseña/i), 'secret123')
    await user.click(screen.getByRole('button', { name: /ingresar/i }))

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/dashboard')
    })
  })

  it('shows the account-locked copy on ACCOUNT_LOCKED', async () => {
    const lockedError = Object.assign(new Error('ACCOUNT_LOCKED: locked'), {
      code: 'ACCOUNT_LOCKED',
      retryAfterMinutes: 15,
    })
    loginMock.mockRejectedValueOnce(lockedError)

    const user = userEvent.setup()
    render(<LoginPage />)

    await user.type(screen.getByLabelText(/usuario/i), 'admin')
    await user.type(screen.getByLabelText(/contraseña/i), 'secret123')
    await user.click(screen.getByRole('button', { name: /ingresar/i }))

    await waitFor(() => {
      expect(
        screen.getByText(/cuenta bloqueada.*vuelva a intentar en 15 minutos/i),
      ).toBeInTheDocument()
    })
  })

  it('shows a generic error message on 401 INVALID_CREDENTIALS', async () => {
    loginMock.mockRejectedValueOnce(
      Object.assign(new Error('INVALID_CREDENTIALS: bad creds'), {
        code: 'INVALID_CREDENTIALS',
      }),
    )

    const user = userEvent.setup()
    render(<LoginPage />)

    await user.type(screen.getByLabelText(/usuario/i), 'admin')
    await user.type(screen.getByLabelText(/contraseña/i), 'wrong')
    await user.click(screen.getByRole('button', { name: /ingresar/i }))

    await waitFor(() => {
      expect(screen.getByText(/usuario o contraseña incorrectos/i)).toBeInTheDocument()
    })
  })

  it('disables the submit button while the request is in flight', async () => {
    let resolveLogin!: (value: unknown) => void
    loginMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLogin = resolve
      }),
    )

    const user = userEvent.setup()
    render(<LoginPage />)

    await user.type(screen.getByLabelText(/usuario/i), 'admin')
    await user.type(screen.getByLabelText(/contraseña/i), 'secret123')
    await user.click(screen.getByRole('button', { name: /ingresar/i }))

    const submitButton = screen.getByRole('button', { name: /ingresar|ingresando/i })
    expect(submitButton).toBeDisabled()

    await act(async () => {
      resolveLogin({
        access_token: 'a',
        refresh_token: 'r',
        expires_in: 900,
        operator_id: 'op-1',
        role: 'ADMIN',
        permissions: { can_reprint: true, can_anulate: true },
      })
    })
  })
})
