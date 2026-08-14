import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * MovementList component tests (TASK-026, PR 8b.2).
 *
 * Covers the read-only movements ledger rendered by
 * `/ctacte/[cuenta]/page.tsx`. The contract:
 *   - Header strip: cuenta (socioId), formatted saldo in ARS
 *     currency, "Exportar CSV" button
 *   - Movements table: Fecha | Descripción | Debe (ARS) | Haber (ARS) | Saldo
 *   - Money values formatted via `Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })`
 *   - "Exportar CSV" button triggers `downloadCSV` with the visible
 *     rows + the canonical column set
 *   - Empty state: "Sin movimientos para los filtros seleccionados"
 *   - Loading state: 5 skeleton rows + SR-only "Cargando…"
 *
 * The Movimiento shape comes from `lib/api/ctacte.ts` (snake_case).
 * The component is purely presentational + wires the CSV export
 * button — no data fetching of its own (parent provides `data`).
 */

const downloadCSVMock = vi.fn()
const toCSVMock = vi.fn(() => 'mocked-csv')

vi.mock('@/lib/csv-export', () => ({
  downloadCSV: (...args: unknown[]) =>
    downloadCSVMock(...(args as Parameters<typeof downloadCSVMock>)),
  toCSV: (...args: unknown[]) => toCSVMock(...(args as Parameters<typeof toCSVMock>)),
}))

const { MovementList } = await import('./MovementList')
type SampleMovimiento = Parameters<typeof MovementList>[0]['movimientos'][number]

const SAMPLE_MOVIMIENTOS: SampleMovimiento[] = [
  {
    id: 'mv-1',
    socio_id: 'a1b2c3d4',
    fecha: '2026-01-15',
    tipo: 'DEBITO',
    concepto: 'Cuota enero 2026',
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
    socio_id: 'a1b2c3d4',
    fecha: '2026-01-20',
    tipo: 'CREDITO',
    concepto: 'Pago en mesa',
    debe: '0.00',
    haber: '1500.00',
    anulado: false,
    anulado_at: null,
    anulado_motivo: null,
    monto: '-1500.00',
    saldo_resultante: null,
    created_at: '2026-01-20T10:00:00.000Z',
  },
]

function renderList(props: Partial<Parameters<typeof MovementList>[0]> = {}) {
  return render(
    <MovementList
      socioId="a1b2c3d4"
      saldo="0.00"
      movimientos={SAMPLE_MOVIMIENTOS}
      loading={false}
      {...props}
    />,
  )
}

describe('MovementList', () => {
  beforeEach(() => {
    downloadCSVMock.mockReset()
    toCSVMock.mockReset()
    toCSVMock.mockReturnValue('mocked-csv')
  })

  it('renders the cuenta + saldo header strip', () => {
    renderList()
    // socioId visible (or at least the "Cuenta" label + the id)
    expect(screen.getByText(/cuenta/i)).toBeInTheDocument()
    expect(screen.getByText('a1b2c3d4')).toBeInTheDocument()
    // saldo formatted as es-AR currency — Intl produces `$ 0,00`
    // (with a non-breaking space between `$` and the digits).
    expect(screen.getByText(/\$\s*0,00/)).toBeInTheDocument()
  })

  it('renders an "Exportar CSV" button', () => {
    renderList()
    expect(screen.getByRole('button', { name: /exportar csv/i })).toBeInTheDocument()
  })

  it('renders one table row per movimiento with the formatted columns', () => {
    renderList()
    // Two rows for the two sample movimientos
    expect(screen.getByText('Cuota enero 2026')).toBeInTheDocument()
    expect(screen.getByText('Pago en mesa')).toBeInTheDocument()
    // DEBITO row's "debe" cell + CREDITO row's "haber" cell are both
    // $ 1.500,00 in es-AR (two matches total).
    const matches = screen.getAllByText(/\$\s*1\.500,00/)
    expect(matches).toHaveLength(2)
  })

  it('formats the fecha as DD/MM/YYYY (es-AR)', () => {
    renderList()
    expect(screen.getByText('15/01/2026')).toBeInTheDocument()
    expect(screen.getByText('20/01/2026')).toBeInTheDocument()
  })

  it('shows the empty state when movimientos is empty', () => {
    renderList({ movimientos: [] })
    expect(screen.getByText(/sin movimientos/i)).toBeInTheDocument()
  })

  it('shows a loading skeleton when loading is true', () => {
    renderList({ loading: true })
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByText('Cargando…')).toHaveClass('sr-only')
  })

  it('triggers downloadCSV with the movimientos when the button is clicked', async () => {
    const user = userEvent.setup()
    renderList()
    await user.click(screen.getByRole('button', { name: /exportar csv/i }))

    expect(toCSVMock).toHaveBeenCalledTimes(1)
    expect(downloadCSVMock).toHaveBeenCalledTimes(1)
    // Signature is `downloadCSV(filename, csv)` — filename is arg 0.
    const filename = downloadCSVMock.mock.calls[0]?.[0] as string
    // The filename should include the socioId so users can track which
    // account the export came from.
    expect(filename).toMatch(/ctacte-a1b2c3d4.*\.csv$/)
  })

  it('disables the Exportar CSV button when there are no rows', () => {
    renderList({ movimientos: [] })
    const button = screen.getByRole('button', { name: /exportar csv/i })
    expect(button).toBeDisabled()
  })

  it('renders the "anulado" indicator on rows whose anulado is true', () => {
    const movimientos: SampleMovimiento[] = [
      { ...SAMPLE_MOVIMIENTOS[0]!, id: 'mv-x', anulado: true, anulado_at: '2026-02-01T00:00:00Z' },
    ]
    renderList({ movimientos })
    expect(screen.getByText(/anulado/i)).toBeInTheDocument()
  })
})
