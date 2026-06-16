import type { Logger } from 'pino'
import type { JobRun, JobRunStatus, JobTrigger } from '@athlos/db/schema'

/**
 * Handler signature for a scheduled job.
 *
 * Handlers are pure async functions that receive a {@link JobContext} and
 * return a {@link JobResult}. The scheduler wraps the call in try/catch —
 * handlers do not need their own try/catch; a thrown error means a failed
 * run, and the scheduler applies the retry policy + dead-letter logic.
 *
 * Handlers SHOULD respect `ctx.signal` for cooperative cancellation on
 * shutdown (long-running handlers can call `ctx.signal.throwIfAborted()`
 * between domain checks; the scheduler aborts the signal at shutdown
 * timeout).
 */
export type JobHandler = (ctx: JobContext) => Promise<JobResult>

/**
 * The single object passed to every job invocation. The scheduler binds
 * it from the live job definition + the in-flight `job_runs` row, so a
 * handler can log with `ctx.log.info({ ... }, '...')` and the structured
 * log line carries `jobRunId`, `jobName`, `attempt` for free.
 */
export interface JobContext {
  /** UUID stored in `job_runs.id` (matches `RequestId` shape for grep). */
  jobRunId: string
  /** Name from {@link JobDefinition.name}. */
  jobName: string
  /** 1..3 (4th attempt is not made — see retry policy). */
  attempt: number
  /** Originating trigger. */
  triggeredBy: JobTrigger
  /** Free-form metadata passed by the caller (`runNow` second arg) or the
   * scheduler (`{ tickAt: <iso> }` for cron triggers). */
  metadata: Record<string, unknown>
  /** pino child logger with `jobRunId` + `jobName` + `attempt` bound. */
  log: Logger
  /** Aborted by the scheduler on shutdown timeout. */
  signal: AbortSignal
}

/**
 * Handler return shape. The only required field is `status: 'succeeded'`;
 * `metadata` is merged into the `job_runs.metadata` jsonb on success so
 * the admin history endpoint can surface domain-specific details (e.g.
 * `drift_count`, `tokens_deleted`).
 *
 * Returning anything other than `{ status: 'succeeded' }` is reserved
 * for future "skip" semantics — the scheduler treats any other shape
 * as a no-op success and the row is marked `succeeded` without a
 * metadata merge.
 */
export interface JobResult {
  status: 'succeeded'
  metadata?: Record<string, unknown>
}

/**
 * Static description of a registered job. Held in memory by the
 * scheduler (`list()` returns the registered definitions) and used by
 * the admin health endpoint to compute `2× interval` healthy windows.
 */
export interface JobDefinition {
  /** Stable identifier, matches `job_runs.job_name`. */
  name: string
  /** Cron expression. `null` for manual-only jobs (e.g. `import-batch`). */
  cronExpr: string | null
  /** The handler invoked on each tick / `runNow` call. */
  handler: JobHandler
  /** IANA timezone string (e.g. `America/Argentina/Buenos_Aires`). */
  timezone?: string
  /**
   * Default cadence in minutes — used by `getJobHealth()` to compute
   * the healthy window (`last_succeeded within 2× cadence`). Jobs with
   * `cronExpr = null` (manual-only) report `cadenceMinutes: null` and
   * are always healthy when no run is in flight.
   */
  cadenceMinutes: number | null
  /** False if the job is registered but cron is unset (e.g. reconciliation
   * without `RECONCILIATION_CRON`). The scheduler skips scheduling but
   * `runNow` still works. */
  enabled: boolean
}

/**
 * Public scheduler surface. Five methods, narrow contract — every
 * downstream call site (job definitions, admin endpoints, the import
 * post-trigger) goes through this interface. Swapping to BullMQ later
 * means writing a new `BullMqScheduler` that implements the same shape.
 */
export interface JobScheduler {
  /**
   * Register a job. Idempotent: a second call with the same name replaces
   * the previous definition (test convenience; prod code calls once at
   * boot). Throws on invalid cron expression.
   */
  schedule(name: string, cronExpr: string, handler: JobHandler, opts?: ScheduleOptions): void

  /** Start ticking. Calls `schedule()` on every enabled job's
   * `node-cron` task. Must be called exactly once at boot. */
  start(): Promise<void>

  /**
   * Stop ticking. Stops accepting new ticks, clears pending retries, and
   * waits up to `gracefulTimeoutMs` (default 30s) for in-flight handlers
   * to finish. After timeout, in-flight jobs are marked
   * `failed / error_message='process shutdown'`.
   */
  stop(gracefulTimeoutMs?: number): Promise<void>

  /**
   * Trigger a one-shot run. Enqueues a `job_runs` row with
   * `triggered_by='manual' | 'post-import'` and returns the new
   * `job_run_id` immediately. The handler runs asynchronously — the
   * caller does not block on completion.
   *
   * Throws `Error` if `name` is not registered (the admin endpoint
   * catches this and returns 404).
   */
  runNow(name: string, metadata?: Record<string, unknown>): Promise<{ jobRunId: string }>

  /** Snapshot of registered job definitions — drives the admin health
   * endpoint and the boot reconciliation list. */
  list(): JobDefinition[]
}

export interface ScheduleOptions {
  /** IANA timezone (e.g. `America/Argentina/Buenos_Aires`). Omit for
   * cadence-based jobs in the system timezone. */
  timezone?: string
  /** Default cadence in minutes. Used by `getJobHealth()` to compute
   * the healthy window. Defaults to a heuristic derived from the cron
   * expression. */
  cadenceMinutes?: number
}

/** Internal scheduler state used by the run-tracker. Not exported. */
export interface RunStartInput {
  jobName: string
  triggeredBy: JobTrigger
  metadata: Record<string, unknown>
  scheduledAt?: Date
}

export interface RunFinishInput {
  jobRunId: string
  status: Exclude<JobRunStatus, 'pending'>
  errorMessage?: string
  metadata?: Record<string, unknown>
  attempt?: number
}

/** Result of `runNow` — the row stored plus the new id. */
export interface RunNowResult {
  jobRunId: string
  row: JobRun
}
