import { describe, it, expect } from 'vitest'
import { signAccessToken, type JWTPayload } from '@athlos/auth'
import type { Env } from '@athlos/config'
import { createStandinDb } from '../../test-standins/db.ts'
import { buildServer } from '../../server.ts'
import type { FastifyInstance } from 'fastify'
import type { Db } from '@athlos/db'
import type { Operator } from '@athlos/db/schema'

/**
 * HTTP-level tests for /api/v1/admin/operators.
 *
 * Pins the contracts:
 *   - Non-admin cannot access (403)
 *   - ADMIN can list / create / update / soft-delete / unlock
 *   - Duplicate username returns 409
 *   - Login history returns the audit_events-shaped list
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
  } as Env
}

function makeOperator(overrides: Partial<Operator> = {}): Operator {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    username: 'admin-test',
    passwordHash: '$2b$12$placeholderplaceholderplaceholderplaceholder',
    role: 'A',
    canReprint: true,
    canAnulate: true,
    isActive: true,
    lastLoginAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

function bearer(role: JWTPayload['role'], sub = '00000000-0000-4000-8000-000000000001'): string {
  const env = makeEnv()
  return signAccessToken(
    {
      sub,
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

describe('GET /api/v1/admin/operators', () => {
  it('returns 403 for a non-admin operator', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operators',
        headers: { authorization: `Bearer ${bearer('TESORERO')}` },
      })
      expect(res.statusCode).toBe(403)
      expect(res.json()).toMatchObject({ error: 'INSUFFICIENT_PERMISSIONS' })
    } finally {
      await app.close()
    }
  })

  it('returns 401 without an Authorization header', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({ method: 'GET', url: '/api/v1/admin/operators' })
      expect(res.statusCode).toBe(401)
    } finally {
      await app.close()
    }
  })

  it('lists operators for an ADMIN', async () => {
    const { app, standin } = await bootstrap()
    try {
      standin.state.operators.push(makeOperator({ id: 'op-1', username: 'admin1' }))
      standin.state.operators.push(makeOperator({ id: 'op-2', username: 'tesorero1', role: 'T' }))
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/operators',
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as {
        items: Array<Record<string, unknown>>
        next_cursor: string | null
      }
      expect(body.items).toHaveLength(2)
      // The DTO MUST NOT leak the password hash.
      for (const item of body.items) {
        expect(item['password_hash']).toBeUndefined()
        expect(item['passwordHash']).toBeUndefined()
      }
    } finally {
      await app.close()
    }
  })
})

describe('POST /api/v1/admin/operators', () => {
  it('creates a new operator', async () => {
    const { app, standin } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/operators',
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
        payload: { username: 'new.op', password: 'long-enough-password', role: 'OPERADOR' },
      })
      expect(res.statusCode).toBe(201)
      const body = res.json() as Record<string, unknown>
      expect(body['username']).toBe('new.op')
      expect(body['role']).toBe('OPERADOR')
      // The response MUST NOT leak the password hash.
      expect(body['password_hash']).toBeUndefined()
      expect(body['passwordHash']).toBeUndefined()
      expect(standin.state.operators).toHaveLength(1)
    } finally {
      await app.close()
    }
  })

  it('returns 409 for a duplicate username', async () => {
    const { app, standin } = await bootstrap()
    try {
      standin.state.operators.push(makeOperator({ username: 'taken' }))
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/operators',
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
        payload: { username: 'taken', password: 'long-enough-password', role: 'OPERADOR' },
      })
      expect(res.statusCode).toBe(409)
      expect(res.json()).toMatchObject({ error: 'CONFLICT' })
    } finally {
      await app.close()
    }
  })

  it('returns 400 for an invalid role', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/operators',
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
        payload: { username: 'new.op', password: 'long-enough-password', role: 'SUPERUSER' },
      })
      expect(res.statusCode).toBe(400)
    } finally {
      await app.close()
    }
  })
})

describe('PUT /api/v1/admin/operators/:id', () => {
  it('updates an operator', async () => {
    const { app, standin } = await bootstrap()
    try {
      const id = '00000000-0000-4000-8000-000000000010'
      standin.state.operators.push(makeOperator({ id, username: 'old', role: 'O' }))
      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/admin/operators/${id}`,
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
        payload: { role: 'TESORERO', can_anulate: false },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as Record<string, unknown>
      expect(body['role']).toBe('TESORERO')
      expect(standin.state.operators[0]?.role).toBe('T')
      expect(standin.state.operators[0]?.canAnulate).toBe(false)
    } finally {
      await app.close()
    }
  })

  it('returns 404 for an unknown id', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/operators/00000000-0000-4000-8000-000000000099',
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
        payload: { role: 'TESORERO' },
      })
      expect(res.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  })
})

describe('DELETE /api/v1/admin/operators/:id', () => {
  it('soft-deletes (is_active = false)', async () => {
    const { app, standin } = await bootstrap()
    try {
      const id = '00000000-0000-4000-8000-000000000010'
      standin.state.operators.push(makeOperator({ id, isActive: true }))
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/operators/${id}`,
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
      })
      expect(res.statusCode).toBe(204)
      expect(standin.state.operators[0]?.isActive).toBe(false)
    } finally {
      await app.close()
    }
  })

  it('returns 404 for an unknown id', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/admin/operators/00000000-0000-4000-8000-000000000099',
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
      })
      expect(res.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  })
})

describe('POST /api/v1/admin/operators/:id/unlock', () => {
  it('resets the lockout counters', async () => {
    const { app, standin } = await bootstrap()
    try {
      const id = '00000000-0000-4000-8000-000000000010'
      const future = new Date(Date.now() + 60_000)
      standin.state.operators.push(
        makeOperator({ id, failedLoginAttempts: 5, lockedUntil: future }),
      )
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/operators/${id}/unlock`,
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ message: 'Operator unlocked' })
      const updated = standin.state.operators[0]
      expect(updated?.failedLoginAttempts).toBe(0)
      expect(updated?.lockedUntil).toBeNull()
    } finally {
      await app.close()
    }
  })
})

describe('GET /api/v1/admin/operators/:id/login-history', () => {
  it('returns an empty list (audit writer not yet wired)', async () => {
    const { app, standin } = await bootstrap()
    try {
      const id = '00000000-0000-4000-8000-000000000010'
      standin.state.operators.push(makeOperator({ id }))
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/operators/${id}/login-history`,
        headers: { authorization: `Bearer ${bearer('ADMIN')}` },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as { items: Array<unknown>; next_cursor: string | null }
      expect(body.items).toEqual([])
      expect(body.next_cursor).toBeNull()
    } finally {
      await app.close()
    }
  })
})
