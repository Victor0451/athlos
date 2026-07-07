import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * New socio page tests (PR 8b.2 second slice + PR 8b.7 toast wiring).
 *
 * Contract:
 *   - ADMIN sees the form + submit fires `createSocio` mutation
 *   - On success: invalidates the `['socios']` query key + pushes /socios
 *     + fires `notify('success', 'Socio creado')`
 *   - On error: shows an inline `role="alert"` with the error message
 *     + fires `notify('error', 'No se pudo crear el socio')`
 *   - Non-ADMIN: redirected (no form rendered); pushed to /socios
 *   - Cancel navigates back to /socios without firing the mutation
 *   - Loading state shows "Guardando…" + disabled form
 */

const pushMock = vi.fn()
const replaceMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, back: vi.fn() }),
  usePathname: () => '/socios/new',
  useSearchParams: () => new URLSearchParams(),
}))

const useAuthMock = vi.fn()
vi.mock('@/lib/use-auth', () => ({
  useAuth: () => useAuthMock(),
}))

const createSocioMock = vi.fn()
vi.mock('@/lib/api/socios', () => ({
  createSocio: (...args: unknown[]) => createSocioMock(...args),
}))

// PR 8b.7 — toast primitive. Mock `@/lib/notifications`
// synchronously so the page wires `notify` into the create mutation
// without rendering a real <ToasterMount />. The wrapper itself has
// its own ARIA / mount contract test in `Toast.test.tsx`.
const notifyMock = vi.fn((..._args: unknown[]) => 'toast-mock-1')
vi.mock('@/lib/notifications', () => ({
  notify: (...args: unknown[]) => notifyMock(...args),
}))

const { default: NewSocioPage } = await import('./page')

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
      <NewSocioPage />
    </QueryClientProvider>,
  )
}

describe('New socio page', () => {
  beforeEach(() => {
    pushMock.mockReset()
    replaceMock.mockReset()
    useAuthMock.mockReset()
    useAuthMock.mockReturnValue(makeAdminUser())
    createSocioMock.mockReset()
    notifyMock.mockReset()
    notifyMock.mockReturnValue('toast-mock-1')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the "Nuevo socio" heading + a back button for ADMIN', () => {
    renderPage()
    expect(screen.getByTestId('new-socio-heading')).toHaveTextContent(/nuevo socio/i)
    const back = screen.getByTestId('new-socio-back')
    expect(back).toBeInTheDocument()
    // The back control is a <button>, not a <Link> — clicking it
    // pushes /socios (the canonical back target for this page, since
    // there's no meaningful "history" to preserve on a deep-link).
    fireEvent.click(back)
    expect(pushMock).toHaveBeenCalledWith('/socios')
  })

  it('renders the create-mode SocioForm for ADMIN', () => {
    renderPage()
    expect(screen.getByTestId('socio-form-create')).toBeInTheDocument()
  })

  it('fires createSocio on valid form submit', async () => {
    createSocioMock.mockResolvedValueOnce({
      id: '99999999-9999-9999-9999-999999999999',
      numero_socio: '00042',
      nombre: 'María',
      apellido: 'García',
      dni: '40123456',
      fecha_alta: '2026-07-03',
      estado: 'activo',
    })

    renderPage()

    fireEvent.input(screen.getByTestId('socio-form-numero'), { target: { value: '00042' } })
    fireEvent.input(screen.getByTestId('socio-form-dni'), { target: { value: '40123456' } })
    fireEvent.input(screen.getByTestId('socio-form-apellido'), { target: { value: 'García' } })
    fireEvent.input(screen.getByTestId('socio-form-nombre'), { target: { value: 'María' } })
    fireEvent.input(screen.getByTestId('socio-form-fecha-alta'), {
      target: { value: '2026-07-03' },
    })
    fireEvent.click(screen.getByTestId('socio-form-submit'))

    await waitFor(() => {
      expect(createSocioMock).toHaveBeenCalledWith({
        numero_socio: '00042',
        dni: '40123456',
        nombre: 'María',
        apellido: 'García',
        fecha_alta: '2026-07-03',
        estado: 'activo',
      })
    })
  })

  it('navigates to /socios on success', async () => {
    createSocioMock.mockResolvedValueOnce({
      id: '99999999-9999-9999-9999-999999999999',
      numero_socio: '00042',
      nombre: 'María',
      apellido: 'García',
      dni: '40123456',
      fecha_alta: '2026-07-03',
      estado: 'activo',
    })

    renderPage()
    fireEvent.input(screen.getByTestId('socio-form-numero'), { target: { value: '00042' } })
    fireEvent.input(screen.getByTestId('socio-form-dni'), { target: { value: '40123456' } })
    fireEvent.input(screen.getByTestId('socio-form-apellido'), { target: { value: 'García' } })
    fireEvent.input(screen.getByTestId('socio-form-nombre'), { target: { value: 'María' } })
    fireEvent.input(screen.getByTestId('socio-form-fecha-alta'), {
      target: { value: '2026-07-03' },
    })
    fireEvent.click(screen.getByTestId('socio-form-submit'))

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/socios')
    })
  })

  it('renders the error message in a role="alert" block when createSocio rejects', async () => {
    createSocioMock.mockRejectedValueOnce(new Error('CONFLICT: número de socio duplicado'))

    renderPage()
    fireEvent.input(screen.getByTestId('socio-form-numero'), { target: { value: '00042' } })
    fireEvent.input(screen.getByTestId('socio-form-dni'), { target: { value: '40123456' } })
    fireEvent.input(screen.getByTestId('socio-form-apellido'), { target: { value: 'García' } })
    fireEvent.input(screen.getByTestId('socio-form-nombre'), { target: { value: 'María' } })
    fireEvent.input(screen.getByTestId('socio-form-fecha-alta'), {
      target: { value: '2026-07-03' },
    })
    fireEvent.click(screen.getByTestId('socio-form-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('new-socio-error')).toBeInTheDocument()
    })
    expect(screen.getByRole('alert')).toHaveTextContent(/número de socio duplicado/i)
  })

  it('redirects non-ADMIN users to /socios (renders the gate, not the form)', () => {
    useAuthMock.mockReturnValue(makeOperadorUser())
    renderPage()
    expect(screen.getByTestId('new-socio-gate')).toBeInTheDocument()
    expect(screen.queryByTestId('socio-form-create')).not.toBeInTheDocument()
    expect(replaceMock).toHaveBeenCalledWith('/socios')
  })

  it('navigates back to /socios when "Cancelar" is clicked, without firing the mutation', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('socio-form-cancel'))
    expect(pushMock).toHaveBeenCalledWith('/socios')
    expect(createSocioMock).not.toHaveBeenCalled()
  })

  /* ── PR 8b.7: toast notifications on create ───────────────────────── */

  it('fires notify("success", "Socio creado") on successful create', async () => {
    createSocioMock.mockResolvedValueOnce({
      id: '99999999-9999-9999-9999-999999999999',
      numero_socio: '00042',
      nombre: 'María',
      apellido: 'García',
      dni: '40123456',
      fecha_alta: '2026-07-03',
      estado: 'activo',
    })

    renderPage()
    fireEvent.input(screen.getByTestId('socio-form-numero'), { target: { value: '00042' } })
    fireEvent.input(screen.getByTestId('socio-form-dni'), { target: { value: '40123456' } })
    fireEvent.input(screen.getByTestId('socio-form-apellido'), { target: { value: 'García' } })
    fireEvent.input(screen.getByTestId('socio-form-nombre'), { target: { value: 'María' } })
    fireEvent.input(screen.getByTestId('socio-form-fecha-alta'), {
      target: { value: '2026-07-03' },
    })
    fireEvent.click(screen.getByTestId('socio-form-submit'))

    await waitFor(() => {
      expect(notifyMock).toHaveBeenCalledWith('success', 'Socio creado')
    })
    // router.push to /socios still fires after the success toast
    expect(pushMock).toHaveBeenCalledWith('/socios')
  })

  it('fires notify("error", "No se pudo crear el socio") when createSocio rejects', async () => {
    createSocioMock.mockRejectedValueOnce(new Error('CONFLICT: número de socio duplicado'))

    renderPage()
    fireEvent.input(screen.getByTestId('socio-form-numero'), { target: { value: '00042' } })
    fireEvent.input(screen.getByTestId('socio-form-dni'), { target: { value: '40123456' } })
    fireEvent.input(screen.getByTestId('socio-form-apellido'), { target: { value: 'García' } })
    fireEvent.input(screen.getByTestId('socio-form-nombre'), { target: { value: 'María' } })
    fireEvent.input(screen.getByTestId('socio-form-fecha-alta'), {
      target: { value: '2026-07-03' },
    })
    fireEvent.click(screen.getByTestId('socio-form-submit'))

    await waitFor(() => {
      expect(notifyMock).toHaveBeenCalledWith('error', 'No se pudo crear el socio')
    })
    // Inline error block still renders (toast is additive feedback).
    expect(screen.getByTestId('new-socio-error')).toBeInTheDocument()
  })
})
