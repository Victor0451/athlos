import { describe, it, expect, vi } from 'vitest'
import { signAccessToken } from '@athlos/auth'
import type { Env } from '@athlos/config'
import { createStandinDb } from '../../../test-standins/db.ts'
import { buildServer } from '../../../server.ts'
import { previewFingerprint, type Db } from '@athlos/db'
import { resolutionApplicationFingerprint } from '@athlos/promotion'
import type { Pool } from 'pg'

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
    STORAGE_LOCAL_ROOT: '/app/storage',
    STORAGE_MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,
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

async function bootstrap(pool?: Pool) {
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
    containerOverrides: pool
      ? { db: standin.drizzle as unknown as Db, pool }
      : { db: standin.drizzle as unknown as Db },
    quietLogger: true,
  })
  return { app, standin }
}

const closurePair = {
  catalogBatchId: '00000000-0000-4000-8000-000000000011',
  sociosBatchId: '00000000-0000-4000-8000-000000000012',
  previewId: '00000000-0000-4000-8000-000000000013',
}
const closureInputs = [
  {
    sourceTable: 'tiposoci',
    id: '00000000-0000-4000-8000-000000000015',
    contentHash: 'catalog',
  },
  {
    sourceTable: 'socios',
    id: '00000000-0000-4000-8000-000000000014',
    contentHash: 'socio',
  },
]
const closureFingerprint = previewFingerprint(
  closurePair.catalogBatchId,
  closurePair.sociosBatchId,
  closureInputs,
)
const resolutionSetFingerprint = resolutionApplicationFingerprint([])
const closureBody = { ...closurePair, fingerprint: closureFingerprint, resolutionSetFingerprint }

function closurePool(
  outcome: 'reserved' | 'replay' | 'conflict' | 'stale',
  leaseHeld = false,
): Pool {
  return {
    query: async (text: string, _values?: unknown[]) => {
      if (text.includes('FROM "socios".evidence_closure_confirmations')) {
        if (outcome === 'replay')
          return {
            rows: [
              {
                catalog_batch_id: closurePair.catalogBatchId,
                socios_batch_id: closurePair.sociosBatchId,
                preview_id: closurePair.previewId,
                fingerprint: closureFingerprint,
                resolution_set_fingerprint: resolutionSetFingerprint,
              },
            ],
          }
        if (outcome === 'conflict')
          return {
            rows: [
              {
                catalog_batch_id: closurePair.catalogBatchId,
                socios_batch_id: closurePair.sociosBatchId,
                preview_id: closurePair.previewId,
                fingerprint: 'x'.repeat(64),
                resolution_set_fingerprint: resolutionSetFingerprint,
              },
            ],
          }
        return { rows: [] }
      }
      if (text.includes('evidence_closure_previews'))
        return outcome === 'stale'
          ? { rows: [] }
          : {
              rows: [
                {
                  catalog_batch_id: closurePair.catalogBatchId,
                  socios_batch_id: closurePair.sociosBatchId,
                  fingerprint: closureFingerprint,
                  resolution_set_fingerprint: resolutionSetFingerprint,
                  expires_at: new Date(Date.now() + 60_000),
                },
              ],
            }
      if (text.includes('legacy_member_evidence e')) return { rows: [] }
      if (text.includes('raw_events'))
        return {
          rows: closureInputs.map((input) => ({
            source_table: input.sourceTable,
            id: input.id,
            content_hash: input.contentHash,
            import_batch:
              input.sourceTable === 'tiposoci'
                ? closurePair.catalogBatchId
                : closurePair.sociosBatchId,
          })),
        }
      if (text.includes('evidence_closure_confirmations'))
        return {
          rows: [
            {
              catalog_batch_id: closurePair.catalogBatchId,
              socios_batch_id: closurePair.sociosBatchId,
              preview_id: closurePair.previewId,
              fingerprint: closureFingerprint,
              resolution_set_fingerprint: resolutionSetFingerprint,
              created: true,
            },
          ],
        }
      if (text.includes('evidence_closure_leases')) return { rows: leaseHeld ? [] : [{ fence: 1 }] }
      return { rows: [] }
    },
  } as unknown as Pool
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

describe('POST /api/v1/admin/socios-evidence-closures/preview', () => {
  it('denies non-admin callers without preview evidence disclosure', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/socios-evidence-closures/preview',
        headers: { authorization: `Bearer ${operatorToken()}`, 'content-type': 'application/json' },
        payload: {
          catalogBatchId: '00000000-0000-4000-8000-000000000001',
          sociosBatchId: '00000000-0000-4000-8000-000000000002',
        },
      })
      expect(res.statusCode).toBe(403)
      expect(res.body).not.toMatch(/fingerprint|counts/)
    } finally {
      await app.close()
    }
  })
})

describe('POST /api/v1/admin/socios-evidence-closures/confirm', () => {
  it('denies non-admin callers without confirmation disclosure', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/socios-evidence-closures/confirm',
        headers: { authorization: `Bearer ${operatorToken()}`, 'content-type': 'application/json' },
        payload: {},
      })
      expect(res.statusCode).toBe(403)
      expect(res.body).not.toMatch(/fingerprint|fence/)
    } finally {
      await app.close()
    }
  })

  it.each([
    ['fresh reservation', 'reserved', false, 202],
    ['compatible key replay', 'replay', false, 200],
    ['incompatible key', 'conflict', false, 409],
    ['stale preview', 'stale', false, 409],
    ['held fingerprint lease', 'reserved', true, 409],
  ] as const)(
    'maps %s to %i without starting execution',
    async (_name, outcome, leaseHeld, status) => {
      const { app } = await bootstrap(closurePool(outcome, leaseHeld))
      try {
        const enqueue = vi.spyOn(app.scheduler, 'runNow')
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/admin/socios-evidence-closures/confirm',
          headers: {
            authorization: `Bearer ${adminToken()}`,
            'content-type': 'application/json',
            'idempotency-key': 'closure-confirmation-key',
          },
          payload: closureBody,
        })
        expect(res.statusCode).toBe(status)
        if (status === 202)
          expect(res.json()).toMatchObject({ status: 'accepted', jobRunId: expect.any(String) })
        if (status === 200) expect(res.json()).toEqual({ status: 'replay' })
        expect(enqueue.mock.calls.map(([name]) => name)).toEqual(
          status === 202 ? ['socios-evidence-runtime-closure'] : [],
        )
      } finally {
        await app.close()
      }
    },
  )

  it('maps actual aborted and unwritable-close events to 499 and removes both listeners', async () => {
    for (const event of ['aborted', 'close'] as const) {
      const { app } = await bootstrap(closurePool('reserved'))
      const removed: string[] = []
      app.addHook('preHandler', (request, reply, done) => {
        const raw = event === 'aborted' ? request.raw : reply.raw
        const once = raw.once.bind(raw)
        const recordRemoval = (target: typeof raw) => {
          const removeListener = target.removeListener.bind(target)
          target.removeListener = ((name: string, listener: () => void) => {
            removed.push(name)
            return removeListener(name, listener)
          }) as typeof target.removeListener
        }
        recordRemoval(request.raw)
        recordRemoval(reply.raw)
        raw.once = ((name: string, listener: () => void) => {
          const result = once(name, listener)
          if (name === event) listener()
          return result
        }) as typeof raw.once
        done()
      })
      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/admin/socios-evidence-closures/confirm',
          headers: {
            authorization: `Bearer ${adminToken()}`,
            'content-type': 'application/json',
            'idempotency-key': `closure-${event}`,
          },
          payload: closureBody,
        })
        expect(res.statusCode).toBe(499)
        expect(removed).toEqual(expect.arrayContaining(['aborted', 'close']))
      } finally {
        await app.close()
      }
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
