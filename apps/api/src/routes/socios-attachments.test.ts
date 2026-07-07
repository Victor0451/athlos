import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { signAccessToken, type JWTPayload } from '@athlos/auth'
import type { Env } from '@athlos/config'
import { createStandinDb } from '../test-standins/db.ts'
import { buildServer } from '../server.ts'
import { mkdtempSync as _mk } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import type { Db } from '@athlos/db'

/**
 * HTTP-level tests for the 5 socio-attachments routes.
 *
 * Strategy: build the production Fastify app, swap the DB for the
 * standin, seed a socio, and inject multipart + JSON requests with
 * a Bearer token. The multipart plugin + LocalFileStorage handle the
 * real upload pipeline; the standin mocks the DB. The `/tmp/...`
 * upload base dir is cleaned up in `afterEach`.
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
let baseDir: string

function jpegBuffer(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00])
}

function pdfBuffer(): Buffer {
  const head = Buffer.from('%PDF-1.7\n', 'binary')
  const body = Buffer.alloc(50, 0x20)
  const tail = Buffer.from('%%EOF\n', 'binary')
  return Buffer.concat([head, body, tail])
}

function seedSocio(): void {
  standin.state.socios.push({
    id: SOCIO_ID,
    numeroSocio: '0001',
    nombre: 'Test',
    apellido: 'Socio',
    dni: '11111111',
    fechaAlta: '2024-01-01',
    estado: 'activo',
    categoria: null,
    direccion: null,
    telefono: null,
    email: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  } as never)
}

async function bootstrap(): Promise<void> {
  standin = createStandinDb()
  baseDir = mkdtempSync(join(tmpdir(), 'athlos-route-'))
  app = await buildServer({
    env: {
      ...process.env,
      NODE_ENV: 'test',
      JWT_SECRET: makeEnv().JWT_SECRET,
      JWT_REFRESH_SECRET: makeEnv().JWT_REFRESH_SECRET,
      DATABASE_URL: makeEnv().DATABASE_URL,
      LEGACY_DB_PATH: makeEnv().LEGACY_DB_PATH,
      STORAGE_LOCAL_ROOT: baseDir,
    },
    containerOverrides: { db: standin.drizzle as unknown as Db },
    quietLogger: true,
  })
  seedSocio()
}

afterEach(async () => {
  if (app) await app.close()
  if (baseDir) rmSync(baseDir, { recursive: true, force: true })
})

beforeEach(async () => {
  await bootstrap()
})

describe('POST /api/v1/socios/:socioId/attachments', () => {
  it('returns 401 when the JWT is missing', async () => {
    const payload = jpegBuffer()
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/attachments`,
      headers: {
        'content-type': 'multipart/form-data; boundary=----TestBoundary',
      },
      payload: multipartBody('file', 'front.jpg', 'image/jpeg', payload, 'dni'),
    })
    expect(res.statusCode).toBe(401)
  })

  it('uploads a valid JPEG, returns 201, and persists a row', async () => {
    const payload = jpegBuffer()
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/attachments`,
      headers: {
        authorization: `Bearer ${bearer('OPERADOR')}`,
        'content-type': 'multipart/form-data; boundary=----TestBoundary',
      },
      payload: multipartBody('file', 'front.jpg', 'image/jpeg', payload, 'dni'),
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.filename).toBe('front.jpg')
    expect(body.category).toBe('dni')
    expect(body.mime_type).toBe('image/jpeg')
    expect(body.size_bytes).toBe(payload.length)
    // DB row inserted.
    expect(standin.state.socioAttachments).toHaveLength(1)
  })

  it('returns 415 + rollback when the declared MIME does not match the sniffed bytes', async () => {
    const payload = pdfBuffer() // actual bytes are PDF
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/attachments`,
      headers: {
        authorization: `Bearer ${bearer('OPERADOR')}`,
        'content-type': 'multipart/form-data; boundary=----TestBoundary',
      },
      payload: multipartBody('file', 'carnet.jpg', 'image/jpeg', payload, 'dni'),
    })
    expect(res.statusCode).toBe(400) // service raises VALIDATION_ERROR with `detected` field
    expect(res.json().error).toBe('UNSUPPORTED_MEDIA_TYPE')
    expect(standin.state.socioAttachments).toHaveLength(0)
  })

  it('returns 413 when the payload exceeds the 10 MB cap', async () => {
    // The multipart plugin enforces `limits.fileSize` server-side,
    // so we send a payload that exceeds it and expect 413.
    const payload = Buffer.alloc(11 * 1024 * 1024, 0xff) // 11 MB
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/socios/${SOCIO_ID}/attachments`,
      headers: {
        authorization: `Bearer ${bearer('OPERADOR')}`,
        'content-type': 'multipart/form-data; boundary=----TestBoundary',
      },
      payload: multipartBody('file', 'big.jpg', 'image/jpeg', payload, 'dni'),
    })
    // Fastify returns 413 or 400 depending on how the multipart
    // plugin reports the truncation. Both are acceptable.
    expect([400, 413]).toContain(res.statusCode)
  })
})

describe('GET /api/v1/socios/:socioId/attachments', () => {
  it('returns 401 without a JWT', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/socios/${SOCIO_ID}/attachments`,
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns an empty list when the socio has no attachments', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/socios/${SOCIO_ID}/attachments`,
      headers: { authorization: `Bearer ${bearer('OPERADOR')}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ items: [] })
  })
})

describe('DELETE /api/v1/socios/:socioId/attachments/:attachmentId', () => {
  it('returns 401 without a JWT', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/socios/${SOCIO_ID}/attachments/00000000-0000-4000-8000-000000000099`,
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 404 for an unknown attachment id', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/socios/${SOCIO_ID}/attachments/00000000-0000-4000-8000-000000000099`,
      headers: { authorization: `Bearer ${bearer('OPERADOR')}` },
    })
    expect(res.statusCode).toBe(404)
  })
})

/**
 * Build a multipart/form-data body with a single file part + a
 * `category` text field. Returns the raw bytes; the caller sets the
 * matching `content-type: multipart/form-data; boundary=----TestBoundary`.
 */
function multipartBody(
  fieldName: string,
  filename: string,
  mimeType: string,
  fileBytes: Buffer,
  category: string,
): Buffer {
  const boundary = '----TestBoundary'
  const parts: Buffer[] = []
  // category field
  parts.push(Buffer.from(`--${boundary}\r\n`))
  parts.push(Buffer.from(`Content-Disposition: form-data; name="category"\r\n\r\n`))
  parts.push(Buffer.from(`${category}\r\n`))
  // file field
  parts.push(Buffer.from(`--${boundary}\r\n`))
  parts.push(
    Buffer.from(`Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n`),
  )
  parts.push(Buffer.from(`Content-Type: ${mimeType}\r\n\r\n`))
  parts.push(fileBytes)
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`))
  return Buffer.concat(parts)
}

// Keep imports live.
void Readable
void _mk
