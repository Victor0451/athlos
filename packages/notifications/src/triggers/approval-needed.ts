import type { NotificationEvent } from '../types.ts'

/**
 * Approval-needed trigger. The approval-link service calls
 * `buildApprovalEvent(ctx)` after persisting a new
 * `approval_tokens` row. The dispatcher delivers via the
 * approver's channel (whatsapp OR email) — never both.
 *
 * The `eventId` is `<approvalTokenId>:approval-link-created`
 * so a re-render of the same link dedups to a single send.
 */
export interface ApprovalContext {
  approvalTokenId: string
  approverAddress: string
  approverChannel: 'whatsapp' | 'email'
  approvalUrl: string
}

/**
 * Should the trigger fire? v1: every approval link. The
 * channel decision is in the context, not the policy.
 */
export function shouldFireApproval(_ctx: ApprovalContext): boolean {
  return true
}

/**
 * Build the dispatcher event. The dispatcher uses
 * `approverChannel` to pick the single channel — never
 * fan out across channels for approval links.
 */
export function buildApprovalEvent(ctx: ApprovalContext): NotificationEvent {
  return {
    type: 'approval_link_created',
    eventId: `${ctx.approvalTokenId}:approval-link-created`,
    metadata: {
      approverAddress: ctx.approverAddress,
      approverChannel: ctx.approverChannel,
      approvalUrl: ctx.approvalUrl,
    },
  }
}
