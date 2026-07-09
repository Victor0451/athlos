import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Admin gasto detail page tests (TASK-012, PR n16b-web).
 *
 * `/admin/gastos/[id]` shows a single gasto + its links + heuristic candidates:
 *   - ADMIN-only gate (Sin permisos for non-ADMIN; no fetches fire)
 *   - Renders gasto header (cuenta_principal, fecha, importe, concepto)
 *   - Renders the `links[]` table with monto_cubierto, motivo, anulado badge
 *   - Per-link Eliminar / Anular buttons
 *   - "Agregar enlace" button (admin-only; submitting calls createLink)
 *   - "Candidatos heurísticos" section with Confirmar / Descartar per row
 *   - Confirming a candidate calls createLink with motivo='manual'
 *   - Loading skeleton + error state on initial fetch failure
 */

const pushMock = vi.fn()
const useParamsMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin/gastos/g-1',
  useSearchParams: () => new URLSearchParams(),
  useParams: <T,>() => useParamsMock() as T,
}))

const getGastoByIdMock = vi.fn()
const getGastoLinksMock = vi.fn()
const createLinkMock = vi.fn()
const deleteLinkMock = vi.fn()
const anularLinkMock = vi.fn()
const getCandidatesMock = vi.fn()

vi.mock('@/lib/api/gastos', () => ({
  getGastoById: (...args: unknown[]) => getGastoByIdMock(...args),
}))

vi.mock('@/lib/api/gastos-ctacte', () => ({
  getGastoLinks: (...args: unknown[]) => getGastoLinksMock(...args),
  createLink: (...args: unknown[]) => createLinkMock(...args),
  deleteLink: (...args: unknown[]) => deleteLinkMock(...args),
  anularLink: (...args: unknown[]) => anularLinkMock(...args),
  getCandidates: (...args: unknown[]) => getCandidatesMock(...args),
}))

const useAuthMock = vi.fn()
vi.mock('@/lib/use-auth', () => ({
  useAuth: () => useAuthMock(),
}))

const { default: GastoDetailPage } = await import('./page')

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

const SAMPLE_GASTO = {
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
  links: [],
}

const SAMPLE_LINK = {
  id: 'link-1',
  gastoId: 'g-1',
  ctacteId: 'c-1',
  montoCubierto: '2500.00',
  motivo: 'manual' as const,
  anulado: false,
  anuladoAt: null,
  anuladoMotivo: null,
  createdBy: 'op-admin',
  createdAt: '2024-03-15T12:00:00.000Z',
}

const SAMPLE_CANDIDATE = {
  ctacteId: 'c-2',
  socioId: 's-1',
  ctacteFecha: '2024-03-16',
  ctacteConcepto: 'Pago sueldos',
  debe: '5000.00',
  haber: '0.00',
  daysDiff: 1,
  amountDiff: 0,
  score: 80,
  motivo: 'heuristic-pending' as const,
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <GastoDetailPage />
    </QueryClientProvider>,
  )
}

describe('Admin gasto detail page', () => {
  beforeEach(() => {
    pushMock.mockReset()
    useParamsMock.mockReset()
    useParamsMock.mockReturnValue({ id: 'g-1' })
    useAuthMock.mockReset()
    useAuthMock.mockReturnValue(makeAdminUser())

    getGastoByIdMock.mockReset()
    getGastoLinksMock.mockReset()
    createLinkMock.mockReset()
    deleteLinkMock.mockReset()
    anularLinkMock.mockReset()
    getCandidatesMock.mockReset()

    getGastoByIdMock.mockResolvedValue(SAMPLE_GASTO)
    getGastoLinksMock.mockResolvedValue({ items: [] })
    getCandidatesMock.mockResolvedValue({ items: [] })
    createLinkMock.mockResolvedValue(SAMPLE_LINK)
    deleteLinkMock.mockResolvedValue({ ok: true })
    anularLinkMock.mockResolvedValue({ ...SAMPLE_LINK, anulado: true })
  })

  it('renders the gasto header (cuenta_principal, fecha, importe, concepto)', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('6003009')).toBeInTheDocument()
    })
    expect(screen.getByText('Sueldos marzo')).toBeInTheDocument()
    expect(screen.getByText('5000.00')).toBeInTheDocument()
    expect(screen.getByText('2024-03-15')).toBeInTheDocument()
  })

  it('renders the Sin permisos copy for non-ADMIN and does NOT call getGastoById', () => {
    useAuthMock.mockReturnValue(makeOperadorUser())
    renderPage()
    expect(screen.getByText(/sin permisos/i)).toBeInTheDocument()
    expect(getGastoByIdMock).not.toHaveBeenCalled()
    expect(getGastoLinksMock).not.toHaveBeenCalled()
  })

  it('renders the loading skeleton while the detail query is pending', () => {
    getGastoByIdMock.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByText(/cargando/i)).toBeInTheDocument()
  })

  it('renders an error state when getGastoById fails', async () => {
    getGastoByIdMock.mockRejectedValueOnce(new Error('not found'))
    renderPage()
    expect(await screen.findByText(/no se pudo cargar/i)).toBeInTheDocument()
  })

  it('renders the links table when links are returned by the API', async () => {
    getGastoLinksMock.mockResolvedValueOnce({ items: [SAMPLE_LINK] })
    renderPage()
    await screen.findByText('6003009')
    expect(await screen.findByText('c-1')).toBeInTheDocument()
    expect(screen.getByText('2500.00')).toBeInTheDocument()
  })

  it('renders the heuristic candidates section with Confirmar/Descartar buttons', async () => {
    getCandidatesMock.mockResolvedValueOnce({ items: [SAMPLE_CANDIDATE] })
    renderPage()
    await screen.findByText('6003009')
    expect(await screen.findByTestId('candidates-list')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirmar/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /descartar/i })).toBeInTheDocument()
  })

  it('calls createLink with the candidate ctacte_id when Confirmar is clicked', async () => {
    const user = userEvent.setup()
    getCandidatesMock.mockResolvedValueOnce({ items: [SAMPLE_CANDIDATE] })
    renderPage()
    const confirmar = await screen.findByRole('button', { name: /confirmar/i })
    await user.click(confirmar)
    await waitFor(() => {
      expect(createLinkMock).toHaveBeenCalledWith(
        'g-1',
        expect.objectContaining({
          ctacteId: 'c-2',
          motivo: 'manual',
        }),
      )
    })
  })

  it('calls deleteLink when Eliminar is clicked on an active link', async () => {
    const user = userEvent.setup()
    getGastoLinksMock.mockResolvedValueOnce({ items: [SAMPLE_LINK] })
    renderPage()
    await screen.findByText('c-1')
    const eliminar = screen.getByRole('button', { name: /eliminar/i })
    await user.click(eliminar)
    await waitFor(() => {
      expect(deleteLinkMock).toHaveBeenCalledWith('link-1')
    })
  })

  it('calls anularLink when Anular is clicked on an active link', async () => {
    const user = userEvent.setup()
    getGastoLinksMock.mockResolvedValueOnce({ items: [SAMPLE_LINK] })
    renderPage()
    await screen.findByText('c-1')
    const anular = screen.getByRole('button', { name: /anular/i })
    await user.click(anular)
    await waitFor(() => {
      expect(anularLinkMock).toHaveBeenCalledWith('link-1', expect.any(String))
    })
  })
})
