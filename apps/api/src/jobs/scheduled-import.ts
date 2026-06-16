import type { Db } from '@athlos/db'
import type { JobHandler } from '@athlos/scheduler'

/**
 * Build the `scheduled-import` job handler.
 *
 * The full import pipeline (`runImport({ trigger, domain? })` reading
 * 14 legacy DBF tables, writing into `raw_events`, rebuilding
 * projections) lives in `@athlos/import` and ships in PR 7
 * (TASK-053). For PR 6a we ship a STUB that:
 *   1. Runs on cron (default `0 2 * * *` — 02:00 Argentina time).
 *   2. Logs the trigger and the date range covered.
 *   3. Returns `succeeded` with `imported_tables: 0` (the count is
 *      filled in by the real implementation in PR 7).
 *
 * The real handler in PR 7 will:
 *   - Read 14 tables from `LEGACY_DBF_PATH`.
 *   - Compute content hash for each row.
 *   - Insert into `raw_events` with `ON CONFLICT (source_table, source_key, content_hash) DO NOTHING`.
 *   - On success, call `scheduler.runNow('freshness-refresh', { triggeredBy: 'post-import', domain })`.
 *
 * Manual trigger: the admin endpoint (PR 6b TASK-050) calls
 * `scheduler.runNow('scheduled-import', { triggeredBy: 'manual' })` —
 * the trigger value in `ctx.triggeredBy` is what the import pipeline
 * logs for lineage.
 */
export function makeScheduledImportHandler(_db: Db): JobHandler {
  return async (ctx) => {
    ctx.log.info(
      {
        event: 'SCHEDULED_IMPORT_START',
        triggeredBy: ctx.triggeredBy,
      },
      'starting scheduled import',
    )
    // PR 7 replaces this body with `runImport({ trigger: 'scheduled' })`.
    // The handler's return shape is stable: callers (the admin endpoint
    // and the import pipeline's post-trigger) consume metadata only.
    return {
      status: 'succeeded',
      metadata: {
        imported_tables: 0,
        triggered_by: ctx.triggeredBy,
      },
    }
  }
}
