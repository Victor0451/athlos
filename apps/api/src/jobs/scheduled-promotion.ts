import type { Db } from '@athlos/db'
import type { JobHandler } from '@athlos/scheduler'
import { promoteAll } from '@athlos/promotion'
import type { AppContainer } from '../container.ts'

/**
 * Build the `scheduled-promotion` job handler.
 *
 * Runs `promoteAll(db)` via the scheduler, with the same
 * `promotionInFlight` flag as the sync `POST /api/v1/promote/trigger`
 * endpoint — so manual triggers and scheduled ticks never overlap.
 *
 * The handler is a thin wrapper: domain errors propagate as a thrown
 * exception, which the scheduler catches + retries per the retry policy
 * (30s → 120s → 600s, dead-letter after 3 attempts).
 *
 * Returns `{ status: 'succeeded', metadata: { totals, durationMs, domains } }`
 * on success — metadata is merged into `job_runs.metadata` and surfaced
 * by `GET /api/v1/admin/jobs/runs?job=scheduled-promotion`.
 */
export function makeScheduledPromotionHandler(db: Db, container: AppContainer): JobHandler {
  return async (ctx) => {
    if (container.promotionInFlight) {
      // Concurrent-trigger guard — same as sync endpoint. Throws so the
      // scheduler catches it via retry (the next tick will succeed once
      // the sync run finishes). Operator sees a `failed` row with
      // `error_message='promotion already in flight'`.
      throw new Error('promotion already in flight')
    }
    container.promotionInFlight = true
    ctx.log.info({ event: 'SCHEDULED_PROMOTION_START' }, 'starting scheduled promotion')
    const t0 = Date.now()
    try {
      const results = await promoteAll(db)
      const totals = results.reduce(
        (acc, r) => ({
          inserted: acc.inserted + r.inserted,
          skipped: acc.skipped + r.skipped,
          failed: acc.failed + r.failed,
        }),
        { inserted: 0, skipped: 0, failed: 0 },
      )
      const durationMs = Date.now() - t0
      ctx.log.info(
        { event: 'SCHEDULED_PROMOTION_DONE', totals, durationMs },
        'scheduled promotion done',
      )
      return {
        status: 'succeeded',
        metadata: {
          totals,
          durationMs,
          domains: results.map((r) => ({
            domain: r.domain,
            attempted: r.attempted,
            inserted: r.inserted,
            skipped: r.skipped,
            failed: r.failed,
          })),
        },
      }
    } finally {
      container.promotionInFlight = false
    }
  }
}
