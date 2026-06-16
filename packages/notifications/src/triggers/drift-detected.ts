import type { NotificationEvent } from '../types.ts'

/**
 * Drift-detected trigger — the drift-detector calls
 * `buildDriftEvent(ctx)` after every scan, passing the affected
 * domain and the count + sample of drifted keys. The event is
 * forwarded to the dispatcher, which fans out to all ADMIN
 * operators via email + in-app.
 *
 * The `eventId` convention for drift events is
 * `<jobRunId>:<domain>` so retries from the same scheduled run
 * dedup to a single dispatch.
 */
export interface DriftContext {
  jobRunId: string
  domain: 'socios' | 'ctacte' | 'padrones' | 'deportes'
  count: number
  affectedKeys: string[]
}

/**
 * Decide whether the trigger should fire. v1 fires on every
 * scan that finds drift; a count of 0 means "no drift" and
 * the trigger is skipped. The function exists so future
 * policies (e.g. "only fire after N consecutive failed scans")
 * have a place to live.
 */
export function shouldFireDrift(ctx: DriftContext): boolean {
  return ctx.count > 0
}

/**
 * Build the dispatcher event for a drift finding. The
 * dispatcher handles fan-out and audit; this function only
 * shapes the input.
 */
export function buildDriftEvent(ctx: DriftContext): NotificationEvent {
  return {
    type: 'drift_alert',
    eventId: `${ctx.jobRunId}:${ctx.domain}`,
    metadata: {
      domain: ctx.domain,
      count: ctx.count,
      affectedKeys: ctx.affectedKeys,
    },
  }
}
