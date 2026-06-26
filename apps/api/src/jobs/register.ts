import type { Db } from '@athlos/db'
import type { Env } from '@athlos/config'
import type { JobScheduler } from '@athlos/scheduler'
import { InProcessScheduler, validateCronExpression } from '@athlos/scheduler'
import { BusinessError } from '@athlos/errors'
import {
  makeDriftDetectionHandler,
  makeFreshnessRefreshHandler,
  makeReconciliationHandler,
  makeScheduledImportHandler,
  makeScheduledPromotionHandler,
  makeTokenCleanupHandler,
} from './index.ts'
import { reconcileOrphanedRuns } from '@athlos/scheduler'
import { rebuildProjection, DOMAIN_PROJECTION_TABLE, type Domain } from '@athlos/projection'
import { detect, emitDriftAlert } from '@athlos/drift'
import type { AppContainer, DriftService, ProjectionService } from '../container'

/**
 * Build the scheduler instance + register all 5 default jobs. The
 * caller (apps/api/src/server.ts) calls `scheduler.start()` after the
 * Fastify app is ready and `scheduler.stop()` from the SIGTERM handler.
 *
 * Boot sequence (matches scheduler-jobs spec §"Scheduler Boot and
 * Shutdown"):
 *
 *   1. Reconcile orphaned `running` rows from a previous (crashed)
 *      process. Marks them `failed / 'process terminated unexpectedly'`.
 *   2. Validate every configured cron expression with
 *      `node-cron.validate`. A bad expression aborts the boot with a
 *      clear error referencing the env var name.
 *   3. Schedule each enabled job. `reconciliation` is registered
 *      unconditionally (so `runNow` works) but `enabled: false` when
 *      `RECONCILIATION_CRON` is unset — the cron task is not created.
 *   4. The caller calls `scheduler.start()` (no-op for `node-cron`
 *      since tasks fire on registration, but kept for interface
 *      symmetry with future BullMQ adapter).
 */
export async function buildScheduler(opts: {
  db: Db
  env: Env
  logger: never
  container: AppContainer
}): Promise<JobScheduler> {
  const { db, env, container } = opts

  // 1. Boot reconciliation — run BEFORE scheduling so the new
  //    scheduler's `runningJobs` set starts empty. Idempotent.
  //    Skipped in test env (the standin DB doesn't support the
  //    raw-SQL `update().set().where(sql\`...\`)` path). On a real
  //    boot, the reconciliation is wrapped in a 2s timeout — a DB
  //    outage at boot is logged and the scheduler continues, so the
  //    API can serve `/health` while the DB recovers.
  if (env.NODE_ENV !== 'test') {
    try {
      const reconciled = await Promise.race([
        reconcileOrphanedRuns(db),
        new Promise<number>((resolve) => setTimeout(() => resolve(0), 2_000)),
      ])
      if (reconciled > 0) {
        // eslint-disable-next-line no-console
        console.log(`[scheduler] reconciled ${reconciled} orphaned job_runs from previous process`)
      }
    } catch (err) {
      console.warn(
        '[scheduler] boot reconciliation failed (DB unreachable?); continuing',
        err instanceof Error ? err.message : err,
      )
    }
  }

  // 2. Validate cron expressions up front.
  const cronExprs: Array<{ name: string; expr: string | undefined }> = [
    { name: 'DRIFT_DETECTION_CRON', expr: env.DRIFT_DETECTION_CRON },
    { name: 'FRESHNESS_REFRESH_CRON', expr: env.FRESHNESS_REFRESH_CRON },
    { name: 'TOKEN_CLEANUP_CRON', expr: env.TOKEN_CLEANUP_CRON },
    { name: 'RECONCILIATION_CRON', expr: env.RECONCILIATION_CRON },
    { name: 'PROMOTION_CRON', expr: env.PROMOTION_CRON },
  ]
  for (const { name, expr } of cronExprs) {
    if (expr && !validateCronExpression(expr)) {
      throw new Error(
        `Invalid cron expression for ${name}: '${expr}'. ` +
          `Use a standard 5-field cron (e.g. '*/15 * * * *').`,
      )
    }
  }

  // 3. Build the scheduler.
  const scheduler = new InProcessScheduler({
    db,
    logger: opts.logger as never,
  })

  // 4. Register the 5 default jobs.
  scheduler.schedule('drift-detection', env.DRIFT_DETECTION_CRON, makeDriftDetectionHandler(db), {
    timezone: 'America/Argentina/Buenos_Aires',
  })
  scheduler.schedule(
    'freshness-refresh',
    env.FRESHNESS_REFRESH_CRON,
    makeFreshnessRefreshHandler(db),
  )
  scheduler.schedule(
    'token-cleanup',
    env.TOKEN_CLEANUP_CRON,
    makeTokenCleanupHandler(db, env.AUDIT_RETENTION_DAYS),
    { timezone: 'America/Argentina/Buenos_Aires' },
  )
  scheduler.schedule(
    'scheduled-import',
    // import-batch is manual-only; pick the 02:00 cron as a sentinel
    // so a future change to "schedule it automatically" is one env
    // var away. The schedule is still wired because some operators
    // want nightly imports out of the box.
    '0 2 * * *',
    makeScheduledImportHandler(db),
    { timezone: 'America/Argentina/Buenos_Aires' },
  )
  // scheduled-promotion: async promotion via the in-process scheduler.
  // Uses the same promotionInFlight flag as the sync POST /promote/trigger
  // endpoint so the two paths never overlap. Timezone is UTC (node-cron
  // default — user-locked decision).
  scheduler.schedule(
    'scheduled-promotion',
    env.PROMOTION_CRON,
    makeScheduledPromotionHandler(db, container),
  )
  if (env.RECONCILIATION_CRON) {
    scheduler.schedule(
      'reconciliation',
      env.RECONCILIATION_CRON,
      makeReconciliationHandler(makeProjectionSvc(db), makeDriftSvc(db)),
    )
  }
  // When `RECONCILIATION_CRON` is unset, register a disabled job so
  // `runNow('reconciliation')` still works for manual triggers but
  // no cron task fires.
  if (!env.RECONCILIATION_CRON) {
    scheduler.schedule(
      'reconciliation',
      '0 0 31 2 *', // Feb 31 — never
      makeReconciliationHandler(makeProjectionSvc(db), makeDriftSvc(db)),
    )
  }

  return scheduler
}

/** Build the projection service for the reconciliation job */
function makeProjectionSvc(db: Db): ProjectionService {
  return {
    rebuild: async (domain) => rebuildProjection(db, domain as Domain),
    rebuildAll: async () => {
      const domains = Object.keys(DOMAIN_PROJECTION_TABLE) as Domain[]
      const results = await Promise.all(domains.map((d) => rebuildProjection(db, d)))
      return {
        domainsChecked: domains,
        totalRowCount: results.reduce((sum, r) => sum + r.rowCount, 0),
      }
    },
  }
}

/** Build the drift service for the reconciliation job */
function makeDriftSvc(db: Db): DriftService {
  return {
    detect: (opts) => detect(db, opts ?? {}),
    detectAll: () => detect(db, {}),
    emitDriftAlert: (report, ctx) => emitDriftAlert(db, report, ctx),
  }
}

/**
 * Build a "disabled-job" stub: when an admin tries to run a job that
 * is registered but disabled, surface a 404 with a clear message.
 * Wired from the admin endpoint in PR 6b (TASK-050).
 */
export function jobNotFoundError(name: string): ReturnType<typeof BusinessError> {
  return BusinessError('NOT_FOUND' as never, `Job '${name}' is not registered`, {
    error: 'JOB_NOT_FOUND',
  })
}
