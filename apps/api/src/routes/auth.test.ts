import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { hashPassword, signAccessToken, type JWTPayload } from '@athlos/auth'
import type { Env } from '@athlos/config'
import { createStandinDb } from '../test-standins/db.ts'
import { generateRefreshToken, hashRefreshToken } from '../services/auth.ts'
import type { Db } from '@athlos/db'
import type { Operator } from '@athlos/db/schema'
import type { PermissionsRepo } from '@athlos/db/repositories/permissions'
import { buildServer } from '../server.ts'
import type { FastifyInstance } from 'fastify'

/**
 * HTTP-level tests for the auth routes.
 *
 * Uses buildServer with the standin DB override so the tests run in-
 * process without Testcontainers. Each test gets a fresh standin so
 * the suites are isolated.
 */

/**
 * Placeholder env — the DI container's `buildContainerEnv` substitutes
 * these in NODE_ENV=test, so we mirror those values here. Tests that
 * need a real secret should override `JWT_SECRET` on both the env
 * passed to `buildServer` and to `signAccessToken`.
 */
const PLACEHOLDER_JWT_SECRET = 'test-secret-please-rotate-32chars-minimum'
const PLACEHOLDER_REFRESH_SECRET = 'test-secret-please-rotate-32chars-minimum'

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: 'test',
    PORT: 3001,
    HOST: '0.0.0.0',
    LOG_LEVEL: 'info',
    DATABASE_URL: 'postgresql://test/test',
    JWT_SECRET: PLACEHOLDER_JWT_SECRET,
    JWT_REFRESH_SECRET: PLACEHOLDER_REFRESH_SECRET,
    JWT_ACCESS_TTL_SECONDS: 900,
    JWT_REFRESH_TTL_SECONDS: 604800,
    LEGACY_DB_PATH: '/tmp/legacy',
    CORS_ORIGINS: 'http://localhost:3000',
    FROM_ADDRESS: 'noreply@gorriti.app',
    ...overrides,
  } as Env
}

function makeOperator(overrides: Partial<Operator> = {}): Operator {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    username: 'op-test',
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

function bearer(payload: JWTPayload, env: Env): string {
  return signAccessToken(
    { sub: payload.sub, role: payload.role, permissions: payload.permissions },
    env,
  )
}

async function bootstrap(dataSteward = false): Promise<{
  app: FastifyInstance
  standin: ReturnType<typeof createStandinDb>
  env: Env
}> {
  const standin = createStandinDb()
  const env = makeEnv()
  const permissionsRepo: PermissionsRepo = {
    hasPermission: async () => dataSteward,
    grant: async () => undefined,
    revoke: async () => undefined,
    listOperatorsWithPermission: async () => [],
  }
  const app = await buildServer({
    env: {
      ...process.env,
      NODE_ENV: 'test',
      JWT_SECRET: env.JWT_SECRET,
      JWT_REFRESH_SECRET: env.JWT_REFRESH_SECRET,
      DATABASE_URL: env.DATABASE_URL,
      LEGACY_DB_PATH: env.LEGACY_DB_PATH,
    },
    containerOverrides: {
      db: standin.drizzle as unknown as Db,
      permissionsRepo,
    },
    quietLogger: true,
  })
  app.container.db = standin.drizzle as unknown as Db
  return { app, standin, env }
}

describe('POST /api/v1/auth/refresh', () => {
  it('issues a new pair for a valid refresh token', async () => {
    const { app, standin, env } = await bootstrap()
    try {
      const op = makeOperator()
      standin.state.operators.push(op)
      const { raw, hash } = generateRefreshToken()
      standin.state.refreshTokens.push({
        id: randomBytes(8).toString('hex'),
        operatorId: op.id,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
        createdAt: new Date(),
      })

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refresh_token: raw },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as { access_token: string; refresh_token: string; expires_in: number }
      expect(body.access_token).toBeTruthy()
      expect(body.refresh_token).toMatch(/^[0-9a-f]{64}$/)
      expect(body.expires_in).toBe(env.JWT_ACCESS_TTL_SECONDS)
    } finally {
      await app.close()
    }
  })

  it('returns 401 for a revoked token', async () => {
    const { app, standin } = await bootstrap()
    try {
      const op = makeOperator()
      standin.state.operators.push(op)
      const { raw, hash } = generateRefreshToken()
      standin.state.refreshTokens.push({
        id: 'rt-1',
        operatorId: op.id,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: new Date(),
        createdAt: new Date(),
      })

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refresh_token: raw },
      })
      expect(res.statusCode).toBe(401)
      expect(res.json()).toMatchObject({ error: 'TOKEN_INVALID' })
    } finally {
      await app.close()
    }
  })

  it('returns 400 for a missing refresh_token', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: {},
      })
      expect(res.statusCode).toBe(400)
    } finally {
      await app.close()
    }
  })
})

describe('POST /api/v1/auth/logout', () => {
  it('sets revoked_at and returns 200', async () => {
    const { app, standin, env } = await bootstrap()
    try {
      const op = makeOperator()
      standin.state.operators.push(op)
      const { raw, hash } = generateRefreshToken()
      standin.state.refreshTokens.push({
        id: 'rt-1',
        operatorId: op.id,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
        createdAt: new Date(),
      })

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        payload: { refresh_token: raw },
        headers: {
          authorization: `Bearer ${bearer(
            { sub: op.id, role: 'ADMIN', permissions: { can_reprint: true, can_anulate: true } },
            env,
          )}`,
        },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ message: 'Logged out' })
      expect(standin.state.refreshTokens[0]?.revokedAt).toBeInstanceOf(Date)
    } finally {
      await app.close()
    }
  })

  it('returns 401 without a bearer token (PR 4b route-audit gate)', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        payload: { refresh_token: 'x' },
      })
      expect(res.statusCode).toBe(401)
    } finally {
      await app.close()
    }
  })
})

describe('GET /api/v1/auth/me', () => {
  it('returns the operator DTO for a valid token', async () => {
    const { app, standin, env } = await bootstrap()
    try {
      const op = makeOperator()
      standin.state.operators.push(op)
      const token = bearer(
        { sub: op.id, role: 'ADMIN', permissions: { can_reprint: true, can_anulate: true } },
        env,
      )
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${token}` },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as Record<string, unknown>
      expect(body['id']).toBe(op.id)
      expect(body['username']).toBe('op-test')
      expect(body['role']).toBe('ADMIN')
      // The DTO MUST NOT leak the password hash under any key shape.
      expect(body['password_hash']).toBeUndefined()
      expect(body['passwordHash']).toBeUndefined()
    } finally {
      await app.close()
    }
  })

  it('returns 401 without an Authorization header', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' })
      expect(res.statusCode).toBe(401)
    } finally {
      await app.close()
    }
  })

  it('returns 401 for an invalid Bearer token', async () => {
    const { app } = await bootstrap()
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: 'Bearer not-a-jwt' },
      })
      expect(res.statusCode).toBe(401)
    } finally {
      await app.close()
    }
  })
})

describe('GET /api/v1/auth/me/permissions', () => {
  it('returns the live data_steward grant for an authenticated operator', async () => {
    const { app, standin, env } = await bootstrap(true)
    try {
      const op = makeOperator({ role: 'O' })
      standin.state.operators.push(op)
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me/permissions',
        headers: {
          authorization: `Bearer ${bearer(
            { sub: op.id, role: 'OPERADOR', permissions: { can_reprint: true, can_anulate: true } },
            env,
          )}`,
        },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ data_steward: true })
    } finally {
      await app.close()
    }
  })

  it('does not infer data_steward from the ADMIN role', async () => {
    const { app, standin, env } = await bootstrap(false)
    try {
      const op = makeOperator({ role: 'A' })
      standin.state.operators.push(op)
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me/permissions',
        headers: {
          authorization: `Bearer ${bearer(
            { sub: op.id, role: 'ADMIN', permissions: { can_reprint: true, can_anulate: true } },
            env,
          )}`,
        },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ data_steward: false })
    } finally {
      await app.close()
    }
  })
})

describe('POST /api/v1/auth/change-password', () => {
  it('updates the hash when current is correct', async () => {
    const { app, standin, env } = await bootstrap()
    try {
      const originalHash = await hashPassword('correct-current')
      const op = makeOperator({ passwordHash: originalHash })
      standin.state.operators.push(op)
      const token = bearer(
        { sub: op.id, role: 'ADMIN', permissions: { can_reprint: true, can_anulate: true } },
        env,
      )
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/change-password',
        headers: { authorization: `Bearer ${token}` },
        payload: { current_password: 'correct-current', new_password: 'brand-new-password' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ message: 'Password changed' })
      // Hash should be different from the original (saved before the call).
      expect(standin.state.operators[0]?.passwordHash).not.toBe(originalHash)
    } finally {
      await app.close()
    }
  })

  it('returns 401 for wrong current password', async () => {
    const { app, standin, env } = await bootstrap()
    try {
      const op = makeOperator({ passwordHash: await hashPassword('correct-current') })
      standin.state.operators.push(op)
      const token = bearer(
        { sub: op.id, role: 'ADMIN', permissions: { can_reprint: true, can_anulate: true } },
        env,
      )
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/change-password',
        headers: { authorization: `Bearer ${token}` },
        payload: { current_password: 'wrong-current', new_password: 'brand-new-password' },
      })
      expect(res.statusCode).toBe(401)
      expect(res.json()).toMatchObject({ error: 'INVALID_CREDENTIALS' })
    } finally {
      await app.close()
    }
  })

  it('returns 400 when new_password is too short', async () => {
    const { app, standin, env } = await bootstrap()
    try {
      const op = makeOperator({ passwordHash: await hashPassword('correct-current') })
      standin.state.operators.push(op)
      const token = bearer(
        { sub: op.id, role: 'ADMIN', permissions: { can_reprint: true, can_anulate: true } },
        env,
      )
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/change-password',
        headers: { authorization: `Bearer ${token}` },
        payload: { current_password: 'correct-current', new_password: 'short' },
      })
      expect(res.statusCode).toBe(400)
    } finally {
      await app.close()
    }
  })
})

// Reference unused import so eslint doesn't strip it.
void hashRefreshToken
