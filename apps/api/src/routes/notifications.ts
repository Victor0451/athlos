import type { FastifyPluginCallback } from 'fastify'
import { z } from 'zod'
import { idSchema } from '@athlos/validation'
import { throwIfInvalid } from '@athlos/errors'
import { requireAuth } from '@athlos/auth'
import { list, markAsRead, unreadCount } from '../modules/notifications/service.ts'
import type { AppContainer } from '../container.ts'

/**
 * Notifications routes — `/api/v1/notifications/*`.
 *
 * Three endpoints powering the in-app bell (PR bell-N1):
 *
 *   GET  /api/v1/notifications              list (paginated, filterable)
 *   GET  /api/v1/notifications/unread-count cheap count for the badge
 *   PATCH /api/v1/notifications/:id/read    mark a single row as read
 *
 * Every route is `requireAuth()`-gated: the bell is per-operator,
 * and `request.operator.sub` is the recipient id threaded into the
 * service. There is intentionally no admin override — a notification
 * is a personal record; the only way to see another operator's
 * notifications is to log in as them.
 *
 * The route layer owns HTTP plumbing (Zod validation, status codes,
 * wire DTO shape). The service throws `BusinessError` codes that
 * the global error handler maps to status codes.
 */

const listQuerySchema = z.object({
  status: z.enum(['unread', 'read', 'all']).default('all'),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})

const idParamSchema = z.object({ id: idSchema })

/**
 * Map a DB `Notification` row to the public snake-cased wire DTO.
 * Date fields are ISO strings (the front-end can format them). The
 * `metadata` JSONB blob is passed through as-is.
 */
function toNotificationDTO(row: {
  id: string
  channel: string
  recipientId: string | null
  recipientAddress: string | null
  subject: string | null
  body: string
  metadata: unknown
  eventId: string | null
  status: string
  readAt: Date | null
  createdAt: Date
}): Record<string, unknown> {
  return {
    id: row.id,
    channel: row.channel,
    recipient_id: row.recipientId,
    recipient_address: row.recipientAddress,
    subject: row.subject,
    body: row.body,
    metadata: row.metadata,
    event_id: row.eventId,
    status: row.status,
    read_at: row.readAt ? row.readAt.toISOString() : null,
    created_at: row.createdAt.toISOString(),
  }
}

const AUTH = { preHandler: requireAuth() }

export const notificationRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const container: AppContainer = fastify.container

  // GET /api/v1/notifications
  fastify.get('/api/v1/notifications', AUTH, async (request, reply) => {
    if (!request.operator) {
      // requireAuth already throws, but the type-narrow keeps us honest.
      return
    }
    const q = throwIfInvalid(listQuerySchema, request.query, 'query')
    const statusFilter = q.status === 'all' ? undefined : q.status
    const result = await list(container.db, request.operator.sub, {
      ...(statusFilter ? { statusFilter } : {}),
      page: q.page ?? 1,
      limit: q.limit ?? 20,
    })
    return reply.code(200).send({
      items: result.items.map(toNotificationDTO),
      total: result.total,
      page: result.page,
      limit: result.limit,
      has_more: result.has_more,
    })
  })

  // GET /api/v1/notifications/unread-count
  fastify.get('/api/v1/notifications/unread-count', AUTH, async (request, reply) => {
    if (!request.operator) {
      // requireAuth already throws, but the type-narrow keeps us honest.
      return
    }
    const count = await unreadCount(container.db, request.operator.sub)
    return reply.code(200).send({ count })
  })

  // PATCH /api/v1/notifications/:id/read
  fastify.patch<{ Params: { id: string } }>(
    '/api/v1/notifications/:id/read',
    AUTH,
    async (request, reply) => {
      if (!request.operator) {
        return
      }
      const params = throwIfInvalid(idParamSchema, request.params, 'params')
      const row = await markAsRead(container.db, request.operator.sub, params.id)
      return reply.code(200).send(toNotificationDTO(row))
    },
  )

  done()
}

declare module 'fastify' {
  interface FastifyInstance {
    container: AppContainer
  }
}
