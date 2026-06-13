import type { FastifyPluginCallback } from 'fastify'
import { z } from 'zod'
import { BusinessError, ErrorCode, throwIfInvalid } from '@athlos/errors'
import { requireRole } from '@athlos/auth'
import {
  consumeApprovalToken,
  createApprovalToken,
  getApprovalToken,
  type ApprovalTokenRecord,
} from '@athlos/approval'
import type { AppContainer } from '../container.ts'

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
