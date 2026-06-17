/**
 * GET /api/v1/audit — query audit trail.
 *
 * Gate: ADMIN OR operator with data_steward permission.
 * Query params: operator?, entity?, entityType?, from?, to?, page?, limit?
 *
 * The audit trail records both operator events (via auditPlugin middleware)
 * and system events (via drift.emitDriftAlert direct inserts with operator_id=NULL).
 */
import type { FastifyPluginCallback, preHandlerHookHandler } from 'fastify'
import { z } from 'zod'
import { throwIfInvalid } from '@athlos/errors'
import { requireRole, requirePermission } from '@athlos/auth'
import { queryAudit } from '@athlos/audit'
import type { AppContainer } from '../container.ts'

/**
 * OR-gate: passes if any of the given preHandlers pass.
 * Each handler is invoked; the first one that does NOT throw is the winner.
 * If all throw, the last error propagates.
 * Preserves ATHLOS_GATE_MARKER from the first handler.
 */
function anyOf(...handlers: preHandlerHookHandler[]): preHandlerHookHandler {
  const first = handlers[0]
  const wrapper = async (
    request: Parameters<typeof first>[0],
    reply: Parameters<typeof first>[1],
  ) => {
    let lastErr: unknown
    for (const h of handlers) {
      try {
        await h(request, reply)
        return // this handler passed
      } catch (err) {
        lastErr = err
        // continue to next handler
      }
    }
    if (lastErr !== undefined) throw lastErr
  }
  // Propagate the gate marker so route-audit plugin recognises this as a gated route
  const marker = (first as unknown as Record<symbol, unknown>)[Symbol.for('@athlos/auth/gate')]
  if (marker) {
    ;(wrapper as unknown as Record<symbol, unknown>)[Symbol.for('@athlos/auth/gate')] = marker
  }
  return wrapper
}

const querySchema = z.object({
  operator: z.string().uuid().optional(),
  entity: z.string().uuid().optional(),
  entityType: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(100),
})

export const auditRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const container = fastify.container as AppContainer

  // ADMIN OR data_steward
  const ADMIN_OR_STEWARD = anyOf(requireRole('ADMIN'), requirePermission('data_steward' as never))

  fastify.get('/api/v1/audit', { preHandler: ADMIN_OR_STEWARD }, async (request, reply) => {
    const q = throwIfInvalid(querySchema, request.query as Record<string, unknown>, 'query')

    const result = await queryAudit(container.db, {
      ...(q.operator && { operatorId: q.operator }),
      ...(q.entity && { entityId: q.entity }),
      ...(q.entityType && { entityType: q.entityType }),
      ...(q.from && { from: q.from }),
      ...(q.to && { to: q.to }),
      page: q.page,
      limit: q.limit,
    } as Parameters<typeof queryAudit>[1])

    return reply.code(200).send({
      items: result.items,
      total: result.total,
      page: result.page,
      limit: result.limit,
      pages: result.pages,
    })
  })

  done()
}
