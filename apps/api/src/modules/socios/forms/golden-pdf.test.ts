import { afterAll, describe, expect, it, vi } from 'vitest'
import pdfParse from 'pdf-parse'
import puppeteer from 'puppeteer'
import { emitForm } from './emit-form.ts'
import { createPdfGenerator } from './pdf-generator.ts'

/**
 * Golden-file test for `emitForm` (spec R14, design §11 testing strategy).
 *
 * Calls `emitForm` twice with the same known socio fixture, parses the
 * returned PDF bytes via `pdf-parse`, and asserts the extracted text
 * contains the expected substrings (apellido+nombre, dni, numeroSocio,
 * the FESCAG footer, etc.) so a visual regression — e.g. silently
 * dropping the FESCAG block or moving `{{titular_nombre}}` outside its
 * dotted-line span — is caught by CI.
 *
 * The two-emission determinism check ensures same input → same
 * rendered text. This is a substring equivalence check, not
 * byte-equality (chromium version drift is acceptable per design §11).
 *
 * Runtime constraints:
 *
 *   - This test uses REAL puppeteer (no `vi.mock('puppeteer')` here).
 *     The chrome binary must be launchable. A top-level probe below
 *     attempts to launch chromium with the production args; if the
 *     probe fails (missing shared libraries, no chromium in the
 *     runner image, etc.) the entire `describe` block is skipped via
 *     `describe.runIf(chromeAvailable)`. The test FILE still ships
 *     and runs in any environment where the project's Dockerfile
 *     runner stage has installed chromium (e.g. CI runner with
 *     `apk add chromium`).
 *
 *   - The socio loader is mocked via `vi.mock('../repository.ts')` —
 *     no real DB row needed. A standin known fixture is loaded.
 *
 *   - `emitAudit` is mocked via `vi.mock('@athlos/audit')` to a no-op
 *     so no DB write happens during the PDF render.
 *
 *   - `pdfGenerator` is created once at probe time and reused across
 *     both scenarios (matching the production `buildServer()` singleton
 *     wiring).
 */

const SOCIO_ID = '00000000-0000-4000-8000-0000000000aa'
const OPERATOR_ID = '00000000-0000-4000-8000-0000000000bb'

interface KnownSocioRow {
  id: string
  numeroSocio: string
  nombre: string
  apellido: string
  dni: string
  fechaAlta: string
  estado: 'activo'
  categoria: null
  direccion: string
  telefono: string
  email: string
  fechaNacimiento: string
  createdAt: Date
  updatedAt: Date
  deletedAt: null
}

const KNOWN_SOCIO: KnownSocioRow = {
  id: SOCIO_ID,
  numeroSocio: '12345',
  nombre: 'Juan',
  apellido: 'Pérez',
  dni: '12345678',
  fechaAlta: '2024-01-01',
  estado: 'activo',
  categoria: null,
  direccion: 'Av. Siempre Viva 742',
  telefono: '3884123456',
  email: 'juan@test.com',
  fechaNacimiento: '1990-05-15',
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
  deletedAt: null,
}

vi.mock('../repository.ts', () => ({
  findById: vi.fn(async () => KNOWN_SOCIO),
}))

vi.mock('@athlos/audit', () => ({
  emitAudit: vi.fn(async () => undefined),
  AuditAction: { SOCIO_FORM_EMITTED: 'SOCIO_FORM_EMITTED' },
}))

/**
 * Probe the chrome binary at module-load time. If we can launch a
 * browser, reuse that instance for the golden-file tests (avoids the
 * 2-3s launch overhead re-run per scenario). If we can't (missing
 * libs, alpine-edge-only chromium, etc.), `chromeAvailable` is false
 * and the describe block below becomes `describe.skip`.
 */
let pdfGenerator: Awaited<ReturnType<typeof createPdfGenerator>> | null = null
let chromeAvailable = false
try {
  pdfGenerator = createPdfGenerator()
  await pdfGenerator.init()
  chromeAvailable = !!(await import('puppeteer')).default ? true : false
} catch {
  chromeAvailable = false
  if (pdfGenerator) {
    try {
      await pdfGenerator.close()
    } catch {
      // best-effort cleanup on the failed probe
    }
    pdfGenerator = null
  }
}

// Suppress "unused" lint on the dynamic import — keeps the probe
// above semantically self-explanatory.
void puppeteer

afterAll(async () => {
  if (pdfGenerator) {
    await pdfGenerator.close()
    pdfGenerator = null
  }
})

const runIf = chromeAvailable ? describe : describe.skip

runIf('golden-pdf — emitForm end-to-end rendering (spec R14)', () => {
  it('renders a PDF whose extracted text contains the expected substrings', async () => {
    // pdfGenerator is guaranteed non-null when chromeAvailable is true.
    if (!pdfGenerator) throw new Error('pdfGenerator missing — chrome probe failed')
    const result = await emitForm({
      socioId: SOCIO_ID,
      operatorId: OPERATOR_ID,
      db: {} as never, // never invoked — vi.mock replaces `findById`
      pdfGenerator,
      now: () => new Date('2026-07-08T12:00:00Z'),
    })
    expect(Buffer.isBuffer(result.pdf)).toBe(true)
    expect(result.pdf.subarray(0, 5).toString('utf8')).toBe('%PDF-')

    const parsed = await pdfParse(result.pdf)
    const text = parsed.text

    // Club header — assert one of the two variants (the template uses
    // the ASCII form "CLUB ATLETICO GORRITI" but the design §5 also
    // mentions "CLUB ATLÉTICO" with the accent).
    expect(text.includes('CLUB ATLETICO GORRITI') || text.includes('CLUB ATLÉTICO')).toBe(true)

    // Titular name. The template renders `apellido + ', ' + nombre`
    // — we look for either ordering since pdf-parse may collapse or
    // reorder line breaks.
    const titularCandidates = ['Juan Pérez', 'Pérez, Juan', 'Pérez Juan']
    expect(titularCandidates.some((candidate) => text.includes(candidate))).toBe(true)

    // DNI — exact match. The template renders it inside a dotted-line
    // span so it appears as raw digits in the parsed text.
    expect(text).toContain('12345678')

    // numeroSocio — the "SOCIO Nº" rectangle + dotted-line.
    expect(text).toContain('SOCIO')
    expect(text).toContain('12345')

    // fecha_nacimiento — DD/MM/YYYY format per emit-form.ts.
    expect(text).toContain('15/05/1990')

    // Dirección.
    expect(text).toContain('Av. Siempre Viva 742')

    // Email.
    expect(text).toContain('juan@test.com')

    // FESCAG footer text. The template has both the literal "FESCAG"
    // token and the full phrase "FONDO DE EMERGENCIA SOLIDARIO". We
    // assert one of them.
    const fescagCandidates = ['FESCAG', 'FONDO DE EMERGENCIA SOLIDARIO']
    expect(fescagCandidates.some((candidate) => text.includes(candidate))).toBe(true)
  })

  it('produces equivalent rendered text when called twice with the same input (determinism proxy)', async () => {
    if (!pdfGenerator) throw new Error('pdfGenerator missing — chrome probe failed')
    const fixedNow = new Date('2026-07-08T12:00:00Z')
    const a = await emitForm({
      socioId: SOCIO_ID,
      operatorId: OPERATOR_ID,
      db: {} as never,
      pdfGenerator,
      now: () => fixedNow,
    })
    const b = await emitForm({
      socioId: SOCIO_ID,
      operatorId: OPERATOR_ID,
      db: {} as never,
      pdfGenerator,
      now: () => fixedNow,
    })
    expect(a.pdf.subarray(0, 5).toString('utf8')).toBe('%PDF-')
    expect(b.pdf.subarray(0, 5).toString('utf8')).toBe('%PDF-')

    const ta = (await pdfParse(a.pdf)).text
    const tb = (await pdfParse(b.pdf)).text

    // Substring equivalence on the locked fields, not byte-equality
    // — chromium timestamps / metadata shift between runs.
    for (const needle of ['CLUB ATLETICO GORRITI', '12345', '12345678', '15/05/1990']) {
      const countA = countSubstring(ta, needle)
      const countB = countSubstring(tb, needle)
      expect(countA).toBe(countB)
    }
  }, 60_000)
})

/** Count non-overlapping occurrences of `needle` inside `haystack`. */
function countSubstring(haystack: string, needle: string): number {
  if (needle.length === 0) return 0
  let count = 0
  let idx = 0
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++
    idx += needle.length
  }
  return count
}
