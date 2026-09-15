import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { operators } from './operators.ts'

/**
 * `approval_tokens` — scoped, single-use links sent to a human approver
 * via WhatsApp or email. The link is presented as
 * `https://app/api/approval/<raw-token>`; the API stores the SHA-256
 * hash, not the raw value. The approver can view context and approve
 * or reject without logging in (the auth-login spec §"Scoped Approval
 * Links" makes the read endpoint public-by-token).
 *
 * The status column is maintained by the service layer in parallel
 * with `used_at` — the two are denormalised on purpose so list views
 * (`GET /api/v1/internal/approval-links`) don't need to recompute
 * `used_at IS NOT NULL OR expires_at < now()` on every row.
 *
 * Two indexes:
 *   - `token_hash` for the hot lookup path (`WHERE token_hash = $1`).
 *   - `(action_type, action_id)` for "show me all approval attempts
 *     for this payment order" (audit and lineage).
 */
export const approvalTokens = pgTable(
  'approval_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull().unique(),
    actionType: text('action_type').notNull(),
    actionId: text('action_id').notNull(),
    contextSummary: text('context_summary').notNull(),
    createdByOperatorId: uuid('created_by_operator_id')
      .notNull()
      .references(() => operators.id, { onDelete: 'restrict' }),
    approverChannel: text('approver_channel').notNull(),
    approverAddress: text('approver_address').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    /** Mirrors used_at for list views; updated by the service layer. */
    status: text('status')
      .notNull()
      .default('pending')
      .$type<'pending' | 'approved' | 'rejected' | 'expired'>(),
    condonationSnapshot: jsonb('condonation_snapshot'),
    requestReason: text('request_reason'),
    requestEvidence: text('request_evidence'),
    decidedByOperatorId: uuid('decided_by_operator_id').references(() => operators.id, {
      onDelete: 'restrict',
    }),
    decisionReason: text('decision_reason'),
    decisionEvidence: text('decision_evidence'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    executionId: uuid('execution_id'),
    callerKey: text('caller_key'),
    requestFingerprint: text('request_fingerprint'),
    /** Community-work specific snapshot — nullable to preserve legacy condonation rows. */
    communitySnapshot: jsonb('community_snapshot'),
    /** Requester key for community-work action tracking. Nullable. */
    requesterKey: text('requester_key'),
    /** Agreement UUID context for community-work. Nullable. */
    agreementUuid: uuid('agreement_uuid'),
    /** Terms version captured at request time. Nullable. */
    termsVersion: integer('terms_version'),
    /** Server-captured actor fingerprint for community-work requests. Required once present. */
    actorFingerprint: text('actor_fingerprint').notNull(),
    /** Execution receipt. Populated after successful execution. */
    receipt: text('receipt'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    actionIdx: index('approval_tokens_action_idx').on(table.actionType, table.actionId),
    condonationRequestIdempotencyIdx: uniqueIndex(
      'approval_tokens_condonation_request_idempotency_idx',
    )
      .on(table.createdByOperatorId, table.callerKey)
      .where(sql`${table.actionType} = 'dues.condonation' AND ${table.callerKey} IS NOT NULL`),
    /** Index for community-work lookup by action/requester. */
    communityWorkIdx: index('approval_tokens_community_work_idx')
      .on(table.actionType, table.requesterKey)
      .where(sql`${table.actionType} = 'dues.community-work-request'`),
  }),
)

export type ApprovalToken = typeof approvalTokens.$inferSelect
export type NewApprovalToken = typeof approvalTokens.$inferInsert
