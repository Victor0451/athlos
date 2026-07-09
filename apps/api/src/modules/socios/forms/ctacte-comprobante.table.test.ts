import { describe, expect, it } from 'vitest'
import {
  CTACTE_MOVEMENTS_TABLE,
  CTACTE_TOTALS_FOOTER,
  type ComprobanteMovementLite,
} from './ctacte-comprobante.template.ts'

/**
 * `ctacte-comprobante` table-helper tests (PR A1b.2 — athlos-ctacte-mutations).
 *
 * Sibling of `ctacte-comprobante.template.test.ts` (which tests
 * `buildComprobanteHtml` + `buildComprobanteFilename`). Split for the
 * 200 LoC per-file cap.
 *
 * The helpers expand the `{{movements_table}}` and `{{totals_footer}}`
 * placeholders server-side because `renderTemplate()` is a pure
 * `{{var}}` renderer (no loops, no conditionals — design §7).
 */

const SAMPLE_MOVEMENTS: ComprobanteMovementLite[] = [
  {
    id: 'm-1',
    fecha: '2026-07-05',
    tipo: 'CREDITO',
    monto: 1500,
    concepto: 'Cuota Julio',
    motivo: null,
    saldo: -1500,
  },
  {
    id: 'm-2',
    fecha: '2026-07-15',
    tipo: 'DEBITO',
    monto: 800,
    concepto: 'Cuota social Julio',
    motivo: 'Cuota social Julio',
    saldo: -700,
  },
]

describe('CTACTE_MOVEMENTS_TABLE', () => {
  it('renders one <tr> per movement with fecha / tipo / concepto cells', () => {
    const html = CTACTE_MOVEMENTS_TABLE(SAMPLE_MOVEMENTS)
    const trCount = (html.match(/<tr>/g) ?? []).length
    expect(trCount).toBe(2)
    expect(html).toContain('CREDITO')
    expect(html).toContain('DEBITO')
    expect(html).toContain('Cuota Julio')
    expect(html).toContain('Cuota social Julio')
  })

  it('CREDITO row: debe=0.00, haber=monto', () => {
    const html = CTACTE_MOVEMENTS_TABLE([SAMPLE_MOVEMENTS[0]!])
    // Row format: <tr><td>fecha</td><td>tipo</td><td>concepto</td>
    //              <td class="num">debe</td><td class="num">haber</td>
    //              <td class="num">saldo</td></tr>
    expect(html).toContain('1500.00')
    // CREDITO debe should be 0.00 (rendered into the debe cell).
    expect(html).toMatch(/<td class="num">0\.00<\/td><td class="num">1500\.00<\/td>/)
  })

  it('DEBITO row: debe=monto, haber=0.00', () => {
    const html = CTACTE_MOVEMENTS_TABLE([SAMPLE_MOVEMENTS[1]!])
    expect(html).toContain('800.00')
    // DEBITO haber should be 0.00.
    expect(html).toMatch(/<td class="num">800\.00<\/td><td class="num">0\.00<\/td>/)
  })

  it('returns a single empty row when there are no movements', () => {
    const html = CTACTE_MOVEMENTS_TABLE([])
    expect(html).toContain('Sin movimientos en el periodo')
    expect(html).toContain('<tr class="empty">')
  })

  it('uses motivo when concepto is null (DEBITO rows)', () => {
    const html = CTACTE_MOVEMENTS_TABLE([
      {
        id: 'm-3',
        fecha: '2026-07-20',
        tipo: 'DEBITO',
        monto: 100,
        concepto: null,
        motivo: 'Cargo administrativo',
        saldo: 0,
      },
    ])
    expect(html).toContain('Cargo administrativo')
  })
})

describe('CTACTE_TOTALS_FOOTER', () => {
  it('sums debe (DEBITO monto) and haber (CREDITO monto) correctly', () => {
    const html = CTACTE_TOTALS_FOOTER(SAMPLE_MOVEMENTS)
    // totalDebe = 800, totalHaber = 1500, saldoFinal = -700 (last row)
    expect(html).toContain('Totales')
    expect(html).toContain('800.00')
    expect(html).toContain('1500.00')
    expect(html).toMatch(/-700\.00/)
  })

  it('returns zeroed totals for an empty movements array', () => {
    const html = CTACTE_TOTALS_FOOTER([])
    expect(html).toContain('Totales')
    // Three 0.00 cells (debe, haber, saldo).
    const zeros = (html.match(/0\.00/g) ?? []).length
    expect(zeros).toBeGreaterThanOrEqual(3)
  })
})
