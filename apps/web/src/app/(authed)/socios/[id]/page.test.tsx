import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Socio detail page tests (TASK-021, PR 8b.1).
 *
 * Read-only view at `/socios/[id]`. The orchestrator brief calls
 * out: list + detail + search **only** — no create/update/delete UI
 * in PR 8b.1 (those land in 8b.1b or 8b.2 with ADMIN role gating).
 *
 * Contract:
 *   - Renders the socio name + DNI in a heading + the estado badge
 *   - Renders the field grid (nombre, apellido, dni, email, telefono,
 *     fecha_alta, estado, categoria, numero_socio)
 *   - Shows a loading skeleton while the query is pending
 *   - Shows a "Socio no encontrado" error state on 404
 *   - "Volver al listado" link points to /socios
 *   - The page calls `getSocio(id)` with the route's dynamic segment
 *
 * The dynamic segment is read via `useParams()` from `next/navigation`,
 * which the test mocks to return `{ id: SAMPLE_SOCIO.id }`. We use
 * `useParams` (not `use(params)`) so the test doesn't need a
 * Suspense boundary — `useParams` is plain read from Next's router
 * context and works in jsdom.
 */

const pushMock = vi.fn()
const replaceMock = vi.fn()
const useParamsMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, back: vi.fn() }),
  usePathname: () => '/socios/abc',
  useSearchParams: () => new URLSearchParams(),
  useParams: <T,>() => useParamsMock() as T,
}))

const getSocioMock = vi.fn()

vi.mock('@/lib/api/socios', () => ({
  getSocio: (...args: unknown[]) => getSocioMock(...args),
}))

const useAuthMock = vi.fn()
vi.mock('@/lib/use-auth', () => ({
  useAuth: () => useAuthMock(),
}))

const { default: SocioDetailPage } = await import('./page')

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

const SAMPLE_SOCIO = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  numero_socio: '00001',
  nombre: 'Juan',
  apellido: 'García',
  dni: '12345678',
  fecha_alta: '2020-03-15',
  estado: 'activo' as const,
  categoria: 'TITULAR',
  direccion: 'Av. Siempre Viva 742',
  telefono: '+5491155555555',
  email: 'juan@example.com',
  created_at: '2020-03-15T12:00:00.000Z',
  updated_at: '2026-01-15T08:00:00.000Z',
  deleted_at: null,
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <SocioDetailPage />
    </QueryClientProvider>,
  )
}

describe('Socio detail page', () => {
  beforeEach(() => {
    pushMock.mockReset()
    replaceMock.mockReset()
    useParamsMock.mockReset()
    useParamsMock.mockReturnValue({ id: SAMPLE_SOCIO.id })
    useAuthMock.mockReset()
    useAuthMock.mockReturnValue(makeAdminUser())
    getSocioMock.mockReset()
    getSocioMock.mockResolvedValue(SAMPLE_SOCIO)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls getSocio with the dynamic segment id', async () => {
    renderPage()
    await waitFor(() => {
      expect(getSocioMock).toHaveBeenCalledWith(SAMPLE_SOCIO.id)
    })
  })

  it('renders the socio name (apellido, nombre) and DNI in the header', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/garcía.*juan/i)
    })
    expect(screen.getByText(/dni.*12345678/i)).toBeInTheDocument()
  })

  it('renders the estado badge with the right copy', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('activo')).toBeInTheDocument()
    })
  })

  it('renders the socio fields (email, telefono, fecha_alta, numero_socio)', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('juan@example.com')).toBeInTheDocument()
    })
    expect(screen.getByText('+5491155555555')).toBeInTheDocument()
    // fecha_alta is rendered as DD/MM/YYYY (es-AR)
    expect(screen.getByText('15/03/2020')).toBeInTheDocument()
    expect(screen.getByText('00001')).toBeInTheDocument()
  })

  it('shows a loading skeleton while the query is pending', () => {
    getSocioMock.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByTestId('socio-detail-loading')).toBeInTheDocument()
  })

  it('renders a "Socio no encontrado" error state when the API rejects', async () => {
    // The apiFetch wrapper throws ApiError on !res.ok. The detail
    // page catches the error and renders the not-found copy.
    getSocioMock.mockRejectedValue(new Error('NOT_FOUND: socio no encontrado'))

    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/socio no encontrado/i)).toBeInTheDocument()
    })
  })

  it('renders a "Volver al listado" link back to /socios', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /volver/i })).toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: /volver/i })).toHaveAttribute('href', '/socios')
  })
})
