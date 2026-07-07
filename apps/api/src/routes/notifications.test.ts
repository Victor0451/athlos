import { describe, it, expect } from 'vitest'
import { signAccessToken, type JWTPayload } from '@athlos/auth'
import type { Env } from '@athlos/config'
import { createStandinDb } from '../test-standins/db.ts'
import { buildServer } from '../server.ts'
import type { FastifyInstance } from 'fastify'
import type { Db } from '@athlos/db'
import type { Notification } from '@athlos/db/schema'

/**
 * HTTP-level tests for the in-app notifications routes (PR bell-N1).
 *
 * Pins the contracts:
 *   - All three routes require auth (401 without a bearer).
 *   - GET / returns the caller's notifications, paginated, filterable.
 *   - GET /unread-count excludes 'read' rows and counts only the
 *     caller's own notifications.
 *   - PATCH /:id/read marks a single row as read, returns 200
 *     (idempotent), 404 when the id is unknown or owned by another
 *     operator.
 *
 * Test data is seeded directly into the standin's `notifications`
 * array (see `apps/api/src/test-standins/db.ts`); the standin's
 * filter parser handles `eq` + `or(eq, eq, eq)` (the "unread"
 * filter) and a single `and(eq, ...)` chain.
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

const OPERATOR_A = '00000000-0000-4000-8000-00000000000a'
const OPERATOR_B = '00000000-0000-4000-8000-00000000000b'

function bearer(sub: string, role: JWTPayload['role'] = 'ADMIN'): string {
  return signAccessToken(
    { sub, role, permissions: { can_reprint: true, can_anulate: true } },
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

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    channel: 'in_app',
    recipientId: OPERATOR_A,
    recipientAddress: null,
    subject: null,
    body: 'hello',
    metadata: {},
    eventId: null,
    status: 'sent',
    readAt: null,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  } as Notification
}

describe('GET /api/v1/notifications', () => {
  it('returns 401 without a bearer token', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({ method: 'GET', url: '/api/v1/notifications' })
      expect(res.statusCode).toBe(401)
    } finally {
      await app.close()
    }
  })

  it("returns the caller's notifications with default filter (all)", async () => {
    const { app, standin } = await bootstrap()
    try {
      standin.state.notifications.push(
        makeNotification({ id: '00000000-0000-4000-8000-000000000001', status: 'sent' }),
        makeNotification({ id: '00000000-0000-4000-8000-000000000002', status: 'read' }),
        // another operator's row — must be excluded
        makeNotification({
          id: '00000000-0000-4000-8000-000000000003',
          recipientId: OPERATOR_B,
          status: 'sent',
        }),
      )

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications',
        headers: { authorization: `Bearer ${bearer(OPERATOR_A)}` },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as {
        items: Array<{ id: string; status: string }>
        total: number
        page: number
        limit: number
        has_more: boolean
      }
      expect(body.total).toBe(2)
      expect(body.items.map((i) => i.id).sort()).toEqual([
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
      ])
      expect(body.page).toBe(1)
      expect(body.limit).toBe(20)
      expect(body.has_more).toBe(false)
    } finally {
      await app.close()
    }
  })

  it('filters by status=unread (excludes read rows)', async () => {
    const { app, standin } = await bootstrap()
    try {
      standin.state.notifications.push(
        makeNotification({ id: '00000000-0000-4000-8000-000000000001', status: 'sent' }),
        makeNotification({ id: '00000000-0000-4000-8000-000000000002', status: 'read' }),
        makeNotification({ id: '00000000-0000-4000-8000-000000000003', status: 'pending' }),
        makeNotification({ id: '00000000-0000-4000-8000-000000000004', status: 'failed' }),
      )

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications?status=unread',
        headers: { authorization: `Bearer ${bearer(OPERATOR_A)}` },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as { items: Array<{ id: string }>; total: number }
      expect(body.total).toBe(3)
      const ids = body.items.map((i) => i.id).sort()
      expect(ids).toEqual([
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000003',
        '00000000-0000-4000-8000-000000000004',
      ])
    } finally {
      await app.close()
    }
  })

  it('filters by status=read (only read rows)', async () => {
    const { app, standin } = await bootstrap()
    try {
      standin.state.notifications.push(
        makeNotification({ id: '00000000-0000-4000-8000-000000000001', status: 'sent' }),
        makeNotification({ id: '00000000-0000-4000-8000-000000000002', status: 'read' }),
      )

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications?status=read',
        headers: { authorization: `Bearer ${bearer(OPERATOR_A)}` },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as { items: Array<{ id: string }>; total: number }
      expect(body.total).toBe(1)
      expect(body.items[0]?.id).toBe('00000000-0000-4000-8000-000000000002')
    } finally {
      await app.close()
    }
  })

  it('honors page + limit query params', async () => {
    const { app, standin } = await bootstrap()
    try {
      // 5 notifications for operator A
      for (let i = 1; i <= 5; i++) {
        standin.state.notifications.push(
          makeNotification({
            id: `00000000-0000-4000-8000-00000000000${i}`,
            status: 'sent',
          }),
        )
      }

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications?page=2&limit=2',
        headers: { authorization: `Bearer ${bearer(OPERATOR_A)}` },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as {
        items: unknown[]
        total: number
        page: number
        limit: number
        has_more: boolean
      }
      expect(body.total).toBe(5)
      expect(body.page).toBe(2)
      expect(body.limit).toBe(2)
      expect(body.items.length).toBe(2)
      expect(body.has_more).toBe(true)
    } finally {
      await app.close()
    }
  })

  it('rejects an invalid status value with 400', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications?status=bogus',
        headers: { authorization: `Bearer ${bearer(OPERATOR_A)}` },
      })
      expect(res.statusCode).toBe(400)
    } finally {
      await app.close()
    }
  })
})

describe('GET /api/v1/notifications/unread-count', () => {
  it('returns 401 without a bearer token', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications/unread-count',
      })
      expect(res.statusCode).toBe(401)
    } finally {
      await app.close()
    }
  })

  it("counts only unread rows for the caller (excludes 'read')", async () => {
    const { app, standin } = await bootstrap()
    try {
      standin.state.notifications.push(
        makeNotification({ id: '00000000-0000-4000-8000-000000000001', status: 'sent' }),
        makeNotification({ id: '00000000-0000-4000-8000-000000000002', status: 'pending' }),
        makeNotification({ id: '00000000-0000-4000-8000-000000000003', status: 'failed' }),
        makeNotification({ id: '00000000-0000-4000-8000-000000000004', status: 'read' }),
      )

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications/unread-count',
        headers: { authorization: `Bearer ${bearer(OPERATOR_A)}` },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ count: 3 })
    } finally {
      await app.close()
    }
  })

  it("only counts the caller's own notifications", async () => {
    const { app, standin } = await bootstrap()
    try {
      // 2 unread for A, 1 read for A
      standin.state.notifications.push(
        makeNotification({ id: '00000000-0000-4000-8000-000000000001', status: 'sent' }),
        makeNotification({ id: '00000000-0000-4000-8000-000000000002', status: 'sent' }),
        makeNotification({ id: '00000000-0000-4000-8000-000000000003', status: 'read' }),
        // B's notifications — must NOT be counted for A
        makeNotification({
          id: '00000000-0000-4000-8000-000000000010',
          recipientId: OPERATOR_B,
          status: 'sent',
        }),
        makeNotification({
          id: '00000000-0000-4000-8000-000000000011',
          recipientId: OPERATOR_B,
          status: 'pending',
        }),
      )

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications/unread-count',
        headers: { authorization: `Bearer ${bearer(OPERATOR_A)}` },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ count: 2 })
    } finally {
      await app.close()
    }
  })

  it('returns 0 when the caller has no notifications', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications/unread-count',
        headers: { authorization: `Bearer ${bearer(OPERATOR_A)}` },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ count: 0 })
    } finally {
      await app.close()
    }
  })
})

describe('PATCH /api/v1/notifications/:id/read', () => {
  it('returns 401 without a bearer token', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/notifications/00000000-0000-4000-8000-000000000001/read',
      })
      expect(res.statusCode).toBe(401)
    } finally {
      await app.close()
    }
  })

  it('marks a single notification as read and returns 200', async () => {
    const { app, standin } = await bootstrap()
    try {
      standin.state.notifications.push(
        makeNotification({ id: '00000000-0000-4000-8000-000000000001', status: 'sent' }),
      )

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/notifications/00000000-0000-4000-8000-000000000001/read',
        headers: { authorization: `Bearer ${bearer(OPERATOR_A)}` },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as { id: string; status: string; read_at: string | null }
      expect(body.status).toBe('read')
      expect(body.read_at).toBeTruthy()
      // The standin mutated the in-memory row
      expect(standin.state.notifications[0]?.status).toBe('read')
      expect(standin.state.notifications[0]?.readAt).toBeInstanceOf(Date)
    } finally {
      await app.close()
    }
  })

  it('returns 404 for an unknown notification id', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/notifications/00000000-0000-4000-8000-000000000999/read',
        headers: { authorization: `Bearer ${bearer(OPERATOR_A)}` },
      })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toMatchObject({ error: 'NOT_FOUND' })
    } finally {
      await app.close()
    }
  })

  it('returns 404 when the notification is owned by another operator', async () => {
    const { app, standin } = await bootstrap()
    try {
      standin.state.notifications.push(
        makeNotification({
          id: '00000000-0000-4000-8000-000000000001',
          recipientId: OPERATOR_B,
          status: 'sent',
        }),
      )

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/notifications/00000000-0000-4000-8000-000000000001/read',
        headers: { authorization: `Bearer ${bearer(OPERATOR_A)}` },
      })
      expect(res.statusCode).toBe(404)
      // B's row was NOT mutated
      expect(standin.state.notifications[0]?.status).toBe('sent')
    } finally {
      await app.close()
    }
  })

  it('is idempotent — marking an already-read row returns 200', async () => {
    const { app, standin } = await bootstrap()
    try {
      const readAt = new Date('2024-06-01T00:00:00.000Z')
      standin.state.notifications.push(
        makeNotification({
          id: '00000000-0000-4000-8000-000000000001',
          status: 'read',
          readAt,
        }),
      )

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/notifications/00000000-0000-4000-8000-000000000001/read',
        headers: { authorization: `Bearer ${bearer(OPERATOR_A)}` },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as { status: string }
      expect(body.status).toBe('read')
    } finally {
      await app.close()
    }
  })

  it('rejects a non-UUID id with 400', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/notifications/not-a-uuid/read',
        headers: { authorization: `Bearer ${bearer(OPERATOR_A)}` },
      })
      expect(res.statusCode).toBe(400)
    } finally {
      await app.close()
    }
  })
})
