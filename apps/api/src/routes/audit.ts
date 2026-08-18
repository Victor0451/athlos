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
  // Cast to a permissive function type so the inner `await h(request, reply)` call
  // doesn't trip TS strict about preHandlerHookHandler's 3-argument signature
  // (`request, reply, done`). Fastify v5 preHandlers can be either async or
  // callback-style; we always invoke them with just the first 2 args.
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

const querySchema = z.object({
  operator: z.string().uuid().optional(),
  entity: z.string().uuid().optional(),
  entityType: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(100),
})

const DUES_AUDIT_ACTIONS = new Set([
  'DUES_PRICE_CREATED',
  'DUES_PRICE_REVOKED',
  'DUES_PERIOD_GENERATED',
  'DUES_BENEFIT_CREATED',
  'DUES_BENEFIT_REVOKED',
  'DUES_BENEFIT_APPLIED',
  'DUES_FAMILY_GROUP_CREATED',
  'DUES_FAMILY_MEMBERSHIP_CREATED',
  'DUES_FAMILY_MEMBERSHIP_REVOKED',
])
type AuditItem = Awaited<ReturnType<typeof queryAudit>>['items'][number]
type JsonObject = Record<string, unknown>

function jsonObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null
}

function safeRole(value: unknown): string | null {
  return typeof value === 'string' && /^(ADMIN|TESORERO|OPERADOR|CONSULTA)$/.test(value)
    ? value
    : null
}

function safePermissions(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value.slice(0, 32)
    : null
}

function safeText(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength ? value : null
}

function duesEvidence(metadata: unknown) {
  const data = jsonObject(metadata)
  const authorization = jsonObject(data?.authorizationEvidence)
  const text = (key: string, maxLength = 128) => safeText(data?.[key], maxLength)
  const actorId = text('actorId')
  const role = safeRole(data?.role)
  const permissions = safePermissions(data?.permissions)
  const authorizationRole = safeRole(authorization?.role)
  const authorizationPermissions = safePermissions(authorization?.permissions)
  const callerKey = text('callerKey')
  const requestFingerprint = text('requestFingerprint', 64)
  const time = text('time', 64)
  if (
    !actorId ||
    !role ||
    !permissions ||
    !authorizationRole ||
    !authorizationPermissions ||
    authorizationRole !== role ||
    callerKey === null ||
    !requestFingerprint ||
    !/^[a-f0-9]{64}$/i.test(requestFingerprint) ||
    !time ||
    Number.isNaN(Date.parse(time))
  )
    return null
  return {
    actor: { id: actorId, role, permissions },
    authorization_evidence: { role: authorizationRole, permissions: authorizationPermissions },
    idempotency: { caller_key: callerKey, request_fingerprint: requestFingerprint },
    time,
  }
}

function toAuditDTO(item: AuditItem) {
  const { metadata, ...dto } = item
  if (!DUES_AUDIT_ACTIONS.has(item.action)) return dto
  const privacySensitive =
    item.action.startsWith('DUES_BENEFIT_') || item.action.startsWith('DUES_FAMILY_')
  // prettier-ignore
  return { ...dto, ...(privacySensitive ? { oldValue: null, newValue: null } : {}), dues_evidence: duesEvidence(metadata) }
}

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
      items: result.items.map(toAuditDTO),
      total: result.total,
      page: result.page,
      limit: result.limit,
      pages: result.pages,
    })
  })

  done()
}
