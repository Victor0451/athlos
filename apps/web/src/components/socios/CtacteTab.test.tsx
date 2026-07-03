import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { CtacteTab } from './CtacteTab'
import type { CtacteResponse, Movimiento } from '@/lib/api/ctacte'

/**
 * CtacteTab tests (PR 8b.2 second slice).
 *
 * Contract:
 *   - Renders the formatted saldo (es-AR ARS currency)
 *   - Renders one row per movimiento with the right column values
 *   - Shows a loading skeleton while the query is pending
 *   - Shows an error panel (role="alert") when the API rejects
 *   - Shows an empty-state copy when movimientos.length === 0
 *
 * The `getCtacte` wrapper is mocked so the test stays focused on
 * the component's render contract; the wire shape is already covered
 * by `apps/web/src/lib/api/ctacte.test.ts`.
 */

const SAMPLE_SOCIO_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

function makeMovimiento(over: Partial<Movimiento> = {}): Movimiento {
  return {
    id: 'mv-1',
    socio_id: SAMPLE_SOCIO_ID,
    fecha: '2026-01-15',
    tipo: 'DEBITO',
    concepto: 'Cuota enero 2026',
    debe: '1500.00',
    haber: '0.00',
    anulado: false,
    anulado_at: null,
    anulado_motivo: null,
    monto: '1500.00',
    saldo_resultante: '1500.00',
    created_at: '2026-01-15T12:00:00.000Z',
    ...over,
  }
}

const getCtacteMock = vi.fn()
vi.mock('@/lib/api/ctacte', () => ({
  getCtacte: (...args: unknown[]) => getCtacteMock(...args),
}))

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <CtacteTab socioId={SAMPLE_SOCIO_ID} />
    </QueryClientProvider>,
  )
}

describe('CtacteTab', () => {
  beforeEach(() => {
    getCtacteMock.mockReset()
  })

  it('calls getCtacte with the socioId + default limit', async () => {
    getCtacteMock.mockResolvedValueOnce({
      socioId: SAMPLE_SOCIO_ID,
      saldo: '1500.00',
      saldo_calculado_at: '2026-06-29T12:00:00.000Z',
      movimientos: [makeMovimiento()],
      page: 1,
      limit: 20,
      total: 1,
      has_more: false,
    })
    renderTab()
    await waitFor(() => {
      expect(getCtacteMock).toHaveBeenCalledWith(SAMPLE_SOCIO_ID, { limit: 20 })
    })
  })

  it('renders the formatted saldo (es-AR ARS)', async () => {
    getCtacteMock.mockResolvedValueOnce({
      socioId: SAMPLE_SOCIO_ID,
      saldo: '1500.00',
      saldo_calculado_at: '2026-06-29T12:00:00.000Z',
      movimientos: [],
      page: 1,
      limit: 20,
      total: 0,
      has_more: false,
    })
    renderTab()
    await waitFor(() => {
      // es-AR ARS uses "$" prefix with thousands "." and decimal ","
      expect(screen.getByTestId('ctacte-tab-saldo')).toHaveTextContent(/\$|1\.500,00/i)
    })
  })

  it('renders one row per movimiento with the formatted date + debe/haber', async () => {
    const movimientos: Movimiento[] = [
      makeMovimiento({
        id: 'mv-1',
        fecha: '2026-01-15',
        tipo: 'DEBITO',
        concepto: 'Cuota enero 2026',
        debe: '1500.00',
        haber: '0.00',
      }),
      makeMovimiento({
        id: 'mv-2',
        fecha: '2026-02-01',
        tipo: 'CREDITO',
        concepto: 'Pago recibido',
        debe: '0.00',
        haber: '1500.00',
      }),
    ]
    getCtacteMock.mockResolvedValueOnce({
      socioId: SAMPLE_SOCIO_ID,
      saldo: '0.00',
      saldo_calculado_at: '2026-06-29T12:00:00.000Z',
      movimientos,
      page: 1,
      limit: 20,
      total: 2,
      has_more: false,
    } satisfies CtacteResponse)
    renderTab()

    await waitFor(() => {
      expect(screen.getByTestId('ctacte-tab-row-mv-1')).toBeInTheDocument()
    })
    // Fecha is rendered as DD/MM/YYYY
    expect(screen.getByTestId('ctacte-tab-row-mv-1')).toHaveTextContent('15/01/2026')
    expect(screen.getByTestId('ctacte-tab-row-mv-1')).toHaveTextContent('Cuota enero 2026')
    expect(screen.getByTestId('ctacte-tab-row-mv-2')).toHaveTextContent('01/02/2026')
    expect(screen.getByTestId('ctacte-tab-row-mv-2')).toHaveTextContent('Pago recibido')
  })

  it('shows an empty-state message when there are no movimientos', async () => {
    getCtacteMock.mockResolvedValueOnce({
      socioId: SAMPLE_SOCIO_ID,
      saldo: '0.00',
      saldo_calculado_at: '2026-06-29T12:00:00.000Z',
      movimientos: [],
      page: 1,
      limit: 20,
      total: 0,
      has_more: false,
    })
    renderTab()
    await waitFor(() => {
      expect(screen.getByTestId('ctacte-tab-empty')).toBeInTheDocument()
    })
    expect(screen.getByText(/sin movimientos para este socio/i)).toBeInTheDocument()
  })

  it('shows a loading skeleton while the query is pending', () => {
    getCtacteMock.mockReturnValue(new Promise(() => {}))
    renderTab()
    // The region renders the loading skeleton with aria-busy="true"
    expect(screen.getByTestId('ctacte-tab-loading')).toBeInTheDocument()
    expect(screen.getByText(/cargando/i)).toBeInTheDocument()
  })

  it('shows an error state (role="alert") when the API rejects', async () => {
    getCtacteMock.mockRejectedValueOnce(new Error('NOT_FOUND: socio no encontrado'))
    renderTab()
    await waitFor(() => {
      expect(screen.getByTestId('ctacte-tab-error')).toBeInTheDocument()
    })
    expect(screen.getByRole('alert')).toHaveTextContent(/no pudimos cargar la cuenta corriente/i)
  })

  it('renders the section with an aria-label for screen readers', async () => {
    getCtacteMock.mockResolvedValueOnce({
      socioId: SAMPLE_SOCIO_ID,
      saldo: '1500.00',
      saldo_calculado_at: '2026-06-29T12:00:00.000Z',
      movimientos: [],
      page: 1,
      limit: 20,
      total: 0,
      has_more: false,
    })
    renderTab()
    await waitFor(() => {
      expect(screen.getByRole('region', { name: /cuenta corriente/i })).toBeInTheDocument()
    })
  })
})
