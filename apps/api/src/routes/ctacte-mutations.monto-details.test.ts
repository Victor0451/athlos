import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signAccessToken, type JWTPayload } from '@athlos/auth'
import type { Env } from '@athlos/config'
import { createStandinDb } from '../test-standins/db.ts'
import { buildServer } from '../server.ts'
import type { PdfGenerator } from '../modules/socios/forms/pdf-generator.ts'
import type { FastifyInstance } from 'fastify'
import type { Db } from '@athlos/db'

/**
 * R4 corrective batch — defect #1: payment / debit `monto <= 0` must
 * surface the standard `VALIDATION_ERROR.details` array shape that
 * the front-end `applyFieldErrors` helper consumes
 * (`[{ field, message }, …]`). Before this fix, the route emitted
 * the envelope `{ error: 'VALIDATION_ERROR', message: 'monto must be
 * > 0' }` with no `details` payload — which forced every form to fall
 * back to the top-level toast because `parseFieldErrors(undefined)`
 * returns `[]`. The fix is symmetric for pago (multipart) and debit
 * (JSON).
 */

function buildMultipartText(fields: Record<string, string>): Buffer {
  const boundary = '----TestBoundary'
  const parts: Buffer[] = []
  parts.push(Buffer.from(`--${boundary}\r\n`))
  parts.push(Buffer.from(`Content-Disposition: form-data; name="placeholder"; filename=""\r\n`))
  parts.push(Buffer.from(`Content-Type: application/octet-stream\r\n\r\n`))
  parts.push(Buffer.from(`\r\n`))
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\n`))
    parts.push(Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n`))
    parts.push(Buffer.from(`${value}\r\n`))
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`))
  return Buffer.concat(parts)
}

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

function bearer(): string {
  return signAccessToken(
    {
      sub: '00000000-0000-4000-8000-000000000001',
      role: 'OPERADOR' as JWTPayload['role'],
      permissions: { can_reprint: true, can_anulate: true },
    },
    makeEnv(),
  )
}

const SOCIO_ID = '11111111-1111-4111-8111-111111111111'

let app: FastifyInstance
let standin: ReturnType<typeof createStandinDb>
let pdfGenerator: PdfGenerator

function stubPdfGenerator(): PdfGenerator {
  return {
    init: vi.fn(async () => undefined),
    generate: vi.fn(async () => Buffer.from('%PDF-stub\n%%EOF\n')),
    close: vi.fn(async () => undefined),
  }
}

function seedSocio(): void {
  standin.state.socios.push({
    id: SOCIO_ID,
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

describe('R4 corrective batch — `monto <= 0` must emit VALIDATION_ERROR.details array', () => {
  it('pago: `monto: 0` returns 400 with details: [{ field: "monto", message }] and no insert / no audit', async () => {
    seedSocio()
    const body = buildMultipartText({ monto: '0', fecha: '2026-07-09', concepto: 'X' })
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/payment`,
      headers: {
        authorization: `Bearer ${bearer()}`,
        'content-type': 'multipart/form-data; boundary=----TestBoundary',
        'idempotency-key': 'monto-zero-payment',
      },
      payload: body,
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({
      error: 'VALIDATION_ERROR',
      message: 'monto must be > 0',
      details: [{ field: 'monto', message: 'monto must be > 0' }],
    })
    expect(standin.state.ctacte).toHaveLength(0)
    expect(
      standin.state.auditEvents.filter(
        (e: { action?: string }) => e.action === 'CTACTE_PAYMENT_REGISTERED',
      ),
    ).toHaveLength(0)
  })

  it('pago: `monto: -100` returns the same details array shape', async () => {
    seedSocio()
    const body = buildMultipartText({ monto: '-100', fecha: '2026-07-09', concepto: 'X' })
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/payment`,
      headers: {
        authorization: `Bearer ${bearer()}`,
        'content-type': 'multipart/form-data; boundary=----TestBoundary',
        'idempotency-key': 'monto-negative-payment',
      },
      payload: body,
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({
      error: 'VALIDATION_ERROR',
      details: [{ field: 'monto', message: 'monto must be > 0' }],
    })
  })

  it('debit: `monto: -100` returns 400 with details: [{ field: "monto", message }] and no insert / no audit', async () => {
    seedSocio()
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/debit`,
      headers: {
        authorization: `Bearer ${bearer()}`,
        'idempotency-key': 'monto-negative-debit',
      },
      payload: { monto: -100, fecha: '2026-07-09', motivo: 'Cargo mora' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({
      error: 'VALIDATION_ERROR',
      message: 'monto must be > 0',
      details: [{ field: 'monto', message: 'monto must be > 0' }],
    })
    expect(standin.state.ctacte).toHaveLength(0)
    expect(
      standin.state.auditEvents.filter(
        (e: { action?: string }) => e.action === 'CTACTE_DEBIT_REGISTERED',
      ),
    ).toHaveLength(0)
  })

  it('debit: `monto: 0` returns the same details array shape', async () => {
    seedSocio()
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/debit`,
      headers: {
        authorization: `Bearer ${bearer()}`,
        'idempotency-key': 'monto-zero-debit',
      },
      payload: { monto: 0, fecha: '2026-07-09', motivo: 'Cargo mora' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({
      error: 'VALIDATION_ERROR',
      details: [{ field: 'monto', message: 'monto must be > 0' }],
    })
  })
})
