import type { FastifyPluginCallback } from 'fastify'
import { z } from 'zod'
import { throwIfInvalid } from '@athlos/errors'
import { requireRole } from '@athlos/auth'
import type { AppContainer } from '../../container.ts'
import {
  createOperator,
  getLoginHistory,
  listOperators,
  softDeleteOperator,
  unlockOperator,
  updateOperator,
  type OperatorRole,
} from '../../services/operators.ts'

/**
 * Admin operator management routes — `/api/v1/admin/operators`.
 *
 * Every endpoint is gated by `requireRole('ADMIN')`. The service
 * layer (`apps/api/src/services/operators.ts`) is the only place
 * that touches the `operators` table; the route layer is responsible
 * for Zod validation, status codes, and DTO shaping.
 *
 * Soft-delete is the only delete: `DELETE` sets `is_active = false`
 * and revokes active refresh tokens. The row is preserved for audit.
 *
 * Login history is a thin pass-through to the service; the audit
 * writer that feeds it lands in a later PR (the route contract is
 * stable now so the writer can plug in without route changes).
 */

const idParamSchema = z.object({ id: z.string().uuid() })

const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  role: z.enum(['ADMIN', 'TESORERO', 'OPERADOR', 'CONSULTA']).optional(),
  is_active: z.union([z.literal('true'), z.literal('false')]).optional(),
})

const createSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[a-z0-9._-]+$/, 'username must be lowercase alnum with . _ -'),
  password: z.string().min(8).max(200),
  role: z.enum(['ADMIN', 'TESORERO', 'OPERADOR', 'CONSULTA']),
  can_reprint: z.boolean().optional(),
  can_anulate: z.boolean().optional(),
})

const updateSchema = z
  .object({
    role: z.enum(['ADMIN', 'TESORERO', 'OPERADOR', 'CONSULTA']).optional(),
    can_reprint: z.boolean().optional(),
    can_anulate: z.boolean().optional(),
    is_active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field must be provided' })

const loginHistoryQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

const ROLE_GATE = { preHandler: requireRole('ADMIN') }

export const adminOperatorsRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const container = fastify.container

  // GET /api/v1/admin/operators
  fastify.get('/api/v1/admin/operators', ROLE_GATE, async (request, reply) => {
    const q = throwIfInvalid(listQuerySchema, request.query, 'query')
    const result = await listOperators(container.db, {
      limit: q.limit ?? 20,
      ...(q.cursor !== undefined ? { cursor: q.cursor } : {}),
      ...(q.role !== undefined ? { role: q.role as OperatorRole } : {}),
      ...(q.is_active !== undefined ? { isActive: q.is_active === 'true' } : {}),
    })
    return reply.code(200).send({
      items: result.items,
      next_cursor: result.nextCursor,
    })
  })

  // POST /api/v1/admin/operators
  fastify.post('/api/v1/admin/operators', ROLE_GATE, async (request, reply) => {
    const body = throwIfInvalid(createSchema, request.body, 'body')
    const dto = await createOperator(container.db, {
      username: body.username,
      password: body.password,
      role: body.role,
      ...(body.can_reprint !== undefined ? { canReprint: body.can_reprint } : {}),
      ...(body.can_anulate !== undefined ? { canAnulate: body.can_anulate } : {}),
    })
    return reply.code(201).send(dto)
  })

  // PUT /api/v1/admin/operators/:id
  fastify.put<{ Params: { id: string } }>(
    '/api/v1/admin/operators/:id',
    ROLE_GATE,
    async (request, reply) => {
      const params = throwIfInvalid(idParamSchema, request.params, 'params')
      const body = throwIfInvalid(updateSchema, request.body, 'body')
      const dto = await updateOperator(container.db, {
        id: params.id,
        ...(body.role !== undefined ? { role: body.role as OperatorRole } : {}),
        ...(body.can_reprint !== undefined ? { canReprint: body.can_reprint } : {}),
        ...(body.can_anulate !== undefined ? { canAnulate: body.can_anulate } : {}),
        ...(body.is_active !== undefined ? { isActive: body.is_active } : {}),
      })
      return reply.code(200).send(dto)
    },
  )

  // DELETE /api/v1/admin/operators/:id  (soft delete)
  fastify.delete<{ Params: { id: string } }>(
    '/api/v1/admin/operators/:id',
    ROLE_GATE,
    async (request, reply) => {
      const params = throwIfInvalid(idParamSchema, request.params, 'params')
      await softDeleteOperator(container.db, params.id)
      return reply.code(204).send()
    },
  )

  // POST /api/v1/admin/operators/:id/unlock
  fastify.post<{ Params: { id: string } }>(
    '/api/v1/admin/operators/:id/unlock',
    ROLE_GATE,
    async (request, reply) => {
      const params = throwIfInvalid(idParamSchema, request.params, 'params')
      const result = await unlockOperator(container.db, params.id)
      return reply.code(200).send(result)
    },
  )

  // GET /api/v1/admin/operators/:id/login-history
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/admin/operators/:id/login-history',
    ROLE_GATE,
    async (request, reply) => {
      const params = throwIfInvalid(idParamSchema, request.params, 'params')
      const q = throwIfInvalid(loginHistoryQuerySchema, request.query, 'query')
      const result = await getLoginHistory(container.db, params.id, q.cursor, q.limit ?? 20)
      return reply.code(200).send({
        items: result.items,
        next_cursor: result.nextCursor,
      })
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
