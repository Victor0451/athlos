import { describe, it, expect, beforeEach } from 'vitest'
import { signAccessToken, type JWTPayload } from '@athlos/auth'
import type { Env } from '@athlos/config'
import { createStandinDb } from '../../test-standins/db.ts'
import { buildServer } from '../../server.ts'
import type { FastifyInstance } from 'fastify'
import type { Db } from '@athlos/db'

/**
 * HTTP-level tests for /api/v1/admin/jobs/* (PR 6b TASK-050).
 *
 * Pins the contracts:
 *   - Non-admin → 403
 *   - GET /jobs/runs without filters returns every job_runs row
 *   - Filter by `status=failed` returns only failed rows
 *   - Filter by `job` returns only that job's rows
 *   - GET /jobs/health returns one entry per registered job
 *   - The shape matches the DTO contract (camelCase, ISO timestamps)
 *
 * Uses the in-memory standin so the suite stays in-process.
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
    STORAGE_LOCAL_ROOT: '/app/storage',
    STORAGE_MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,
  } as Env
}

function bearer(role: JWTPayload['role'], sub = '00000000-0000-4000-8000-000000000001'): string {
  const env = makeEnv()
  return signAccessToken({ sub, role, permissions: { can_reprint: true, can_anulate: true } }, env)
}

interface Harness {
  app: FastifyInstance
}

async function bootstrap(): Promise<Harness> {
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
  return { app }
}

beforeEach(() => {
  // Each test rebuilds via bootstrap() — no shared state.
})

describe('GET /api/v1/admin/jobs/runs', () => {
  it('returns 403 for a non-admin operator', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/jobs/runs',
        headers: { authorization: `Bearer ${bearer('TESORERO')}` },
      })
      expect(res.statusCode).toBe(403)
      expect(res.json()).toMatchObject({ error: 'INSUFFICIENT_PERMISSIONS' })
    } finally {
      await app.close()
    }
  })

  it('returns an empty list when no runs exist', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/jobs/runs',
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ items: [] })
    } finally {
      await app.close()
    }
  })

  it('returns the DTO shape (camelCase + ISO timestamps)', async () => {
    const { app } = await bootstrap()
    try {
      // Use the scheduler's runNow path to create a real run.
      const { jobRunId } = await app.scheduler.runNow('token-cleanup', { note: 'smoke' })
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/jobs/runs',
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as { items: Array<Record<string, unknown>> }
      expect(body.items.length).toBeGreaterThanOrEqual(1)
      const row = body.items[0]!
      expect(row).toMatchObject({
        id: expect.any(String),
        jobName: expect.any(String),
        status: expect.stringMatching(/pending|running|succeeded|failed|dead_letter/),
        attempt: expect.any(Number),
        triggeredBy: 'manual',
        scheduledAt: expect.any(String),
      })
      expect(row['id']).toBe(jobRunId)
    } finally {
      await app.close()
    }
  })

  it('filter by status=failed returns only failed runs', async () => {
    const { app } = await bootstrap()
    try {
      // Drive a failed run via the scheduler — register a handler
      // that throws, run it, wait for the recordFinish.
      const failingHandler = async (): Promise<{ status: 'succeeded' }> => {
        throw new Error('boom')
      }
      app.scheduler.schedule('failing-job', '0 0 31 2 *', failingHandler)
      const { jobRunId } = await app.scheduler.runNow('failing-job')
      // Wait for the in-flight handler to finish.
      await new Promise((resolve) => setImmediate(resolve))
      await new Promise((resolve) => setImmediate(resolve))
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/jobs/runs?status=failed',
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as { items: Array<Record<string, unknown>> }
      const ourRow = body.items.find((r) => r['id'] === jobRunId)
      expect(ourRow).toBeDefined()
      expect(ourRow?.['status']).toBe('failed')
      expect(ourRow?.['reason']).toEqual({
        code: 'EXECUTION_FAILED',
        message: 'The job failed during execution.',
      })
    } finally {
      await app.close()
    }
  })

  it('returns a projected failure without raw error or metadata', async () => {
    const { app } = await bootstrap()
    try {
      app.scheduler.schedule('safe-failure', '0 0 31 2 *', async () => {
        throw new Error('postgres://operator:secret@db')
      })
      const { jobRunId } = await app.scheduler.runNow('safe-failure')
      await new Promise((resolve) => setImmediate(resolve))
      await new Promise((resolve) => setImmediate(resolve))
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/jobs/runs?status=failed',
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
      })

      expect(res.statusCode).toBe(200)
      const row = (res.json() as { items: Array<Record<string, unknown>> }).items.find(
        (item) => item['id'] === jobRunId,
      )
      expect(row).toMatchObject({
        status: 'failed',
        reason: { code: 'EXECUTION_FAILED', message: 'The job failed during execution.' },
      })
      expect(JSON.stringify(row)).not.toContain('postgres://operator:secret@db')
      expect(row).not.toHaveProperty('metadata')
      expect(row).not.toHaveProperty('errorMessage')
    } finally {
      await app.close()
    }
  })

  it('filter by job=token-cleanup returns only that job', async () => {
    const { app } = await bootstrap()
    try {
      await app.scheduler.runNow('token-cleanup', {})
      await new Promise((resolve) => setImmediate(resolve))
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/jobs/runs?job=token-cleanup',
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
      })
      const body = res.json() as { items: Array<Record<string, unknown>> }
      for (const item of body.items) {
        expect(item['jobName']).toBe('token-cleanup')
      }
    } finally {
      await app.close()
    }
  })
})

describe('GET /api/v1/admin/jobs/health', () => {
  it('returns 403 for a non-admin operator', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/jobs/health',
        headers: { authorization: `Bearer ${bearer('TESORERO')}` },
      })
      expect(res.statusCode).toBe(403)
    } finally {
      await app.close()
    }
  })

  it('returns one entry per registered job', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/jobs/health',
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as { items: Array<Record<string, unknown>> }
      // PR 6a registered 5 default jobs (drift-detection,
      // freshness-refresh, token-cleanup, scheduled-import,
      // reconciliation). The list may grow as PRs add more.
      const names = body.items.map((i) => i['name']).sort()
      expect(names).toContain('token-cleanup')
      expect(names).toContain('drift-detection')
      // The shape is stable: every item has these keys.
      for (const item of body.items) {
        expect(item).toMatchObject({
          name: expect.any(String),
          enabled: expect.any(Boolean),
          healthy: expect.any(Boolean),
        })
      }
    } finally {
      await app.close()
    }
  })
})
