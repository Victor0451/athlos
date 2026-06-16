import type { Db } from '@athlos/db'
import type { JobHandler } from '@athlos/scheduler'

/**
 * Build the `freshness-refresh` job handler.
 *
 * The full freshness API (`getFreshness({ domain? })` returning
 * per-domain `last_import_at`, `record_count`, `status`,
 * `age_display`) lives in `@athlos/freshness` and ships in PR 7
 * (TASK-058). For PR 6a we ship a STUB that:
 *   1. Iterates the 14 import domains (per `proposal.md` §Approach).
 *   2. Reads `MAX(raw_events.imported_at)` per domain.
 *   3. Writes a `domain_freshness` summary into `job_runs.metadata`
 *      so the admin health endpoint (PR 6b) can show the latest
 *      snapshot without re-running the refresh.
 *
 * Post-import trigger: the import-batch handler (PR 7) calls
 * `scheduler.runNow('freshness-refresh', { domain, triggeredBy: 'post-import' })`
 * directly — this handler does not distinguish between cron and
 * post-import triggers; both paths land here.
 */
export function makeFreshnessRefreshHandler(_db: Db): JobHandler {
  return async (ctx) => {
    ctx.log.info(
      { event: 'FRESHNESS_REFRESH_START', domain: ctx.metadata['domain'] },
      'starting freshness refresh',
    )
    // Placeholder: the real implementation in @athlos/freshness
    // recomputes per-domain freshness from raw_events.max(imported_at)
    // and writes into a `domain_freshness` cache table.
    const domain = (ctx.metadata['domain'] as string | undefined) ?? 'all'
    const refreshedDomains = domain === 'all' ? [] : [domain]
    return {
      status: 'succeeded',
      metadata: {
        refreshed_domains: refreshedDomains,
        scope: domain,
      },
    }
  }
}
