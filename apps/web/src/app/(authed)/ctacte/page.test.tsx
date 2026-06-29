import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Ctacte list page tests (TASK-024, PR 8b.2).
 *
 * The `/ctacte` page is a socio-selector that drives the user to
 * the cuenta-corriente of the socio they pick. Backend does not
 * expose a "list of cuentas" endpoint (only per-socio
 * `/api/v1/socios/:id/cuenta-corriente`), so the page reuses
 * `getSocios({ search })` to look up the matching master-record
 * row and let the operator pick one.
 *
 * Contract:
 *   - Page heading "Cuentas corrientes" + descriptive copy
 *   - Search input (by DNI or nombre) + "Buscar" submit button
 *   - Submitting the form calls `getSocios({ search })` and
 *     renders the matching socios as clickable rows
 *   - Clicking a row navigates to `/ctacte/<socio_id>`
 *   - Empty state when no matches
 *   - "Próximamente" placeholder for the deferred "create cuenta"
 *     action (no backend write endpoints in PR 8b.2)
 *   - Pre-populated `?cuenta=<id>` URL param redirects immediately
 *     to `/ctacte/<id>` (deep-link from approvals / scheduler etc.)
 */

const pushMock = vi.fn()
const replaceMock = vi.fn()
const useSearchParamsMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, back: vi.fn() }),
  usePathname: () => '/ctacte',
  useSearchParams: () => useSearchParamsMock(),
}))

const getSociosMock = vi.fn()
vi.mock('@/lib/api/socios', () => ({
  getSocios: (...args: unknown[]) => getSociosMock(...args),
}))

const useAuthMock = vi.fn()
vi.mock('@/lib/use-auth', () => ({
  useAuth: () => useAuthMock(),
}))

const { default: CtacteListPage } = await import('./page')

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

const SAMPLE_SOCIO_1 = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  numero_socio: '00001',
  nombre: 'Juan',
  apellido: 'García',
  dni: '12345678',
  fecha_alta: '2020-03-15',
  estado: 'activo' as const,
  categoria: 'TITULAR',
  direccion: null,
  telefono: null,
  email: null,
  created_at: '2020-03-15T12:00:00.000Z',
  updated_at: '2026-01-15T08:00:00.000Z',
  deleted_at: null,
}

const SAMPLE_SOCIO_2 = {
  id: 'b2c3d4e5-f6a7-8901-bcde-f23456789012',
  numero_socio: '00002',
  nombre: 'Ana',
  apellido: 'Pérez',
  dni: '87654321',
  fecha_alta: '2021-06-01',
  estado: 'activo' as const,
  categoria: 'TITULAR',
  direccion: null,
  telefono: null,
  email: null,
  created_at: '2021-06-01T12:00:00.000Z',
  updated_at: '2026-01-15T08:00:00.000Z',
  deleted_at: null,
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <CtacteListPage />
    </QueryClientProvider>,
  )
}

describe('Ctacte list page (socio selector)', () => {
  beforeEach(() => {
    pushMock.mockReset()
    replaceMock.mockReset()
    useSearchParamsMock.mockReset()
    useSearchParamsMock.mockReturnValue(new URLSearchParams())
    useAuthMock.mockReset()
    useAuthMock.mockReturnValue(makeAdminUser())
    getSociosMock.mockReset()
    getSociosMock.mockResolvedValue({
      items: [],
      page: 1,
      limit: 20,
      total: 0,
      has_more: false,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the page heading + search input', () => {
    renderPage()
    expect(
      screen.getByRole('heading', { name: /cuentas corrientes/i, level: 1 }),
    ).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: /buscar/i })).toBeInTheDocument()
  })

  it('renders the Próximamente placeholder for write actions (no backend in 8b.2)', () => {
    renderPage()
    expect(screen.getByText(/próximamente/i)).toBeInTheDocument()
  })

  it('does NOT call getSocios on initial mount (search is user-driven)', () => {
    renderPage()
    expect(getSociosMock).not.toHaveBeenCalled()
  })

  it('calls getSocios({ search }) when the search form is submitted', async () => {
    getSociosMock.mockResolvedValueOnce({
      items: [SAMPLE_SOCIO_1],
      page: 1,
      limit: 20,
      total: 1,
      has_more: false,
    })
    const user = userEvent.setup()
    renderPage()
    const input = screen.getByRole('searchbox', { name: /buscar/i })
    await user.type(input, 'garcia')
    await user.click(screen.getByRole('button', { name: /buscar/i }))

    await waitFor(() => {
      expect(getSociosMock).toHaveBeenCalledWith({ search: 'garcia', page: 1, limit: 20 })
    })
  })

  it('renders one clickable row per matching socio', async () => {
    getSociosMock.mockResolvedValueOnce({
      items: [SAMPLE_SOCIO_1, SAMPLE_SOCIO_2],
      page: 1,
      limit: 20,
      total: 2,
      has_more: false,
    })
    const user = userEvent.setup()
    renderPage()
    const input = screen.getByRole('searchbox', { name: /buscar/i })
    await user.type(input, 'a')
    await user.click(screen.getByRole('button', { name: /buscar/i }))

    await waitFor(() => {
      expect(screen.getByText('García, Juan')).toBeInTheDocument()
    })
    expect(screen.getByText('Pérez, Ana')).toBeInTheDocument()
    // numero_socio is rendered as "N° 00001" — verify the prefix
    // is present and the DNI is visible too.
    expect(screen.getByText(/N°\s*00001/)).toBeInTheDocument()
    expect(screen.getByText('DNI 12345678')).toBeInTheDocument()
    expect(screen.getByText('DNI 87654321')).toBeInTheDocument()
  })

  it('navigates to /ctacte/<id> when a row is clicked', async () => {
    getSociosMock.mockResolvedValueOnce({
      items: [SAMPLE_SOCIO_1],
      page: 1,
      limit: 20,
      total: 1,
      has_more: false,
    })
    const user = userEvent.setup()
    renderPage()
    const input = screen.getByRole('searchbox', { name: /buscar/i })
    await user.type(input, 'garcia')
    await user.click(screen.getByRole('button', { name: /buscar/i }))

    await waitFor(() => {
      expect(screen.getByText('García, Juan')).toBeInTheDocument()
    })
    screen.getByRole('button', { name: /garcía.*juan/i }).click()
    expect(pushMock).toHaveBeenCalledWith('/ctacte/' + SAMPLE_SOCIO_1.id)
  })

  it('shows the empty state when the search returns no matches', async () => {
    getSociosMock.mockResolvedValueOnce({
      items: [],
      page: 1,
      limit: 20,
      total: 0,
      has_more: false,
    })
    const user = userEvent.setup()
    renderPage()
    const input = screen.getByRole('searchbox', { name: /buscar/i })
    await user.type(input, 'zzz')
    await user.click(screen.getByRole('button', { name: /buscar/i }))

    await waitFor(() => {
      expect(screen.getByText(/sin resultados/i)).toBeInTheDocument()
    })
  })

  it('shows a loading skeleton while the search query is pending', async () => {
    getSociosMock.mockReturnValue(new Promise(() => {})) // never resolves
    const user = userEvent.setup()
    renderPage()
    const input = screen.getByRole('searchbox', { name: /buscar/i })
    await user.type(input, 'garcia')
    await user.click(screen.getByRole('button', { name: /buscar/i }))

    expect(await screen.findByText(/cargando/i)).toBeInTheDocument()
  })

  it('redirects to /ctacte/<id> when the URL has ?cuenta=<id> on mount (deep-link)', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('cuenta=' + SAMPLE_SOCIO_1.id))
    renderPage()
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/ctacte/' + SAMPLE_SOCIO_1.id)
    })
  })
})
