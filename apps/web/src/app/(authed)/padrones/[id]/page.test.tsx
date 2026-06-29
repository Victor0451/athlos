import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Padrones detail page tests (TASK-029, PR 8b.3).
 *
 * `/padrones/[id]` is the deep-link view of a single padron.
 * The `[id]` segment is a slug of the form `<DISCIPLINA>-<EJERCICIO>`
 * (e.g. `NATACION-2026`) — the page splits on the last `-` to
 * recover the filter pair, then queries the SAME endpoint as the
 * list page (`GET /api/v1/padrones?disciplina=...&ejercicio=...`).
 *
 * Why no dedicated detail endpoint? The backend exposes only the
 * list endpoint (per `apps/api/src/routes/padrones.ts`). The
 * "detail" view is the same roster, just driven by URL params
 * instead of a filter form. The orchestrator brief flagged this
 * explicitly: "may only have list endpoint, no detail".
 *
 * Contract:
 *   - Renders a header with the disciplina + ejercicio labels
 *   - Calls `getPadrones({ disciplina, ejercicio, page: 1, limit: 20 })`
 *     with the values decoded from the slug
 *   - Renders the member roster as `<PadronRow>` cards
 *   - "Volver al Padrón" link points back to /padrones with the
 *     filters pre-populated so the operator can adjust them
 *   - CSV export of the current page's rows
 *   - Loading skeleton while the query is in flight
 *   - "Padrón no encontrado" error state when the backend 404s
 *   - "Próximamente" placeholder for the deferred write actions
 */

const pushMock = vi.fn()
const replaceMock = vi.fn()
const useParamsMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, back: vi.fn() }),
  usePathname: () => '/padrones/NATACION-2026',
  useSearchParams: () => new URLSearchParams(),
  useParams: <T,>() => useParamsMock() as T,
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

const { default: PadronDetailPage } = await import('./page')

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
      <PadronDetailPage />
    </QueryClientProvider>,
  )
}

describe('Padron detail page', () => {
  beforeEach(() => {
    pushMock.mockReset()
    replaceMock.mockReset()
    useParamsMock.mockReset()
    useParamsMock.mockReturnValue({ id: 'NATACION-2026' })
    useAuthMock.mockReset()
    useAuthMock.mockReturnValue(makeAdminUser())
    getPadronesMock.mockReset()
    getPadronesMock.mockResolvedValue(SAMPLE_RESPONSE)
    downloadCSVMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the page heading with the decoded disciplina + ejercicio', async () => {
    renderPage()
    // Wait for the query to resolve so the page is past the
    // loading skeleton.
    const heading = await screen.findByRole('heading', { level: 1 })
    // The backend response shape only exposes the disciplina
    // codigo (no display name at the response top level), so the
    // heading renders the codigo verbatim.
    expect(heading).toHaveTextContent(/NATACION/)
    expect(heading).toHaveTextContent(/2026/)
  })

  it('renders a "Volver al Padrón" link back to the list page', async () => {
    renderPage()
    const link = await screen.findByRole('link', { name: /volver al padrón/i })
    expect(link).toHaveAttribute('href', '/padrones?disciplina=NATACION&ejercicio=2026')
  })

  it('calls getPadrones with the decoded disciplina + ejercicio from the slug', async () => {
    renderPage()
    await waitFor(() => {
      expect(getPadronesMock).toHaveBeenCalledWith({
        disciplina: 'NATACION',
        ejercicio: 2026,
        page: 1,
        limit: 20,
      })
    })
  })

  it('renders one <PadronRow> per member of the padron', async () => {
    renderPage()
    expect(await screen.findByText('García, Juan')).toBeInTheDocument()
    expect(screen.getByText('Pérez, Ana')).toBeInTheDocument()
    expect(screen.getByText(/N°\s*00001/)).toBeInTheDocument()
    expect(screen.getByText('DNI 12345678')).toBeInTheDocument()
  })

  it('renders the CSV export button when there are results', async () => {
    renderPage()
    expect(await screen.findByRole('button', { name: /exportar.*csv/i })).toBeInTheDocument()
  })

  it('clicking "Exportar CSV" calls downloadCSV with the current rows', async () => {
    const user = userEvent.setup()
    renderPage()
    const exportBtn = await screen.findByRole('button', { name: /exportar.*csv/i })
    await user.click(exportBtn)
    expect(downloadCSVMock).toHaveBeenCalledTimes(1)
    const [filename, csv] = downloadCSVMock.mock.calls[0] as [string, string]
    expect(filename).toBe('padron-NATACION-2026.csv')
    expect(csv).toContain('García')
    expect(csv).toContain('Pérez')
  })

  it('renders the Próximamente placeholder for deferred write actions', async () => {
    renderPage()
    // The placeholder renders below the roster — wait for the query
    // to resolve so the page is past the loading skeleton.
    expect(await screen.findByText(/próximamente/i)).toBeInTheDocument()
  })

  it('shows a loading skeleton while the query is pending', () => {
    getPadronesMock.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByText(/cargando/i)).toBeInTheDocument()
  })

  it('shows a "Padrón no encontrado" error state when the backend rejects', async () => {
    const notFound = Object.assign(new Error('NOT_FOUND: Disciplina not found'), {
      status: 404,
      code: 'NOT_FOUND',
      name: 'ApiError',
    })
    getPadronesMock.mockRejectedValueOnce(notFound)
    renderPage()
    expect(await screen.findByText(/padrón no encontrado/i)).toBeInTheDocument()
  })

  it('decodes slugs with multi-segment disciplina names (e.g. FUTBOL-7-2026)', async () => {
    useParamsMock.mockReturnValue({ id: 'FUTBOL-7-2026' })
    renderPage()
    await waitFor(() => {
      expect(getPadronesMock).toHaveBeenCalledWith({
        disciplina: 'FUTBOL-7',
        ejercicio: 2026,
        page: 1,
        limit: 20,
      })
    })
    const link = await screen.findByRole('link', { name: /volver al padrón/i })
    expect(link).toHaveAttribute('href', '/padrones?disciplina=FUTBOL-7&ejercicio=2026')
  })
})
