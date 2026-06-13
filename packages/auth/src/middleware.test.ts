import { describe, it, expect } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { ApiError } from '@athlos/errors'
import { authPlugin, requireAuth, requirePermission, requireRole } from './middleware.ts'
import { signAccessToken } from './jwt.ts'
import type { Env } from '@athlos/config'

const env: Env = {
  NODE_ENV: 'test',
  PORT: 3001,
  HOST: '0.0.0.0',
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgresql://test/test',
  JWT_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  JWT_ACCESS_TTL_SECONDS: 900,
  JWT_REFRESH_TTL_SECONDS: 604800,
  LEGACY_DB_PATH: '/tmp/legacy',
  CORS_ORIGINS: 'http://localhost:3000',
  FROM_ADDRESS: 'noreply@gorriti.app',
} as Env

function buildTestApp(): FastifyInstance {
  const app = Fastify({ logger: false })
  // Mirror the production error handler so ApiError → { error: code, message }.
  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof ApiError) {
      return reply.code(err.statusCode).send({
        error: err.code,
        message: err.isBusiness ? err.message : 'Internal server error',
        ...(err.details !== undefined ? { details: err.details } : {}),
      })
    }
    return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Internal server error' })
  })
  // authPlugin is a callback plugin — call it directly with the instance.
  authPlugin(() => env)(app, {}, () => {})
  return app
}

function makeToken(
  role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA',
  perms: { can_reprint: boolean; can_anulate: boolean },
): string {
  return signAccessToken(
    {
      sub: '00000000-0000-0000-0000-000000000001',
      role,
      permissions: perms,
    },
    env,
  )
}

describe('requireAuth', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const app = buildTestApp()
    try {
      app.get('/protected', { preHandler: requireAuth() }, async () => ({ ok: true }))
      const res = await app.inject({ method: 'GET', url: '/protected' })
      expect(res.statusCode).toBe(401)
      const body = res.json() as { error: string }
      expect(body.error).toBe('TOKEN_INVALID')
    } finally {
      await app.close()
    }
  })

  it('allows a request with a valid Bearer token', async () => {
    const app = buildTestApp()
    try {
      app.get('/protected', { preHandler: requireAuth() }, async () => ({ ok: true }))
      const res = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: {
          authorization: `Bearer ${makeToken('ADMIN', { can_reprint: true, can_anulate: true })}`,
        },
      })
      expect(res.statusCode).toBe(200)
    } finally {
      await app.close()
    }
  })

  it('rejects a malformed Bearer token with 401', async () => {
    const app = buildTestApp()
    try {
      app.get('/protected', { preHandler: requireAuth() }, async () => ({ ok: true }))
      const res = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: { authorization: 'Bearer not-a-jwt' },
      })
      expect(res.statusCode).toBe(401)
    } finally {
      await app.close()
    }
  })
})

describe('requireRole', () => {
  it('allows a request whose role is in the allow-list', async () => {
    const app = buildTestApp()
    try {
      app.get('/admin', { preHandler: requireRole('ADMIN', 'TESORERO') }, async () => ({
        ok: true,
      }))
      const res = await app.inject({
        method: 'GET',
        url: '/admin',
        headers: {
          authorization: `Bearer ${makeToken('TESORERO', { can_reprint: true, can_anulate: false })}`,
        },
      })
      expect(res.statusCode).toBe(200)
    } finally {
      await app.close()
    }
  })

  it('rejects a request whose role is not in the allow-list (403)', async () => {
    const app = buildTestApp()
    try {
      app.get('/admin', { preHandler: requireRole('ADMIN') }, async () => ({ ok: true }))
      const res = await app.inject({
        method: 'GET',
        url: '/admin',
        headers: {
          authorization: `Bearer ${makeToken('CONSULTA', { can_reprint: false, can_anulate: false })}`,
        },
      })
      expect(res.statusCode).toBe(403)
      const body = res.json() as { error: string; message: string }
      expect(body.error).toBe('INSUFFICIENT_PERMISSIONS')
      expect(body.message).toContain('CONSULTA')
    } finally {
      await app.close()
    }
  })

  it('rejects an unauthenticated request (401)', async () => {
    const app = buildTestApp()
    try {
      app.get('/admin', { preHandler: requireRole('ADMIN') }, async () => ({ ok: true }))
      const res = await app.inject({ method: 'GET', url: '/admin' })
      expect(res.statusCode).toBe(401)
    } finally {
      await app.close()
    }
  })
})

describe('requirePermission', () => {
  it('allows when the operator has the required permission', async () => {
    const app = buildTestApp()
    try {
      app.get('/reprint', { preHandler: requirePermission('can_reprint') }, async () => ({
        ok: true,
      }))
      const res = await app.inject({
        method: 'GET',
        url: '/reprint',
        headers: {
          authorization: `Bearer ${makeToken('OPERADOR', { can_reprint: true, can_anulate: false })}`,
        },
      })
      expect(res.statusCode).toBe(200)
    } finally {
      await app.close()
    }
  })

  it('rejects when the operator lacks the required permission (403)', async () => {
    const app = buildTestApp()
    try {
      app.get('/reprint', { preHandler: requirePermission('can_reprint') }, async () => ({
        ok: true,
      }))
      const res = await app.inject({
        method: 'GET',
        url: '/reprint',
        headers: {
          authorization: `Bearer ${makeToken('OPERADOR', { can_reprint: false, can_anulate: false })}`,
        },
      })
      expect(res.statusCode).toBe(403)
      const body = res.json() as { error: string; message: string }
      expect(body.error).toBe('INSUFFICIENT_PERMISSIONS')
      expect(body.message).toContain('can_reprint')
    } finally {
      await app.close()
    }
  })
})
