import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { ErrorCode } from '@athlos/errors'
import { emitForm } from './emit-form.ts'
import type { PdfGenerator } from './pdf-generator.ts'

/**
 * `emitForm` — full flow + audit integration.
 *
 * Mocks every dependency (repository, PDF generator, db) so the
 * orchestration + audit metadata shape are the only things under test.
 *
 * Critical contracts locked here:
 *   - Filename sanitization end-to-end (`O'Brien` → `O_BRIEN`).
 *   - SHA-256 = SHA-256 of the PDF bytes (no double-read).
 *   - `byteSize` = `Buffer.byteLength(pdf)`.
 *   - Audit metadata: EXACTLY 4 keys: `socio_id`, `form_id`, `sha256`,
 *     `byte_size` — same shape pinned by the audit emitter test.
 *   - `form_id` = literal `'solicitud-inscripcion'`.
 *   - `sha256` is 64-char lowercase hex.
 *   - Audit emission failure does NOT propagate — the result still
 *     returns with `{ pdf, filename, sha256, byteSize }`.
 *   - `NOT_FOUND` when the socio doesn't exist (no audit emitted).
 */

const SOCIO_ID = '00000000-0000-4000-8000-0000000000aa'
const OPERATOR_ID = '00000000-0000-4000-8000-0000000000bb'

interface MockDb {
  select: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
}

interface CapturedAudit {
  operatorId: string | null
  action: string
  entityType: string
  entityId: string
  oldValue: unknown
  newValue: unknown
  sourceIp: string | null
  payload: unknown
  metadata: Record<string, unknown> | null
  idempotencyKey: string | null
}

let capturedAudits: CapturedAudit[]
let socioRow: Record<string, unknown> | null
let pdfBuffer: Buffer
let insertShouldThrow: boolean

function buildMockDb(): MockDb {
  // Tables the mock knows how to resolve. Anything else returns []. The
  // audit emitter's idempotency SELECT targets `auditEvents` — we want
  // it to return [] (no prior row) so the INSERT path runs.
  const DRIZZLE_NAME = Symbol.for('drizzle:Name')
  const tableName = (t: unknown): string => {
    const obj = t as { name?: unknown; _?: { name?: string } }
    if (typeof obj?.name === 'string') return obj.name
    if (typeof obj?._?.name === 'string') return obj._.name
    const sym = (t as Record<symbol, unknown> | null)?.[DRIZZLE_NAME]
    return typeof sym === 'string' ? sym : ''
  }
  const socioResult = () => (socioRow ? [socioRow] : [])
  return {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        const tname = tableName(table)
        const rows = tname === 'socios' ? socioResult() : []
        return {
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve(rows)),
          })),
        }
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((row: Record<string, unknown>) => ({
        returning: vi.fn(() => {
          if (insertShouldThrow) {
            return Promise.reject(new Error('audit insert exploded'))
          }
          const captured: CapturedAudit = {
            operatorId: (row['operatorId'] as string | null) ?? null,
            action: row['action'] as string,
            entityType: row['entityType'] as string,
            entityId: row['entityId'] as string,
            oldValue: row['oldValue'] ?? null,
            newValue: row['newValue'] ?? null,
            sourceIp: (row['sourceIp'] as string | null) ?? null,
            payload: row['payload'] ?? null,
            metadata: (row['metadata'] as Record<string, unknown> | null) ?? null,
            idempotencyKey: (row['idempotencyKey'] as string | null) ?? null,
          }
          capturedAudits.push(captured)
          return Promise.resolve([{ id: 'row-1' }])
        }),
      })),
    })),
  }
}

function buildMockPdfGenerator(): PdfGenerator & {
  generateSpy: ReturnType<typeof vi.fn>
} {
  const generateSpy = vi.fn(async () => pdfBuffer)
  return {
    init: vi.fn(async () => undefined),
    generate: generateSpy,
    close: vi.fn(async () => undefined),
    generateSpy,
  }
}

beforeEach(() => {
  capturedAudits = []
  insertShouldThrow = false
  pdfBuffer = Buffer.from('%PDF-1.7 mock content for SHA-256 test ' + 'x'.repeat(50))
  socioRow = {
    id: SOCIO_ID,
    numeroSocio: '12345',
    nombre: 'Juan',
    apellido: 'Pérez',
    dni: '28765432',
    fechaAlta: '2024-01-01',
    estado: 'activo',
    categoria: null,
    direccion: 'Av. Forestal 1234',
    telefono: '3885123456',
    email: 'juan@example.com',
    fechaNacimiento: '1985-05-15',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('emitForm', () => {
  it('returns the PDF, a sanitized filename, a 64-char sha256, and the byte size', async () => {
    const db = buildMockDb()
    const pdfGenerator = buildMockPdfGenerator()
    const fixedNow = new Date('2026-07-08T12:00:00Z')
    const result = await emitForm({
      socioId: SOCIO_ID,
      operatorId: OPERATOR_ID,
      db: db as never,
      pdfGenerator,
      now: () => fixedNow,
    })
    expect(Buffer.isBuffer(result.pdf)).toBe(true)
    expect(result.filename).toBe('solicitud-inscripcion-socio-12345-PEREZ.pdf')
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/)
    // Independently compute sha256 from the same PDF bytes
    expect(result.sha256).toBe(createHash('sha256').update(pdfBuffer).digest('hex'))
    expect(result.byteSize).toBe(pdfBuffer.byteLength)
  })

  it('sanitizes special characters in apellido end-to-end', async () => {
    socioRow = { ...socioRow!, apellido: "O'Brien", numeroSocio: '9999' }
    const db = buildMockDb()
    const pdfGenerator = buildMockPdfGenerator()
    const result = await emitForm({
      socioId: SOCIO_ID,
      operatorId: OPERATOR_ID,
      db: db as never,
      pdfGenerator,
    })
    expect(result.filename).toBe('solicitud-inscripcion-socio-9999-O_BRIEN.pdf')
  })

  it('renders an empty fecha_nacimiento when the column is NULL', async () => {
    socioRow = { ...socioRow!, fechaNacimiento: null }
    const db = buildMockDb()
    const pdfGenerator = buildMockPdfGenerator()
    const genSpy = pdfGenerator.generateSpy
    await emitForm({
      socioId: SOCIO_ID,
      operatorId: OPERATOR_ID,
      db: db as never,
      pdfGenerator,
    })
    // The HTML passed to puppeteer must have an empty
    // `{{fecha_nacimiento}}` placeholder so the template's
    // `<span class="dotted-line">{{fecha_nacimiento}}</span>` renders
    // blank with the dotted underline visible.
    const htmlArg = genSpy.mock.calls[0]![0] as string
    expect(htmlArg).toContain('FECHA DE NACIMIENTO')
    // The placeholder should be substituted to empty (not the literal
    // `{{fecha_nacimiento}}` text and not a malformed date string).
    expect(htmlArg).not.toContain('{{fecha_nacimiento}}')
    expect(htmlArg).not.toContain('null')
  })

  it('formats fecha_nacimiento as DD/MM/YYYY when set', async () => {
    socioRow = { ...socioRow!, fechaNacimiento: '1985-05-15' }
    const db = buildMockDb()
    const pdfGenerator = buildMockPdfGenerator()
    const genSpy = pdfGenerator.generateSpy
    await emitForm({
      socioId: SOCIO_ID,
      operatorId: OPERATOR_ID,
      db: db as never,
      pdfGenerator,
    })
    const htmlArg = genSpy.mock.calls[0]![0] as string
    expect(htmlArg).toContain('15/05/1985')
  })

  it('emits SOCIO_FORM_EMITTED with exactly the 4-key metadata shape', async () => {
    const db = buildMockDb()
    const pdfGenerator = buildMockPdfGenerator()
    const result = await emitForm({
      socioId: SOCIO_ID,
      operatorId: OPERATOR_ID,
      db: db as never,
      pdfGenerator,
    })
    expect(capturedAudits).toHaveLength(1)
    const audit = capturedAudits[0]!
    expect(audit.action).toBe('SOCIO_FORM_EMITTED')
    expect(audit.entityType).toBe('socio')
    expect(audit.entityId).toBe(SOCIO_ID)
    expect(audit.operatorId).toBe(OPERATOR_ID)
    const meta = audit.metadata
    expect(meta).not.toBeNull()
    expect(Object.keys(meta!).sort()).toEqual(['byte_size', 'form_id', 'sha256', 'socio_id'])
    expect(meta!['socio_id']).toBe(SOCIO_ID)
    expect(meta!['form_id']).toBe('solicitud-inscripcion')
    expect(meta!['sha256']).toBe(result.sha256)
    expect(meta!['byte_size']).toBe(result.byteSize)
    expect(typeof meta!['byte_size']).toBe('number')
    expect((meta!['byte_size'] as number) > 0).toBe(true)
    expect(typeof meta!['sha256']).toBe('string')
    expect((meta!['sha256'] as string).length).toBe(64)
  })

  it('does NOT emit the audit when the socio is not found', async () => {
    socioRow = null
    const db = buildMockDb()
    const pdfGenerator = buildMockPdfGenerator()
    await expect(
      emitForm({
        socioId: SOCIO_ID,
        operatorId: OPERATOR_ID,
        db: db as never,
        pdfGenerator,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    expect(capturedAudits).toHaveLength(0)
    expect(pdfGenerator.generateSpy).not.toHaveBeenCalled()
  })

  it('swallows audit failures and still returns the PDF (best-effort)', async () => {
    insertShouldThrow = true
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const db = buildMockDb()
    const pdfGenerator = buildMockPdfGenerator()
    const result = await emitForm({
      socioId: SOCIO_ID,
      operatorId: OPERATOR_ID,
      db: db as never,
      pdfGenerator,
    })
    expect(Buffer.isBuffer(result.pdf)).toBe(true)
    expect(result.filename).toBe('solicitud-inscripcion-socio-12345-PEREZ.pdf')
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(consoleSpy).toHaveBeenCalledWith(
      '[emit-form] failed to emit SOCIO_FORM_EMITTED audit_event',
      expect.any(Error),
    )
    consoleSpy.mockRestore()
  })

  it('formats the emission date as DD/MM/YYYY in the FESCAG block', async () => {
    const db = buildMockDb()
    const pdfGenerator = buildMockPdfGenerator()
    const fixedNow = new Date('2026-07-08T15:30:00Z')
    const genSpy = pdfGenerator.generateSpy
    await emitForm({
      socioId: SOCIO_ID,
      operatorId: OPERATOR_ID,
      db: db as never,
      pdfGenerator,
      now: () => fixedNow,
    })
    const htmlArg = genSpy.mock.calls[0]![0] as string
    expect(htmlArg).toContain('08/07/2026')
  })
})
