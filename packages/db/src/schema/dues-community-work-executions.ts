import { sql } from 'drizzle-orm'
import {
  check,
  index,
  numeric,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { tesoreriaSchema } from './tesoreria.ts'
import { approvalTokens } from './approval-tokens.ts'
import { duesSettlements } from './dues-settlements.ts'
import { duesObligations } from './dues.ts'

/**
 * `dues_community_work_executions` — executes approved community-work requests.
 *
 * Community-only uniqueness: `(action_id, requester_key)` must be unique;
 * there is NO obligation-level uniqueness — multiple pending requests per
 * obligation are permitted, first valid execution wins, others become stale.
 *
 * All financial linkage columns reference existing settlement/allocation rows
 * created by the atomic executor (Unit 4); they start as null until executed.
 */
// prettier-ignore
export const duesCommunityWorkExecutions = tesoreriaSchema.table('dues_community_work_executions', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Reference to the approved request token. Required. */
  approvalTokenId: uuid('approval_token_id')
    .notNull()
    .references((): AnyPgColumn => approvalTokens.id, { onDelete: 'restrict' }),
  /** Settlement created by atomic execution. Null until executed. */
  settlementId: uuid('settlement_id').references(
    (): AnyPgColumn => duesSettlements.id,
    { onDelete: 'restrict' },
  ),
  /** Internal action ID (e.g. "community-work.approved"). Unique+requester pair enforces once-per-request. */
  actionId: text('action_id').notNull(),
  /** Caller key identifying who requested this community-work. Paired with actionId for uniqueness. */
  requesterKey: text('requester_key').notNull(),
  /** Amount settled via NON_CASH. Positive cents enforced by CHECK. */
  amountCents: numeric('amount_cents', { precision: 14, scale: 2 }),
  /** Obligation target ID for linking allocations. Null until executed. */
  allocationId: uuid('allocation_id').references(
    (): AnyPgColumn => duesObligations.id,
    { onDelete: 'restrict' },
  ),
  /** Server-captured snapshot actor fingerprint. NOT NULL. */
  snapshotActorFingerprint: text('snapshot_actor_fingerprint').notNull(),
  /** Execution receipt hash. NOT NULL. */
  receipt: text('receipt').notNull(),
  /** When the execution was recorded. */
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  /** Unique per (action, requester): one execution per distinct request. No obligation uniqueness. */
  actionRequesterUnique: uniqueIndex(
    'dues_community_work_executions_action_requester_unique',
  ).on(table.actionId, table.requesterKey),
  /** Index on approval token for execution lookups and stale detection. */
  approvalIdx: index('dues_community_work_executions_approval_idx').on(table.approvalTokenId),
  /** Fingerprint index for replay validation. */
  fingerprintIdx: index('dues_community_work_executions_fingerprint_idx').on(table.snapshotActorFingerprint),
  /** Mirrors the 0071 SQL CHECK: amount is NULL pre-execution, strictly positive after. */
  amountPositive: check(
'dues_cwe_amount_positive_check',
sql`(${table.amountCents} IS NULL OR ${table.amountCents} > 0)`,
  ),
}))

// Note: Due to forward-reference limitation in Drizzle (duesAllocations not yet defined),
// we create the allocation FK constraint separately in the migration.
// Types follow below.
export type DuesCommunityWorkExecution = typeof duesCommunityWorkExecutions.$inferSelect
export type NewDuesCommunityWorkExecution = typeof duesCommunityWorkExecutions.$inferInsert
