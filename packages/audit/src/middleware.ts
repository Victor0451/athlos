/**
 * @athlos/audit/middleware — Fastify audit plugin.
 *
 * IMPORTANT: Must be wrapped with fp() from fastify-plugin.
 * Without the wrap, the onRequest/onResponse hooks only fire for routes
 * REGISTERED INSIDE this plugin's encapsulated context — not the parent scope.
 * This was the PR 3a bug class (Engram #1990): unwrapped plugins silently
 * 401 every protected route because request.operator was never decorated.
 *
 * The fp() wrap pattern (copied from authPlugin):
 *   export const auditPlugin = fp(auditPlugin, { name: 'athlos-audit' })
 *
 * TWO-WRITE-PATH ARCHITECTURE (design §5):
 *   - This middleware → emitAudit() → audit_events with operator_id set
 *   - drift.emitDriftAlert() → direct insert → audit_events with operator_id = NULL
 *
 * onRequest: captures auditCtx from request if operator is present
 * onResponse: fires ONLY on 2xx responses; snapshots old_value before mutation
 */
import fp from 'fastify-plugin'
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { emitAudit, type AuditRecord } from './emitter.ts'
import type { Db } from '@athlos/db'
import type { JWTPayload } from '@athlos/auth'

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Set by authPlugin on every authenticated request.
     * null for anonymous, or JWT payload for authenticated.
     */
    operator?: JWTPayload | null
    /**
     * Set by the onRequest hook when the request has a verified operator.
     * Contains the entity and action context parsed from the route params.
     */
    auditCtx?: {
      entityType: string
      entityId: string
      action: string
    }
  }
}

/**
 * Parse audit context from the request.
 *
 * The entityId is extracted from route params by convention:
 *   - GET /api/v1/lineage/:entityId    → entityId = params.entityId
 *   - POST /api/v1/socios              → entityId = body.id or generated
 * The route handler can pre-set request.auditCtx before the response fires.
 *
 * TODO: wire a route-helper that resolves entityId from the route's
 * schema (design §5 §"Audit — entityId resolution").
 */
function parseAuditContext(
  request: FastifyRequest,
): { entityType: string; entityId: string; action: string } | undefined {
  // Fallback: try to extract from route params if set by handler
  const params = request.params as Record<string, string>
  if (params.entityId) {
    // Heuristic: infer entity type from route prefix
    const route = request.routeOptions?.url ?? ''
    const entityType = route.includes('/lineage')
      ? 'entity'
      : route.includes('/socios')
        ? 'socio'
        : route.includes('/ctacte')
          ? 'ctacte'
          : 'unknown'
    return {
      entityType,
      entityId: params.entityId,
      action: request.method + '_' + entityType,
    }
  }
  return undefined
}

/**
 * Snapshot the old value before mutation.
 *
 * For now this is a stub — the real implementation would read the
 * pre-mutation state from the DB using the entityType + entityId.
 * The design §5 calls for snapshotOldValue to be called from onResponse
 * before emitAudit fires.
 *
 * TODO: implement real snapshot (design §5 §"snapshot old_value")
 */
async function snapshotOldValue(_db: Db, _entityType: string, _entityId: string): Promise<unknown> {
  // Stub: returns null until we wire entity-specific snapshot reads
  return null
}

const auditPluginImpl: FastifyPluginAsync = async (fastify) => {
  // onRequest: capture audit context if operator is present
  fastify.addHook('onRequest', async (request: FastifyRequest) => {
    if (!request.operator) return // anonymous — no audit
    const ctx = parseAuditContext(request)
    if (ctx) request.auditCtx = ctx
  })

  // onResponse: emit audit row ONLY on 2xx
  fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.auditCtx || !request.operator) return
    // Only audit successful mutations (2xx)
    if (reply.statusCode < 200 || reply.statusCode >= 300) return

    const serverWithContainer = request.server as { container?: { db?: Db } }
    const db = serverWithContainer.container?.db
    if (!db) {
      fastify.log.warn({ event: 'AUDIT_NO_DB' }, 'audit emit skipped: no db in container')
      return
    }

    const oldValue = await snapshotOldValue(
      db,
      request.auditCtx.entityType,
      request.auditCtx.entityId,
    )

    const record: AuditRecord = {
      operatorId: request.operator.sub,
      action: request.auditCtx.action,
      entityType: request.auditCtx.entityType,
      entityId: request.auditCtx.entityId,
      oldValue,
      newValue: null, // TODO: capture reply payload once serialized
      sourceIp: request.ip ?? null,
      payload: request.body,
    }

    await emitAudit(db, record)
  })
}

/**
 * CRITICAL: fp()-wrapped so hooks reach the parent scope.
 * See Engram #1990 (PR 3a bug): unwrapped plugins silently 401.
 *
 * CI guard (ci-check-audit-fp.sh) verifies this wrap is present.
 */
export const auditPlugin = fp(auditPluginImpl, { name: 'athlos-audit' })
