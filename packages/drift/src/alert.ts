import type { Db } from '@athlos/db'
import type { DriftReport } from './detect.js'

export interface EmitDriftAlertOptions {
  jobRunId: string
}

/**
 * Emit a drift alert: direct Drizzle insert into audit_events (system event,
 * operator_id=NULL) + fire-and-forget notification to DATA_STEWARD via
 * the notification dispatcher.
 *
 * Two write paths (documented in code):
 *   - operator event path: auditPlugin → @athlos/audit → audit_events
 *   - system event path:  drift cron  → emitDriftAlert → audit_events (direct)
 *
 * These paths are intentionally separate.
 */
export async function emitDriftAlert(
  _db: Db,
  _report: DriftReport,
  _ctx: EmitDriftAlertOptions,
): Promise<{ audited: true; notificationDispatched: boolean }> {
  // TODO: implement
  return { audited: true, notificationDispatched: false }
}
