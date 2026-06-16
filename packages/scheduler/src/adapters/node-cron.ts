import cron, { type ScheduledTask } from 'node-cron'

/**
 * Task handle returned by {@link createNodeCronTask}. The interface is
 * intentionally narrow: just `stop()`. We don't expose the inner
 * `ScheduledTask` to keep the surface swap-friendly (a BullMQ adapter
 * would also expose a `stop()`-like method).
 */
export interface CronTaskHandle {
  stop(): void
}

export interface CreateNodeCronTaskOptions {
  /** Standard 5-field cron expression. */
  cronExpr: string
  /** IANA timezone. Omit for cadence-based jobs in the system timezone. */
  timezone?: string
  /** Invoked on every tick. Errors are caught and logged inside the
   * adapter — the scheduler's own error path runs on top. */
  onTick: () => void | Promise<void>
}

/**
 * Validate a cron expression without registering a task. Used at boot
 * so a bad `DRIFT_DETECTION_CRON=...` exits the process with a clear
 * error referencing the env var name (per the design's "validation
 * on boot" decision).
 */
export function validateCronExpression(cronExpr: string): boolean {
  return cron.validate(cronExpr)
}

/**
 * Create a `node-cron` task and return a handle with `stop()`. The
 * task fires `onTick` on every cron match. We catch errors inside
 * `onTick`'s wrapping closure so a handler that throws synchronously
 * doesn't crash the timer — the scheduler's own execute path handles
 * the async failure.
 */
export function createNodeCronTask(opts: CreateNodeCronTaskOptions): CronTaskHandle {
  if (!cron.validate(opts.cronExpr)) {
    throw new Error(`Invalid cron expression: ${opts.cronExpr}`)
  }
  const task: ScheduledTask = cron.schedule(
    opts.cronExpr,
    () => {
      try {
        const result = opts.onTick()
        if (result && typeof (result as Promise<void>).catch === 'function') {
          ;(result as Promise<void>).catch(() => {
            // Scheduler's own error path will have caught the
            // handler error — this catch is just to keep the
            // node-cron internals from logging the rejection.
          })
        }
      } catch {
        // sync throw — same: scheduler handles async path; sync
        // throws are swallowed here to keep the timer alive.
      }
    },
    opts.timezone !== undefined ? { timezone: opts.timezone } : undefined,
  )
  return {
    stop: () => {
      task.stop()
    },
  }
}
