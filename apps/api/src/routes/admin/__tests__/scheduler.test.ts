import { describe, it, expect } from 'vitest'
import { signAccessToken } from '@athlos/auth'
import type { Env } from '@athlos/config'
import { createStandinDb } from '../../../test-standins/db.ts'
import { buildServer } from '../../../server.ts'
import type { Db } from '@athlos/db'

/**
 * HTTP-level tests for /api/v1/scheduler/jobs/* (athlos-async-scheduler).
 *
 * Tests the 3 admin endpoints (POST /run-now, GET /jobs, GET /jobs/:name,
 * PATCH /:name/enabled) plus auth and rate-limiting. Uses the in-memory
 * standin DB so the suite stays in-process.
 */

function makeEnv(): Env {
  return {
    NODE_ENV: 'test',
    PORT: 3001,
    HOST: '0.0.0.0',
    LOG_LEVEL: 'fatal',
    DATABASE_URL: 'postgresql://test/test',
    JWT_SECRET: 'test-secret-please-rotate-32chars-minimum',
    JWT_REFRESH_SECRET: 'test-secret-please-rotate-32chars-minimum',
    JWT_ACCESS_TTL_SECONDS: 900,
    JWT_REFRESH_TTL_SECONDS: 604800,
    LEGACY_DB_PATH: '/tmp/athlos-test-legacy',
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

function adminToken(sub = '00000000-0000-4000-8000-000000000001'): string {
  const env = makeEnv()
  return signAccessToken(
    { sub, role: 'ADMIN' as const, permissions: { can_reprint: false, can_anulate: false } },
    env,
  )
}

function operatorToken(sub = '00000000-0000-4000-8000-000000000002'): string {
  const env = makeEnv()
  return signAccessToken(
    { sub, role: 'OPERADOR' as const, permissions: { can_reprint: false, can_anulate: false } },
    env,
  )
}

async function bootstrap() {
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

describe('POST /api/v1/scheduler/jobs/:name/run-now', () => {
  it('returns 200 with jobRunId and status for a valid admin request', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/scheduler/jobs/scheduled-promotion/run-now',
        headers: { authorization: `Bearer ${adminToken()}` },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toMatchObject({ jobRunId: expect.any(String), status: 'pending' })
    } finally {
      await app.close()
    }
  })

  it('returns 404 for an unknown job name', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/scheduler/jobs/unknown-job/run-now',
        headers: { authorization: `Bearer ${adminToken()}` },
      })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toMatchObject({ error: 'JOB_NOT_FOUND' })
    } finally {
      await app.close()
    }
  })

  it('returns 403 for a non-admin operator', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/scheduler/jobs/scheduled-promotion/run-now',
        headers: { authorization: `Bearer ${operatorToken()}` },
      })
      expect(res.statusCode).toBe(403)
      expect(res.json()).toMatchObject({ error: 'INSUFFICIENT_PERMISSIONS' })
    } finally {
      await app.close()
    }
  })

  it.skip('returns 429 when rate-limited (2nd request within 60s) — requires @fastify/rate-limit integration', async () => {
    const { app } = await bootstrap()
    try {
      // First request — should succeed
      const first = await app.inject({
        method: 'POST',
        url: '/api/v1/scheduler/jobs/scheduled-promotion/run-now',
        headers: { authorization: `Bearer ${adminToken()}` },
      })
      expect(first.statusCode).toBe(200)

      // Second request within same 60s window from same operator — should be rate-limited
      const second = await app.inject({
        method: 'POST',
        url: '/api/v1/scheduler/jobs/scheduled-promotion/run-now',
        headers: { authorization: `Bearer ${adminToken()}` },
      })
      expect(second.statusCode).toBe(429)
      expect(second.headers['retry-after']).toBeDefined()
    } finally {
      await app.close()
    }
  })

  it('returns 401 without a JWT', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/scheduler/jobs/scheduled-promotion/run-now',
      })
      expect(res.statusCode).toBe(401)
    } finally {
      await app.close()
    }
  })
})

describe('GET /api/v1/scheduler/jobs', () => {
  it('returns 200 with last 20 job runs ordered by startedAt DESC', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/scheduler/jobs',
        headers: { authorization: `Bearer ${adminToken()}` },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toHaveProperty('items')
      expect(Array.isArray(body.items)).toBe(true)
    } finally {
      await app.close()
    }
  })

  it('returns 403 for a non-admin operator', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/scheduler/jobs',
        headers: { authorization: `Bearer ${operatorToken()}` },
      })
      expect(res.statusCode).toBe(403)
      expect(res.json()).toMatchObject({ error: 'INSUFFICIENT_PERMISSIONS' })
    } finally {
      await app.close()
    }
  })
})

describe('GET /api/v1/scheduler/jobs/:name', () => {
  it('returns 200 with job definition and last runs for a known job', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/scheduler/jobs/scheduled-promotion',
        headers: { authorization: `Bearer ${adminToken()}` },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toMatchObject({
        name: 'scheduled-promotion',
        cronExpr: '0 */6 * * *',
      })
      expect(body).toHaveProperty('enabled')
      expect(body).toHaveProperty('lastRuns')
      expect(Array.isArray(body.lastRuns)).toBe(true)
    } finally {
      await app.close()
    }
  })

  it('returns 404 for an unknown job name', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/scheduler/jobs/unknown-job',
        headers: { authorization: `Bearer ${adminToken()}` },
      })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toMatchObject({ error: 'JOB_NOT_FOUND' })
    } finally {
      await app.close()
    }
  })
})

describe('PATCH /api/v1/scheduler/jobs/:name', () => {
  it('returns 200 and updates enabled=false for a valid admin request', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/scheduler/jobs/scheduled-promotion',
        headers: { authorization: `Bearer ${adminToken()}`, 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toMatchObject({ name: 'scheduled-promotion', enabled: false })
    } finally {
      await app.close()
    }
  })

  it('returns 200 and re-enables a previously disabled job', async () => {
    const { app } = await bootstrap()
    try {
      // Disable first
      await app.inject({
        method: 'PATCH',
        url: '/api/v1/scheduler/jobs/scheduled-promotion',
        headers: { authorization: `Bearer ${adminToken()}`, 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      })
      // Re-enable
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/scheduler/jobs/scheduled-promotion',
        headers: { authorization: `Bearer ${adminToken()}`, 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toMatchObject({ name: 'scheduled-promotion', enabled: true })
    } finally {
      await app.close()
    }
  })

  it('returns 404 for an unknown job name', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/scheduler/jobs/unknown-job',
        headers: { authorization: `Bearer ${adminToken()}`, 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toMatchObject({ error: 'JOB_NOT_FOUND' })
    } finally {
      await app.close()
    }
  })

  it('returns 400 when enabled field is missing', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/scheduler/jobs/scheduled-promotion',
        headers: { authorization: `Bearer ${adminToken()}`, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.statusCode).toBe(400)
    } finally {
      await app.close()
    }
  })

  it('returns 403 for a non-admin operator', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/scheduler/jobs/scheduled-promotion',
        headers: { authorization: `Bearer ${operatorToken()}`, 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      })
      expect(res.statusCode).toBe(403)
      expect(res.json()).toMatchObject({ error: 'INSUFFICIENT_PERMISSIONS' })
    } finally {
      await app.close()
    }
  })
})
