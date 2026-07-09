import { describe, expect, it } from 'vitest'
import {
  buildComprobanteFilename,
  buildComprobanteHtml,
  CTACTE_COMPROBANTE_DEFAULTS,
  type ComprobanteMovementLite,
  type ComprobanteRange,
  type ComprobanteSocio,
} from './ctacte-comprobante.template.ts'

/**
 * `ctacte-comprobante` template + substitution tests
 * (PR A1b.2 — athlos-ctacte-mutations). Pure-function tests, no puppeteer.
 *
 * The integration test (`ctacte-comprobante.golden.test.ts`) exercises
 * the full `pdfGenerator.generate` pipeline and lives in a separate
 * file to keep this file under the 200 LoC per-file cap.
 */

const SOCIO: ComprobanteSocio = {
  numeroSocio: '12345',
  apellido: 'P\u00e9rez',
  nombre: 'Juan',
  dni: '28765432',
}

const RANGE: ComprobanteRange = {
  from: '2026-07-01',
  to: '2026-07-31',
  generatedAt: '09/07/2026',
}

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

describe('buildComprobanteHtml — template substitution', () => {
  it('substitutes the Gorriti Premium header + socio card + movements table', () => {
    const html = buildComprobanteHtml(SAMPLE_MOVEMENTS, SOCIO, RANGE)
    expect(html).toContain('CLUB ATLETICO GORRITI')
    expect(html).toContain('12345')
    expect(html).toContain('P\u00e9rez, Juan')
    expect(html).toContain('28765432')
    expect(html).toContain('2026-07-01')
    expect(html).toContain('2026-07-31')
    expect(html).toContain('Cuota Julio')
    expect(html).toContain('Cuota social Julio')
    // No unresolved placeholders left in the output.
    expect(html).not.toMatch(/\{\{[a-z_]+\}\}/i)
  })

  it('renders the empty-movements table gracefully (just the totals row)', () => {
    const html = buildComprobanteHtml([], SOCIO, RANGE)
    expect(html).toContain('Totales')
    expect(html).toContain('>0.00</td>')
    expect(html).not.toMatch(/\{\{[a-z_]+\}\}/i)
  })

  it('HTML-escapes the socio fields (XSS protection)', () => {
    const evil: ComprobanteSocio = {
      ...SOCIO,
      apellido: '<script>alert(1)</script>',
      nombre: '"><img src=x onerror=alert(1)>',
    }
    const html = buildComprobanteHtml(SAMPLE_MOVEMENTS, evil, RANGE)
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('uses the default style + logo when no overrides are passed', () => {
    const html = buildComprobanteHtml(SAMPLE_MOVEMENTS, SOCIO, RANGE)
    expect(CTACTE_COMPROBANTE_DEFAULTS.styles).toBeDefined()
    expect(CTACTE_COMPROBANTE_DEFAULTS.logoBase64).toContain('base64,')
    // The CSS block is embedded in the rendered HTML.
    expect(html).toContain(CTACTE_COMPROBANTE_DEFAULTS.styles.slice(0, 32))
  })

  it('uses an explicit generatedAt when supplied', () => {
    const html = buildComprobanteHtml(SAMPLE_MOVEMENTS, SOCIO, {
      ...RANGE,
      generatedAt: '31/07/2026',
    })
    expect(html).toContain('31/07/2026')
  })
})

describe('buildComprobanteFilename', () => {
  it('returns the canonical ctacte-<numeroSocio>-<from>-<to>.pdf shape', () => {
    expect(
      buildComprobanteFilename({
        numeroSocio: '12345',
        from: '2026-07-01',
        to: '2026-07-31',
      }),
    ).toBe('ctacte-12345-2026-07-01-2026-07-31.pdf')
  })

  it('preserves non-numeric socio numbers verbatim (no padding)', () => {
    expect(
      buildComprobanteFilename({
        numeroSocio: 'CTA-99',
        from: '2026-07-01',
        to: '2026-07-31',
      }),
    ).toBe('ctacte-CTA-99-2026-07-01-2026-07-31.pdf')
  })

  it('zero-pads short numeric socio numbers to the canonical 5-digit width', () => {
    expect(
      buildComprobanteFilename({
        numeroSocio: '7',
        from: '2026-07-01',
        to: '2026-07-31',
      }),
    ).toBe('ctacte-00007-2026-07-01-2026-07-31.pdf')
  })
})
