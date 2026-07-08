import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signAccessToken, type JWTPayload } from '@athlos/auth'
import type { Env } from '@athlos/config'
import { createStandinDb } from '../test-standins/db.ts'
import { buildServer } from '../server.ts'
import { createPdfGenerator, type PdfGenerator } from '../modules/socios/forms/pdf-generator.ts'
import type { FastifyInstance } from 'fastify'
import type { Db } from '@athlos/db'

/**
 * HTTP-level tests for the `solicitud-inscripcion` route.
 *
 *   GET /api/v1/socios/:socioId/forms/solicitud-inscripcion.pdf
 *
 * Uses the standin DB (no real pg / chromium) + a stub PDF generator
 * that returns a fixed buffer so the assertions don't depend on
 * puppeteer actually rendering anything.
 *
 * Locks the wire contract per api-design delta:
 *   - 200 + `Content-Type: application/pdf` + valid PDF body
 *   - `Content-Disposition: inline; filename="..."` (exact quoted shape)
 *   - 401 missing JWT
 *   - 404 unknown socioId (no audit emitted)
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

function bearer(role: JWTPayload['role']): string {
  return signAccessToken(
    {
      sub: '00000000-0000-4000-8000-000000000001',
      role,
      permissions: { can_reprint: true, can_anulate: true },
    },
    makeEnv(),
  )
}

const SOCIO_ID = '11111111-1111-4111-8111-111111111111'

let app: FastifyInstance
let standin: ReturnType<typeof createStandinDb>
let pdfGenerator: PdfGenerator
let pdfGeneratorInitSpy: ReturnType<typeof vi.fn>

function stubPdfGenerator(): PdfGenerator {
  pdfGeneratorInitSpy = vi.fn(async () => undefined)
  const fixedPdf = Buffer.from('%PDF-1.7 stub for tests\n%%EOF\n')
  const stub: PdfGenerator = {
    init: pdfGeneratorInitSpy,
    generate: vi.fn(async () => fixedPdf),
    close: vi.fn(async () => undefined),
  }
  return stub
}

function seedSocio(apellido: string, numeroSocio: string): void {
  standin.state.socios.push({
    id: SOCIO_ID,
    numeroSocio,
    nombre: 'Test',
    apellido,
    dni: '11111111',
    fechaAlta: '2024-01-01',
    estado: 'activo',
    categoria: null,
    direccion: 'Av. Forestal 1234',
    telefono: '3885123456',
    email: 'test@example.com',
    fechaNacimiento: '1985-05-15',
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
  vi.restoreAllMocks()
})

beforeEach(async () => {
  await bootstrap()
})

describe('GET /api/v1/socios/:socioId/forms/solicitud-inscripcion.pdf', () => {
  it('returns 401 when the JWT is missing', async () => {
    seedSocio('Pérez', '12345')
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/socios/${SOCIO_ID}/forms/solicitud-inscripcion.pdf`,
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 200 with application/pdf + valid PDF body when the JWT is valid', async () => {
    seedSocio('Pérez', '12345')
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/socios/${SOCIO_ID}/forms/solicitud-inscripcion.pdf`,
      headers: { authorization: `Bearer ${bearer('OPERADOR')}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('application/pdf')
    const body = res.rawPayload
    expect(body.subarray(0, 5).toString('utf8')).toBe('%PDF-')
    expect(body.toString('utf8').trimEnd().endsWith('%%EOF')).toBe(true)
  })

  it('emits the sanitized filename in Content-Disposition with quoted shape', async () => {
    seedSocio("O'Brien", '9999')
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/socios/${SOCIO_ID}/forms/solicitud-inscripcion.pdf`,
      headers: { authorization: `Bearer ${bearer('OPERADOR')}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-disposition']).toBe(
      'inline; filename="solicitud-inscripcion-socio-9999-O_BRIEN.pdf"',
    )
  })

  it('returns 404 when the socio does not exist (no audit emitted)', async () => {
    // No socio seeded.
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/socios/${SOCIO_ID}/forms/solicitud-inscripcion.pdf`,
      headers: { authorization: `Bearer ${bearer('OPERADOR')}` },
    })
    expect(res.statusCode).toBe(404)
    expect(standin.state.auditEvents).toHaveLength(0)
    // PDF generator was NOT called.
    expect(pdfGenerator.generate).not.toHaveBeenCalled()
  })

  it('emits SOCIO_FORM_EMITTED audit on success', async () => {
    seedSocio('Pérez', '12345')
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/socios/${SOCIO_ID}/forms/solicitud-inscripcion.pdf`,
      headers: { authorization: `Bearer ${bearer('OPERADOR')}` },
    })
    expect(res.statusCode).toBe(200)
    expect(standin.state.auditEvents).toHaveLength(1)
    const row = standin.state.auditEvents[0]!
    expect(row.action).toBe('SOCIO_FORM_EMITTED')
    expect(row.entityType).toBe('socio')
    expect(row.entityId).toBe(SOCIO_ID)
  })

  it('escapes dangerous characters in the filename before header insertion', async () => {
    // Seed a socio with a malformed apellido to prove the escape
    // function neutralises injection vectors. The sanitizer
    // (`sanitizeApellido`) already strips CR/LF/quote, but the route
    // adds a second defence-in-depth pass.
    seedSocio('Safe', '12345')
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/socios/${SOCIO_ID}/forms/solicitud-inscripcion.pdf`,
      headers: { authorization: `Bearer ${bearer('OPERADOR')}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-disposition']).toContain('inline; filename="')
    expect(res.headers['content-disposition']).toContain('"')
    // No raw CR/LF inside the disposition value.
    expect(res.headers['content-disposition']).not.toMatch(/[\r\n]/)
  })
})

// Suppress unused import warnings (typescript-eslint).
void createPdfGenerator
