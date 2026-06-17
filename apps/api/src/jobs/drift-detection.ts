import type { Db } from '@athlos/db'
import type { JobHandler } from '@athlos/scheduler'
import { detect, emitDriftAlert } from '@athlos/drift'

/**
 * Build the `drift-detection` job handler.
 *
 * Detects schema drift by comparing the latest raw_events content_hash
 * per entity against the stored snapshot in drift_snapshots.
 * Emits an audit event + notification dispatch for each report with
 * non-zero drift.
 */
export function makeDriftDetectionHandler(db: Db): JobHandler {
  return async (ctx) => {
    ctx.log.info({ event: 'DRIFT_DETECTION_START' }, 'starting drift detection')

    const domain = (ctx.metadata['domain'] as string | undefined) ?? undefined
    const report = await detect(db, domain ? { domain } : {})

    if (report.driftCount > 0) {
      ctx.log.warn(
        { event: 'DRIFT_DETECTED', driftCount: report.driftCount, domain: report.domain },
        'drift detected — emitting alert',
      )
      await emitDriftAlert(db, report, { jobRunId: ctx.jobRunId })
    } else {
      ctx.log.info({ event: 'DRIFT_NOT_DETECTED' }, 'no drift — clean run')
    }

    return {
      status: 'succeeded',
      metadata: {
        drift_count: report.driftCount,
        domain: report.domain ?? 'all',
        scanned: report.scanned,
      },
    }
  }
}
