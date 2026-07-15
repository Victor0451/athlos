import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signAccessToken, type JWTPayload } from '@athlos/auth'
import type { Env } from '@athlos/config'
import { createStandinDb } from '../test-standins/db.ts'
import { buildServer } from '../server.ts'
import type { PdfGenerator } from '../modules/socios/forms/pdf-generator.ts'
import type { FastifyInstance } from 'fastify'
import type { Db } from '@athlos/db'

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

describe('CTACTE route error contract — non-ErrorCode service failures', () => {
  it('payment: a non-ErrorCode audit/DB rollback throw maps to a retryable redacted 5xx, NOT a 400 VALIDATION_ERROR', async () => {
    seedSocio()
    const ctacteMutations = await import('../modules/socios/forms/ctacte-mutations.ts')
    const spy = vi
      .spyOn(ctacteMutations, 'registerPayment')
      .mockRejectedValueOnce(new Error('boom: audit emit failed inside payment tx'))

    const body = buildMultipartText({
      monto: '1500',
      fecha: '2026-07-09',
      concepto: 'Cuota Julio',
    })
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/payment`,
      headers: {
        authorization: `Bearer ${bearer()}`,
        'content-type': 'multipart/form-data; boundary=----TestBoundary',
        'idempotency-key': 'route-error-contract-payment',
      },
      payload: body,
    })

    expect(res.statusCode).toBeGreaterThanOrEqual(500)
    expect(res.statusCode).toBeLessThan(600)
    expect(res.json()).not.toMatchObject({ error: 'VALIDATION_ERROR' })
    expect(res.body).not.toContain('boom: audit emit failed')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('debit: a non-ErrorCode audit/DB rollback throw maps to a retryable redacted 5xx, NOT a 400 VALIDATION_ERROR', async () => {
    seedSocio()
    const ctacteMutations = await import('../modules/socios/forms/ctacte-mutations.ts')
    const spy = vi
      .spyOn(ctacteMutations, 'registerDebit')
      .mockRejectedValueOnce(new Error('boom: pg transaction rolled back during audit'))

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/debit`,
      headers: {
        authorization: `Bearer ${bearer()}`,
        'idempotency-key': 'route-error-contract-debit',
      },
      payload: { monto: 800, fecha: '2026-07-09', motivo: 'Cargo mora' },
    })

    expect(res.statusCode).toBeGreaterThanOrEqual(500)
    expect(res.statusCode).toBeLessThan(600)
    expect(res.json()).not.toMatchObject({ error: 'VALIDATION_ERROR' })
    expect(res.body).not.toContain('boom: pg transaction rolled back')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('payment: preserves the existing 400 VALIDATION_ERROR envelope when the service throws an ErrorCode VALIDATION_ERROR', async () => {
    seedSocio()
    const ctacteMutations = await import('../modules/socios/forms/ctacte-mutations.ts')
    vi.spyOn(ctacteMutations, 'registerPayment').mockRejectedValueOnce(
      Object.assign(new Error('monto must be > 0'), {
        code: 'VALIDATION_ERROR',
        details: [{ field: 'monto', message: 'monto must be > 0' }],
      }),
    )

    const body = buildMultipartText({
      monto: '1500',
      fecha: '2026-07-09',
      concepto: 'Cuota Julio',
    })
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/payment`,
      headers: {
        authorization: `Bearer ${bearer()}`,
        'content-type': 'multipart/form-data; boundary=----TestBoundary',
        'idempotency-key': 'route-error-contract-payment-validation',
      },
      payload: body,
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({
      error: 'VALIDATION_ERROR',
      details: [{ field: 'monto', message: 'monto must be > 0' }],
    })
  })

  it('payment: preserves the existing 404 NOT_FOUND envelope when the service throws an ErrorCode NOT_FOUND', async () => {
    seedSocio()
    const ctacteMutations = await import('../modules/socios/forms/ctacte-mutations.ts')
    vi.spyOn(ctacteMutations, 'registerPayment').mockRejectedValueOnce(
      Object.assign(new Error('socio not found'), { code: 'NOT_FOUND' }),
    )

    const body = buildMultipartText({
      monto: '1500',
      fecha: '2026-07-09',
      concepto: 'Cuota Julio',
    })
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/ctacte/movements/payment`,
      headers: {
        authorization: `Bearer ${bearer()}`,
        'content-type': 'multipart/form-data; boundary=----TestBoundary',
        'idempotency-key': 'route-error-contract-payment-not-found',
      },
      payload: body,
    })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ error: 'NOT_FOUND' })
  })
})
