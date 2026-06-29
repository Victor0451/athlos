import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Padrones list page tests (TASK-028, PR 8b.3).
 *
 * `/padrones` is a filter-driven padron browser:
 *   - Disciplina selector (dropdown) + ejercicio input (year)
 *   - "Ver Padrón" submit button triggers the query
 *   - URL state (?disciplina=&ejercicio=&page=) via nuqs so the
 *     page is deep-linkable and survives reloads
 *   - Results rendered as `<PadronRow>` stacked-list cards
 *   - CSV export of the current results
 *   - Pagination (Anterior / Siguiente)
 *   - Loading skeleton while the query is in flight
 *   - Empty state when no rows match the filter
 *   - "Próximamente" placeholder for the deferred write actions
 *
 * The page is **read-only** per the orchestrator brief — no
 * create / update / delete UI surfaces here.
 *
 * The `nuqs` mock is shaped so the page re-renders when
 * `setUrlState` is called: `useQueryStates` is wrapped around
 * React's `useState`, which lets the page's submit handler
 * trigger a fresh render → fresh `enabled` check → fresh
 * `getPadrones` call. The shared `currentUrlState` snapshot
 * still lets tests pre-populate the initial state for the
 * deep-link scenario.
 */

const pushMock = vi.fn()
const replaceMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, back: vi.fn() }),
  usePathname: () => '/padrones',
  useSearchParams: () => new URLSearchParams(),
}))

type UrlState = { disciplina: string; ejercicio: string; page: number }
const urlStateDefaults: UrlState = { disciplina: '', ejercicio: '', page: 1 }
let currentUrlState: UrlState = { ...urlStateDefaults }
const setUrlStateMock = vi.fn()

vi.mock('nuqs', () => ({
  parseAsString: { withDefault: (d: string) => ({ defaultValue: d }) },
  parseAsInteger: { withDefault: (d: number) => ({ defaultValue: d }) },
  // useQueryStates is wrapped around React.useState so setUrlState
  // triggers a real re-render (needed for the gated query to flip
  // from disabled → enabled after submit). The initial state is
  // read from the shared `currentUrlState` snapshot so a test can
  // pre-populate it for the deep-link scenario.
  useQueryStates: () => {
    const [state, setState] = useState(currentUrlState)
    return [state, setState] as const
  },
}))

const getPadronesMock = vi.fn()

vi.mock('@/lib/api/padrones', () => ({
  getPadrones: (...args: unknown[]) => getPadronesMock(...args),
}))

const downloadCSVMock = vi.fn()
vi.mock('@/lib/csv-export', () => ({
  downloadCSV: (...args: unknown[]) => downloadCSVMock(...args),
  toCSV: (rows: unknown[], cols: Array<{ key: string; label: string }>) => {
    const header = cols.map((c) => c.label).join(',')
    const body = rows
      .map((r) => cols.map((c) => String((r as Record<string, unknown>)[c.key] ?? '')).join(','))
      .join('\n')
    return header + '\n' + body
  },
}))

const useAuthMock = vi.fn()
vi.mock('@/lib/use-auth', () => ({
  useAuth: () => useAuthMock(),
}))

const { default: PadronesListPage } = await import('./page')

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

const SAMPLE_ROW_1 = {
  inscripcionId: 'i-1',
  socioId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  numeroSocio: '00001',
  nombre: 'Juan',
  apellido: 'García',
  dni: '12345678',
  estado: 'activa' as const,
  fechaAlta: '2026-03-01',
  disciplinaCodigo: 'NATACION',
  disciplinaNombre: 'Natación',
  ejercicioAnio: 2026,
}

const SAMPLE_ROW_2 = {
  ...SAMPLE_ROW_1,
  inscripcionId: 'i-2',
  socioId: 'b2c3d4e5-f6a7-8901-bcde-f23456789012',
  numeroSocio: '00002',
  nombre: 'Ana',
  apellido: 'Pérez',
  dni: '87654321',
}

const SAMPLE_RESPONSE = {
  disciplina: 'NATACION',
  ejercicio: 2026,
  items: [SAMPLE_ROW_1, SAMPLE_ROW_2],
  page: 1,
  limit: 20,
  total: 2,
  has_more: false,
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <PadronesListPage />
    </QueryClientProvider>,
  )
}

describe('Padrones list page', () => {
  beforeEach(() => {
    pushMock.mockReset()
    replaceMock.mockReset()
    currentUrlState = { ...urlStateDefaults }
    setUrlStateMock.mockReset()
    useAuthMock.mockReset()
    useAuthMock.mockReturnValue(makeAdminUser())
    getPadronesMock.mockReset()
    getPadronesMock.mockResolvedValue(SAMPLE_RESPONSE)
    downloadCSVMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the page heading + disciplina selector + ejercicio input + submit button', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /padrones/i, level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /disciplina/i })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: /ejercicio/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ver padrón/i })).toBeInTheDocument()
  })

  it('renders the Próximamente placeholder for deferred write actions', () => {
    renderPage()
    expect(screen.getByText(/próximamente/i)).toBeInTheDocument()
  })

  it('does NOT call getPadrones on initial mount (search is user-driven)', () => {
    renderPage()
    expect(getPadronesMock).not.toHaveBeenCalled()
  })

  it('shows a prompt to select filters before any submission', () => {
    renderPage()
    // The prompt copy lives in <p data-testid="padrones-empty-initial">;
    // the heading also contains the words "seleccioná / disciplina /
    // ejercicio" so we scope to the test-id to avoid double-matching.
    expect(screen.getByTestId('padrones-empty-initial')).toBeInTheDocument()
  })

  it('calls getPadrones({ disciplina, ejercicio, page: 1, limit: 20 }) when the form is submitted', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.selectOptions(screen.getByRole('combobox', { name: /disciplina/i }), 'NATACION')
    await user.clear(screen.getByRole('spinbutton', { name: /ejercicio/i }))
    await user.type(screen.getByRole('spinbutton', { name: /ejercicio/i }), '2026')
    await user.click(screen.getByRole('button', { name: /ver padrón/i }))

    await waitFor(() => {
      expect(getPadronesMock).toHaveBeenCalledWith({
        disciplina: 'NATACION',
        ejercicio: 2026,
        page: 1,
        limit: 20,
      })
    })
  })

  it('renders one <PadronRow> per matching member', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.selectOptions(screen.getByRole('combobox', { name: /disciplina/i }), 'NATACION')
    await user.clear(screen.getByRole('spinbutton', { name: /ejercicio/i }))
    await user.type(screen.getByRole('spinbutton', { name: /ejercicio/i }), '2026')
    await user.click(screen.getByRole('button', { name: /ver padrón/i }))

    expect(await screen.findByText('García, Juan')).toBeInTheDocument()
    expect(screen.getByText('Pérez, Ana')).toBeInTheDocument()
    expect(screen.getByText(/N°\s*00001/)).toBeInTheDocument()
    expect(screen.getByText('DNI 12345678')).toBeInTheDocument()
  })

  it('renders the CSV export button when there are results', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.selectOptions(screen.getByRole('combobox', { name: /disciplina/i }), 'NATACION')
    await user.clear(screen.getByRole('spinbutton', { name: /ejercicio/i }))
    await user.type(screen.getByRole('spinbutton', { name: /ejercicio/i }), '2026')
    await user.click(screen.getByRole('button', { name: /ver padrón/i }))

    expect(await screen.findByRole('button', { name: /exportar.*csv/i })).toBeInTheDocument()
  })

  it('clicking "Exportar CSV" calls downloadCSV with the current results', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.selectOptions(screen.getByRole('combobox', { name: /disciplina/i }), 'NATACION')
    await user.clear(screen.getByRole('spinbutton', { name: /ejercicio/i }))
    await user.type(screen.getByRole('spinbutton', { name: /ejercicio/i }), '2026')
    await user.click(screen.getByRole('button', { name: /ver padrón/i }))

    const exportBtn = await screen.findByRole('button', { name: /exportar.*csv/i })
    await user.click(exportBtn)

    expect(downloadCSVMock).toHaveBeenCalledTimes(1)
    const [filename, csv] = downloadCSVMock.mock.calls[0] as [string, string]
    expect(filename).toMatch(/padron-NATACION-2026.*\.csv/)
    expect(csv).toContain('Apellido')
    expect(csv).toContain('García')
    expect(csv).toContain('Pérez')
  })

  it('shows the empty state when the filter returns no rows', async () => {
    getPadronesMock.mockResolvedValueOnce({
      disciplina: 'NATACION',
      ejercicio: 2026,
      items: [],
      page: 1,
      limit: 20,
      total: 0,
      has_more: false,
    })
    const user = userEvent.setup()
    renderPage()
    await user.selectOptions(screen.getByRole('combobox', { name: /disciplina/i }), 'NATACION')
    await user.clear(screen.getByRole('spinbutton', { name: /ejercicio/i }))
    await user.type(screen.getByRole('spinbutton', { name: /ejercicio/i }), '2026')
    await user.click(screen.getByRole('button', { name: /ver padrón/i }))

    expect(await screen.findByText(/sin resultados/i)).toBeInTheDocument()
  })

  it('shows a loading skeleton while the query is pending', async () => {
    getPadronesMock.mockReturnValue(new Promise(() => {})) // never resolves
    const user = userEvent.setup()
    renderPage()
    await user.selectOptions(screen.getByRole('combobox', { name: /disciplina/i }), 'NATACION')
    await user.clear(screen.getByRole('spinbutton', { name: /ejercicio/i }))
    await user.type(screen.getByRole('spinbutton', { name: /ejercicio/i }), '2026')
    await user.click(screen.getByRole('button', { name: /ver padrón/i }))

    expect(await screen.findByText(/cargando/i)).toBeInTheDocument()
  })

  it('pre-populates the form from ?disciplina=&ejercicio= URL params (deep-link)', async () => {
    // Simulate a deep-link by mutating the shared `currentUrlState`
    // BEFORE render — useQueryStates's useState init picks it up.
    currentUrlState = {
      disciplina: 'FUTBOL',
      ejercicio: '2025',
      page: 1,
    }
    renderPage()
    const disciplina = screen.getByRole('combobox', {
      name: /disciplina/i,
    }) as HTMLSelectElement
    const ejercicio = screen.getByRole('spinbutton', {
      name: /ejercicio/i,
    }) as HTMLInputElement
    expect(disciplina.value).toBe('FUTBOL')
    expect(ejercicio.value).toBe('2025')

    await waitFor(() => {
      expect(getPadronesMock).toHaveBeenCalledWith({
        disciplina: 'FUTBOL',
        ejercicio: 2025,
        page: 1,
        limit: 20,
      })
    })
  })
})
