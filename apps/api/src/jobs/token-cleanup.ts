import { and, isNull, lt, or } from 'drizzle-orm'
import type { Db } from '@athlos/db'
import { refreshTokens, approvalTokens, auditEvents } from '@athlos/db'
import type { JobHandler } from '@athlos/scheduler'

/**
 * Build the `token-cleanup` job handler — the only fully-implemented
 * handler in PR 6a. The job runs daily at 03:00 (configurable) and
 * deletes:
 *
 *   1. Refresh tokens whose `expires_at < now() - 7 days` OR
 *      `revoked_at < now() - 7 days`.
 *   2. Approval tokens whose `expires_at < now() - 30 days` OR
 *      `used_at < now() - 30 days`.
 *   3. Audit events older than `AUDIT_RETENTION_DAYS` (default 90).
 *
 * Returns `{ deleted_refresh_tokens, deleted_approval_tokens,
 * deleted_audit_events, audit_retention_days }` in the
 * `job_runs.metadata` so the admin history endpoint surfaces the
 * cleanup counts.
 *
 * Spec reference: scheduler-jobs spec §"Token Cleanup".
 */
export function makeTokenCleanupHandler(db: Db, auditRetentionDays: number): JobHandler {
  return async (ctx) => {
    ctx.log.info({ event: 'TOKEN_CLEANUP_START' }, 'starting token cleanup')

    // 1. Refresh tokens: expired > 7 days ago OR revoked > 7 days ago.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const refreshResult = await db
      .delete(refreshTokens)
      .where(
        or(
          lt(refreshTokens.expiresAt, sevenDaysAgo),
          and(isNull(refreshTokens.expiresAt), lt(refreshTokens.revokedAt, sevenDaysAgo)),
        ),
      )
    const deletedRefreshTokens = readRowCount(refreshResult)

    // 2. Approval tokens: expired > 30 days ago OR used > 30 days ago.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const approvalResult = await db
      .delete(approvalTokens)
      .where(
        or(lt(approvalTokens.expiresAt, thirtyDaysAgo), lt(approvalTokens.usedAt, thirtyDaysAgo)),
      )
    const deletedApprovalTokens = readRowCount(approvalResult)

    // 3. Audit events older than the retention window.
    const retentionCutoff = new Date(Date.now() - auditRetentionDays * 24 * 60 * 60 * 1000)
    const auditResult = await db
      .delete(auditEvents)
      .where(lt(auditEvents.createdAt, retentionCutoff))
    const deletedAuditEvents = readRowCount(auditResult)

    ctx.log.info(
      {
        event: 'TOKEN_CLEANUP_DONE',
        deletedRefreshTokens,
        deletedApprovalTokens,
        deletedAuditEvents,
        audit_retention_days: auditRetentionDays,
      },
      'token cleanup finished',
    )

    return {
      status: 'succeeded',
      metadata: {
        deleted_refresh_tokens: deletedRefreshTokens,
        deleted_approval_tokens: deletedApprovalTokens,
        deleted_audit_events: deletedAuditEvents,
        audit_retention_days: auditRetentionDays,
      },
    }
  }
}

/**
 * The Drizzle `delete` builder returns a row count that is shaped
 * differently between the real driver and the test standin. Real
 * Postgres returns `{ rowCount: number }`; the standin returns an
 * array (the rows it matched, before delete — which is always empty
 * in v1 because the standin does not implement delete). We normalise
 * to a number so the caller gets a stable contract.
 */
function readRowCount(result: unknown): number {
  if (Array.isArray(result)) return result.length
  if (result && typeof result === 'object' && 'rowCount' in result) {
    const n = (result as { rowCount: unknown }).rowCount
    if (typeof n === 'number') return n
  }
  return 0
}
