import type { Db } from '@athlos/db'
import { auditEvents } from '@athlos/db/schema'
import { sendNotification } from '@athlos/notifications'
import type { DriftReport } from './detect.js'

export interface EmitDriftAlertOptions {
  jobRunId: string
}

/**
 * Emit a drift alert.
 *
 * Two write paths (documented in design §5):
 *   - operator event path: auditPlugin → @athlos/audit → audit_events
 *   - system event path:  drift cron  → emitDriftAlert → audit_events (direct)
 *
 * These paths are intentionally separate. This function writes DIRECTLY to
 * audit_events via Drizzle insert with operator_id=NULL (system event path).
 * It does NOT call @athlos/audit.
 *
 * The notification dispatcher fans out to DATA_STEWARD operators (7b.2 will
 * update the filter to use role_permissions; in 7b.1b it sends to ADMINs per
 * the existing dispatcher logic).
 */
export async function emitDriftAlert(
  db: Db,
  report: DriftReport,
  ctx: EmitDriftAlertOptions,
): Promise<{ audited: true; notificationDispatched: boolean }> {
  if (report.driftCount === 0) {
    return { audited: true, notificationDispatched: false }
  }

  // SYSTEM EVENT — no operator. Direct Drizzle insert; NEVER call
  // @athlos/audit here. The two paths are deliberately separate.
  await db.insert(auditEvents).values({
    operatorId: null,
    action: 'DRIFT_DETECTED',
    entityType: 'domain',
    entityId: report.domain ?? 'all',
    oldValue: null,
    newValue: null,
    sourceIp: null,
    metadata: {
      driftCount: report.driftCount,
      sample: report.drifts.slice(0, 5).map((d) => ({
        entityUuid: d.entityUuid,
        oldHash: d.oldHash,
        newHash: d.newHash,
      })),
    },
    idempotencyKey: null,
  })

  // Fire-and-forget notification. The dispatcher handles DATA_STEWARD routing;
  // in 7b.1b it uses the existing ADMIN filter; 7b.2 updates to
  // role_permissions based routing.
  void sendNotification({
    type: 'drift_alert',
    eventId: `${ctx.jobRunId}:${report.domain ?? 'all'}`,
    metadata: {
      domain: report.domain ?? 'all',
      count: report.driftCount,
      affectedKeys: report.drifts.slice(0, 5).map((d) => d.entityUuid),
    },
  })

  return { audited: true, notificationDispatched: true }
}
