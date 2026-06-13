import type { FastifyPluginCallback } from 'fastify'
import { z } from 'zod'
import { BusinessError, ErrorCode, throwIfInvalid } from '@athlos/errors'
import { requireAuth } from '@athlos/auth'
import type { AppContainer } from '../container.ts'
import { login } from '../services/login.ts'

/**
 * Auth routes (`/api/v1/auth/*`).
 *
 *   POST /login           — implemented; username + password → tokens
 *   POST /refresh         — stub: returns 501; full impl in PR 3b
 *   POST /logout          — stub: returns 501; full impl in PR 3b
 *   GET  /me              — stub: returns 501; full impl in PR 3b
 *   POST /change-password — stub: returns 501; full impl in PR 3b
 *
 * The login handler is fully functional end-to-end so PR 3a lands
 * something testable in the HTTP layer. The other four are 501
 * `NOT_IMPLEMENTED` to keep the diff inside the review budget —
 * refresh + logout depend on a refresh-token table that's there but
 * not yet wired into a service.
 */
const loginSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(1).max(200),
})

const refreshSchema = z.object({
  refresh_token: z.string().min(1),
})

const changePasswordSchema = z.object({
  current: z.string().min(1).max(200),
  new: z.string().min(8).max(200),
})

export const authRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const container = fastify.container
  const env = container.env

  fastify.post('/api/v1/auth/login', async (request, reply) => {
    const body = throwIfInvalid(loginSchema, request.body, 'body')
    const result = await login(container.db, env, body)
    return reply.code(200).send(result)
  })

  fastify.post('/api/v1/auth/refresh', async (_request, _reply) => {
    throwIfInvalid(refreshSchema, _request.body, 'body')
    throw BusinessError(
      ErrorCode.INTERNAL_ERROR,
      'POST /api/v1/auth/refresh is not implemented in PR 3a (see PR 3b)',
    )
  })

  fastify.post('/api/v1/auth/logout', async (_request, _reply) => {
    throwIfInvalid(refreshSchema, _request.body, 'body')
    throw BusinessError(
      ErrorCode.INTERNAL_ERROR,
      'POST /api/v1/auth/logout is not implemented in PR 3a (see PR 3b)',
    )
  })

  fastify.get('/api/v1/auth/me', { preHandler: requireAuth() }, async (_request, _reply) => {
    throw BusinessError(
      ErrorCode.INTERNAL_ERROR,
      'GET /api/v1/auth/me is not implemented in PR 3a (see PR 3b)',
    )
  })

  fastify.post(
    '/api/v1/auth/change-password',
    { preHandler: requireAuth() },
    async (request, _reply) => {
      throwIfInvalid(changePasswordSchema, request.body, 'body')
      throw BusinessError(
        ErrorCode.INTERNAL_ERROR,
        'POST /api/v1/auth/change-password is not implemented in PR 3a (see PR 3b)',
      )
    },
  )

  done()
}

// Type-safe Fastify decorator access.
declare module 'fastify' {
  interface FastifyInstance {
    container: AppContainer
  }
}
