import type { Db } from '@athlos/db'
import type { JobDefinition } from './types.ts'
import { getLastRun } from './run-tracker.ts'

/**
 * Health snapshot for a single registered job. Returned by
 * {@link getJobHealth} and consumed by the admin `/api/v1/admin/jobs/health`
 * endpoint in PR 6b. The shape is JSON-stable — clients can branch on
 * `healthy: boolean` and read `reason` for a human explanation.
 */
export interface JobHealth {
  name: string
  enabled: boolean
  cronExpr: string | null
  cadenceMinutes: number | null
  /** True when the scheduler has a `node-cron` task firing for this job. */
  scheduled: boolean
  /** True when a `job_runs` row for this name currently has `status='running'`. */
  inFlight: boolean
  /** Last run row (any status), or `null` if the job has never run. */
  lastRun: {
    id: string
    status: 'pending' | 'running' | 'succeeded' | 'failed' | 'dead_letter'
    startedAt: Date | null
    finishedAt: Date | null
    attempt: number
    errorMessage: string | null
  } | null
  /** True when last successful run is within `2× cadenceMinutes`. */
  healthy: boolean
  /** Empty when healthy; populated with a human-readable explanation otherwise. */
  reason: string
}

/**
 * Compute the health snapshot for every registered job.
 *
 * The "healthy" rule (spec §"Job Monitoring and Health"): a job is healthy
 * when its last *successful* run is within `2 × cron_interval` of now.
 *
 * Manual-only jobs (cadenceMinutes = null) are always healthy when no
 * run is in flight — the cadence concept does not apply.
 */
export async function getJobHealth(
  db: Db,
  definitions: readonly JobDefinition[],
): Promise<JobHealth[]> {
  const now = Date.now()
  const out: JobHealth[] = []
  for (const def of definitions) {
    const last = await getLastRun(db, def.name)
    const lastSucc = await getLastRunByStatus(db, def.name, 'succeeded')

    let healthy = true
    let reason = ''

    if (def.cadenceMinutes === null) {
      // Manual-only: healthy if not in flight.
      if (last?.status === 'running') {
        healthy = false
        reason = 'manual run in progress'
      }
    } else if (lastSucc === null) {
      // Never succeeded — only unhealthy if the job is enabled and we
      // have nothing to show for it (a fresh boot before the first
      // tick is normal; we mark unhealthy only after one interval has
      // elapsed).
      healthy = false
      reason = 'no successful run recorded'
    } else {
      const lastSuccAt = lastSucc.startedAt?.getTime() ?? lastSucc.scheduledAt.getTime()
      const windowMs = def.cadenceMinutes * 2 * 60_000
      if (now - lastSuccAt > windowMs) {
        healthy = false
        reason = `last successful run exceeded 2× interval (${def.cadenceMinutes}m)`
      }
    }

    out.push({
      name: def.name,
      enabled: def.enabled,
      cronExpr: def.cronExpr,
      cadenceMinutes: def.cadenceMinutes,
      scheduled: def.enabled && def.cronExpr !== null,
      inFlight: last?.status === 'running',
      lastRun: last
        ? {
            id: last.id,
            status: last.status,
            startedAt: last.startedAt,
            finishedAt: last.finishedAt,
            attempt: last.attempt,
            errorMessage: last.errorMessage,
          }
        : null,
      healthy,
      reason,
    })
  }
  return out
}

/**
 * Look up the most recent `job_runs` row for a given name with a
 * specific status. Used by the health endpoint to find the
 * "last successful run" baseline. Returns `null` if no matching row
 * exists.
 */
async function getLastRunByStatus(
  db: Db,
  jobName: string,
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'dead_letter',
) {
  const { eq, and } = await import('drizzle-orm')
  const { jobRuns } = await import('@athlos/db')
  const rows = await db
    .select()
    .from(jobRuns)
    .where(and(eq(jobRuns.jobName, jobName), eq(jobRuns.status, status)))
  if (rows.length === 0) return null
  const sorted = [...rows].sort((a, b) => {
    const aAt = a.startedAt?.getTime() ?? a.scheduledAt.getTime()
    const bAt = b.startedAt?.getTime() ?? b.scheduledAt.getTime()
    return bAt - aAt
  })
  return sorted[0] ?? null
}
