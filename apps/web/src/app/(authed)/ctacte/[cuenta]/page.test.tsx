import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Ctacte detail page tests (TASK-025, PR 8b.2).
 *
 * `/ctacte/[cuenta]` shows a socio's cuenta-corriente ledger:
 *   - Header: socio name + "Volver al selector" link
 *   - Summary strip: Total Debe | Total Haber | Saldo (es-AR)
 *   - `MovementList` component with the first page of movimientos
 *   - Pagination footer (Anterior / Siguiente) when more pages exist
 *   - Loading skeleton while the ctacte query is pending
 *   - "Cuenta no encontrada" error state on 404
 *   - "Próximamente" placeholder for the deferred write actions
 *
 * The page reads the dynamic segment via `useParams()` from
 * `next/navigation` (same pattern as the socio detail page in
 * PR 8b.1 — works in jsdom without a Suspense wrapper).
 */

const pushMock = vi.fn()
const replaceMock = vi.fn()
const useParamsMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, back: vi.fn() }),
  usePathname: () => '/ctacte/abc',
  useSearchParams: () => new URLSearchParams(),
  useParams: <T,>() => useParamsMock() as T,
}))

const getCtacteMock = vi.fn()
const getMovimientosMock = vi.fn()
const getSocioMock = vi.fn()
const getCtacteGastosLinksMock = vi.fn()
const getCtacteNotesMock = vi.fn()

vi.mock('@/lib/api/ctacte', () => ({
  getCtacte: (...args: unknown[]) => getCtacteMock(...args),
  getMovimientos: (...args: unknown[]) => getMovimientosMock(...args),
}))

vi.mock('@/lib/api/socios', () => ({
  getSocio: (...args: unknown[]) => getSocioMock(...args),
}))

vi.mock('@/lib/api/gastos-ctacte', () => ({
  getCtacteGastosLinks: (...args: unknown[]) => getCtacteGastosLinksMock(...args),
}))

vi.mock('@/lib/api/ctacte-mutations', () => ({
  getCtacteNotes: (...args: unknown[]) => getCtacteNotesMock(...args),
}))

// Mock the form + notes components
vi.mock('@/components/ctacte/CtactePaymentForm', () => ({
  CtactePaymentForm: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <button onClick={onClose} data-testid="ctacte-payment-form">
        PaymentForm
      </button>
    ) : null,
}))

vi.mock('@/components/ctacte/CtacteDebitForm', () => ({
  CtacteDebitForm: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <button onClick={onClose} data-testid="ctacte-debit-form">
        DebitForm
      </button>
    ) : null,
}))

vi.mock('@/components/ctacte/CtacteComprobanteButton', () => ({
  CtacteComprobanteButton: () => <button data-testid="ctacte-comprobante-btn">Comprobante</button>,
}))

vi.mock('@/components/ctacte/CtacteNotesSection', () => ({
  CtacteNotesSection: ({
    movementId,
    notes,
    isLoading,
    error,
  }: {
    movementId: string
    notes: unknown[]
    isLoading: boolean
    error: string | null
  }) => (
    <div data-testid="ctacte-notes-section">
      movementId:{movementId} notes:{notes.length} loading:{String(isLoading)} error:{error}
      <button type="button" data-testid="ctacte-note-new-trigger">
        Agregar nota
      </button>
    </div>
  ),
}))

const useAuthMock = vi.fn()
const useQueryClientMock = vi.fn()

vi.mock('@/lib/use-auth', () => ({
  useAuth: () => useAuthMock(),
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
vi.mock('@tanstack/react-query', async (actual: () => Promise<any>) => {
  const mod = await actual()
  return {
    ...mod,
    useQueryClient: () => useQueryClientMock(),
  }
})

const { default: CtacteDetailPage } = await import('./page')

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

const SAMPLE_CTACTE = {
  socioId: SAMPLE_SOCIO.id,
  saldo: '500.00',
  saldo_calculado_at: '2026-06-29T12:00:00.000Z',
  movimientos: [
    {
      id: 'mv-1',
      socio_id: SAMPLE_SOCIO.id,
      fecha: '2026-01-15',
      tipo: 'DEBITO' as const,
      concepto: 'Cuota enero',
      debe: '1500.00',
      haber: '0.00',
      anulado: false,
      anulado_at: null,
      anulado_motivo: null,
      monto: '1500.00',
      saldo_resultante: null,
      created_at: '2026-01-15T12:00:00.000Z',
    },
    {
      id: 'mv-2',
      socio_id: SAMPLE_SOCIO.id,
      fecha: '2026-01-20',
      tipo: 'CREDITO' as const,
      concepto: 'Pago',
      debe: '0.00',
      haber: '1000.00',
      anulado: false,
      anulado_at: null,
      anulado_motivo: null,
      monto: '-1000.00',
      saldo_resultante: null,
      created_at: '2026-01-20T10:00:00.000Z',
    },
  ],
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
      <CtacteDetailPage />
    </QueryClientProvider>,
  )
}

describe('Ctacte detail page', () => {
  beforeEach(() => {
    pushMock.mockReset()
    replaceMock.mockReset()
    useParamsMock.mockReset()
    useParamsMock.mockReturnValue({ cuenta: SAMPLE_SOCIO.id })
    useAuthMock.mockReset()
    useAuthMock.mockReturnValue(makeAdminUser())
    getCtacteMock.mockReset()
    getMovimientosMock.mockReset()
    getSocioMock.mockReset()
    getCtacteGastosLinksMock.mockReset()

    getCtacteMock.mockResolvedValue(SAMPLE_CTACTE)
    getSocioMock.mockResolvedValue(SAMPLE_SOCIO)
    getMovimientosMock.mockResolvedValue({
      items: SAMPLE_CTACTE.movimientos,
      page: 1,
      limit: 20,
      total: 2,
      has_more: false,
    })
    getCtacteGastosLinksMock.mockResolvedValue({ items: [] })
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() })
    getCtacteNotesMock.mockResolvedValue([])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the complete premium account header', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('ctacte-premium-header')).toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: /volver al selector/i })).toHaveAttribute(
      'href',
      '/ctacte',
    )
    expect(screen.getByTestId('ctacte-header-icon')).toBeInTheDocument()
    expect(screen.getByTestId('ctacte-header-member-number')).toHaveTextContent('00001')
    expect(screen.getByTestId('ctacte-header-dni')).toHaveTextContent('12345678')
    expect(screen.getByTestId('ctacte-header-status')).toHaveTextContent(/activo/i)
    expect(screen.getByTestId('ctacte-header-status')).toHaveAccessibleName('Estado: activo')
  })

  it('renders the socio name in the heading', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/garcía.*juan/i)
    })
  })

  it('calls getCtacte with the dynamic segment id', async () => {
    renderPage()
    await waitFor(() => {
      expect(getCtacteMock).toHaveBeenCalledWith(SAMPLE_SOCIO.id)
    })
  })

  it('renders the summary strip with Total Debe + Total Haber + Saldo', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('ctacte-summary')).toBeInTheDocument()
    })
    const summary = screen.getByTestId('ctacte-summary')
    expect(summary).toHaveTextContent(/total debe/i)
    expect(summary).toHaveTextContent(/total haber/i)
    expect(summary).toHaveTextContent(/saldo/i)
  })

  it('renders the MovementList with the movimientos from the API', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Cuota enero')).toBeInTheDocument()
    })
    expect(screen.getByText('Pago')).toBeInTheDocument()
  })

  it('does NOT render the "Próximamente" placeholder (TASK-013: replaced by Gastos vinculados panel)', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    })
    expect(screen.queryByText(/próximamente/i)).not.toBeInTheDocument()
  })

  it('renders the "Gastos vinculados" panel below the movements list (TASK-013)', async () => {
    getCtacteGastosLinksMock.mockResolvedValueOnce({
      items: [
        {
          linkId: 'link-1',
          gastoId: 'g-1',
          ctacteId: SAMPLE_SOCIO.id,
          montoCubierto: '1500.00',
          motivo: 'manual' as const,
          anulado: false,
          gastoFecha: '2026-01-15',
          gastoImporte: '1500.00',
          gastoConcepto: 'Sueldos únicos',
          gastoCuentaPrincipal: '6003009',
        },
      ],
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('gastos-vinculados')).toBeInTheDocument()
    })
    expect(screen.getByTestId('gastos-vinculado-row-link-1')).toBeInTheDocument()
  })

  it('shows a loading skeleton while the query is pending', () => {
    getCtacteMock.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByText(/cargando/i)).toBeInTheDocument()
  })

  it('renders a "Cuenta no encontrada" error state when the API rejects', async () => {
    getCtacteMock.mockRejectedValue(new Error('NOT_FOUND: socio no encontrado'))
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/cuenta no encontrada/i)).toBeInTheDocument()
    })
  })

  it('renders pagination controls when there are multiple pages', async () => {
    getCtacteMock.mockResolvedValueOnce({
      ...SAMPLE_CTACTE,
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

  it('shows PaymentForm when "Registrar pago" button is clicked', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('ctacte-action-payment')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('ctacte-payment-form')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('ctacte-action-payment'))
    await waitFor(() => {
      expect(screen.getByTestId('ctacte-payment-form')).toBeInTheDocument()
    })
  })

  it('shows DebitForm when "Registrar débito" button is clicked', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('ctacte-action-debit')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('ctacte-debit-form')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('ctacte-action-debit'))
    await waitFor(() => {
      expect(screen.getByTestId('ctacte-debit-form')).toBeInTheDocument()
    })
  })

  it('renders the Comprobante button in the header', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('ctacte-comprobante-btn')).toBeInTheDocument()
    })
  })

  it('shows the notes section when a movement nota button is clicked', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Cuota enero')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('ctacte-notes-section')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('movement-row-mv-1-nota'))
    await waitFor(() => {
      expect(screen.getByTestId('ctacte-notes-section')).toBeInTheDocument()
    })
  })

  it('passes the correct movementId to CtacteNotesSection', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Cuota enero')).toBeInTheDocument()
    })
    await user.click(screen.getByTestId('movement-row-mv-1-nota'))
    await waitFor(() => {
      expect(screen.getByTestId('ctacte-notes-section')).toHaveTextContent('movementId:mv-1')
    })
  })

  it('calls getMovimientos when the user navigates to page 2', async () => {
    getCtacteMock.mockResolvedValueOnce({
      ...SAMPLE_CTACTE,
      total: 60,
      has_more: true,
    })
    getMovimientosMock.mockResolvedValueOnce({
      items: [SAMPLE_CTACTE.movimientos[0]!],
      page: 2,
      limit: 20,
      total: 60,
      has_more: true,
    })
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /siguiente/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /siguiente/i }))

    await waitFor(() => {
      expect(getMovimientosMock).toHaveBeenCalledWith(SAMPLE_SOCIO.id, { page: 2, limit: 20 })
    })
  })

  it('exposes the CtacteNoteForm modal trigger inside the mounted notes section (R3)', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Cuota enero')).toBeInTheDocument()
    })
    await user.click(screen.getByTestId('movement-row-mv-1-nota'))
    await waitFor(() => {
      expect(screen.getByTestId('ctacte-notes-section')).toBeInTheDocument()
    })
    // R3: the production section exposes a modal trigger that opens
    // CtacteNoteForm so the row action has a real add-note path.
    expect(screen.getByTestId('ctacte-note-new-trigger')).toBeInTheDocument()
  })

  it('calls getMovimientos when the user navigates to page 2', async () => {
    getCtacteMock.mockResolvedValueOnce({
      ...SAMPLE_CTACTE,
      total: 60,
      has_more: true,
    })
    getMovimientosMock.mockResolvedValueOnce({
      items: [SAMPLE_CTACTE.movimientos[0]!],
      page: 2,
      limit: 20,
      total: 60,
      has_more: true,
    })
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /siguiente/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /siguiente/i }))

    await waitFor(() => {
      expect(getMovimientosMock).toHaveBeenCalledWith(SAMPLE_SOCIO.id, { page: 2, limit: 20 })
    })
  })
})
