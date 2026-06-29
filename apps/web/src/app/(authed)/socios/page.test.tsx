import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Socios list page tests (TASK-020 + TASK-022, PR 8b.1).
 * Covers: heading + search + filter, DataTable rows, empty/loading
 * states, row click → detail navigation, pagination, nuqs URL state
 * (search submission + pre-population from ?search=).
 */

const pushMock = vi.fn()
const replaceMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, back: vi.fn() }),
  usePathname: () => '/socios',
  useSearchParams: () => new URLSearchParams(),
}))

// nuqs mock — test controls URL state explicitly via the variables below.
type UrlState = { search: string; estado: string; page: number }
const urlStateDefaults: UrlState = { search: '', estado: '', page: 1 }
let currentUrlState: UrlState = { ...urlStateDefaults }
const setUrlStateMock = vi.fn()

vi.mock('nuqs', () => ({
  parseAsString: { withDefault: (d: string) => ({ defaultValue: d }) },
  parseAsInteger: { withDefault: (d: number) => ({ defaultValue: d }) },
  useQueryStates: () => [currentUrlState, setUrlStateMock],
}))

const useAuthMock = vi.fn()
vi.mock('@/lib/use-auth', () => ({
  useAuth: () => useAuthMock(),
}))

const getSociosMock = vi.fn()
vi.mock('@/lib/api/socios', () => ({
  getSocios: (...args: unknown[]) => getSociosMock(...args),
}))

const { default: SociosListPage } = await import('./page')

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
  direccion: null,
  telefono: null,
  email: null,
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
      <SociosListPage />
    </QueryClientProvider>,
  )
}

describe('Socios list page', () => {
  beforeEach(() => {
    pushMock.mockReset()
    replaceMock.mockReset()
    useAuthMock.mockReset()
    useAuthMock.mockReturnValue(makeAdminUser())
    getSociosMock.mockReset()
    currentUrlState = { ...urlStateDefaults }
    setUrlStateMock.mockReset()

    getSociosMock.mockResolvedValue({
      items: [SAMPLE_SOCIO],
      page: 1,
      limit: 20,
      total: 1,
      has_more: false,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the page heading and the search input', async () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Socios', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: /buscar/i })).toBeInTheDocument()
  })

  it('renders the estado filter dropdown with "Todos" as the default', () => {
    renderPage()
    const select = screen.getByRole('combobox', { name: /estado/i }) as HTMLSelectElement
    expect(select).toBeInTheDocument()
    expect(select.value).toBe('')
    expect(within(select).getByRole('option', { name: 'Todos' })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: 'Activo' })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: 'Baja' })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: 'Suspendido' })).toBeInTheDocument()
  })

  it('calls getSocios on mount with the current URL state', async () => {
    currentUrlState = { search: 'garcia', estado: 'activo', page: 1 }
    renderPage()
    await waitFor(() => {
      expect(getSociosMock).toHaveBeenCalledWith({
        search: 'garcia',
        estado: 'activo',
        page: 1,
      })
    })
  })

  it('renders one row per socio from the API response', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('García, Juan')).toBeInTheDocument()
    })
    expect(screen.getByText('00001')).toBeInTheDocument()
    expect(screen.getByText('12345678')).toBeInTheDocument()
  })

  it('shows the empty state when the API returns no socios', async () => {
    getSociosMock.mockResolvedValueOnce({
      items: [],
      page: 1,
      limit: 20,
      total: 0,
      has_more: false,
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/sin resultados/i)).toBeInTheDocument()
    })
  })

  it('shows the loading skeleton while the query is pending', () => {
    getSociosMock.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByText(/cargando/i)).toBeInTheDocument()
  })

  it('navigates to /socios/<id> when a row is clicked', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('García, Juan')).toBeInTheDocument()
    })
    // DataTable renders the row as role="button" when onRowClick is set.
    screen.getByRole('button', { name: /00001/ }).click()
    expect(pushMock).toHaveBeenCalledWith('/socios/' + SAMPLE_SOCIO.id)
  })

  it('renders pagination controls when there are multiple pages', async () => {
    getSociosMock.mockResolvedValueOnce({
      items: [SAMPLE_SOCIO],
      page: 1,
      limit: 20,
      total: 60,
      has_more: true,
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /anterior/i })).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /siguiente/i })).toBeInTheDocument()
    expect(screen.getByText(/página 1 de 3/i)).toBeInTheDocument()
  })

  it('updates the URL state when the search form is submitted', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => {
      expect(getSociosMock).toHaveBeenCalled()
    })
    const input = screen.getByRole('searchbox', { name: /buscar/i })
    await user.type(input, 'garcia')
    await user.click(screen.getByRole('button', { name: /buscar/i }))
    const lastCall = setUrlStateMock.mock.calls.at(-1)?.[0] as Partial<UrlState>
    expect(lastCall.search).toBe('garcia')
    expect(lastCall.page).toBe(1) // new search resets page
  })

  it('pre-populates the search input from ?search= (URL deep-link)', () => {
    currentUrlState = { search: 'garcia', estado: 'activo', page: 2 }
    renderPage()
    const input = screen.getByRole('searchbox', { name: /buscar/i }) as HTMLInputElement
    expect(input.value).toBe('garcia')
    const select = screen.getByRole('combobox', { name: /estado/i }) as HTMLSelectElement
    expect(select.value).toBe('activo')
  })
})
