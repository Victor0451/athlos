import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signAccessToken, type JWTPayload } from '@athlos/auth'
import type { Env } from '@athlos/config'
import { createStandinDb } from '../test-standins/db.ts'
import { buildServer } from '../server.ts'
import type { PdfGenerator } from '../modules/socios/forms/pdf-generator.ts'
import type { FastifyInstance } from 'fastify'
import type { Db } from '@athlos/db'

/**
 * Build a multipart/form-data body from a record of text fields.
 * The text fields are placed AFTER a small placeholder file part because
 * the payment route uses `request.file()` which only captures fields
 * that appear AFTER the file in the stream (matching the socios-attachments.ts
 * pattern where text fields follow the file).
 */
function buildMultipartText(fields: Record<string, string>): Buffer {
  const boundary = '----TestBoundary'
  const parts: Buffer[] = []
  // Placeholder file first (0 bytes) so that subsequent text fields
  // are captured into file.fields by @fastify/multipart's request.file()
  parts.push(Buffer.from(`--${boundary}\r\n`))
  parts.push(Buffer.from(`Content-Disposition: form-data; name="placeholder"; filename=""\r\n`))
  parts.push(Buffer.from(`Content-Type: application/octet-stream\r\n\r\n`))
  // Empty file content
  parts.push(Buffer.from(`\r\n`))
  // Text fields (these become file.fields after the placeholder file)
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\n`))
    parts.push(Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n`))
    parts.push(Buffer.from(`${value}\r\n`))
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`))
  return Buffer.concat(parts)
}

/**
 * HTTP-level tests for the ctacte mutations routes.
 *
 *   POST /api/v1/socios/:socioId/ctacte/movements/payment
 *   POST /api/v1/socios/:socioId/ctacte/movements/debit
 *   POST /api/v1/socios/:socioId/ctacte/movements/:movementId/notes
 *   GET  /api/v1/socios/:socioId/ctacte/comprobante.pdf?from=&to=&cuenta=
 *
 * Uses the standin DB (no real pg / chromium) + a stub PDF generator.
 * Covers: 201 happy paths, 400 validation, 401 missing JWT, 404 unknown
 * socio/movement, cap-50 enforcement at the route level, and the
 * audit emission for CTACTE_COMPROBANTE_PRINTED.
 */

function makeEnv(): Env {
  return {
    NODE_ENV: 'test',
    PORT: 3001,
    HOST: '0.0.0.0',
    LOG_LEVEL: 'info',
    DATABASE_URL: 'postgresql://test/test',
    JWT_SECRET: 'test-secret-please-rotate-32chars-minimum',
    JWT_REFRESH_SECRET: 'test-secret-please-rotate-32chars-minimum',
    JWT_ACCESS_TTL_SECONDS: 900,
    JWT_REFRESH_TTL_SECONDS: 604800,
    LEGACY_DB_PATH: '/tmp/legacy',
    CORS_ORIGINS: 'http://localhost:3000',
    FROM_ADDRESS: 'noreply@gorriti.app',
    DRIFT_DETECTION_CRON: '*/15 * * * *',
    FRESHNESS_REFRESH_CRON: '*/5 * * * *',
    TOKEN_CLEANUP_CRON: '0 3 * * *',
    RECONCILIATION_CRON: '0 * * * *',
    PROMOTION_CRON: '0 */6 * * *',
    AUDIT_RETENTION_DAYS: 90,
  } as Env
}

function bearer(role: JWTPayload['role'] = 'OPERADOR'): string {
  return signAccessToken(
    {
      sub: '00000000-0000-4000-8000-000000000001',
      role,
      permissions: { can_reprint: true, can_anulate: true },
    },
    makeEnv(),
  )
}

function bearerAs(sub: string, role: JWTPayload['role']): string {
  return signAccessToken(
    {
      sub,
      role,
      permissions: { can_reprint: true, can_anulate: true },
    },
    makeEnv(),
  )
}

const SOCIO_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_SOCIO_ID = '33333333-3333-4333-8333-333333333333'
const MOVEMENT_ID = '22222222-2222-4222-8222-222222222222'
const IDEMPOTENCY_KEY = 'payment-retry-key-1'

let app: FastifyInstance
let standin: ReturnType<typeof createStandinDb>
let pdfGenerator: PdfGenerator

function stubPdfGenerator(): PdfGenerator {
  const fixedPdf = Buffer.from('%PDF-1.7 stub for tests\n%%EOF\n')
  return {
    init: vi.fn(async () => undefined),
    generate: vi.fn(async () => fixedPdf),
    close: vi.fn(async () => undefined),
  }
}

function seedSocio(id = SOCIO_ID): void {
  standin.state.socios.push({
    id,
    numeroSocio: '12345',
    nombre: 'Juan',
    apellido: 'Pérez',
    dni: '28765432',
    fechaAlta: '2024-01-01',
    estado: 'activo',
    categoria: null,
    direccion: 'Av. Siempre Viva 742',
    telefono: '3885123456',
    email: 'juan@test.com',
    fechaNacimiento: '1990-05-15',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  } as never)
}

function seedCtacteMovement(): void {
  standin.state.ctacte.push({
    id: MOVEMENT_ID,
    socioId: SOCIO_ID,
    fecha: '2026-07-05',
    tipo: 'CREDITO',
    concepto: 'Cuota Julio',
    debe: '0.00',
    haber: '1500.00',
    anulado: false,
    anuladoAt: null,
    anuladoMotivo: null,
    cctcuenta: 'PRINCIPAL',
    legacyId: null,
    comprobanteAttachmentId: null,
    createdAt: new Date(),
  } as never)
}

async function bootstrap(): Promise<void> {
  standin = createStandinDb()
  pdfGenerator = stubPdfGenerator()
  app = await buildServer({
    env: {
      ...process.env,
      NODE_ENV: 'test',
      JWT_SECRET: makeEnv().JWT_SECRET,
      JWT_REFRESH_SECRET: makeEnv().JWT_REFRESH_SECRET,
      DATABASE_URL: makeEnv().DATABASE_URL,
      LEGACY_DB_PATH: makeEnv().LEGACY_DB_PATH,
    },
    containerOverrides: { db: standin.drizzle as unknown as Db },
    pdfGenerator,
    quietLogger: true,
  })
}

afterEach(async () => {
  if (app) await app.close()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

beforeEach(async () => {
  await bootstrap()
})

// ─── POST /ctacte/movements/payment ──────────────────────────────────────────

describe('POST /api/v1/socios/:socioId/ctacte/movements/payment', () => {
  it('returns 401 when the JWT is missing', async () => {
    seedSocio()
    const body = buildMultipartText({ monto: '1500', fecha: '2026-07-09', concepto: 'Cuota Julio' })
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/payment`,
      headers: { 'content-type': 'multipart/form-data; boundary=----TestBoundary' },
      payload: body,
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 201 with movement DTO when the payment is registered (no comprobante)', async () => {
    seedSocio()
    const body = buildMultipartText({ monto: '1500', fecha: '2026-07-09', concepto: 'Cuota Julio' })
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/payment`,
      headers: {
        authorization: `Bearer ${bearer()}`,
        'content-type': 'multipart/form-data; boundary=----TestBoundary',
        'idempotency-key': IDEMPOTENCY_KEY,
      },
      payload: body,
    })
    if (res.statusCode !== 201) {
      // eslint-disable-next-line no-console
      console.log('Payment 201 failed:', res.statusCode, res.body)
    }
    expect(res.statusCode).toBe(201)
    const body2 = res.json()
    expect(body2.id).toBeDefined()
    expect(body2.tipo).toBe('CREDITO')
    expect(body2.monto).toBe(1500)
    expect(body2.concepto).toBe('Cuota Julio')
  })

  it('returns 400 when monto <= 0', async () => {
    seedSocio()
    const body = buildMultipartText({ monto: '0', fecha: '2026-07-09', concepto: 'X' })
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/payment`,
      headers: {
        authorization: `Bearer ${bearer()}`,
        'content-type': 'multipart/form-data; boundary=----TestBoundary',
        'idempotency-key': IDEMPOTENCY_KEY,
      },
      payload: body,
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('VALIDATION_ERROR')
  })

  it.each([
    ['before fecha_alta', '2023-12-30'],
    ['in the future', '2099-01-01'],
  ])(
    'returns field-level fecha validation without side effects when the date is %s',
    async (_case, fecha) => {
      seedSocio()
      const body = buildMultipartText({ monto: '1500', fecha, concepto: 'Cuota Julio' })

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/payment`,
        headers: {
          authorization: `Bearer ${bearer()}`,
          'content-type': 'multipart/form-data; boundary=----TestBoundary',
          'idempotency-key': IDEMPOTENCY_KEY,
        },
        payload: body,
      })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toMatchObject({
        error: 'VALIDATION_ERROR',
        details: [{ field: 'fecha', message: "outside socio's relationship range" }],
      })
      expect(standin.state.ctacte).toHaveLength(0)
      expect(
        standin.state.auditEvents.filter(
          (event: { action?: string }) => event.action === 'CTACTE_PAYMENT_REGISTERED',
        ),
      ).toHaveLength(0)
    },
  )

  it.each(['2026-02-30', '2026-2-3', 'not-a-date'])(
    'rejects invalid calendar date %s',
    async (fecha) => {
      seedSocio()
      const body = buildMultipartText({ monto: '1500', fecha, concepto: 'Cuota Julio' })

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/payment`,
        headers: {
          authorization: `Bearer ${bearer()}`,
          'content-type': 'multipart/form-data; boundary=----TestBoundary',
          'idempotency-key': IDEMPOTENCY_KEY,
        },
        payload: body,
      })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toMatchObject({
        error: 'VALIDATION_ERROR',
        details: [{ field: 'fecha', message: 'must be a valid ISO calendar date' }],
      })
      expect(standin.state.ctacte).toHaveLength(0)
    },
  )

  it('returns 404 when the socio does not exist', async () => {
    const body = buildMultipartText({ monto: '1500', fecha: '2026-07-09', concepto: 'Cuota Julio' })
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/payment`,
      headers: {
        authorization: `Bearer ${bearer()}`,
        'content-type': 'multipart/form-data; boundary=----TestBoundary',
        'idempotency-key': IDEMPOTENCY_KEY,
      },
      payload: body,
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns the original movement without inserting a duplicate for the same retry key', async () => {
    seedSocio()
    const body = buildMultipartText({ monto: '1500', fecha: '2026-07-09', concepto: 'Cuota Julio' })
    const headers = {
      authorization: `Bearer ${bearer()}`,
      'content-type': 'multipart/form-data; boundary=----TestBoundary',
      'idempotency-key': IDEMPOTENCY_KEY,
    }
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/payment`,
      headers,
      payload: body,
    })
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/payment`,
      headers,
      payload: body,
    })

    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(201)
    expect(second.json().id).toBe(first.json().id)
    expect(standin.state.ctacte).toHaveLength(1)
  })

  it('returns 409 when the same retry key is used for a changed payload or socio', async () => {
    seedSocio()
    seedSocio(OTHER_SOCIO_ID)
    const headers = {
      authorization: `Bearer ${bearer()}`,
      'content-type': 'multipart/form-data; boundary=----TestBoundary',
      'idempotency-key': IDEMPOTENCY_KEY,
    }
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/payment`,
      headers,
      payload: buildMultipartText({ monto: '1500', fecha: '2026-07-09', concepto: 'Cuota Julio' }),
    })
    const changedPayload = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/payment`,
      headers,
      payload: buildMultipartText({ monto: '1600', fecha: '2026-07-09', concepto: 'Cuota Julio' }),
    })
    const changedSocio = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${OTHER_SOCIO_ID}/ctacte/movements/payment`,
      headers,
      payload: buildMultipartText({ monto: '1500', fecha: '2026-07-09', concepto: 'Cuota Julio' }),
    })

    expect(first.statusCode).toBe(201)
    expect(changedPayload.statusCode).toBe(409)
    expect(changedSocio.statusCode).toBe(409)
    expect(standin.state.ctacte).toHaveLength(1)
  })
})

// ─── POST /ctacte/movements/debit ─────────────────────────────────────────────

describe('POST /api/v1/socios/:socioId/ctacte/movements/debit', () => {
  it('returns 401 when the JWT is missing', async () => {
    seedSocio()
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/debit`,
      payload: { monto: 800, fecha: '2026-07-09', motivo: 'Cargo mora' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 201 with movement DTO when the debit is registered', async () => {
    seedSocio()
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/debit`,
      headers: { authorization: `Bearer ${bearer()}`, 'idempotency-key': 'debit-happy-key' },
      payload: { monto: 800, fecha: '2026-07-09', motivo: 'Cargo mora' },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.tipo).toBe('DEBITO')
    expect(body.monto).toBe(800)
    expect(body.motivo).toBe('Cargo mora')
  })

  it('returns 400 when monto <= 0', async () => {
    seedSocio()
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/debit`,
      headers: {
        authorization: `Bearer ${bearer()}`,
        'idempotency-key': 'debit-missing-socio-key',
      },
      payload: { monto: -100, fecha: '2026-07-09', motivo: 'X' },
    })
    expect(res.statusCode).toBe(400)
  })

  it.each(['2026-02-30', '2026-2-3', 'not-a-date'])(
    'rejects invalid calendar date %s',
    async (fecha) => {
      seedSocio()
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/debit`,
        headers: { authorization: `Bearer ${bearer()}`, 'idempotency-key': 'comprobante-401-key' },
        payload: { monto: 800, fecha, motivo: 'Cargo mora' },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toMatchObject({
        error: 'VALIDATION_ERROR',
        details: [{ field: 'fecha', message: 'must be a valid ISO calendar date' }],
      })
      expect(standin.state.ctacte).toHaveLength(0)
    },
  )

  it('returns 404 when the socio does not exist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/debit`,
      headers: {
        authorization: `Bearer ${bearer()}`,
        'idempotency-key': 'debit-missing-socio-key',
      },
      payload: { monto: 800, fecha: '2026-07-09', motivo: 'Cargo mora' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('replays the same caller key and creates a distinct debit for a distinct key', async () => {
    seedSocio()
    const request = () =>
      app.inject({
        method: 'POST',
        url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/debit`,
        headers: { authorization: `Bearer ${bearer()}`, 'idempotency-key': 'debit-replay-key' },
        payload: { monto: 800, fecha: '2026-07-09', motivo: 'Cargo mora' },
      })

    const first = await request()
    const retry = await request()
    const distinct = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/debit`,
      headers: { authorization: `Bearer ${bearer()}`, 'idempotency-key': 'debit-distinct-key' },
      payload: { monto: 800, fecha: '2026-07-09', motivo: 'Cargo mora' },
    })

    expect(first.statusCode).toBe(201)
    expect(retry.statusCode).toBe(201)
    expect(retry.json().id).toBe(first.json().id)
    expect(distinct.statusCode).toBe(201)
    expect(distinct.json().id).not.toBe(first.json().id)
    expect(standin.state.ctacte).toHaveLength(2)
    expect(
      standin.state.auditEvents.filter(
        (event: { action?: string }) => event.action === 'CTACTE_DEBIT_REGISTERED',
      ),
    ).toHaveLength(2)
  })
})

// ─── POST /ctacte/movements/:movementId/notes ─────────────────────────────────

describe('POST /api/v1/socios/:socioId/ctacte/movements/:movementId/notes', () => {
  it('returns 401 when the JWT is missing', async () => {
    seedSocio()
    seedCtacteMovement()
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/${MOVEMENT_ID}/notes`,
      payload: { body: 'Verificar comprobante' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 201 when the note is added', async () => {
    seedSocio()
    seedCtacteMovement()
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/${MOVEMENT_ID}/notes`,
      headers: { authorization: `Bearer ${bearer()}`, 'idempotency-key': 'note-intent-happy' },
      payload: { body: 'Verificar comprobante' },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.id).toBeDefined()
    expect(body.body).toBe('Verificar comprobante')
  })

  it('returns 400 when body is empty', async () => {
    seedSocio()
    seedCtacteMovement()
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/${MOVEMENT_ID}/notes`,
      headers: {
        authorization: `Bearer ${bearer()}`,
        'idempotency-key': 'note-intent-empty-body',
      },
      payload: { body: '' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 when the movement does not exist', async () => {
    seedSocio()
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/${MOVEMENT_ID}/notes`,
      headers: { authorization: `Bearer ${bearer()}`, 'idempotency-key': 'note-intent-missing-mv' },
      payload: { body: 'Nota sobre movimiento inexistente' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('rejects writes to a movement owned by another socio without note or audit side effects', async () => {
    seedSocio()
    seedSocio(OTHER_SOCIO_ID)
    seedCtacteMovement()

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${OTHER_SOCIO_ID}/ctacte/movements/${MOVEMENT_ID}/notes`,
      headers: {
        authorization: `Bearer ${bearer()}`,
        'idempotency-key': 'note-intent-cross-socio',
      },
      payload: { body: 'Cross-socio write' },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'NOT_FOUND' })
    expect(standin.state.ctacteMovementNotes).toHaveLength(0)
    expect(
      standin.state.auditEvents.filter(
        (event: { action?: string }) => event.action === 'CTACTE_MOVEMENT_NOTE_ADDED',
      ),
    ).toHaveLength(0)
  })

  it('collapses same-key retries and keeps different keys as distinct notes', async () => {
    seedSocio()
    seedCtacteMovement()
    const postNote = (body: string, idempotencyKey: string) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/${MOVEMENT_ID}/notes`,
        headers: {
          authorization: `Bearer ${bearer()}`,
          'idempotency-key': idempotencyKey,
        },
        payload: { body },
      })

    // R3 fix #2: distinct keys per intent. The first two calls share
    // the SAME key + SAME body, so they collapse. The third call
    // uses a fresh key and is a distinct note.
    const first = await postNote('A', 'note-intent-collapse-A')
    const retry = await postNote('A', 'note-intent-collapse-A')
    const differentBody = await postNote('B', 'note-intent-collapse-B')

    expect(first.statusCode).toBe(201)
    expect(retry.statusCode).toBe(201)
    expect(retry.json().id).toBe(first.json().id)
    expect(differentBody.statusCode).toBe(201)
    expect(differentBody.json().id).not.toBe(first.json().id)
    expect(standin.state.ctacteMovementNotes).toHaveLength(2)
    expect(
      standin.state.auditEvents.filter(
        (event: { action?: string }) => event.action === 'CTACTE_MOVEMENT_NOTE_ADDED',
      ),
    ).toHaveLength(2)
  })

  it('emits one note audit event when identical requests race in the same bucket', async () => {
    seedSocio()
    seedCtacteMovement()
    const postNote = () =>
      app.inject({
        method: 'POST',
        url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/${MOVEMENT_ID}/notes`,
        headers: {
          authorization: `Bearer ${bearer()}`,
          'idempotency-key': 'note-intent-concurrent',
        },
        payload: { body: 'Concurrent retry' },
      })

    const [first, retry] = await Promise.all([postNote(), postNote()])

    expect(first.statusCode).toBe(201)
    expect(retry.statusCode).toBe(201)
    expect(retry.json().id).toBe(first.json().id)
    expect(standin.state.ctacteMovementNotes).toHaveLength(1)
    expect(
      standin.state.auditEvents.filter(
        (event: { action?: string }) => event.action === 'CTACTE_MOVEMENT_NOTE_ADDED',
      ),
    ).toHaveLength(1)
  })
})

// ─── GET /ctacte/movements/:movementId/notes ──────────────────────────────────

describe('GET /api/v1/socios/:socioId/ctacte/movements/:movementId/notes', () => {
  it('returns active notes for an existing movement', async () => {
    seedSocio()
    seedCtacteMovement()
    standin.state.ctacteMovementNotes.push({
      id: '33333333-3333-4333-8333-333333333333',
      ctacteMovementId: MOVEMENT_ID,
      body: 'Verificar comprobante',
      authorOperatorId: '00000000-0000-4000-8000-000000000001',
      createdAt: new Date('2026-07-09T12:00:00.000Z'),
      deletedAt: null,
    } as never)

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/${MOVEMENT_ID}/notes`,
      headers: { authorization: `Bearer ${bearer()}`, 'idempotency-key': 'comprobante-replay-key' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([
      expect.objectContaining({ ctacte_movement_id: MOVEMENT_ID, body: 'Verificar comprobante' }),
    ])
  })

  it('returns 404 instead of another socio’s movement notes', async () => {
    seedSocio()
    seedSocio(OTHER_SOCIO_ID)
    seedCtacteMovement()

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/socios/${OTHER_SOCIO_ID}/ctacte/movements/${MOVEMENT_ID}/notes`,
      headers: { authorization: `Bearer ${bearer()}` },
    })

    expect(res.statusCode).toBe(404)
  })
})

// ─── GET /ctacte/comprobante.pdf ──────────────────────────────────────────────

describe('GET /api/v1/socios/:socioId/ctacte/comprobante.pdf', () => {
  it('returns 401 when the JWT is missing', async () => {
    seedSocio()
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/comprobante.pdf?from=2026-07-01&to=2026-07-31&cuenta=PRINCIPAL`,
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 200 with PDF buffer and correct Content-Disposition on happy path', async () => {
    seedSocio()
    // Seed a ctacte movement so getMovementsForComprobante returns something
    standin.state.ctacte.push({
      id: '33333333-3333-4333-8333-333333333333',
      socioId: SOCIO_ID,
      fecha: '2026-07-10',
      tipo: 'CREDITO',
      concepto: 'Cuota Julio',
      debe: '0.00',
      haber: '1500.00',
      anulado: false,
      anuladoAt: null,
      anuladoMotivo: null,
      cctcuenta: 'PRINCIPAL',
      legacyId: null,
      comprobanteAttachmentId: null,
      createdAt: new Date(),
    } as never)

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/comprobante.pdf?from=2026-07-01&to=2026-07-31&cuenta=PRINCIPAL`,
      headers: { authorization: `Bearer ${bearer()}`, 'idempotency-key': 'comprobante-happy-key' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('application/pdf')
    const body = res.rawPayload
    expect(body.subarray(0, 5).toString('utf8')).toBe('%PDF-')
    expect(res.headers['content-disposition']).toContain('inline; filename="ctacte-')
  })

  it('returns 404 when the socio does not exist', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/comprobante.pdf?from=2026-07-01&to=2026-07-31&cuenta=PRINCIPAL`,
      headers: {
        authorization: `Bearer ${bearer()}`,
        'idempotency-key': 'comprobante-missing-key',
      },
    })
    expect(res.statusCode).toBe(404)
    // PDF generator should NOT have been called
    expect(pdfGenerator.generate).not.toHaveBeenCalled()
  })

  it('returns 400 when from > to', async () => {
    seedSocio()
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/comprobante.pdf?from=2026-07-31&to=2026-07-01&cuenta=PRINCIPAL`,
      headers: { authorization: `Bearer ${bearer()}`, 'idempotency-key': 'comprobante-range-key' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('VALIDATION_ERROR')
  })

  it('returns 400 when missing required query params', async () => {
    seedSocio()
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/comprobante.pdf`,
      headers: { authorization: `Bearer ${bearer()}`, 'idempotency-key': 'comprobante-query-key' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('emits CTACTE_COMPROBANTE_PRINTED audit with sha256 + byte_size on success', async () => {
    seedSocio()
    standin.state.ctacte.push({
      id: '44444444-4444-4444-8444-444444444444',
      socioId: SOCIO_ID,
      fecha: '2026-07-10',
      tipo: 'CREDITO',
      concepto: 'Cuota Julio',
      debe: '0.00',
      haber: '1500.00',
      anulado: false,
      anuladoAt: null,
      anuladoMotivo: null,
      cctcuenta: 'PRINCIPAL',
      legacyId: null,
      comprobanteAttachmentId: null,
      createdAt: new Date(),
    } as never)

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/comprobante.pdf?from=2026-07-01&to=2026-07-31&cuenta=PRINCIPAL`,
      headers: { authorization: `Bearer ${bearer()}`, 'idempotency-key': 'comprobante-audit-key' },
    })
    expect(res.statusCode).toBe(200)
    const auditEvents = standin.state.auditEvents.filter(
      (e: { action?: string }) => e.action === 'CTACTE_COMPROBANTE_PRINTED',
    )
    expect(auditEvents).toHaveLength(1)
    const audit = auditEvents[0] as Record<string, unknown>
    expect(audit.action).toBe('CTACTE_COMPROBANTE_PRINTED')
    expect((audit.metadata as Record<string, unknown>)?.sha256).toBeDefined()
    expect((audit.metadata as Record<string, unknown>)?.byte_size).toBeDefined()
  })

  it('returns the actual 51-row count without generating or auditing a PDF', async () => {
    seedSocio()
    for (let index = 0; index < 51; index += 1) {
      standin.state.ctacte.push({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        socioId: SOCIO_ID,
        fecha: '2026-07-10',
        tipo: 'CREDITO',
        concepto: `Cuota ${index}`,
        debe: '0.00',
        haber: '1500.00',
        anulado: false,
        anuladoAt: null,
        anuladoMotivo: null,
        cctcuenta: 'PRINCIPAL',
        legacyId: null,
        comprobanteAttachmentId: null,
        createdAt: new Date(),
      } as never)
    }

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/comprobante.pdf?from=2026-07-01&to=2026-07-31&cuenta=PRINCIPAL`,
      headers: { authorization: `Bearer ${bearer()}`, 'idempotency-key': 'comprobante-cap-key' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({
      error: 'VALIDATION_ERROR',
      details: { cap: 50, requested: 51 },
    })
    expect(pdfGenerator.generate).not.toHaveBeenCalled()
    expect(
      standin.state.auditEvents.filter(
        (event: { action?: string }) => event.action === 'CTACTE_COMPROBANTE_PRINTED',
      ),
    ).toHaveLength(0)
  })

  it('returns the same comprobante retry without regenerating its PDF inside the bucket', async () => {
    seedSocio()
    const request = () =>
      app.inject({
        method: 'GET',
        url: `/api/v1/socios/${SOCIO_ID}/ctacte/comprobante.pdf?from=2026-07-01&to=2026-07-31&cuenta=PRINCIPAL`,
        headers: {
          authorization: `Bearer ${bearer()}`,
          'idempotency-key': 'comprobante-replay-key',
        },
      })

    const first = await request()
    const retry = await request()

    expect(first.statusCode).toBe(200)
    expect(retry.statusCode).toBe(200)
    expect(retry.rawPayload).toEqual(first.rawPayload)
    expect(pdfGenerator.generate).toHaveBeenCalledOnce()
    expect(
      standin.state.auditEvents.filter(
        (event: { action?: string }) => event.action === 'CTACTE_COMPROBANTE_PRINTED',
      ),
    ).toHaveLength(1)
  })

  it('returns 409 when another actor replays a completed comprobante key', async () => {
    seedSocio()
    const url = `/api/v1/socios/${SOCIO_ID}/ctacte/comprobante.pdf?from=2026-07-01&to=2026-07-31&cuenta=PRINCIPAL`
    const request = (authorization: string) =>
      app.inject({
        method: 'GET',
        url,
        headers: { authorization, 'idempotency-key': 'actor-bound-comprobante-key' },
      })

    const first = await request(`Bearer ${bearer()}`)
    const sameActorReplay = await request(`Bearer ${bearer()}`)
    const otherActorReplay = await request(
      `Bearer ${bearerAs('00000000-0000-4000-8000-000000000002', 'OPERADOR')}`,
    )

    expect(first.statusCode).toBe(200)
    expect(sameActorReplay.statusCode).toBe(200)
    expect(sameActorReplay.rawPayload).toEqual(first.rawPayload)
    expect(otherActorReplay.statusCode).toBe(409)
    expect(otherActorReplay.json()).toMatchObject({ error: 'CONFLICT' })
    expect(pdfGenerator.generate).toHaveBeenCalledOnce()
  })

  it('requires a caller key and rejects a changed canonical request for the same key', async () => {
    seedSocio()
    const baseUrl = `/api/v1/socios/${SOCIO_ID}/ctacte/comprobante.pdf?from=2026-07-01&to=2026-07-31&cuenta=PRINCIPAL`
    const missing = await app.inject({
      method: 'GET',
      url: baseUrl,
      headers: { authorization: `Bearer ${bearer()}` },
    })
    const first = await app.inject({
      method: 'GET',
      url: baseUrl,
      headers: {
        authorization: `Bearer ${bearer()}`,
        'idempotency-key': 'comprobante-conflict-key',
      },
    })
    const changed = await app.inject({
      method: 'GET',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/comprobante.pdf?from=2026-07-02&to=2026-07-31&cuenta=PRINCIPAL`,
      headers: {
        authorization: `Bearer ${bearer()}`,
        'idempotency-key': 'comprobante-conflict-key',
      },
    })
    expect(missing.statusCode).toBe(400)
    expect(first.statusCode).toBe(200)
    expect(changed.statusCode).toBe(409)
    expect(pdfGenerator.generate).toHaveBeenCalledOnce()
  })
})

// ─── DELETE /ctacte/movements/:movementId/notes/:noteId (R3) ──────────────────

const NOTE_ID = '55555555-5555-4555-8555-555555555555'
const AUTHOR_OPERATOR_ID = '00000000-0000-4000-8000-000000000001'
const OTHER_AUTHOR_OPERATOR_ID = '00000000-0000-4000-8000-000000000002'

function seedNote(): void {
  standin.state.ctacteMovementNotes.push({
    id: NOTE_ID,
    ctacteMovementId: MOVEMENT_ID,
    body: 'Verificar comprobante físico',
    authorOperatorId: AUTHOR_OPERATOR_ID,
    createdAt: new Date('2026-07-09T12:00:00.000Z'),
    deletedAt: null,
  } as never)
}

describe('DELETE /api/v1/socios/:socioId/ctacte/movements/:movementId/notes/:noteId (R3)', () => {
  it('returns 401 when the JWT is missing', async () => {
    seedSocio()
    seedCtacteMovement()
    seedNote()
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/${MOVEMENT_ID}/notes/${NOTE_ID}`,
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 200 when the original author soft-deletes the note', async () => {
    seedSocio()
    seedCtacteMovement()
    seedNote()

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/${MOVEMENT_ID}/notes/${NOTE_ID}`,
      headers: { authorization: `Bearer ${bearerAs(AUTHOR_OPERATOR_ID, 'OPERADOR')}` },
    })

    expect(res.statusCode).toBe(200)
    const deleted = standin.state.ctacteMovementNotes.find(
      (n: { id: string }) => n.id === NOTE_ID,
    ) as { deletedAt: Date | null } | undefined
    expect(deleted?.deletedAt).not.toBeNull()
  })

  it('returns 200 when an ADMIN soft-deletes another operator note', async () => {
    seedSocio()
    seedCtacteMovement()
    standin.state.ctacteMovementNotes.push({
      id: NOTE_ID,
      ctacteMovementId: MOVEMENT_ID,
      body: 'foreign author',
      authorOperatorId: OTHER_AUTHOR_OPERATOR_ID,
      createdAt: new Date('2026-07-09T12:00:00.000Z'),
      deletedAt: null,
    } as never)

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/${MOVEMENT_ID}/notes/${NOTE_ID}`,
      headers: { authorization: `Bearer ${bearerAs(AUTHOR_OPERATOR_ID, 'ADMIN')}` },
    })

    expect(res.statusCode).toBe(200)
    const deleted = standin.state.ctacteMovementNotes.find(
      (n: { id: string }) => n.id === NOTE_ID,
    ) as { deletedAt: Date | null } | undefined
    expect(deleted?.deletedAt).not.toBeNull()
  })

  it('returns 403 when a non-author non-ADMIN caller attempts the delete', async () => {
    seedSocio()
    seedCtacteMovement()
    standin.state.ctacteMovementNotes.push({
      id: NOTE_ID,
      ctacteMovementId: MOVEMENT_ID,
      body: 'foreign author',
      authorOperatorId: OTHER_AUTHOR_OPERATOR_ID,
      createdAt: new Date('2026-07-09T12:00:00.000Z'),
      deletedAt: null,
    } as never)

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/${MOVEMENT_ID}/notes/${NOTE_ID}`,
      headers: { authorization: `Bearer ${bearerAs(AUTHOR_OPERATOR_ID, 'OPERADOR')}` },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json()).toMatchObject({ error: 'INSUFFICIENT_PERMISSIONS' })
    const note = standin.state.ctacteMovementNotes.find((n: { id: string }) => n.id === NOTE_ID) as
      | { deletedAt: Date | null }
      | undefined
    expect(note?.deletedAt).toBeNull()
  })

  it('returns 404 when the note id does not exist', async () => {
    seedSocio()
    seedCtacteMovement()

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/${MOVEMENT_ID}/notes/99999999-9999-4999-8999-999999999999`,
      headers: { authorization: `Bearer ${bearer()}` },
    })

    expect(res.statusCode).toBe(404)
  })

  it('returns 404 when the movement belongs to another socio', async () => {
    seedSocio()
    seedSocio(OTHER_SOCIO_ID)
    seedCtacteMovement()
    seedNote()

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/socios/${OTHER_SOCIO_ID}/ctacte/movements/${MOVEMENT_ID}/notes/${NOTE_ID}`,
      headers: { authorization: `Bearer ${bearerAs(AUTHOR_OPERATOR_ID, 'ADMIN')}` },
    })

    expect(res.statusCode).toBe(404)
    const note = standin.state.ctacteMovementNotes.find((n: { id: string }) => n.id === NOTE_ID) as
      | { deletedAt: Date | null }
      | undefined
    expect(note?.deletedAt).toBeNull()
  })

  it('returns 200 then excludes the note from the subsequent list endpoint', async () => {
    seedSocio()
    seedCtacteMovement()
    seedNote()

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/${MOVEMENT_ID}/notes/${NOTE_ID}`,
      headers: { authorization: `Bearer ${bearerAs(AUTHOR_OPERATOR_ID, 'OPERADOR')}` },
    })
    expect(del.statusCode).toBe(200)

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/${MOVEMENT_ID}/notes`,
      headers: { authorization: `Bearer ${bearer()}` },
    })
    expect(list.statusCode).toBe(200)
    expect(list.json()).toEqual([])
  })

  /**
   * R3 fix #1 — DELETE nested resource binding.
   *
   * A note must belong to the URL `movementId` AND that movement must
   * belong to the URL `socioId`. A note that belongs to a different
   * movement (even of the same socio) must return 404 without
   * soft-deleting anything.
   */
  it('returns 404 when the note belongs to a different movement of the same socio (no delete)', async () => {
    seedSocio()
    seedCtacteMovement()
    // Seed a second movement on the same socio + a note on it
    const otherMovementId = '66666666-6666-4666-8666-666666666666'
    standin.state.ctacte.push({
      id: otherMovementId,
      socioId: SOCIO_ID,
      fecha: '2026-07-06',
      tipo: 'CREDITO',
      concepto: 'Otra cuota',
      debe: '0.00',
      haber: '500.00',
      anulado: false,
      anuladoAt: null,
      anuladoMotivo: null,
      cctcuenta: 'PRINCIPAL',
      legacyId: null,
      comprobanteAttachmentId: null,
      createdAt: new Date(),
    } as never)
    seedNote()

    // Attempt to delete the note via the WRONG movement id
    // (NOTE_ID belongs to MOVEMENT_ID, not otherMovementId)
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/${otherMovementId}/notes/${NOTE_ID}`,
      headers: { authorization: `Bearer ${bearerAs(AUTHOR_OPERATOR_ID, 'ADMIN')}` },
    })

    expect(res.statusCode).toBe(404)
    const note = standin.state.ctacteMovementNotes.find((n: { id: string }) => n.id === NOTE_ID) as
      | { deletedAt: Date | null }
      | undefined
    expect(note?.deletedAt).toBeNull()
  })

  /**
   * R3 fix #3 — DELETE route error mapping.
   *
   * Unexpected DB / technical failures must map to 5xx via the
   * global error handler, NOT be squashed into a 400 VALIDATION_ERROR.
   * Validation (400/404) + auth (401/403) statuses remain preserved
   * by the route layer.
   */
  it('maps an unexpected repository failure to a 5xx (not a 400 VALIDATION_ERROR)', async () => {
    seedSocio()
    seedCtacteMovement()
    seedNote()

    // Simulate a technical failure by stubbing the service to reject
    // with a non-ApiError exception (mirrors a DB outage).
    const ctacteNotes = await import('../modules/socios/ctacte_movement_notes.ts')
    const spy = vi
      .spyOn(ctacteNotes, 'softDeleteNote')
      .mockRejectedValueOnce(new Error('boom: db connection lost'))

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/${MOVEMENT_ID}/notes/${NOTE_ID}`,
      headers: { authorization: `Bearer ${bearerAs(AUTHOR_OPERATOR_ID, 'ADMIN')}` },
    })

    expect(res.statusCode).toBeGreaterThanOrEqual(500)
    expect(res.statusCode).toBeLessThan(600)
    // Must NOT be the old "VALIDATION_ERROR" swallow behaviour
    expect(res.json()).not.toMatchObject({ error: 'VALIDATION_ERROR' })

    spy.mockRestore()
  })

  it('still returns a 403 with the existing envelope when authorization fails', async () => {
    seedSocio()
    seedCtacteMovement()
    standin.state.ctacteMovementNotes.push({
      id: NOTE_ID,
      ctacteMovementId: MOVEMENT_ID,
      body: 'foreign author',
      authorOperatorId: OTHER_AUTHOR_OPERATOR_ID,
      createdAt: new Date('2026-07-09T12:00:00.000Z'),
      deletedAt: null,
    } as never)

    // Sanity check — without an injected failure, auth errors must
    // keep producing the existing 403 envelope (regression guard for
    // the error-mapping fix).
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/${MOVEMENT_ID}/notes/${NOTE_ID}`,
      headers: { authorization: `Bearer ${bearerAs(AUTHOR_OPERATOR_ID, 'OPERADOR')}` },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toMatchObject({ error: 'INSUFFICIENT_PERMISSIONS' })
  })
})

// ─── POST /ctacte/movements/:movementId/notes — Idempotency-Key (R3 fix #2) ────

describe('POST /api/v1/socios/:socioId/ctacte/movements/:movementId/notes — Idempotency-Key', () => {
  const NOTE_KEY = 'note-intent-durable-1'

  it('returns 400 when the caller omits the Idempotency-Key header', async () => {
    seedSocio()
    seedCtacteMovement()
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/${MOVEMENT_ID}/notes`,
      headers: { authorization: `Bearer ${bearer()}` },
      payload: { body: 'Sin clave — no debería crear nota' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ error: 'VALIDATION_ERROR' })
    expect(standin.state.ctacteMovementNotes).toHaveLength(0)
  })

  it('returns 400 when the Idempotency-Key header is empty or > 128 characters', async () => {
    seedSocio()
    seedCtacteMovement()
    const empty = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/${MOVEMENT_ID}/notes`,
      headers: { authorization: `Bearer ${bearer()}`, 'idempotency-key': '   ' },
      payload: { body: 'vacía' },
    })
    const tooLong = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/${MOVEMENT_ID}/notes`,
      headers: {
        authorization: `Bearer ${bearer()}`,
        'idempotency-key': 'x'.repeat(129),
      },
      payload: { body: 'demasiado larga' },
    })

    expect(empty.statusCode).toBe(400)
    expect(tooLong.statusCode).toBe(400)
    expect(standin.state.ctacteMovementNotes).toHaveLength(0)
  })

  it('replays the same note for the same key + same payload (no second row, no second audit)', async () => {
    seedSocio()
    seedCtacteMovement()
    const baseHeaders = {
      authorization: `Bearer ${bearer()}`,
      'idempotency-key': NOTE_KEY,
    }
    const body = { body: 'Verificar comprobante físico' }

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/${MOVEMENT_ID}/notes`,
      headers: baseHeaders,
      payload: body,
    })
    const retry = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/${MOVEMENT_ID}/notes`,
      headers: baseHeaders,
      payload: body,
    })

    expect(first.statusCode).toBe(201)
    expect(retry.statusCode).toBe(201)
    expect(retry.json().id).toBe(first.json().id)
    expect(standin.state.ctacteMovementNotes).toHaveLength(1)
    expect(
      standin.state.auditEvents.filter(
        (e: { action?: string }) => e.action === 'CTACTE_MOVEMENT_NOTE_ADDED',
      ),
    ).toHaveLength(1)
  })

  it('returns 409 when the same key is reused with a different payload', async () => {
    seedSocio()
    seedCtacteMovement()
    const baseHeaders = {
      authorization: `Bearer ${bearer()}`,
      'idempotency-key': NOTE_KEY,
    }

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/${MOVEMENT_ID}/notes`,
      headers: baseHeaders,
      payload: { body: 'Original' },
    })
    const conflict = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/${MOVEMENT_ID}/notes`,
      headers: baseHeaders,
      payload: { body: 'Cambio de cuerpo' },
    })

    expect(first.statusCode).toBe(201)
    expect(conflict.statusCode).toBe(409)
    expect(conflict.json()).toMatchObject({ error: 'CONFLICT' })
    expect(standin.state.ctacteMovementNotes).toHaveLength(1)
  })

  it('creates a distinct note for a new Idempotency-Key (even with identical payload)', async () => {
    seedSocio()
    seedCtacteMovement()
    const basePayload = { body: 'Mismo texto, llaves distintas' }

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/${MOVEMENT_ID}/notes`,
      headers: { authorization: `Bearer ${bearer()}`, 'idempotency-key': 'note-intent-A' },
      payload: basePayload,
    })
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/${MOVEMENT_ID}/notes`,
      headers: { authorization: `Bearer ${bearer()}`, 'idempotency-key': 'note-intent-B' },
      payload: basePayload,
    })

    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(201)
    expect(second.json().id).not.toBe(first.json().id)
    expect(standin.state.ctacteMovementNotes).toHaveLength(2)
    expect(
      standin.state.auditEvents.filter(
        (e: { action?: string }) => e.action === 'CTACTE_MOVEMENT_NOTE_ADDED',
      ),
    ).toHaveLength(2)
  })

  it('still replays the same note when the retry arrives after a long elapsed interval (no 10s bucket collapse)', async () => {
    seedSocio()
    seedCtacteMovement()
    const baseHeaders = {
      authorization: `Bearer ${bearer()}`,
      'idempotency-key': NOTE_KEY,
    }
    const body = { body: 'Persistente a través del reloj' }

    // First write happens at `t0`.
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/${MOVEMENT_ID}/notes`,
      headers: baseHeaders,
      payload: body,
    })

    // Mimic a slow retry: pretend 15 seconds elapsed on the system
    // clock — well past the legacy 10s SHA-256 timestamp bucket.
    // The new durable contract keys replays on `idempotencyKey`
    // (stored in the row), NOT on `Date.now()`, so the replay must
    // surface the same note instead of creating a duplicate.
    const realNow = Date.now
    const FORTY_SECONDS_LATER = realNow.call(Date) + 15_000
    Date.now = () => FORTY_SECONDS_LATER
    try {
      const retry = await app.inject({
        method: 'POST',
        url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/${MOVEMENT_ID}/notes`,
        headers: baseHeaders,
        payload: body,
      })
      expect(first.statusCode).toBe(201)
      expect(retry.statusCode).toBe(201)
      expect(retry.json().id).toBe(first.json().id)
      expect(standin.state.ctacteMovementNotes).toHaveLength(1)
      expect(
        standin.state.auditEvents.filter(
          (e: { action?: string }) => e.action === 'CTACTE_MOVEMENT_NOTE_ADDED',
        ),
      ).toHaveLength(1)
    } finally {
      Date.now = realNow
    }
  })
})
