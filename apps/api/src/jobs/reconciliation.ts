import type { JobHandler } from '@athlos/scheduler'
import type { ProjectionService, DriftService } from '../container.ts'

/**
 * Build the `reconciliation` job handler.
 *
 * Runs on a configurable cron (default: daily at 02:00 Argentina TZ).
 * The full reconciliation logic (design §8):
 *   1. Rebuild all 11 domain projections (truncate + replay raw_events)
 *   2. Detect drift across all domains
 *
 * Returns metadata for the admin health endpoint to surface.
 *
 * The `rebuildAll()` call is idempotent — same raw_events → same end state.
 * Drift detection uses `detectAll()` which scans all domains.
 */
export function makeReconciliationHandler(
  projectionService: ProjectionService,
  driftService: DriftService,
): JobHandler {
  return async (ctx) => {
    ctx.log.info({ event: 'RECONCILIATION_START' }, 'starting reconciliation')

    // Step 1: rebuild all domain projections
    const rebuildResult = await projectionService.rebuildAll()

    // Step 2: detect drift across all domains
    const driftReport = await driftService.detectAll()

    const totalDriftCount = driftReport.driftCount

    ctx.log.info(
      {
        event: 'RECONCILIATION_COMPLETE',
        domainsChecked: rebuildResult.domainsChecked.length,
        totalRowCount: rebuildResult.totalRowCount,
        driftCount: totalDriftCount,
      },
      'reconciliation complete',
    )

    return {
      status: 'succeeded',
      metadata: {
        domains_checked: rebuildResult.domainsChecked,
        total_rows: rebuildResult.totalRowCount,
        drift_count: totalDriftCount,
      },
    }
  }
}
