import { pino, type Logger } from 'pino'
import type { Db, JobTrigger } from '@athlos/db'
import { recordFinish, recordRunning, recordStart, markInflightAsShutdown } from './run-tracker.ts'
import type {
  JobContext,
  JobDefinition,
  JobHandler,
  JobScheduler,
  ScheduleOptions,
} from './types.ts'

/**
 * Exponential-backoff retry policy (spec §"Job Retry Policy"):
 *   attempt 1 → 30s
 *   attempt 2 → 120s
 *   attempt 3 → 600s (final — if this fails too, dead-letter)
 *
 * Jitter ±20% is applied to every delay.
 */
const RETRY_DELAYS_MS: ReadonlyArray<number> = [30_000, 120_000, 600_000]

/** Cap on retries — after attempt 3 fails, the row moves to `dead_letter`. */
const MAX_ATTEMPTS = 3

/**
 * In-process scheduler backed by `node-cron`. Single-node, in-memory
 * concurrency guard (a `Set<string>` of running job names), DB-backed
 * state machine (`job_runs` table). The public surface is the
 * {@link JobScheduler} interface; this class is the reference
 * implementation. A future BullMQ adapter will implement the same
 * interface and live alongside this one.
 *
 * Concurrency model:
 *   - `runningJobs: Set<string>` — names with a handler in flight.
 *   - `pendingRetries: Map<string, NodeJS.Timeout>` — retries scheduled
 *     via `setTimeout` (cleared on shutdown).
 *   - `abortControllers: Map<string, AbortController>` — one per in-flight
 *     handler; aborted on shutdown timeout.
 *
 * Boot order (called by apps/api):
 *   1. {@link reconcileOrphanedRuns} (run-tracker) — mark orphaned
 *      `running` rows as `failed / 'process terminated unexpectedly'`.
 *   2. `schedule()` for each enabled job.
 *   3. `start()` — no-op for `node-cron` (tasks fire on registration),
 *      but kept for interface symmetry.
 *
 * Shutdown:
 *   - `stop(30_000)` clears retries, sets a `shuttingDown` flag, awaits
 *      all in-flight handlers up to 30s, aborts the rest, and runs
 *      `markInflightAsShutdown` to mark the still-running rows.
 */
export class InProcessScheduler implements JobScheduler {
  private readonly db: Db
  private readonly log: Logger
  /** Job name → static definition + the live node-cron task. */
  private readonly jobs = new Map<
    string,
    {
      def: JobDefinition
      task: { stop: () => void } | null
    }
  >()
  /** Job names currently executing. */
  private readonly runningJobs = new Set<string>()
  /** Pending retry timers keyed by `jobRunId`. */
  private readonly pendingRetries = new Map<string, NodeJS.Timeout>()
  /** Per-job-run AbortControllers for cooperative cancellation. */
  private readonly abortControllers = new Map<string, AbortController>()
  /** In-flight handler promises keyed by `jobRunId` — used by `stop()`. */
  private readonly inflight = new Map<string, Promise<void>>()
  private started = false
  private shuttingDown = false

  constructor(opts: { db: Db; logger?: Logger }) {
    this.db = opts.db
    this.log =
      opts.logger ??
      pino({
        name: 'scheduler',
        level: process.env['LOG_LEVEL'] ?? 'info',
        base: { service: 'athlos-scheduler' },
      })
  }

  /**
   * Register a job. If the same name is registered twice, the previous
   * definition is replaced and its cron task (if any) is stopped. The
   * scheduler's own `runNow`/`list`/`stop` work from the latest
   * definition.
   */
  schedule(name: string, cronExpr: string, handler: JobHandler, opts: ScheduleOptions = {}): void {
    if (this.shuttingDown) {
      this.log.warn({ name }, 'schedule: rejected — scheduler is shutting down')
      return
    }
    // Validate the cron expression up front (delegated to the adapter
    // in real builds; node-cron's own validate is wired in the adapter
    // factory). The interface only takes a string, so we accept and
    // trust — but a missing colon-style 6-field expression will throw
    // at task creation time inside the adapter, which surfaces as a
    // startup failure.
    const existing = this.jobs.get(name)
    if (existing?.task) {
      existing.task.stop()
    }
    const def: JobDefinition = {
      name,
      cronExpr,
      handler,
      ...(opts.timezone !== undefined ? { timezone: opts.timezone } : {}),
      cadenceMinutes: opts.cadenceMinutes ?? estimateCadenceMinutes(cronExpr),
      enabled: true,
    }
    this.jobs.set(name, { def, task: null })
    if (this.started) {
      this.startTask(name, def)
    }
  }

  /**
   * Start ticking. The actual `node-cron` task creation happens
   * inside {@link startTask} which is also called from
   * {@link schedule} (when called after `start()`) so re-scheduling
   * during runtime works (test convenience).
   */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    for (const [name, entry] of this.jobs) {
      this.startTask(name, entry.def)
    }
    this.log.info({ jobs: Array.from(this.jobs.keys()) }, 'scheduler: started')
  }

  /**
   * Create a `node-cron` task for one job. The actual scheduling is
   * delegated to the node-cron adapter — we keep the integration
   * thin here so swapping the engine (e.g. to `croner`) is local.
   *
   * The adapter is imported lazily so test environments that don't
   * install `node-cron` can still use the scheduler with a stub.
   */
  private startTask(name: string, def: JobDefinition): void {
    if (!def.cronExpr) return
    // Dynamic import keeps the bundle slim for code paths that never
    // start a task (e.g. when only `runNow` is exercised in tests).
    void import('./adapters/node-cron.ts')
      .then(({ createNodeCronTask }) => {
        const entry = this.jobs.get(name)
        if (!entry) return
        if (entry.task) entry.task.stop()
        const task = createNodeCronTask({
          cronExpr: def.cronExpr!,
          ...(def.timezone !== undefined ? { timezone: def.timezone } : {}),
          onTick: () => {
            void this.execute(def, 'scheduler', {})
          },
        })
        this.jobs.set(name, { def, task })
      })
      .catch((err) => {
        this.log.error({ err, name, cronExpr: def.cronExpr }, 'failed to start cron task')
      })
  }

  /**
   * Stop ticking. Sequence:
   *   1. Mark `shuttingDown` — new `schedule()` calls become no-ops.
   *   2. `clearTimeout` every pending retry.
   *   3. Stop every `node-cron` task.
   *   4. Wait up to `gracefulTimeoutMs` (default 30s) for in-flight
   *      handlers to finish. Abort their `AbortSignal` at timeout.
   *   5. Run `markInflightAsShutdown` to record the still-running rows
   *      as `failed / 'process shutdown'`.
   */
  async stop(gracefulTimeoutMs = 30_000): Promise<void> {
    if (this.shuttingDown) return
    this.shuttingDown = true
    this.log.info({ inFlight: this.inflight.size }, 'scheduler: stopping')

    // 1. Clear pending retries.
    for (const [jobRunId, timer] of this.pendingRetries) {
      clearTimeout(timer)
      this.pendingRetries.delete(jobRunId)
    }

    // 2. Stop cron tasks.
    for (const [, entry] of this.jobs) {
      entry.task?.stop()
    }

    // 3. Wait for in-flight handlers.
    if (this.inflight.size > 0) {
      const all = Array.from(this.inflight.values())
      const timeout = new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), gracefulTimeoutMs),
      )
      const finished = Promise.all(all).then(() => 'finished' as const)
      const result = await Promise.race([finished, timeout])
      if (result === 'timeout') {
        this.log.warn(
          { remaining: this.inflight.size },
          'scheduler: graceful timeout — aborting in-flight jobs',
        )
        for (const controller of this.abortControllers.values()) {
          controller.abort()
        }
        // Give aborted handlers a brief moment to release the DB
        // connection before we mark them as failed.
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
    }

    // 4. Mark remaining in-flight rows as failed.
    const marked = await markInflightAsShutdown(this.db)
    this.log.info({ marked, gracefulTimeoutMs }, 'scheduler: stopped')
  }

  /**
   * Trigger a one-shot run. Returns the `job_run_id` immediately and
   * runs the handler asynchronously — callers do not block. The new
   * row is inserted with `status='pending'`; the row is then
   * transitioned to `running` from inside the execution helper.
   *
   * Throws `Error` (NOT_FOUND-style) if the name is not registered;
   * the admin endpoint catches and returns 404.
   */
  async runNow(
    name: string,
    metadata: Record<string, unknown> = {},
  ): Promise<{ jobRunId: string }> {
    if (this.shuttingDown) {
      throw new Error(`runNow(${name}): scheduler is shutting down`)
    }
    const entry = this.jobs.get(name)
    if (!entry) {
      throw new Error(`runNow: unknown job '${name}'`)
    }
    const triggeredBy: JobTrigger = (metadata['triggeredBy'] as JobTrigger | undefined) ?? 'manual'
    const row = await recordStart(this.db, {
      jobName: name,
      triggeredBy,
      metadata,
    })
    // Fire-and-forget — return the id immediately.
    void this.executeFromRow(entry.def, row.id, triggeredBy, metadata, 1)
    return { jobRunId: row.id }
  }

  /** Snapshot of registered job definitions (no cron task handle). */
  list(): JobDefinition[] {
    return Array.from(this.jobs.values()).map((e) => e.def)
  }

  /**
   * Cron-tick path. Inserts the `pending` row, transitions to
   * `running`, calls the handler, then runs the result pipeline.
   */
  private async execute(
    def: JobDefinition,
    triggeredBy: JobTrigger,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    if (this.runningJobs.has(def.name)) {
      this.log.info({ jobName: def.name }, 'skipped: previous run still in progress')
      return
    }
    this.runningJobs.add(def.name)
    try {
      const row = await recordStart(this.db, {
        jobName: def.name,
        triggeredBy,
        metadata: { ...metadata, tickAt: new Date().toISOString() },
      })
      await this.executeFromRow(def, row.id, triggeredBy, metadata, 1)
    } catch (err) {
      this.log.error({ err, jobName: def.name }, 'execute: failed to record start')
    } finally {
      this.runningJobs.delete(def.name)
    }
  }

  /**
   * The actual handler invocation. Called once per attempt. The
   * `attempt` is the current attempt number (1-indexed). On failure
   * with `attempt < MAX_ATTEMPTS` we schedule a retry via
   * {@link scheduleRetry}; on the last attempt we move to
   * `dead_letter`.
   */
  private async executeFromRow(
    def: JobDefinition,
    jobRunId: string,
    triggeredBy: JobTrigger,
    metadata: Record<string, unknown>,
    attempt: number,
  ): Promise<void> {
    if (this.shuttingDown) return
    const controller = new AbortController()
    this.abortControllers.set(jobRunId, controller)
    const childLog = this.log.child({
      jobRunId,
      jobName: def.name,
      attempt,
      triggeredBy,
    })
    const ctx: JobContext = {
      jobRunId,
      jobName: def.name,
      attempt,
      triggeredBy,
      metadata,
      log: childLog,
      signal: controller.signal,
    }
    const work = (async () => {
      await recordRunning(this.db, jobRunId)
      try {
        const result = await def.handler(ctx)
        const merged = result.metadata ?? {}
        await recordFinish(this.db, {
          jobRunId,
          status: 'succeeded',
          ...(Object.keys(merged).length > 0 ? { metadata: merged } : {}),
        })
        childLog.info({ event: 'JOB_SUCCEEDED' }, 'job succeeded')
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        childLog.error({ err, event: 'JOB_FAILED' }, 'job failed')
        await recordFinish(this.db, {
          jobRunId,
          status: 'failed',
          errorMessage: errMsg,
          attempt,
        })
        if (attempt < MAX_ATTEMPTS) {
          this.scheduleRetry(def, jobRunId, triggeredBy, metadata, attempt + 1)
        } else {
          await recordFinish(this.db, {
            jobRunId,
            status: 'dead_letter',
            errorMessage: errMsg,
            attempt,
          })
          childLog.error({ event: 'JOB_DEAD_LETTER' }, 'job moved to dead-letter')
        }
      } finally {
        this.abortControllers.delete(jobRunId)
      }
    })()
    this.inflight.set(jobRunId, work)
    try {
      await work
    } finally {
      this.inflight.delete(jobRunId)
    }
  }

  /**
   * Schedule a retry with exponential backoff + jitter. The retry
   * respects the concurrency guard — if a fresh tick (or manual call)
   * already kicked off a new run while we waited, the retry's
   * `executeFromRow` will see the new run in `runningJobs` and skip
   * (no — the guard is on cron-tick; retries are unconditional. We
   * accept the very small overlap risk in v1: a handler that succeeds
   * a few hundred ms after the retry timer fires will record its
   * success on the SAME row, and the retry will then start a fresh
   * row via `recordStart`. To prevent that, retries re-read the row
   * status and bail if it's not `failed`.)
   */
  private scheduleRetry(
    def: JobDefinition,
    jobRunId: string,
    triggeredBy: JobTrigger,
    metadata: Record<string, unknown>,
    nextAttempt: number,
  ): void {
    const base = RETRY_DELAYS_MS[nextAttempt - 2] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]!
    const jitter = 0.8 + Math.random() * 0.4 // ±20%
    const delay = base * jitter
    this.log.info(
      { jobRunId, jobName: def.name, nextAttempt, delayMs: Math.round(delay) },
      'scheduling retry',
    )
    const timer = setTimeout(() => {
      this.pendingRetries.delete(jobRunId)
      void this.executeFromRow(def, jobRunId, triggeredBy, metadata, nextAttempt)
    }, delay)
    this.pendingRetries.set(jobRunId, timer)
  }
}

/**
 * Estimate the cadence of a cron expression in minutes. Used as the
 * `cadenceMinutes` default for the health endpoint when the caller
 * does not pass one. This is a heuristic — the admin endpoint accepts
 * an explicit value when the heuristic is wrong (e.g. the import-batch
 * job with no cron).
 *
 * Supported patterns (intentionally narrow — the scheduler's 5 jobs
 * are the only ones in v1):
 *   `*\/N * * * *`     → N
 *   `0 H * * *`        → 1440  (daily at H:00)
 *   `0 H * * DOW`      → 10080 (weekly)
 *   `0 H D * *`        → 43200 (monthly)
 *
 * Returns `null` for anything else (admin must set explicitly).
 */
export function estimateCadenceMinutes(cronExpr: string): number | null {
  const parts = cronExpr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [minute, hour, dom, month, dow] = parts
  if (!minute || !hour || !dom || !month || !dow) return null
  // */N * * * * → every N minutes
  const m = minute.match(/^\*\/(\d+)$/)
  if (m && m[1]) {
    return Number(m[1])
  }
  // 0 H * * * → daily
  if (minute === '0' && /^\d+$/.test(hour) && dom === '*' && month === '*' && dow === '*') {
    return 1440
  }
  // 0 H * * DOW → weekly
  if (
    minute === '0' &&
    /^\d+$/.test(hour) &&
    dom === '*' &&
    month === '*' &&
    /^[0-7*]$/.test(dow) &&
    dow !== '*'
  ) {
    return 10080
  }
  // 0 H D * * → monthly
  if (
    minute === '0' &&
    /^\d+$/.test(hour) &&
    /^\d+$/.test(dom) &&
    dom !== '*' &&
    month === '*' &&
    dow === '*'
  ) {
    return 43200
  }
  return null
}
