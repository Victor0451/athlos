import { describe, it, expect } from 'vitest'
import { buildServer } from '../server.ts'
import type { Pool } from 'pg'
import { createStandinDb } from '../test-standins/db.ts'

/**
 * HTTP-level tests for the health endpoints (TASK-034).
 *
 * The standin DB returns empty rows from `SELECT 1`, so /health/ready
 * returns 200 here. In production the standin is replaced by a
 * real pg.Pool — readiness probes run a real query.
 */

const baseEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test/test',
  JWT_SECRET: 'test-secret-please-rotate-32chars-minimum',
  JWT_REFRESH_SECRET: 'test-secret-please-rotate-32chars-minimum',
  LEGACY_DB_PATH: '/tmp/athlos-test-legacy',
  CORS_ORIGINS: 'http://localhost:3000',
  LOG_LEVEL: 'info',
}

/**
 * Standin pg.Pool that resolves `SELECT 1` with a single row. Used
 * by the /health/ready and /api/versions tests so the route doesn't
 * hang on a real Postgres connection.
 */
function makeStubPool(): Pool {
  return {
    query: async (sql: string) => {
      const trimmed = String(sql).trim().toLowerCase()
      if (trimmed.startsWith('select 1')) {
        return { rows: [{ '?column?': 1 }], rowCount: 1 }
      }
      // Migration count / last — return an empty result. The
      // versions route catches the empty case and uses a fallback.
      return { rows: [], rowCount: 0 }
    },
    end: async () => undefined,
    on: () => undefined,
    once: () => undefined,
    emit: () => true,
  } as unknown as Pool
}

async function buildWithStubPool(): Promise<ReturnType<typeof buildServer>> {
  const standin = createStandinDb()
  return buildServer({
    env: baseEnv,
    // The standin is only typed for the Drizzle surface; the pool
    // is a separate type. We cast through `unknown` to keep the
    // test from re-declaring the full container type.
    containerOverrides: {
      db: standin.drizzle as never,
      pool: makeStubPool(),
    },
    quietLogger: true,
  })
}

describe('GET /health', () => {
  it('returns 200 with the liveness shape', async () => {
    const app = await buildWithStubPool()
    try {
      const res = await app.inject({ method: 'GET', url: '/health' })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.status).toBe('ok')
      expect(typeof body.version).toBe('string')
      expect(typeof body.uptime).toBe('number')
      expect(typeof body.timestamp).toBe('string')
    } finally {
      await app.close()
    }
  })

  it('does not require auth', async () => {
    const app = await buildWithStubPool()
    try {
      const res = await app.inject({ method: 'GET', url: '/health' })
      expect(res.statusCode).toBe(200)
    } finally {
      await app.close()
    }
  })
})

describe('GET /health/ready', () => {
  it('returns 200 with the readiness shape (stub DB)', async () => {
    const app = await buildWithStubPool()
    try {
      const res = await app.inject({ method: 'GET', url: '/health/ready' })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.status).toBe('ok')
      expect(body.db).toBe('ok')
      expect(typeof body.latency_ms).toBe('number')
    } finally {
      await app.close()
    }
  })
})

describe('GET /health/startup', () => {
  it('returns 200 once the server is ready', async () => {
    const app = await buildWithStubPool()
    try {
      const res = await app.inject({ method: 'GET', url: '/health/startup' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ status: 'ok' })
    } finally {
      await app.close()
    }
  })
})
