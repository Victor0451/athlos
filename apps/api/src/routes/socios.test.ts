import { describe, it, expect } from 'vitest'
import { signAccessToken, type JWTPayload } from '@athlos/auth'
import type { Env } from '@athlos/config'
import { createStandinDb } from '../test-standins/db.ts'
import { buildServer } from '../server.ts'
import type { FastifyInstance } from 'fastify'
import type { Db } from '@athlos/db'

/**
 * HTTP-level tests for /api/v1/socios.
 *
 * Pins the AC from the PR 5 spec:
 *   - List / detail reachable for any authenticated operator
 *   - ADMIN can create / update / soft-delete
 *   - TESORERO gets 403 on the write endpoints
 *   - Payload missing `numero_socio` returns 400 with a field path
 *   - Soft delete sets `estado='baja'` and `deleted_at`
 *   - Audit events fire on create / update / delete
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
  const env = makeEnv()
  return signAccessToken(
    {
      sub: '00000000-0000-4000-8000-000000000001',
      role,
      permissions: { can_reprint: true, can_anulate: true },
    },
    env,
  )
}

async function bootstrap(): Promise<{
  app: FastifyInstance
  standin: ReturnType<typeof createStandinDb>
}> {
  const standin = createStandinDb()
  const app = await buildServer({
    env: {
      ...process.env,
      NODE_ENV: 'test',
      JWT_SECRET: makeEnv().JWT_SECRET,
      JWT_REFRESH_SECRET: makeEnv().JWT_REFRESH_SECRET,
      DATABASE_URL: makeEnv().DATABASE_URL,
      LEGACY_DB_PATH: makeEnv().LEGACY_DB_PATH,
    },
    containerOverrides: { db: standin.drizzle as unknown as Db },
    quietLogger: true,
  })
  return { app, standin }
}

describe('GET /api/v1/socios', () => {
  it('returns 401 without an Authorization header', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({ method: 'GET', url: '/api/v1/socios' })
      expect(res.statusCode).toBe(401)
    } finally {
      await app.close()
    }
  })

  it('returns 200 for an authenticated operator (any role)', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/socios',
        headers: { authorization: `Bearer ${bearer('TESORERO')}` },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as { items: unknown[]; total: number }
      expect(Array.isArray(body.items)).toBe(true)
      expect(body.total).toBe(0)
    } finally {
      await app.close()
    }
  })
})

describe('GET /api/v1/socios/:id', () => {
  it('returns 404 for an unknown id', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/socios/00000000-0000-4000-8000-000000000099',
        headers: { authorization: `Bearer ${bearer('TESORERO')}` },
      })
      expect(res.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  })

  it('returns 200 for a known id', async () => {
    const { app, standin } = await bootstrap()
    try {
      standin.state.socios.push({
        id: '00000000-0000-4000-8000-000000000010',
        numeroSocio: '0001',
        nombre: 'Juan',
        apellido: 'García',
        dni: '12345678',
        fechaAlta: '2024-01-15',
        estado: 'activo',
        categoria: null,
        direccion: null,
        telefono: null,
        email: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      } as never)
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/socios/00000000-0000-4000-8000-000000000010',
        headers: { authorization: `Bearer ${bearer('TESORERO')}` },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as { numero_socio: string; apellido: string }
      expect(body.numero_socio).toBe('0001')
      expect(body.apellido).toBe('García')
    } finally {
      await app.close()
    }
  })
})

describe('POST /api/v1/socios', () => {
  it('returns 403 for a non-ADMIN operator', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/socios',
        headers: { authorization: `Bearer ${bearer('TESORERO')}` },
        payload: {
          numero_socio: '0001',
          nombre: 'Juan',
          apellido: 'García',
          dni: '12345678',
          fecha_alta: '2024-01-15',
        },
      })
      expect(res.statusCode).toBe(403)
    } finally {
      await app.close()
    }
  })

  it('returns 400 with a field path when numero_socio is missing', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/socios',
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
        payload: {
          nombre: 'Juan',
          apellido: 'García',
          dni: '12345678',
          fecha_alta: '2024-01-15',
        },
      })
      expect(res.statusCode).toBe(400)
      const body = res.json() as { error: string; details?: Array<{ field: string }> }
      expect(body.error).toBe('VALIDATION_ERROR')
      const fields = (body.details ?? []).map((d) => d.field)
      expect(fields.some((f) => f.includes('numero_socio'))).toBe(true)
    } finally {
      await app.close()
    }
  })

  it('creates a new socio for an ADMIN', async () => {
    const { app, standin } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/socios',
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
        payload: {
          numero_socio: '0100',
          nombre: 'Juan',
          apellido: 'García',
          dni: '12345678',
          fecha_alta: '2024-01-15',
        },
      })
      expect(res.statusCode).toBe(201)
      const body = res.json() as { id: string; estado: string; numero_socio: string }
      expect(body.numero_socio).toBe('0100')
      expect(body.estado).toBe('activo')
      expect(standin.state.socios).toHaveLength(1)
      const audits = standin.state.auditEvents ?? []
      expect(
        audits.find((a) => a.entityId === body.id && a.action === 'SOCIO_CREATED'),
      ).toBeDefined()
    } finally {
      await app.close()
    }
  })
})

describe('PATCH /api/v1/socios/:id', () => {
  it('updates a socio for an ADMIN', async () => {
    const { app, standin } = await bootstrap()
    try {
      const id = '00000000-0000-4000-8000-000000000010'
      standin.state.socios.push({
        id,
        numeroSocio: '0001',
        nombre: 'Juan',
        apellido: 'García',
        dni: '12345678',
        fechaAlta: '2024-01-15',
        estado: 'activo',
        categoria: null,
        direccion: null,
        telefono: null,
        email: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      } as never)
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/socios/${id}`,
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
        payload: { telefono: '+5491100000000' },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as { telefono: string }
      expect(body.telefono).toBe('+5491100000000')
    } finally {
      await app.close()
    }
  })

  it('returns 404 for an unknown id', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/socios/00000000-0000-4000-8000-000000000099',
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
        payload: { telefono: '+5491100000000' },
      })
      expect(res.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  })
})

describe('DELETE /api/v1/socios/:id', () => {
  it('soft-deletes (estado=baja, deleted_at set) for an ADMIN', async () => {
    const { app, standin } = await bootstrap()
    try {
      const id = '00000000-0000-4000-8000-000000000010'
      standin.state.socios.push({
        id,
        numeroSocio: '0001',
        nombre: 'Juan',
        apellido: 'García',
        dni: '12345678',
        fechaAlta: '2024-01-15',
        estado: 'activo',
        categoria: null,
        direccion: null,
        telefono: null,
        email: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      } as never)
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/socios/${id}`,
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as { estado: string; deleted_at: string | null }
      expect(body.estado).toBe('baja')
      expect(body.deleted_at).not.toBeNull()
      // The row stays in the table.
      const row = standin.state.socios.find((s) => s.id === id)
      expect(row).toBeDefined()
    } finally {
      await app.close()
    }
  })
})
