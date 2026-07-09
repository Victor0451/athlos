import { GORRITI_LOGO_BASE64 } from './logo.ts'
import { CTACTE_COMPROBANTE_STYLES } from './ctacte-comprobante.styles.ts'
import { renderTemplateMixed, escapeHtml } from './template-renderer.ts'

/**
 * HTML template + substitution helpers for the `ctacte-comprobante`
 * PDF (PR A1b.2 — athlos-ctacte-mutations).
 *
 * Single TS string constant with `{{var}}` placeholders. `buildComprobanteHtml()`
 * substitutes the placeholder bag and HTML-escapes every value. The
 * movements table + totals footer are pre-rendered server-side via
 * `CTACTE_MOVEMENTS_TABLE()` + `CTACTE_TOTALS_FOOTER()` so the hand-rolled
 * `renderTemplate()` (which only handles flat `{{var}}` placeholders) is
 * enough — no Handlebars / Mustache engine needed.
 *
 * Layout (per design §7): Gorriti Premium header, socio card,
 * movements table, totals footer, document footer.
 */

export const CTACTE_COMPROBANTE_TEMPLATE = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Comprobante de Cuenta Corriente</title>
  <style>{{styles}}</style>
</head>
<body class="page-comprobante">
  <header class="club-header">
    <img class="club-logo" src="{{logo_base64}}" alt="Club Atletico Gorriti">
    <div class="club-name-block">
      <p class="club-name">CLUB ATLETICO GORRITI</p>
      <p class="doc-title">Comprobante de Cuenta Corriente</p>
    </div>
  </header>

  <section class="socio-card">
    <div class="cell"><span class="label">SOCIO N&deg;</span><span class="value">{{numero_socio}}</span></div>
    <div class="cell"><span class="label">Titular</span><span class="value">{{titular}}</span></div>
    <div class="cell"><span class="label">DNI</span><span class="value">{{dni}}</span></div>
    <div class="cell"><span class="label">Periodo</span><span class="value">{{periodo}}</span></div>
  </section>

  <table class="movements-table">
    <thead>
      <tr>
        <th>Fecha</th>
        <th>Tipo</th>
        <th>Concepto / Motivo</th>
        <th class="num">Debe</th>
        <th class="num">Haber</th>
        <th class="num">Saldo</th>
      </tr>
    </thead>
    <tbody>
      {{__raw:movements_table}}
    </tbody>
    <tfoot>
      {{__raw:totals_footer}}
    </tfoot>
  </table>

  <footer class="doc-footer">
    <p>Este comprobante es un resumen de los movimientos generados entre el {{from}} y el {{to}}.</p>
    <p>Para consultas, contacte a la administracion del Club Atletico Gorriti.</p>
    <p>Emitido el {{generated_at}} &mdash; Saldo final: {{saldo_final}}.</p>
  </footer>
</body>
</html>
`

export interface ComprobanteMovementLite {
  id: string
  fecha: string
  tipo: 'DEBITO' | 'CREDITO'
  monto: number
  concepto: string | null
  motivo: string | null
  /** Optional per-row running saldo. Defaults to 0 when absent. */
  saldo?: number
}

export interface ComprobanteSocio {
  numeroSocio: string
  apellido: string
  nombre: string
  dni: string
}

export interface ComprobanteRange {
  from: string
  to: string
  /** DD/MM/YYYY formatted date string; defaults to today (UTC). */
  generatedAt?: string
}

/**
 * Render the `<tbody>` rows for the movements table.
 *
 *   DEBITO  row: debe = monto, haber = 0.00
 *   CREDITO row: debe = 0.00, haber = monto
 *
 * The `concepto` / `motivo` column renders whichever field is set
 * (the schema has no dedicated `motivo` column — debit rows reuse
 * the legacy `concepto` column for their motivo text).
 */
export function CTACTE_MOVEMENTS_TABLE(movements: ReadonlyArray<ComprobanteMovementLite>): string {
  if (movements.length === 0) {
    return '<tr class="empty"><td colspan="6" class="num">Sin movimientos en el periodo</td></tr>'
  }
  return movements
    .map((m) => {
      const debe = m.tipo === 'DEBITO' ? formatMonto(m.monto) : '0.00'
      const haber = m.tipo === 'CREDITO' ? formatMonto(m.monto) : '0.00'
      const concepto = (m.concepto ?? m.motivo ?? '') as string
      return (
        '<tr>' +
        `<td>${escapeHtml(m.fecha)}</td>` +
        `<td>${escapeHtml(m.tipo)}</td>` +
        `<td>${escapeHtml(concepto)}</td>` +
        `<td class="num">${escapeHtml(debe)}</td>` +
        `<td class="num">${escapeHtml(haber)}</td>` +
        `<td class="num">${escapeHtml(formatMonto(m.saldo ?? 0))}</td>` +
        '</tr>'
      )
    })
    .join('\n')
}

/**
 * Render the totals row + saldo final. Sums `debe` (sum of monto for
 * DEBITO rows) + `haber` (sum of monto for CREDITO rows) + uses the
 * last movement's `saldo` as the saldo final.
 */
export function CTACTE_TOTALS_FOOTER(movements: ReadonlyArray<ComprobanteMovementLite>): string {
  let totalDebe = 0
  let totalHaber = 0
  for (const m of movements) {
    if (m.tipo === 'DEBITO') totalDebe += m.monto
    else totalHaber += m.monto
  }
  const saldoFinal = movements.length === 0 ? 0 : (movements[movements.length - 1]!.saldo ?? 0)
  return (
    '<tr>' +
    '<td colspan="3">Totales</td>' +
    `<td class="num">${escapeHtml(formatMonto(totalDebe))}</td>` +
    `<td class="num">${escapeHtml(formatMonto(totalHaber))}</td>` +
    `<td class="num">${escapeHtml(formatMonto(saldoFinal))}</td>` +
    '</tr>'
  )
}

export interface ComprobanteVariables {
  styles: string
  logoBase64: string
  numeroSocio: string
  titular: string
  dni: string
  periodo: string
  from: string
  to: string
  movementsTable: string
  totalsFooter: string
  generatedAt: string
  saldoFinal: string
}

export const CTACTE_COMPROBANTE_DEFAULTS = {
  styles: CTACTE_COMPROBANTE_STYLES,
  logoBase64: GORRITI_LOGO_BASE64,
} as const

/**
 * Build the variable bag for `renderTemplate()` from movements + socio
 * + range. Every value is HTML-escaped at substitution time (via
 * `renderTemplate()`) — protects against a socio `apellido` like
 * `<script>alert(1)</script>` rendering live JS in the PDF.
 */
export function buildComprobanteVariables(input: {
  movements: ComprobanteMovementLite[]
  socio: ComprobanteSocio
  range: ComprobanteRange
}): ComprobanteVariables {
  const saldoFinal = computeSaldoFinal(input.movements)
  return {
    styles: CTACTE_COMPROBANTE_DEFAULTS.styles,
    logoBase64: CTACTE_COMPROBANTE_DEFAULTS.logoBase64,
    numeroSocio: input.socio.numeroSocio,
    titular: `${input.socio.apellido}, ${input.socio.nombre}`,
    dni: input.socio.dni,
    periodo: `${input.range.from} \u2192 ${input.range.to}`,
    from: input.range.from,
    to: input.range.to,
    movementsTable: CTACTE_MOVEMENTS_TABLE(input.movements),
    totalsFooter: CTACTE_TOTALS_FOOTER(input.movements),
    generatedAt: input.range.generatedAt ?? formatFechaEmision(new Date()),
    saldoFinal: formatMonto(saldoFinal),
  }
}

/**
 * Render the comprobante HTML by substituting the variable bag into
 * the template constant.
 */
export function buildComprobanteHtml(
  movements: ComprobanteMovementLite[],
  socio: ComprobanteSocio,
  range: ComprobanteRange,
): string {
  const vars = buildComprobanteVariables({ movements, socio, range })
  // Keys MUST match the {{var}} placeholders in CTACTE_COMPROBANTE_TEMPLATE.
  const templateVars: Record<string, string> = {
    styles: vars.styles,
    logo_base64: vars.logoBase64,
    numero_socio: vars.numeroSocio,
    titular: vars.titular,
    dni: vars.dni,
    periodo: vars.periodo,
    from: vars.from,
    to: vars.to,
    movements_table: vars.movementsTable,
    totals_footer: vars.totalsFooter,
    generated_at: vars.generatedAt,
    saldo_final: vars.saldoFinal,
  }
  return renderTemplateMixed(CTACTE_COMPROBANTE_TEMPLATE, templateVars)
}

/**
 * Build the canonical download filename for a comprobante PDF.
 * Format: `ctacte-<numeroSocio padded>-<from>-<to>.pdf`.
 * - Pure-numeric `numeroSocio`: zero-padded to 5 digits (canonical UI width).
 * - Non-numeric `numeroSocio`: preserved verbatim (e.g. "CTA-99" → "CTA-99").
 */
export function buildComprobanteFilename(query: {
  numeroSocio: string
  from: string
  to: string
}): string {
  const num = /^\d+$/.test(query.numeroSocio)
    ? query.numeroSocio.padStart(5, '0')
    : query.numeroSocio
  return `ctacte-${num}-${query.from}-${query.to}.pdf`
}

/** Format a `Date` as DD/MM/YYYY (UTC). */
function formatFechaEmision(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const yyyy = String(d.getUTCFullYear())
  return `${dd}/${mm}/${yyyy}`
}

/** Format a numeric monto as a NUMERIC(14,2) string ("1234.56"). */
function formatMonto(value: number): string {
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  const intPart = Math.floor(abs).toString()
  // Round to 2 decimals without float drift.
  const cents = Math.round((abs - Math.floor(abs)) * 100)
  return `${sign}${intPart}.${String(cents).padStart(2, '0')}`
}

/** The last movement's running saldo — that's the final saldo on the comprobante. */
function computeSaldoFinal(movements: ComprobanteMovementLite[]): number {
  if (movements.length === 0) return 0
  return movements[movements.length - 1]!.saldo ?? 0
}
