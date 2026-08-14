import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const push = vi.fn()
const logout = vi.fn()
const getMe = vi.fn()
const changePassword = vi.fn()
const user: {
  operator_id: string
  role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA'
  username: string
} = {
  operator_id: 'op-1',
  role: 'ADMIN',
  username: 'operador',
}

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/lib/use-auth', () => ({
  useAuth: () => ({ user, logout, isAuthenticated: true, token: 'token' }),
}))
vi.mock('@/lib/api/auth', () => ({
  getMe: () => getMe(),
  changePassword: (...args: string[]) => changePassword(...args),
}))

const { default: PersonalMenu } = await import('./PersonalMenu')
const { default: AccountPage } = await import('@/app/(authed)/account/page')
const { default: PasswordPage } = await import('@/app/(authed)/account/password/page')
const { default: PreferencesPage } = await import('@/app/(authed)/account/preferences/page')

const renderPage = (page: React.ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {page}
    </QueryClientProvider>,
  )

describe('personal account surfaces', () => {
  beforeEach(() => {
    push.mockReset()
    logout.mockReset()
    getMe.mockReset()
    changePassword.mockReset()
    getMe.mockResolvedValue({
      id: 'op-1',
      username: 'operador',
      role: 'ADMIN',
      last_login_at: null,
    })
  })

  it.each(['ADMIN', 'TESORERO', 'OPERADOR', 'CONSULTA'] as const)(
    'offers only personal actions to %s',
    async (role) => {
      user.role = role
      const actor = userEvent.setup()
      render(<PersonalMenu />)
      await actor.click(screen.getByRole('button', { name: /menú personal/i }))
      expect(screen.getByRole('link', { name: /mi cuenta/i })).toHaveAttribute('href', '/account')
      expect(screen.getByRole('link', { name: /cambiar contraseña/i })).toHaveAttribute(
        'href',
        '/account/password',
      )
      expect(screen.getByRole('link', { name: /preferencias de notificaciones/i })).toHaveAttribute(
        'href',
        '/account/preferences',
      )
      expect(screen.queryByText(/configuración del sistema/i)).not.toBeInTheDocument()
      await actor.click(screen.getByRole('button', { name: /salir/i }))
      await waitFor(() => expect(push).toHaveBeenCalledWith('/login'))
      expect(logout).toHaveBeenCalledOnce()
    },
  )

  it('closes on Escape and outside click while returning focus to the trigger', async () => {
    const actor = userEvent.setup()
    render(
      <>
        <PersonalMenu />
        <button type="button">Fuera</button>
      </>,
    )
    const trigger = screen.getByRole('button', { name: /menú personal/i })

    await actor.click(trigger)
    await actor.keyboard('{Escape}')
    expect(screen.queryByRole('link', { name: /mi cuenta/i })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    await actor.click(trigger)
    await actor.click(screen.getByRole('button', { name: 'Fuera' }))
    expect(screen.queryByRole('link', { name: /mi cuenta/i })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('loads a read-only account overview and preferences without an editor', async () => {
    renderPage(<AccountPage />)
    expect(await screen.findByText('operador')).toBeInTheDocument()
    expect(getMe).toHaveBeenCalledOnce()
    renderPage(<PreferencesPage />)
    expect(
      screen.getByRole('heading', { name: /preferencias de notificaciones/i }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('confirms a password change and allows a safe-error retry', async () => {
    changePassword
      .mockRejectedValueOnce(new Error('rejected'))
      .mockResolvedValueOnce({ message: 'Password changed' })
    const actor = userEvent.setup()
    renderPage(<PasswordPage />)
    await actor.type(screen.getByLabelText(/contraseña actual/i), 'bad-password')
    await actor.type(screen.getByLabelText(/^nueva contraseña/i), 'new-password')
    await actor.click(screen.getByRole('button', { name: /cambiar contraseña/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo cambiar/i)
    await actor.click(screen.getByRole('button', { name: /cambiar contraseña/i }))
    await waitFor(() =>
      expect(changePassword).toHaveBeenLastCalledWith('bad-password', 'new-password'),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(/contraseña actualizada/i)
  })
})
