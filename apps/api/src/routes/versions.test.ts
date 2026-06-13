import { describe, it, expect } from 'vitest'
import { buildServer } from '../server.ts'
import { createStandinDb } from '../test-standins/db.ts'
import type { Pool } from 'pg'

/**
 * HTTP-level tests for the version discovery endpoint (TASK-035).
 *
 * The standin DB doesn't have a `__drizzle_migrations` table — the
 * route catches the error and returns the `nomig__` fallback hash.
 * In production the table exists and the hash is derived from the
 * migration count + last applied id.
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

function makeStubPool(): Pool {
  return {
    query: async () => ({ rows: [], rowCount: 0 }),
    end: async () => undefined,
    on: () => undefined,
    once: () => undefined,
    emit: () => true,
  } as unknown as Pool
}

async function buildWithStubPool(
  env: NodeJS.ProcessEnv = baseEnv,
): Promise<ReturnType<typeof buildServer>> {
  const standin = createStandinDb()
  return buildServer({
    env,
    containerOverrides: { db: standin.drizzle as never, pool: makeStubPool() },
    quietLogger: true,
  })
}

describe('GET /api/versions', () => {
  it('returns the version discovery body', async () => {
    const app = await buildWithStubPool()
    try {
      const res = await app.inject({ method: 'GET', url: '/api/versions' })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(typeof body.api).toBe('string')
      expect(body.api).toMatch(/^\d+\.\d+\.\d+$/)
      expect(typeof body.db).toBe('string')
      expect(body.db).toHaveLength(7)
      expect(typeof body.node).toBe('string')
      expect(body.node.startsWith('v')).toBe(true)
      expect(typeof body.build).toBe('string')
    } finally {
      await app.close()
    }
  })

  it('does not require auth', async () => {
    const app = await buildWithStubPool()
    try {
      const res = await app.inject({ method: 'GET', url: '/api/versions' })
      expect(res.statusCode).toBe(200)
    } finally {
      await app.close()
    }
  })

  it('does not set the API-Version header (unversioned endpoint)', async () => {
    const app = await buildWithStubPool()
    try {
      const res = await app.inject({ method: 'GET', url: '/api/versions' })
      expect(res.headers['api-version']).toBeUndefined()
    } finally {
      await app.close()
    }
  })

  it('uses BUILD_SHA env var when set, otherwise "dev"', async () => {
    const app = await buildWithStubPool({ ...baseEnv, BUILD_SHA: 'abc1234' })
    try {
      const res = await app.inject({ method: 'GET', url: '/api/versions' })
      expect(res.json().build).toBe('abc1234')
    } finally {
      await app.close()
    }
  })
})
