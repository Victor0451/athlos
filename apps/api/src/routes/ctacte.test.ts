import { describe, it, expect } from 'vitest'
import { signAccessToken, type JWTPayload } from '@athlos/auth'
import type { Env } from '@athlos/config'
import { createStandinDb } from '../test-standins/db.ts'
import { buildServer } from '../server.ts'
import type { FastifyInstance } from 'fastify'
import type { Db } from '@athlos/db'

/**
 * HTTP-level tests for /api/v1/socios/:id/cuenta-corriente.
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

const SOCIO_ID = '00000000-0000-4000-8000-000000000010'

describe('GET /api/v1/socios/:id/cuenta-corriente', () => {
  it('returns saldo + movimientos for a known socio with 100 movements', async () => {
    const { app, standin } = await bootstrap()
    try {
      // Seed 100 movements; the AC says page 1 returns 50.
      for (let i = 0; i < 100; i += 1) {
        standin.state.ctacte.push({
          id: `m-${i}`,
          socioId: SOCIO_ID,
          fecha: `2024-${String((i % 12) + 1).padStart(2, '0')}-15`,
          tipo: i % 2 === 0 ? 'DEBITO' : 'CREDITO',
          concepto: `mov ${i}`,
          debe: i % 2 === 0 ? '10.00' : '0.00',
          haber: i % 2 === 0 ? '0.00' : '5.00',
          anulado: false,
          anuladoAt: null,
          anuladoMotivo: null,
          createdAt: new Date(),
        } as never)
      }
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/socios/${SOCIO_ID}/cuenta-corriente?limit=50`,
        headers: { authorization: `Bearer ${bearer('TESORERO')}` },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as {
        saldo: string
        saldo_calculado_at: string
        movimientos: Array<unknown>
        total: number
        has_more: boolean
      }
      // 50 debits of 10 - 50 credits of 5 = 500 - 250 = 250
      expect(body.saldo).toBe('250.00')
      expect(body.saldo_calculado_at).toMatch(/T.*Z$/)
      expect(body.movimientos).toHaveLength(50)
      expect(body.total).toBe(100)
      expect(body.has_more).toBe(true)
    } finally {
      await app.close()
    }
  })

  it('returns 401 without an Authorization header', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/socios/${SOCIO_ID}/cuenta-corriente`,
      })
      expect(res.statusCode).toBe(401)
    } finally {
      await app.close()
    }
  })
})

describe('GET /api/v1/socios/:id/cuenta-corriente/movimientos', () => {
  it('returns the page of movements', async () => {
    const { app, standin } = await bootstrap()
    try {
      for (let i = 0; i < 3; i += 1) {
        standin.state.ctacte.push({
          id: `m-${i}`,
          socioId: SOCIO_ID,
          fecha: `2024-0${i + 1}-15`,
          tipo: 'DEBITO',
          concepto: 'cuota',
          debe: '10.00',
          haber: '0.00',
          anulado: false,
          anuladoAt: null,
          anuladoMotivo: null,
          createdAt: new Date(),
        } as never)
      }
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/socios/${SOCIO_ID}/cuenta-corriente/movimientos?limit=2`,
        headers: { authorization: `Bearer ${bearer('TESORERO')}` },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as { items: unknown[]; total: number; has_more: boolean }
      expect(body.items).toHaveLength(2)
      expect(body.total).toBe(3)
      expect(body.has_more).toBe(true)
    } finally {
      await app.close()
    }
  })
})
