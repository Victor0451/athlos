/**
 * GET /api/v1/drift — query drift detection results.
 *
 * Gate: ADMIN OR operator with data_steward permission.
 * Uses the two-gate pattern: requireRole('ADMIN') passes for ADMIN,
 * requirePermission('data_steward') passes for DATA_STEWARD.
 *
 * DATA_STEWARD routing: operators receive drift_alert notifications
 * only when they have a row in role_permissions(permission_key='data_steward').
 * Zero rows = zero drift alerts until an admin grants explicitly (design §9).
 */
import type { FastifyPluginCallback, preHandlerHookHandler } from 'fastify'
import { requireRole, requirePermission } from '@athlos/auth'
import type { AppContainer } from '../container.ts'

/**
 * OR-gate: passes if any of the given preHandlers pass.
 * Each handler is invoked; the first one that does NOT throw is the winner.
 * If all throw, the last error propagates.
 * Preserves ATHLOS_GATE_MARKER from the first handler.
 */
function anyOf(...handlers: preHandlerHookHandler[]): preHandlerHookHandler {
  const first = handlers[0]
  // See audit.ts for explanation of the permissive cast.
  const wrapper = async (request: unknown, reply: unknown): Promise<void> => {
    let lastErr: unknown
    for (const h of handlers) {
      try {
        await (h as unknown as (r: unknown, s: unknown) => Promise<unknown>)(request, reply)
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
  return wrapper as unknown as preHandlerHookHandler
}

export const driftRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const container = fastify.container as AppContainer

  // ADMIN OR data_steward — OR-gate (anyOf)
  const ADMIN_OR_STEWARD = anyOf(requireRole('ADMIN'), requirePermission('data_steward' as never))

  fastify.get('/api/v1/drift', { preHandler: ADMIN_OR_STEWARD }, async (_request, reply) => {
    const report = await container.driftService.detect({})
    return reply.code(200).send(report)
  })

  done()
}
