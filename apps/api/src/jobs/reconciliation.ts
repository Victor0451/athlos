import type { Db } from '@athlos/db'
import type { JobHandler } from '@athlos/scheduler'

/**
 * Build the `reconciliation` job handler.
 *
 * Runs hourly (configurable via `RECONCILIATION_CRON`). Compares
 * `raw_events` row counts vs projection row counts per domain, and
 * emits a `RECONCILIATION_DRIFT` audit event when the counts diverge
 * by more than the configured threshold.
 *
 * The full reconciliation logic ships in PR 7. For PR 6a we ship a
 * STUB that:
 *   1. Reports `mismatched_domains: 0` (the real implementation
 *      iterates 14 domains and compares counts).
 *   2. Records the run in `job_runs.metadata` so the admin health
 *      endpoint (PR 6b) surfaces the snapshot.
 *
 * The handler is gated by `RECONCILIATION_CRON` being set — when
 * unset, the scheduler registers the job with `enabled: false` and
 * the cron task is not created. Manual `runNow` still works.
 */
export function makeReconciliationHandler(_db: Db): JobHandler {
  return async (ctx) => {
    ctx.log.info({ event: 'RECONCILIATION_START' }, 'starting reconciliation')
    // PR 7 replaces this body with the real comparison logic. The
    // return shape is stable: `mismatched_domains` is consumed by
    // the admin health endpoint to populate `lastRun.metadata`.
    return {
      status: 'succeeded',
      metadata: {
        mismatched_domains: 0,
        domains_checked: 0,
      },
    }
  }
}
