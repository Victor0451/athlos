import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    actionIdx: index('approval_tokens_action_idx').on(table.actionType, table.actionId),
  }),
)

export type ApprovalToken = typeof approvalTokens.$inferSelect
export type NewApprovalToken = typeof approvalTokens.$inferInsert
