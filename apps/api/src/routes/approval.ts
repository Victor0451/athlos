import type { FastifyPluginCallback } from 'fastify'
import { z } from 'zod'
import { BusinessError, ErrorCode, throwIfInvalid } from '@athlos/errors'
import { requireRole } from '@athlos/auth'
import { emitAudit, AuditAction } from '@athlos/audit'
import {
  consumeApprovalToken,
  createApprovalToken,
  createCommunityWorkApprovalRequest,
  createCondonationApprovalRequest,
  decideCommunityWorkApproval,
  decideCondonationApproval,
  findCommunityWorkRequest,
  findCondonationRequest,
  getApprovalToken,
  listCommunityWorkLifecycle,
  listCondonationLifecycle,
  listCondonationQueue,
  type CondonationQueueEntry,
  type CondonationSnapshot,
  type ApprovalTokenRecord,
} from '@athlos/approval'
import type { AppContainer } from '../container.ts'
import { selectFullOutstanding } from '../modules/dues/allocations.ts'
import { findActiveCommunityWorkAgreement } from '../modules/dues/agreements.ts'
import { CondonationExecutionService } from '../modules/dues/condonations.ts'
import { validateIdempotencyKey } from '../lib/idempotency.ts'
import { createHash, randomUUID } from 'node:crypto'

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
const condonationMemberSchema = z.object({ memberId: z.string().uuid() }).strict()
const condonationHistoryQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(100).default(25) })
  .strict()
const communityWorkMemberSchema = z.object({ memberId: z.string().uuid() }).strict()
const communityWorkHistoryQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(100).default(25) })
  .strict()
const condonationQueueQuerySchema = z
  .object({
    view: z.literal('all').optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().min(1).max(256).optional(),
  })
  .strict()
const condonationExecutionSchema = z.object({ execution_id: z.string().uuid() }).strict()
const communityWorkRequestSchema = z
  .object({
    member_id: z.string().uuid(),
    obligation_id: z.string().uuid(),
    context: z.string().trim().min(1).max(1000),
    reason: z.string().trim().min(1).max(500),
    evidence: z.string().trim().min(1).max(1000),
    agreement_id: z.string().uuid().optional(),
  })
  .strict()
const CONDONATION_REQUEST_GATE = { preHandler: requireRole('OPERADOR', 'ADMIN', 'TESORERO') }
const CONDONATION_DECISION_GATE = { preHandler: requireRole('ADMIN', 'TESORERO') }

/**
 * Community-work approval writes stay hidden until rollout is explicitly
 * authorized (default-off flag), mirroring the other BETA gates.
 */
function communityWorkEnabled(container: AppContainer): void {
  if (!container.env.COMMUNITY_WORK_APPROVALS_ENABLED)
    throw BusinessError(ErrorCode.NOT_FOUND, 'Resource not found')
}

/**
 * Server-captured decider fingerprint: SHA-256 of the presented credential.
 * Exact decision replays from the same session match; a different credential
 * is a divergent replay and conflicts in the helper.
 */
function actorFingerprint(request: { headers: Record<string, unknown> }): string | null {
  const header = request.headers['authorization']
  if (typeof header !== 'string' || header.trim() === '') return null
  return createHash('sha256').update(header).digest('hex')
}

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

function condonationLifecycleDto(
  row: Awaited<ReturnType<typeof listCondonationLifecycle>>[number],
) {
  const snapshot = row.condonationSnapshot as CondonationSnapshot
  const executed = row.executionReceiptId !== null
  const expired = row.expiresAt <= new Date()
  const state = executed
    ? 'executed'
    : expired
      ? 'expired'
      : row.status === 'rejected'
        ? 'rejected'
        : row.status === 'pending'
          ? 'pending'
          : 'approved_awaiting_execution'
  return {
    id: row.actionId,
    state,
    expires_at: row.expiresAt.toISOString(),
    decided_at: row.decidedAt?.toISOString() ?? null,
    execution_id: row.executionId,
    execution_status: executed ? 'executed' : row.executionId ? 'recoverable' : 'unavailable',
    snapshot: {
      member_id: snapshot.memberId,
      obligations: snapshot.obligations.map((item) => ({
        obligation_id: item.obligationId,
        currency: item.currency,
        outstanding_amount_cents: item.outstandingAmountCents,
      })),
    },
  }
}

function condonationQueueDto(row: CondonationQueueEntry) {
  return {
    ...condonationLifecycleDto(row),
    created_at: row.createdAt.toISOString(),
    current_member: {
      id: row.currentMember.id,
      numero_socio: row.currentMember.numeroSocio,
      nombre: row.currentMember.nombre,
      apellido: row.currentMember.apellido,
    },
    requester: row.requester,
    context: row.contextSummary,
    reason: row.requestReason,
    evidence: row.requestEvidence,
  }
}

function communityWorkLifecycleDto(
  row: Awaited<ReturnType<typeof listCommunityWorkLifecycle>>[number],
) {
  const snapshot = row.communitySnapshot as CondonationSnapshot
  const executed = row.executionReceiptId !== null
  const expired = row.expiresAt <= new Date()
  const state = executed
    ? 'executed'
    : expired
      ? 'expired'
      : row.status === 'rejected'
        ? 'rejected'
        : row.status === 'pending'
          ? 'pending'
          : 'approved_awaiting_execution'
  return {
    id: row.actionId,
    state,
    expires_at: row.expiresAt.toISOString(),
    decided_at: row.decidedAt?.toISOString() ?? null,
    execution_id: row.executionId,
    execution_status: executed ? 'executed' : row.executionId ? 'recoverable' : 'unavailable',
    snapshot: {
      member_id: snapshot.memberId,
      obligations: snapshot.obligations.map((item) => ({
        obligation_id: item.obligationId,
        currency: item.currency,
        outstanding_amount_cents: item.outstandingAmountCents,
      })),
    },
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

  // Both views read the same persisted requests; this endpoint never decides or executes them.
  fastify.get<{ Querystring: unknown }>(
    '/api/v1/condonation-requests',
    CONDONATION_DECISION_GATE,
    async (request, reply) => {
      const query = throwIfInvalid(condonationQueueQuerySchema, request.query, 'query')
      const limit = query.limit ?? 25
      const rows = await listCondonationQueue(container.db, {
        view: query.view ?? 'actionable',
        limit: limit + 1,
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      })
      const page = rows.slice(0, limit)
      const last = page.at(-1)
      const nextCursor =
        rows.length > limit && last
          ? Buffer.from(JSON.stringify({ t: last.createdAtCursor, id: last.id })).toString(
              'base64url',
            )
          : null
      return reply
        .header('Cache-Control', 'no-store')
        .send({ items: page.map(condonationQueueDto), next_cursor: nextCursor })
    },
  )

  fastify.get<{ Params: { memberId: string }; Querystring: unknown }>(
    '/api/v1/members/:memberId/condonation-requests',
    { preHandler: requireRole('OPERADOR', 'ADMIN', 'TESORERO') },
    async (request, reply) => {
      if (!request.operator) return
      const { memberId } = throwIfInvalid(condonationMemberSchema, request.params, 'params')
      const { limit } = throwIfInvalid(condonationHistoryQuerySchema, request.query, 'query')
      const treasury = request.operator.role === 'ADMIN' || request.operator.role === 'TESORERO'
      const rows = await listCondonationLifecycle(container.db, {
        memberId,
        limit: limit ?? 25,
        ...(treasury ? {} : { requesterId: request.operator.sub }),
      })
      return reply.code(200).send({ items: rows.map(condonationLifecycleDto) })
    },
  )

  // Community-work member-history — gated by rollout flag, mirrors condonation lifecycle.
  fastify.get<{ Params: { memberId: string }; Querystring: unknown }>(
    '/api/v1/members/:memberId/community-work-requests',
    { preHandler: requireRole('OPERADOR', 'ADMIN', 'TESORERO') },
    async (request, reply) => {
      if (!request.operator) return
      communityWorkEnabled(container)
      const { memberId } = throwIfInvalid(communityWorkMemberSchema, request.params, 'params')
      const { limit } = throwIfInvalid(communityWorkHistoryQuerySchema, request.query, 'query')
      const treasury = request.operator.role === 'ADMIN' || request.operator.role === 'TESORERO'
      const rows = await listCommunityWorkLifecycle(container.db, {
        memberId,
        limit: limit ?? 25,
        ...(treasury ? {} : { requesterId: request.operator.sub }),
      })
      return reply.code(200).send({ items: rows.map(communityWorkLifecycleDto) })
    },
  )

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
    if (
      candidate.actionType === 'dues.condonation' ||
      candidate.actionType === 'dues.community-work-request'
    ) {
      throw BusinessError(
        ErrorCode.INSUFFICIENT_PERMISSIONS,
        'Condonation and community-work decisions require an authenticated Treasury approver',
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

  // POST /api/v1/community-work-requests
  // Captures a financially inert community-work request. The snapshot is
  // server-captured (client amounts are never trusted); any supplied
  // agreement context is validated for member/obligation ownership.
  fastify.post<{ Body: unknown }>(
    '/api/v1/community-work-requests',
    CONDONATION_REQUEST_GATE,
    async (request, reply) => {
      if (!request.operator) return
      communityWorkEnabled(container)
      const body = throwIfInvalid(communityWorkRequestSchema, request.body, 'body')
      const key = callerKey(request)
      const result = await container.db.transaction(async (tx) => {
        const existing = await findCommunityWorkRequest(tx, request.operator!.sub, key)
        const snapshot = existing
          ? sameSnapshot(existing.communitySnapshot, body.member_id, [body.obligation_id])
            ? (existing.communitySnapshot as CondonationSnapshot)
            : (() => {
                throw BusinessError(
                  ErrorCode.CONFLICT,
                  'Idempotency key was already used for a different request',
                )
              })()
          : await selectFullOutstanding(tx, {
              socioId: body.member_id,
              obligationIds: [body.obligation_id],
            }).then((selection) => ({
              memberId: selection.socioId,
              obligations: selection.allocations.map((item) => ({
                obligationId: item.obligationId,
                currency: selection.currency,
                outstandingAmountCents: item.amountCents,
              })),
            }))
        let agreementUuid: string | null = null
        let termsVersion: number | null = null
        if (body.agreement_id !== undefined) {
          if (existing) {
            // a replay must carry the same agreement context
            if (existing.agreementUuid !== body.agreement_id)
              throw BusinessError(
                ErrorCode.CONFLICT,
                'Idempotency key was already used for a different request',
              )
            agreementUuid = existing.agreementUuid
            termsVersion = existing.termsVersion
          } else {
            const agreement = await findActiveCommunityWorkAgreement(tx, {
              agreementId: body.agreement_id,
              socioId: body.member_id,
              obligationId: body.obligation_id,
            })
            if (!agreement)
              throw BusinessError(
                ErrorCode.CONFLICT,
                'Agreement context does not match this member and obligation',
              )
            agreementUuid = body.agreement_id
            termsVersion = agreement.termsVersion
          }
        }
        const created = await createCommunityWorkApprovalRequest(tx, {
          requestId: randomUUID(),
          contextSummary: body.context,
          requesterId: request.operator!.sub,
          requesterKey: existing?.requesterKey ?? randomUUID(),
          approverChannel: 'email',
          approverAddress: 'authenticated-treasury',
          snapshot,
          reason: body.reason,
          evidence: body.evidence,
          callerKey: key,
          agreementUuid,
          termsVersion,
        })
        await emitAudit(tx, {
          operatorId: request.operator!.sub,
          action: AuditAction.COMMUNITY_WORK_REQUEST_CREATED,
          entityType: 'community_work_request',
          entityId: created.record.id,
          oldValue: null,
          newValue: { status: 'pending', financial_execution: false },
          sourceIp: request.ip ?? null,
          callerKey: key,
          metadata: {
            request_id: created.record.actionId,
            requester_id: request.operator!.sub,
            snapshot,
            agreement_uuid: agreementUuid,
            terms_version: termsVersion,
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

  // POST /api/v1/community-work-requests/:id/decision
  // Records one Treasury decision. The decision only authorizes later
  // execution (U4); it never consumes the token or touches money.
  // Idempotency comes from the exact-decision identity in the helper
  // (same decision/actor/reason/evidence/credential fingerprint), and
  // the audit emitter dedups replays; no Idempotency-Key is required,
  // mirroring the preserved condonation decision contract.
  fastify.post<{ Params: { id: string }; Body: unknown }>(
    '/api/v1/community-work-requests/:id/decision',
    CONDONATION_DECISION_GATE,
    async (request, reply) => {
      if (!request.operator) return
      communityWorkEnabled(container)
      const { id } = throwIfInvalid(condonationIdSchema, request.params, 'params')
      const body = throwIfInvalid(condonationDecisionSchema, request.body, 'body')
      const result = await container.db.transaction(async (tx) => {
        const decided = await decideCommunityWorkApproval(tx, {
          requestId: id,
          actorId: request.operator!.sub,
          decision: body.decision,
          reason: body.reason,
          evidence: body.evidence,
          actorFingerprint: actorFingerprint(request),
        })
        await emitAudit(tx, {
          operatorId: request.operator!.sub,
          action: AuditAction.COMMUNITY_WORK_DECISION_RECORDED,
          entityType: 'community_work_request',
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
            snapshot: decided.communitySnapshot,
            agreement_uuid: decided.agreementUuid,
            terms_version: decided.termsVersion,
            outcome: `${decided.status}_no_financial_execution`,
          },
        })
        return decided
      })
      return reply.code(200).send(condonationDto(result))
    },
  )
  fastify.post<{ Params: { id: string }; Body: unknown }>(
    '/api/v1/condonation-requests/:id/execution',
    CONDONATION_DECISION_GATE,
    async (request, reply) => {
      if (!request.operator) return
      const { id } = throwIfInvalid(condonationIdSchema, request.params, 'params')
      const { execution_id: executionId } = throwIfInvalid(
        condonationExecutionSchema,
        request.body,
        'body',
      )
      const result = await new CondonationExecutionService(container.db).executeApproved({
        requestId: id,
        executionId,
        actorId: request.operator.sub,
        callerKey: callerKey(request),
        sourceIp: request.ip ?? null,
      })
      return reply.code(200).send({
        execution_id: result.executionId,
        approval_id: result.approvalId,
        member_id: result.memberId,
        currency: result.currency,
        approved_amount_cents: result.totalAmountCents,
        treatment_ids: result.treatmentIds,
        status: result.status,
      })
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
