import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Admin gastos list page tests (TASK-011, PR n16b-web).
 *
 * `/admin/gastos` shows the expense ledger (2,114 rows in v0.5.19).
 * Per the spec:
 *   - ADMIN-only (Sin permisos for non-ADMIN; no query fired)
 *   - Renders the page heading
 *   - Calls getGastos on mount
 *   - Each row has cuenta_principal, fecha, concepto, importe, link_count,
 *     anulado badge; per-row click → /admin/gastos/<id>
 *   - Renders loading skeleton while pending
 *   - Renders error state on failure
 */

const pushMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin/gastos',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}))

const getGastosMock = vi.fn()
vi.mock('@/lib/api/gastos', () => ({
  getGastos: (...args: unknown[]) => getGastosMock(...args),
}))

const useAuthMock = vi.fn()
vi.mock('@/lib/use-auth', () => ({
  useAuth: () => useAuthMock(),
}))

const { default: GastosListPage } = await import('./page')

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

const SAMPLE = {
  items: [
    {
      id: 'g-1',
      tipo: 1,
      tipoCuenta: 0,
      cuentaPrincipal: '6003009',
      cuentaAuxiliar: null,
      secuencia: 0,
      comprobante: '',
      fecha: '2024-03-15',
      concepto: 'Sueldos marzo',
      importe: '5000.00',
      iva: '0.00',
      ingresoBruto: null,
      socioId: null,
      legacyId: null,
      anulado: false,
      anuladoAt: null,
      anuladoMotivo: null,
      createdAt: '2024-03-15T12:00:00.000Z',
      linkCount: 2,
    },
  ],
  total: 1,
  page: 1,
  limit: 50,
  has_more: false,
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <GastosListPage />
    </QueryClientProvider>,
  )
}

describe('Admin gastos list page', () => {
  beforeEach(() => {
    pushMock.mockReset()
    useAuthMock.mockReset()
    useAuthMock.mockReturnValue(makeAdminUser())
    getGastosMock.mockReset()
    getGastosMock.mockResolvedValue(SAMPLE)
  })

  it('renders the heading for ADMIN', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: /gastos/i, level: 1 })).toBeInTheDocument()
  })

  it('calls getGastos with page=1 and limit=50 on mount', async () => {
    renderPage()
    await waitFor(() => {
      expect(getGastosMock).toHaveBeenCalled()
    })
    const lastCall = getGastosMock.mock.calls[0]?.[0] as Record<string, unknown>
    expect(lastCall['page']).toBe(1)
    expect(lastCall['limit']).toBe(50)
  })

  it('renders one row per gasto with cuenta_principal, fecha, importe', async () => {
    renderPage()
    await screen.findByRole('heading', { name: /gastos/i, level: 1 })
    expect(await screen.findByText('6003009')).toBeInTheDocument()
    expect(screen.getByText('Sueldos marzo')).toBeInTheDocument()
    expect(screen.getByText('5000.00')).toBeInTheDocument()
    expect(screen.getByText('2024-03-15')).toBeInTheDocument()
  })

  it('renders the link_count badge per row', async () => {
    renderPage()
    expect(await screen.findByText('2')).toBeInTheDocument()
  })

  it('renders the "Sin permisos" copy for a non-ADMIN operator and does NOT call getGastos', () => {
    useAuthMock.mockReturnValue(makeOperadorUser())
    renderPage()
    expect(screen.getByText(/sin permisos/i)).toBeInTheDocument()
    expect(getGastosMock).not.toHaveBeenCalled()
  })

  it('renders the loading skeleton while the query is pending', () => {
    getGastosMock.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByText(/cargando/i)).toBeInTheDocument()
  })

  it('renders an error state when the fetch fails', async () => {
    getGastosMock.mockRejectedValueOnce(new Error('network down'))
    renderPage()
    expect(await screen.findByText(/no se pudo cargar/i)).toBeInTheDocument()
  })

  it('navigates to /admin/gastos/<id> when a row is clicked', async () => {
    const user = userEvent.setup()
    renderPage()
    const row = await screen.findByText('Sueldos marzo')
    await user.click(row)
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/admin/gastos/g-1')
    })
  })

  it('renders the anulado badge for an anulado gasto', async () => {
    getGastosMock.mockResolvedValueOnce({
      ...SAMPLE,
      items: [{ ...SAMPLE.items[0]!, anulado: true, anuladoMotivo: 'Reverso' }],
    })
    renderPage()
    expect(await screen.findByTestId('gastos-anulado-g-1')).toBeInTheDocument()
  })
})
