import type { Db } from '@athlos/db'
import type { JobHandler } from '@athlos/scheduler'
import { refreshAll } from '@athlos/freshness'

/**
 * Build the `freshness-refresh` job handler.
 *
 * Recomputes per-domain freshness stats from raw_events (MAX(imported_at)
 * + COUNT(*) per source_table) and upserts the domain_freshness cache table.
 *
 * Post-import trigger: the import-batch handler calls
 * `scheduler.runNow('freshness-refresh', { domain, triggeredBy: 'post-import' })`
 * directly — this handler does not distinguish between cron and
 * post-import triggers; both paths land here.
 */
export function makeFreshnessRefreshHandler(db: Db): JobHandler {
  return async (ctx) => {
    const domain = (ctx.metadata['domain'] as string | undefined) ?? undefined
    ctx.log.info(
      { event: 'FRESHNESS_REFRESH_START', domain: domain ?? 'all' },
      'starting freshness refresh',
    )

    const refreshed = await refreshAll(db, domain ? { domain } : {})

    ctx.log.info(
      { event: 'FRESHNESS_REFRESH_DONE', refreshedDomains: refreshed.map((r) => r.domain) },
      'freshness refresh complete',
    )

    return {
      status: 'succeeded',
      metadata: {
        refreshed_domains: refreshed.map((r) => r.domain),
        scope: domain ?? 'all',
      },
    }
  }
}
