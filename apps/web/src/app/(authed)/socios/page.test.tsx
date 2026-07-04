import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Socios list page tests (TASK-020 + TASK-022, PR 8b.1; second
 * slice: cards + monogram + sort, PR 8b.2 second slice).
 * Covers: heading + search + filter, summary cards, monogram,
 * DataTable rows, empty/loading states, row click → detail
 * navigation, pagination, sort toggle, the ADMIN-only "+ Nuevo"
 * link, and nuqs URL state (search submission + pre-population +
 * sort).
 */

const pushMock = vi.fn()
const replaceMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, back: vi.fn() }),
  usePathname: () => '/socios',
  useSearchParams: () => new URLSearchParams(),
}))

// nuqs mock — test controls URL state explicitly via the variables below.
type UrlState = {
  search: string
  estado: string
  categoria: string
  fechaDesde: string
  fechaHasta: string
  hasEmail: string
  page: number
  sortBy: string
  sortDir: string
}
const urlStateDefaults: UrlState = {
  search: '',
  estado: '',
  categoria: '',
  fechaDesde: '',
  fechaHasta: '',
  hasEmail: '',
  page: 1,
  sortBy: '',
  sortDir: '',
}
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
const getSociosAggregateMock = vi.fn()
vi.mock('@/lib/api/socios', () => ({
  getSocios: (...args: unknown[]) => getSociosMock(...args),
  getSociosAggregate: (...args: unknown[]) => getSociosAggregateMock(...args),
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

const SAMPLE_AGGREGATE = {
  activos: 12_345,
  suspendidos: 234,
  baja: 567,
  total: 13_146,
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
    getSociosAggregateMock.mockReset()
    currentUrlState = { ...urlStateDefaults }
    setUrlStateMock.mockReset()

    getSociosMock.mockResolvedValue({
      items: [SAMPLE_SOCIO],
      page: 1,
      limit: 20,
      total: 1,
      has_more: false,
    })
    getSociosAggregateMock.mockResolvedValue(SAMPLE_AGGREGATE)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the page heading and the search input', async () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Socios', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: /buscar/i })).toBeInTheDocument()
  })

  it('renders the estado filter as a tab strip with "Todos" as the default', () => {
    renderPage()
    const todosTab = screen.getByTestId('socios-estado-tab-all') as HTMLButtonElement
    expect(todosTab).toBeInTheDocument()
    expect(todosTab.textContent).toBe('Todos')
    expect(todosTab).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('socios-estado-tab-activo')).toHaveTextContent('Activos')
    expect(screen.getByTestId('socios-estado-tab-suspendido')).toHaveTextContent('Suspendidos')
    expect(screen.getByTestId('socios-estado-tab-baja')).toHaveTextContent('Dados de baja')
    expect(screen.queryByRole('combobox', { name: /estado/i })).not.toBeInTheDocument()
  })

  it('calls getSocios on mount with the current URL state', async () => {
    currentUrlState = { ...urlStateDefaults, search: 'garcia', estado: 'activo', page: 1 }
    renderPage()
    await waitFor(() => {
      expect(getSociosMock).toHaveBeenCalledWith({
        search: 'garcia',
        estado: 'activo',
        page: 1,
      })
    })
  })

  it('forwards sortBy + sortDir to getSocios when present in the URL', async () => {
    currentUrlState = {
      ...urlStateDefaults,
      sortBy: 'apellido',
      sortDir: 'desc',
    }
    renderPage()
    await waitFor(() => {
      expect(getSociosMock).toHaveBeenCalledWith({
        page: 1,
        sortBy: 'apellido',
        sortDir: 'desc',
      })
    })
  })

  it('renders one row per socio from the API response, with the monogram in the name cell', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('García, Juan')).toBeInTheDocument()
    })
    expect(screen.getByText('00001')).toBeInTheDocument()
    expect(screen.getByText('12345678')).toBeInTheDocument()
    // Monogram testid derives from the socio id
    expect(screen.getByTestId('monogram-' + SAMPLE_SOCIO.id)).toBeInTheDocument()
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
    // The DataTable loading container carries data-testid="socios-table-loading"
    expect(screen.getByTestId('socios-table-loading')).toBeInTheDocument()
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
    currentUrlState = {
      ...urlStateDefaults,
      search: 'garcia',
      estado: 'activo',
      page: 2,
    }
    renderPage()
    const input = screen.getByRole('searchbox', { name: /buscar/i }) as HTMLInputElement
    expect(input.value).toBe('garcia')
    expect(screen.getByTestId('socios-estado-tab-activo')).toHaveAttribute('aria-current', 'page')
  })

  /* ── Aggregate cards (PR 8b.2 second slice) ─────────────────────── */

  it('fires getSociosAggregate in parallel with getSocios', async () => {
    renderPage()
    await waitFor(() => {
      expect(getSociosMock).toHaveBeenCalled()
      expect(getSociosAggregateMock).toHaveBeenCalled()
    })
  })

  it('renders the four aggregate cards with the resolved counts', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('socios-aggregate-activo-value')).toHaveTextContent(/12\.345/i)
    })
    expect(screen.getByTestId('socios-aggregate-suspendido-value')).toHaveTextContent(/234/i)
    expect(screen.getByTestId('socios-aggregate-baja-value')).toHaveTextContent(/567/i)
    expect(screen.getByTestId('socios-aggregate-total-value')).toHaveTextContent(/13\.146/i)
  })

  it('renders a skeleton placeholder per card while the aggregate query is pending', () => {
    getSociosAggregateMock.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByTestId('socios-aggregate-activo')).toBeInTheDocument()
    // The numeric value is not yet rendered.
    expect(screen.queryByTestId('socios-aggregate-activo-value')).not.toBeInTheDocument()
  })

  /* ── ADMIN "+ Nuevo" link (PR 8b.2 second slice) ────────────────── */

  it('renders the "+ Nuevo" button for ADMIN users', () => {
    useAuthMock.mockReturnValue(makeAdminUser())
    renderPage()
    const link = screen.getByTestId('socios-new-button')
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/socios/new')
  })

  it('hides the "+ Nuevo" button for non-ADMIN users', () => {
    useAuthMock.mockReturnValue(makeOperadorUser())
    renderPage()
    expect(screen.queryByTestId('socios-new-button')).not.toBeInTheDocument()
  })

  /* ── Sort toggle (PR 8b.2 second slice) ─────────────────────────── */

  it('sets sortBy + sortDir=asc when a sortable header is clicked for the first time', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('socios-table-sort-numero_socio')).toBeInTheDocument()
    })
    screen.getByTestId('socios-table-sort-numero_socio').click()
    const lastCall = setUrlStateMock.mock.calls.at(-1)?.[0] as Partial<UrlState>
    expect(lastCall.sortBy).toBe('numero_socio')
    expect(lastCall.sortDir).toBe('asc')
  })

  it('flips to desc when the same sortable header is clicked a second time', async () => {
    currentUrlState = {
      ...urlStateDefaults,
      sortBy: 'numero_socio',
      sortDir: 'asc',
    }
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('socios-table-sort-numero_socio')).toBeInTheDocument()
    })
    screen.getByTestId('socios-table-sort-numero_socio').click()
    const lastCall = setUrlStateMock.mock.calls.at(-1)?.[0] as Partial<UrlState>
    expect(lastCall.sortBy).toBe('numero_socio')
    expect(lastCall.sortDir).toBe('desc')
  })

  it('resets to asc when a DIFFERENT sortable header is clicked', async () => {
    currentUrlState = {
      ...urlStateDefaults,
      sortBy: 'numero_socio',
      sortDir: 'desc',
    }
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('socios-table-sort-estado')).toBeInTheDocument()
    })
    screen.getByTestId('socios-table-sort-estado').click()
    const lastCall = setUrlStateMock.mock.calls.at(-1)?.[0] as Partial<UrlState>
    expect(lastCall.sortBy).toBe('estado')
    expect(lastCall.sortDir).toBe('asc')
  })

  it('reflects the active sort with aria-sort on the matching header', async () => {
    currentUrlState = {
      ...urlStateDefaults,
      sortBy: 'numero_socio',
      sortDir: 'desc',
    }
    renderPage()
    // Wait for the list query to resolve so the full table (with
    // <th data-testid=...> cells) is on screen, not the loading
    // skeleton where those test-ids are absent.
    await waitFor(() => {
      expect(screen.getByTestId('socios-table-th-numero_socio')).toBeInTheDocument()
    })
    expect(screen.getByTestId('socios-table-th-numero_socio')).toHaveAttribute(
      'aria-sort',
      'descending',
    )
    // An inactive sortable header carries aria-sort="none"
    expect(screen.getByTestId('socios-table-th-estado')).toHaveAttribute('aria-sort', 'none')
  })
})

/* ── Advanced filters (categoria / fechaDesde / fechaHasta / hasEmail) ─ */

it('renders the 4 advanced filter inputs after clicking "Más filtros"', () => {
  useAuthMock.mockReturnValue(makeAdminUser())
  renderPage()
  // The advanced filters are collapsed behind a toggle by default.
  // The advanced input fields are not in the DOM until the user
  // opens the panel — this matches the design system (95% white/black,
  // rojo only on intent moments — don't over-stuff the search form).
  expect(screen.queryByLabelText(/categoría/i)).not.toBeInTheDocument()
  fireEvent.click(screen.getByTestId('socios-advanced-toggle'))
  expect(screen.getByLabelText(/categoría/i)).toBeInTheDocument()
  expect(screen.getByLabelText(/fecha alta desde/i)).toBeInTheDocument()
  expect(screen.getByLabelText(/fecha alta hasta/i)).toBeInTheDocument()
  expect(screen.getByLabelText(/solo con email/i)).toBeInTheDocument()
})

it('fires getSocios with categoria, fechaDesde, fechaHasta, and hasEmail when set in URL state', async () => {
  useAuthMock.mockReturnValue(makeAdminUser())
  // When any advanced filter is in the URL, the page opens the
  // advanced panel automatically (per useState initial value).
  currentUrlState = {
    ...urlStateDefaults,
    categoria: 'TITULAR',
    fechaDesde: '2020-01-01',
    fechaHasta: '2026-12-31',
    hasEmail: 'true',
  }
  renderPage()
  await waitFor(() => {
    expect(getSociosMock).toHaveBeenCalledWith({
      categoria: 'TITULAR',
      fechaDesde: '2020-01-01',
      fechaHasta: '2026-12-31',
      hasEmail: 'true',
      page: 1,
    })
  })
})

it('omits empty filter values from the getSocios payload (clean URL contract)', async () => {
  useAuthMock.mockReturnValue(makeAdminUser())
  currentUrlState = { ...urlStateDefaults, categoria: '' }
  renderPage()
  await waitFor(() => {
    const call = getSociosMock.mock.calls[0]?.[0] as Record<string, unknown>
    expect(call).toBeDefined()
    // Empty-string filters should NOT be passed to the API.
    expect('categoria' in call!).toBe(false)
    expect('fechaDesde' in call!).toBe(false)
    expect('fechaHasta' in call!).toBe(false)
    expect('hasEmail' in call!).toBe(false)
  })
})
