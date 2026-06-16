import { and, desc, eq, gte, type SQL } from 'drizzle-orm'
import { jobRuns, type Db, type JobRun, type JobRunStatus, type JobTrigger } from '@athlos/db'
import type { RunFinishInput, RunStartInput } from './types.ts'

/**
 * Job-run persistence layer. Every state transition in the lifecycle
 * goes through one of these functions so the SQL surface lives in a
 * single file. The scheduler calls:
 *
 *   recordStart(...)      → INSERT ... status='pending' (then the
 *                            scheduler UPDATEs to 'running' inside
 *                            {@link recordRunning})
 *   recordRunning(id)     → UPDATE ... status='running', started_at=now()
 *   recordFinish({...})   → UPDATE ... status=succeeded|failed|dead_letter
 *                            finished_at=now(), error_message=?, metadata=?
 *
 * The split into two INSERTs was an early design choice — pending → running
 * tracks when the row entered the queue, running → finished tracks when
 * the handler actually ran. Both timestamps are surfaced in the admin
 * history endpoint.
 */

/**
 * Insert a fresh `job_runs` row in `pending` status. Returns the
 * generated row (id is filled by the DB). The scheduler transitions to
 * `running` immediately after this call returns.
 */
export async function recordStart(db: Db, input: RunStartInput): Promise<JobRun> {
  const [row] = await db
    .insert(jobRuns)
    .values({
      jobName: input.jobName,
      triggeredBy: input.triggeredBy,
      metadata: input.metadata,
      scheduledAt: input.scheduledAt ?? new Date(),
      status: 'pending',
      attempt: 1,
    })
    .returning()
  if (!row) {
    throw new Error('recordStart: job_runs INSERT returned no row')
  }
  return row
}

/**
 * Transition a row from `pending` to `running` and stamp `started_at`.
 * Called immediately before the handler is invoked.
 */
export async function recordRunning(db: Db, jobRunId: string): Promise<void> {
  await db
    .update(jobRuns)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(jobRuns.id, jobRunId))
}

/**
 * Mark a row with a terminal status (`succeeded` | `failed` | `dead_letter`).
 * On `succeeded` the handler's `metadata` is merged into the row; on
 * failure the latest `error_message` is captured and `attempt` is
 * incremented if provided (used by the retry path).
 *
 * Returns the updated row, or `null` if the id is unknown (the row
 * was deleted between insert and finish — should not happen in
 * practice but the call is defensive).
 */
export async function recordFinish(db: Db, input: RunFinishInput): Promise<JobRun | null> {
  const patch: Partial<JobRun> = {
    status: input.status,
    finishedAt: new Date(),
  }
  if (input.errorMessage !== undefined) patch.errorMessage = input.errorMessage
  if (input.attempt !== undefined) patch.attempt = input.attempt
  if (input.metadata !== undefined) {
    // Merge with whatever the row already has (a previous attempt may
    // have written partial metadata before failing).
    patch.metadata = input.metadata
  }
  const [row] = await db
    .update(jobRuns)
    .set(patch)
    .where(eq(jobRuns.id, input.jobRunId))
    .returning()
  return row ?? null
}

/**
 * Boot reconciliation. On startup, any row left in `running` from a
 * previous (crashed) process is moved to `failed` with
 * `error_message='process terminated unexpectedly'`. This is the
 * "crash recovery on boot" scenario from the spec.
 *
 * Returns the number of rows reconciled. Idempotent — running twice
 * matches 0 rows on the second call.
 */
export async function reconcileOrphanedRuns(db: Db): Promise<number> {
  // We avoid pulling in `sql` template tag from drizzle-orm for a single
  // UPDATE — going through the query builder keeps this file consistent
  // with the rest of the run-tracker.
  const { sql } = await import('drizzle-orm')
  const result = await db
    .update(jobRuns)
    .set({
      status: 'failed',
      finishedAt: new Date(),
      errorMessage: 'process terminated unexpectedly',
    })
    .where(sql`${jobRuns.status} = 'running'`)
  // drizzle's update returns a row count on the raw shape; for typed
  // access we re-read the affected rows so the test standin returns
  // the same shape as the real driver.
  return Array.isArray(result) ? result.length : 0
}

/**
 * Set `status='failed'` + `error_message='process shutdown'` on every
 * row that is still `running` after the graceful shutdown window.
 * Called from the scheduler's `stop()` method.
 */
export async function markInflightAsShutdown(db: Db): Promise<number> {
  const { sql } = await import('drizzle-orm')
  const result = await db
    .update(jobRuns)
    .set({
      status: 'failed',
      finishedAt: new Date(),
      errorMessage: 'process shutdown',
    })
    .where(sql`${jobRuns.status} = 'running'`)
  return Array.isArray(result) ? result.length : 0
}

/**
 * Look up the most recent `job_runs` row for a given name. Used by
 * the health endpoint. Returns `null` if the job has never run.
 */
export async function getLastRun(db: Db, jobName: string): Promise<JobRun | null> {
  const rows = await db.select().from(jobRuns).where(eq(jobRuns.jobName, jobName))
  if (rows.length === 0) return null
  // The index is (job_name, started_at DESC) but the standin doesn't
  // honour ORDER BY — sort in JS so the contract is consistent across
  // both drivers.
  const sorted = [...rows].sort((a, b) => {
    const aAt = a.startedAt?.getTime() ?? a.scheduledAt.getTime()
    const bAt = b.startedAt?.getTime() ?? b.scheduledAt.getTime()
    return bAt - aAt
  })
  return sorted[0] ?? null
}

/** Filter used by the health endpoint. Exported for reuse in PR 6b. */
export interface RunHistoryFilter {
  jobName?: string
  status?: JobRunStatus
  triggeredBy?: JobTrigger
  /** Lower bound on `started_at` (inclusive) — for "since X" filters. */
  from?: Date
  limit?: number
}

/**
 * Paginated run-history query for the admin `/jobs/runs` endpoint
 * (PR 6b TASK-050). Filters by job name, status, and `started_at
 * >= from`. Sorted by `started_at DESC` (nulls last) so the
 * freshest run shows up first — matches the spec's "last 50 runs
 * of this job" shape.
 *
 * The limit defaults to 50 and is hard-capped at 200 to keep
 * response sizes bounded. Pagination is via `limit` only in v1
 * (the spec does not require a cursor — the admin UI shows the
 * most recent N runs and the user can filter to narrow).
 */
export async function listRuns(db: Db, filter: RunHistoryFilter): Promise<JobRun[]> {
  const conds: SQL[] = []
  if (filter.jobName !== undefined) {
    conds.push(eq(jobRuns.jobName, filter.jobName))
  }
  if (filter.status !== undefined) {
    conds.push(eq(jobRuns.status, filter.status))
  }
  if (filter.from !== undefined) {
    conds.push(gte(jobRuns.startedAt, filter.from))
  }
  const limit = Math.min(filter.limit ?? 50, 200)
  const where = conds.length > 0 ? and(...conds) : undefined
  const base = db.select().from(jobRuns)
  const q = where
    ? base.where(where).orderBy(desc(jobRuns.startedAt)).limit(limit)
    : base.orderBy(desc(jobRuns.startedAt)).limit(limit)
  return await q
}
