import type { FastifyPluginCallback } from 'fastify'
import { z } from 'zod'
import { throwIfInvalid } from '@athlos/errors'
import { requireAuth } from '@athlos/auth'
import type { AppContainer } from '../container.ts'
import { login } from '../services/login.ts'
import { changePassword, getMe, logout, refresh } from '../services/auth.ts'

/**
 * Auth routes (`/api/v1/auth/*`).
 *
 *   POST /login           — username + password → tokens
 *   POST /refresh         — rotate refresh token → new pair
 *   POST /logout          — revoke a single refresh token
 *   GET  /me              — current operator profile (auth required)
 *   GET  /me/permissions  — current navigation permissions (auth required)
 *   POST /change-password — update own password (auth required)
 *
 * All handlers delegate to a service function in
 * `apps/api/src/services/`. The route layer is responsible for HTTP
 * plumbing (status codes, body shapes, Zod validation). The service
 * layer is responsible for the database + crypto work and throws
 * `BusinessError` codes that the global error handler maps to status
 * codes (so we never construct an HTTP reply in a service).
 */
const loginSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(1).max(200),
})

const refreshSchema = z.object({
  refresh_token: z.string().min(1),
})

const changePasswordSchema = z.object({
  current_password: z.string().min(1).max(200),
  new_password: z.string().min(8).max(200),
})

export const authRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const container = fastify.container
  const env = container.env

  fastify.post('/api/v1/auth/login', async (request, reply) => {
    const body = throwIfInvalid(loginSchema, request.body, 'body')
    const result = await login(container.db, env, body)
    return reply.code(200).send(result)
  })

  fastify.post('/api/v1/auth/refresh', async (request, reply) => {
    const body = throwIfInvalid(refreshSchema, request.body, 'body')
    const result = await refresh(container.db, env, body)
    return reply.code(200).send(result)
  })

  fastify.post('/api/v1/auth/logout', { preHandler: requireAuth() }, async (request, reply) => {
    const body = throwIfInvalid(refreshSchema, request.body, 'body')
    if (!request.operator) {
      // requireAuth already throws, but the type-narrow keeps us honest.
      return
    }
    await logout(container.db, { refresh_token: body.refresh_token })
    return reply.code(200).send({ message: 'Logged out' })
  })

  fastify.get('/api/v1/auth/me', { preHandler: requireAuth() }, async (request, reply) => {
    if (!request.operator) {
      // requireAuth already throws, but the type-narrow keeps us honest.
      return
    }
    const dto = await getMe(container.db, request.operator.sub)
    return reply.code(200).send(dto)
  })

  fastify.get(
    '/api/v1/auth/me/permissions',
    { preHandler: requireAuth() },
    async (request, reply) => {
      if (!request.operator) return
      const dataSteward = await container.permissionsRepo.hasPermission(
        request.operator.sub,
        'data_steward',
      )
      return reply.code(200).send({ data_steward: dataSteward })
    },
  )

  fastify.post(
    '/api/v1/auth/change-password',
    { preHandler: requireAuth() },
    async (request, reply) => {
      if (!request.operator) return
      const body = throwIfInvalid(changePasswordSchema, request.body, 'body')
      await changePassword(container.db, {
        operatorId: request.operator.sub,
        currentPassword: body.current_password,
        newPassword: body.new_password,
      })
      return reply.code(200).send({ message: 'Password changed' })
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
