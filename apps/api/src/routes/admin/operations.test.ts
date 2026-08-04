import { describe, expect, it } from 'vitest'
import { signAccessToken } from '@athlos/auth'
import type { Env } from '@athlos/config'
import { buildServer } from '../../server.ts'
import { createStandinDb } from '../../test-standins/db.ts'
import type { Pool } from 'pg'
import { buildOperationalSnapshot } from '../../services/operational-snapshot.ts'

const env = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test/test',
  JWT_SECRET: 'test-secret-please-rotate-32chars-minimum',
  JWT_REFRESH_SECRET: 'test-secret-please-rotate-32chars-minimum',
  JWT_ACCESS_TTL_SECONDS: 900,
  JWT_REFRESH_TTL_SECONDS: 604800,
  LEGACY_DB_PATH: '/tmp/athlos-test-legacy',
  CORS_ORIGINS: 'http://localhost:3000',
  LOG_LEVEL: 'fatal',
} as Env

function token(role: 'ADMIN' | 'OPERADOR') {
  return signAccessToken(
    {
      sub: '00000000-0000-4000-8000-000000000001',
      role,
      permissions: { can_reprint: false, can_anulate: false },
    },
    env,
  )
}

async function bootstrap() {
  const standin = createStandinDb()
  const pool = {
    query: async (sql: string) =>
      sql.startsWith('SELECT to_regclass')
        ? {
            rows: [
              { operators: 'operators', refresh_tokens: 'refresh_tokens', job_runs: 'job_runs' },
            ],
          }
        : { rows: [{ '?column?': 1 }] },
  } as unknown as Pool
  return buildServer({
    env: env as unknown as NodeJS.ProcessEnv,
    containerOverrides: {
      db: standin.drizzle as never,
      pool,
      freshnessService: {
        getFreshness: async () => [],
        refreshAll: async () => [],
      },
    },
    quietLogger: true,
  })
}

describe('GET /api/v1/admin/operations/snapshot', () => {
  it('isolates unavailable signals while preserving canonical freshness and ten attention rows', async () => {
    const snapshot = await buildOperationalSnapshot({
      readReadiness: async () => ({ db: 'ok' as const, schema: 'down' as const }),
      readFreshness: async () => [
        {
          domain: 'socios',
          lastImportAt: null,
          recordCount: 0,
          status: 'unknown' as const,
          ageDisplay: 'Unknown',
        },
      ],
      readJobs: async () => Promise.reject(new Error('scheduler failure with token=secret')),
      readAttention: async () => Array.from({ length: 11 }, (_, id) => ({ id, safe: true })),
    })

    expect(snapshot.readiness).toEqual({
      overall: 'unavailable',
      db: 'ready',
      schema: 'unavailable',
    })
    expect(snapshot.freshness).toEqual({
      available: true,
      items: [
        {
          domain: 'socios',
          lastImportAt: null,
          recordCount: 0,
          status: 'unknown',
          ageDisplay: 'Unknown',
        },
      ],
    })
    expect(snapshot.jobs).toEqual({ available: false, items: [] })
    expect(snapshot.attention.items).toHaveLength(10)
    expect(JSON.stringify(snapshot)).not.toContain('token=secret')
  })

  it('returns an ADMIN-only bounded snapshot with canonical freshness envelopes', async () => {
    const app = await bootstrap()
    try {
      app.scheduler.schedule('runtime-observability-job', null, async () => ({
        status: 'succeeded',
      }))
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/snapshot',
        headers: { authorization: `Bearer ${token('ADMIN')}` },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.readiness).toEqual({ overall: 'ready', db: 'ready', schema: 'ready' })
      expect(body.freshness).toEqual({ available: true, items: [] })
      expect(body.jobs.available).toBe(true)
      expect(body.jobs.items.map((job: { name: string }) => job.name)).toContain(
        'runtime-observability-job',
      )
      expect(body.attention).toEqual({ available: true, items: [] })
      expect(body.attention.items).toHaveLength(0)
    } finally {
      await app.close()
    }
  })

  it('denies OPERADOR without disclosing operational signals', async () => {
    const app = await bootstrap()
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operations/snapshot',
        headers: { authorization: `Bearer ${token('OPERADOR')}` },
      })

      expect(response.statusCode).toBe(403)
      expect(response.body).not.toMatch(/readiness|freshness|attention|runtime-observability-job/)
    } finally {
      await app.close()
    }
  })
})
