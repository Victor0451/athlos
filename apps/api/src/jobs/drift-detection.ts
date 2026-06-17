import type { Db } from '@athlos/db'
import type { JobHandler } from '@athlos/scheduler'
import { TechnicalError } from '@athlos/errors'

/**
 * Build the `drift-detection` job handler.
 *
 * Body (PR 7b.1b — TASK-076):
 *   1. Call `makeDriftService(db).detectAll()` (all domains).
 *   2. Loop over reports; call `service.emitDriftAlert(report, { jobRunId })`
 *      for each with driftCount > 0.
 *   3. Return { status: 'succeeded', metadata: { drift_count, domains } }.
 *
 * In PR 7b.1a we ship the SKELETON (stub that returns 0 drift).
 * The full body is completed in TASK-076 (7b.1b).
 */
export function makeDriftDetectionHandler(_db: Db): JobHandler {
  return async (ctx) => {
    ctx.log.info({ event: 'DRIFT_DETECTION_START' }, 'starting drift detection')
    // The full implementation is in @athlos/drift.detect({ domain? }).
    // In PR 6a we ship the stub; the PR 7 swap is a one-line import.
    const driftCount = 0
    const affectedDomains: string[] = []
    if (driftCount > 0) {
      ctx.log.warn(
        { event: 'DRIFT_DETECTED', driftCount, affectedDomains },
        'drift detected — alert will be emitted by PR 7 notification triggers',
      )
    } else {
      ctx.log.info({ event: 'DRIFT_NOT_DETECTED' }, 'no drift — clean run')
    }
    // Surface the result in job_runs.metadata so the admin history
    // endpoint (PR 6b) can render it without re-running the detector.
    return {
      status: 'succeeded',
      metadata: {
        drift_count: driftCount,
        domains: affectedDomains,
      },
    }
  }
}

/**
 * Placeholder for the real drift detection. Throw a TechnicalError
 * when called so accidental wiring in PR 6a surfaces a clear
 * "not yet implemented" rather than a silent zero.
 *
 * PR 7 deletes this function and imports `detect` from
 * `@athlos/drift` instead.
 */
export async function runDriftDetection(
  _db: Db,
  _opts: { domain?: string } = {},
): Promise<{ driftCount: number; affectedDomains: string[] }> {
  // Wired as a TechnicalError so a misconfigured boot that triggers
  // drift detection prematurely surfaces in the dead-letter queue
  // rather than silently reporting 0.
  throw TechnicalError(
    'INTERNAL_ERROR' as never,
    'drift.detect not implemented — lands in PR 7 (TASK-057)',
  )
}
