import type { FastifyPluginCallback } from 'fastify'
import { z } from 'zod'
import { BusinessError, ErrorCode, throwIfInvalid } from '@athlos/errors'
import { requireRole } from '@athlos/auth'
import { emitAudit, AuditAction } from '@athlos/audit'
import {
  consumeApprovalToken,
  createApprovalToken,
  createCondonationApprovalRequest,
  decideCondonationApproval,
  findCondonationRequest,
  getApprovalToken,
  type CondonationSnapshot,
  type ApprovalTokenRecord,
} from '@athlos/approval'
import type { AppContainer } from '../container.ts'
import { selectFullOutstanding } from '../modules/dues/allocations.ts'
import { validateIdempotencyKey } from '../lib/idempotency.ts'
import { randomUUID } from 'node:crypto'

/**
 * Approval routes — public-by-token + admin create-link.
 *
 * Two surfaces:
 *
 *   1. `/api/v1/approval/:token`        — the approver-facing flow
 *        GET   returns the context (no auth — the token IS the auth)
 *        POST  records a decision (approve | reject, reason required
 *              on reject) and marks the token used. The actual
 *              business action that the approval gates is NOT
 *              executed here — that's a STUB for PR 3b. The point of
 *              this PR is the auth flow + token mechanics, not the
 *              underlying ctacte.anulate / payment_order actions.
 *
 *   2. `/api/v1/internal/approval-links` — admin/tesorero create
 *        Accepts the action metadata + approver channel/address, mints
 *        a fresh token via @athlos/approval, and returns { token,
 *        link, expires_at }. Delivery (WhatsApp / email) is the
 *        caller's responsibility — the route just returns the link
 *        so the caller can hand it to the existing
 *        @athlos/integrations-whatsapp / -email channels.
 */

const decisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().min(1).max(500).optional(),
})

const condonationRequestSchema = z
  .object({
    member_id: z.string().uuid(),
    obligation_ids: z.array(z.string().uuid()).min(1).max(100),
    context: z.string().trim().min(1).max(1000),
    reason: z.string().trim().min(1).max(500),
    evidence: z.string().trim().min(1).max(1000),
  })
  .strict()
const condonationDecisionSchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    reason: z.string().trim().min(1).max(500),
    evidence: z.string().trim().min(1).max(1000),
  })
  .strict()
const condonationIdSchema = z.object({ id: z.string().uuid() })
const CONDONATION_REQUEST_GATE = { preHandler: requireRole('OPERADOR', 'ADMIN', 'TESORERO') }
const CONDONATION_DECISION_GATE = { preHandler: requireRole('ADMIN', 'TESORERO') }

function callerKey(request: { headers: Record<string, unknown> }): string {
  const key = request.headers['idempotency-key']
  if (typeof key !== 'string' || !validateIdempotencyKey(key))
    throw BusinessError(ErrorCode.VALIDATION_ERROR, 'Idempotency-Key header is required')
  return key
}

function sameSnapshot(
  snapshot: unknown,
  memberId: string,
  obligationIds: string[],
): snapshot is CondonationSnapshot {
  if (!snapshot || typeof snapshot !== 'object') return false
  const value = snapshot as CondonationSnapshot
  return (
    value.memberId === memberId &&
    value.obligations.length === obligationIds.length &&
    [...value.obligations.map((item) => item.obligationId)].sort().join() ===
      [...obligationIds].sort().join()
  )
}

function condonationDto(row: ApprovalTokenRecord) {
  return {
    id: row.actionId,
    status: row.status,
    expires_at: row.expiresAt.toISOString(),
    decided_at: row.decidedAt?.toISOString() ?? null,
  }
}

const createLinkSchema = z.object({
  action_type: z.string().min(1).max(64),
  action_id: z.string().min(1).max(64),
  context_summary: z.string().min(1).max(1000),
  approver_channels: z
    .array(
      z.object({
        channel: z.enum(['whatsapp', 'email']),
        address: z.string().min(1).max(200),
      }),
    )
    .min(1)
    .max(5),
  expires_in_hours: z.number().int().min(1).max(168).optional(),
})

/** Public approval-context view (no operator-only fields). */
interface ApprovalContextResponse {
  action_type: string
  action_id: string
  context_summary: string
  created_by: { operator_id: string }
  expires_at: string
  status: ApprovalTokenRecord['status']
}

function toContextResponse(row: ApprovalTokenRecord): ApprovalContextResponse {
  return {
    action_type: row.actionType,
    action_id: row.actionId,
    context_summary: row.contextSummary,
    created_by: { operator_id: row.createdByOperatorId },
    expires_at: row.expiresAt.toISOString(),
    status: row.status,
  }
}

export const approvalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const container = fastify.container

  // GET /api/v1/approval/:token
  // No auth: the token in the URL is the authorization. Returns the
  // action context for the approver's confirmation UI. 410 Gone is
  // thrown by getApprovalToken for expired/used tokens (see
  // @athlos/approval service).
  fastify.get<{ Params: { token: string } }>('/api/v1/approval/:token', async (request, reply) => {
    const row = await getApprovalToken(container.db, request.params.token)
    return reply.code(200).send(toContextResponse(row))
  })

  // POST /api/v1/approval/:token
  // Records the decision and marks the token used. For PR 3b the
  // business action is a STUB — see the TODO inside the handler. The
  // route still consumes the token atomically so a second POST on the
  // same token returns 410.
  fastify.post<{ Params: { token: string } }>('/api/v1/approval/:token', async (request, reply) => {
    const body = throwIfInvalid(decisionSchema, request.body, 'body')
    if (body.decision === 'reject' && !body.reason) {
      // REASON_REQUIRED maps to 400 in @athlos/errors. The approval
      // spec is explicit that a rejection without a reason is
      // rejected at the boundary, not silently accepted.
      throw BusinessError(ErrorCode.REASON_REQUIRED, 'A reason is required when rejecting')
    }

    // Consume first (mark used). If the business action fails, the
    // token stays used — the spec treats consumption as the audit
    // point and the action is the caller's responsibility to retry
    // via a fresh token.
    const candidate = await getApprovalToken(container.db, request.params.token)
    if (candidate.actionType === 'dues.condonation') {
      throw BusinessError(
        ErrorCode.INSUFFICIENT_PERMISSIONS,
        'Condonation decisions require an authenticated Treasury approver',
      )
    }
    const row = await consumeApprovalToken(container.db, request.params.token)

    // STUB: execute the underlying business action. PR 3b lands
    // the auth flow + token mechanics; the action executor ships
    // in the PR that introduces the action itself (ctacte.anulate
    // → PR 5+; payment_order → PR 6+).

    console.info(
      {
        token_id: row.id,
        action_type: row.actionType,
        action_id: row.actionId,
        decision: body.decision,
        reason: body.reason ?? null,
      },
      'approval: business action execution is a STUB in PR 3b',
    )

    return reply.code(200).send({
      decision: body.decision === 'approve' ? 'approved' : 'rejected',
      action_type: row.actionType,
      action_id: row.actionId,
      decided_at: new Date().toISOString(),
    })
  })

  fastify.post<{ Body: unknown }>(
    '/api/v1/condonation-requests',
    CONDONATION_REQUEST_GATE,
    async (request, reply) => {
      if (!request.operator) return
      const body = throwIfInvalid(condonationRequestSchema, request.body, 'body')
      const key = callerKey(request)
      const result = await container.db.transaction(async (tx) => {
        const existing = await findCondonationRequest(tx, request.operator!.sub, key)
        const snapshot = existing
          ? sameSnapshot(existing.condonationSnapshot, body.member_id, body.obligation_ids)
            ? existing.condonationSnapshot
            : (() => {
                throw BusinessError(
                  ErrorCode.CONFLICT,
                  'Idempotency key was already used for a different request',
                )
              })()
          : await selectFullOutstanding(tx, {
              socioId: body.member_id,
              obligationIds: body.obligation_ids,
            }).then((selection) => ({
              memberId: selection.socioId,
              obligations: selection.allocations.map((item) => ({
                obligationId: item.obligationId,
                currency: selection.currency,
                outstandingAmountCents: item.amountCents,
              })),
            }))
        const created = await createCondonationApprovalRequest(tx, {
          requestId: randomUUID(),
          contextSummary: body.context,
          requesterId: request.operator!.sub,
          approverChannel: 'email',
          approverAddress: 'authenticated-treasury',
          snapshot,
          reason: body.reason,
          evidence: body.evidence,
          callerKey: key,
        })
        await emitAudit(tx, {
          operatorId: request.operator!.sub,
          action: AuditAction.CONDONATION_REQUEST_CREATED,
          entityType: 'condonation_request',
          entityId: created.record.id,
          oldValue: null,
          newValue: { status: 'pending', financial_execution: false },
          sourceIp: request.ip ?? null,
          callerKey: key,
          metadata: {
            request_id: created.record.actionId,
            requester_id: request.operator!.sub,
            snapshot,
            reason: body.reason,
            evidence: body.evidence,
            idempotency_key: key,
            outcome: 'pending_no_financial_execution',
          },
        })
        return created.record
      })
      return reply.code(201).send(condonationDto(result))
    },
  )

  fastify.post<{ Params: { id: string }; Body: unknown }>(
    '/api/v1/condonation-requests/:id/decision',
    CONDONATION_DECISION_GATE,
    async (request, reply) => {
      if (!request.operator) return
      const { id } = throwIfInvalid(condonationIdSchema, request.params, 'params')
      const body = throwIfInvalid(condonationDecisionSchema, request.body, 'body')
      const result = await container.db.transaction(async (tx) => {
        const decided = await decideCondonationApproval(tx, {
          requestId: id,
          actorId: request.operator!.sub,
          decision: body.decision,
          reason: body.reason,
          evidence: body.evidence,
        })
        await emitAudit(tx, {
          operatorId: request.operator!.sub,
          action: AuditAction.CONDONATION_DECISION_RECORDED,
          entityType: 'condonation_request',
          entityId: decided.id,
          oldValue: { status: 'pending' },
          newValue: { status: decided.status, financial_execution: false },
          sourceIp: request.ip ?? null,
          callerKey: decided.actionId,
          metadata: {
            request_id: decided.actionId,
            requester_id: decided.createdByOperatorId,
            approver_id: request.operator!.sub,
            decision: decided.status,
            reason: body.reason,
            evidence: body.evidence,
            snapshot: decided.condonationSnapshot,
            outcome: `${decided.status}_no_financial_execution`,
          },
        })
        return decided
      })
      return reply.code(200).send(condonationDto(result))
    },
  )

  done()
}

export const internalApprovalLinksRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const container = fastify.container

  // POST /api/v1/internal/approval-links
  // ADMIN or TESORERO creates an approval link. The route mints one
  // token per approver_channels entry (the legacy VFP process sends
  // the same link to multiple approvers — we keep the door open
  // for fan-out by accepting an array). The link is derived from a
  // server-side APP_BASE_URL or a sensible default.
  fastify.post(
    '/api/v1/internal/approval-links',
    { preHandler: requireRole('ADMIN', 'TESORERO') },
    async (request, reply) => {
      const body = throwIfInvalid(createLinkSchema, request.body, 'body')
      if (!request.operator) return

      // For PR 3b we only need ONE token per request — fan-out
      // delivery is the caller's job. We pick the first channel as
      // the canonical one and ignore the rest with a console note.
      const channel = body.approver_channels[0]
      if (!channel) return
      if (body.approver_channels.length > 1) {
        console.info(
          { requested: body.approver_channels.length },
          'approval-links: multiple approver_channels received; only the first is persisted (fan-out is the callers job)',
        )
      }

      const { raw, expiresAt, record } = await createApprovalToken(container.db, {
        actionType: body.action_type,
        actionId: body.action_id,
        contextSummary: body.context_summary,
        operatorId: request.operator.sub,
        approverChannel: channel.channel,
        approverAddress: channel.address,
        ...(body.expires_in_hours !== undefined ? { expiresInHours: body.expires_in_hours } : {}),
      })

      const baseUrl = process.env['APP_BASE_URL'] ?? 'http://localhost:3000'
      const link = `${baseUrl}/api/v1/approval/${raw}`

      return reply.code(201).send({
        token: raw,
        link,
        expires_at: expiresAt.toISOString(),
        id: record.id,
      })
    },
  )

  done()
}

// Type-safe Fastify decorator access (mirrors auth.ts).
declare module 'fastify' {
  interface FastifyInstance {
    container: AppContainer
  }
}
