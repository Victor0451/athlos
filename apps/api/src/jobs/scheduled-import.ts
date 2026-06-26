import type { Db } from '@athlos/db'
import type { JobHandler } from '@athlos/scheduler'
import { runImport, type ImportTableSummary } from '@athlos/import'
import { rebuildProjection, DOMAIN_PROJECTION_TABLE, type Domain } from '@athlos/projection'

/**
 * Build the `scheduled-import` job handler.
 *
 * Body (PR 7b.1a — TASK-069):
 *   1. Call `runImport(db, { trigger: 'scheduled', batchId: ctx.jobRunId })`.
 *   2. On success: rebuild projections for every domain that was imported.
 *      The rebuild is idempotent (TRUNCATE + replay), so re-running is safe.
 *
 * Post-import `freshnessSvc.refreshAll()` is wired in 7b.1b (TASK-076)
 * once `@athlos/freshness` is available.
 *
 * Manual trigger: the admin endpoint (PR 6b TASK-050) calls
 * `scheduler.runNow('scheduled-import', { triggeredBy: 'manual' })` —
 * the trigger value in `ctx.triggeredBy` is what the import pipeline
 * logs for lineage.
 */
export function makeScheduledImportHandler(db: Db): JobHandler {
  return async (ctx) => {
    ctx.log.info(
      { event: 'SCHEDULED_IMPORT_START', triggeredBy: ctx.triggeredBy },
      'starting scheduled import',
    )

    const batch = await runImport(db, {
      trigger: ctx.triggeredBy === 'manual' ? 'manual' : 'scheduled',
      batchId: ctx.jobRunId,
      ...(process.env['LEGACY_DB_PATH'] !== undefined
        ? { basePath: process.env['LEGACY_DB_PATH'] }
        : {}),
    })

    // Post-import: rebuild projections for domains that had imports.
    // rebuildProjection is idempotent (TRUNCATE + replay), so rebuilding
    // a domain with zero raw_events is a no-op.
    if (batch.status === 'succeeded') {
      const importedDomains = batch.tables
        .filter((t: ImportTableSummary) => t.recordsRead > 0)
        .map((t: ImportTableSummary) => t.table as Domain)

      // Rebuild projections for imported domains
      for (const domain of importedDomains) {
        if (!DOMAIN_PROJECTION_TABLE[domain]) continue // skip unknown domains
        try {
          await rebuildProjection(db, domain)
          ctx.log.info(
            { event: 'PROJECTION_REBUILT', domain, table: DOMAIN_PROJECTION_TABLE[domain] },
            `projection rebuilt for ${domain}`,
          )
        } catch (err) {
          ctx.log.error(
            {
              event: 'PROJECTION_REBUILD_FAILED',
              domain,
              error: err instanceof Error ? err.message : String(err),
            },
            `projection rebuild failed for ${domain}`,
          )
          // Continue rebuilding other domains — don't abort the whole job
        }
      }
    }

    return {
      status: 'succeeded',
      metadata: {
        imported_tables: batch.totals.read,
        inserted: batch.totals.inserted,
        skipped: batch.totals.skipped,
        failed: batch.totals.failed,
        batch_id: batch.id,
        batch_status: batch.status,
        error_message: batch.errorMessage,
      },
    }
  }
}
