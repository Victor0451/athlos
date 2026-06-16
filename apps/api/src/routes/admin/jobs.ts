import type { FastifyPluginCallback } from 'fastify'
import { z } from 'zod'
import { throwIfInvalid } from '@athlos/errors'
import { requireRole } from '@athlos/auth'
import { getJobHealth, listRuns } from '@athlos/scheduler'
import type { JobRun, JobRunStatus } from '@athlos/db/schema'
import type { FastifyInstance } from 'fastify'
import type { AppContainer } from '../../container.ts'

/**
 * Admin `/api/v1/admin/jobs/*` routes — TASK-050.
 *
 * Two endpoints, both gated by `requireRole('ADMIN')`:
 *
 *   GET /api/v1/admin/jobs/runs?job=<name>&status=<status>&from=<iso>&limit=<n>
 *     Returns `{ items: JobRunDTO[] }`. Filters: job name
 *     (exact), status (enum), `from` (ISO timestamp, inclusive
 *     on `started_at`). `limit` defaults to 50, hard-capped at
 *     200. Sorted by `started_at DESC` so the freshest run
 *     surfaces first.
 *
 *   GET /api/v1/admin/jobs/health
 *     Returns `{ items: JobHealth[] }` — one per registered job.
 *     Shape mirrors `@athlos/scheduler:getJobHealth` with a
 *     `nextRun` projection (the cron expression, no engine
 *     prediction in v1).
 *
 * The route layer is intentionally thin: validation via Zod,
 * service call (`getJobHealth` / `listRuns` from
 * `@athlos/scheduler`), DTO shaping, and a single `requireRole`
 * preHandler. No DB writes — these are read-only admin views.
 */

const idParamSchema = z.object({ id: z.string().uuid() })

const JOB_RUN_STATUSES = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'dead_letter',
] as const satisfies readonly JobRunStatus[]

const runsQuerySchema = z.object({
  job: z.string().min(1).max(64).optional(),
  status: z.enum(JOB_RUN_STATUSES).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

const ADMIN_GATE = { preHandler: requireRole('ADMIN') }

/**
 * Public DTO for a single run row. Mirrors the `job_runs` row
 * shape with `camelCase` keys + ISO timestamps. The DTO is
 * the contract: don't expose `metadata` raw (it can carry
 * domain-specific PII), don't expose `attempt` directly (the
 * UI shows it as a human count).
 */
interface JobRunDTO {
  id: string
  jobName: string
  status: JobRunStatus
  attempt: number
  scheduledAt: string
  startedAt: string | null
  finishedAt: string | null
  triggeredBy: 'scheduler' | 'manual' | 'post-import'
  errorMessage: string | null
  durationMs: number | null
}

function toJobRunDTO(row: JobRun): JobRunDTO {
  const startedAt = row.startedAt?.toISOString() ?? null
  const finishedAt = row.finishedAt?.toISOString() ?? null
  const durationMs =
    startedAt && finishedAt ? new Date(finishedAt).getTime() - new Date(startedAt).getTime() : null
  return {
    id: row.id,
    jobName: row.jobName,
    status: row.status,
    attempt: row.attempt,
    scheduledAt: row.scheduledAt.toISOString(),
    startedAt,
    finishedAt,
    triggeredBy: row.triggeredBy,
    errorMessage: row.errorMessage,
    durationMs,
  }
}

export const adminJobsRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const container: AppContainer = fastify.container

  // GET /api/v1/admin/jobs/runs
  fastify.get('/api/v1/admin/jobs/runs', ADMIN_GATE, async (request, reply) => {
    const q = throwIfInvalid(runsQuerySchema, request.query, 'query')
    const from = q.from ? new Date(q.from) : undefined
    const items = await listRuns(container.db, {
      limit: q.limit ?? 50,
      ...(q.job !== undefined ? { jobName: q.job } : {}),
      ...(q.status !== undefined ? { status: q.status } : {}),
      ...(from ? { from } : {}),
    })
    return reply.code(200).send({
      items: items.map(toJobRunDTO),
    })
  })

  // GET /api/v1/admin/jobs/health
  fastify.get('/api/v1/admin/jobs/health', ADMIN_GATE, async (_request, reply) => {
    // The scheduler is a Fastify decorator (set in server.ts),
    // not part of AppContainer. Pull it off the request-scoped
    // server instance so the container stays focused on the
    // service-level DI surface.
    const definitions = (fastify as FastifyInstance).scheduler.list()
    const items = await getJobHealth(container.db, definitions)
    return reply.code(200).send({
      items: items.map((h) => ({
        name: h.name,
        enabled: h.enabled,
        cronExpr: h.cronExpr,
        cadenceMinutes: h.cadenceMinutes,
        scheduled: h.scheduled,
        inFlight: h.inFlight,
        healthy: h.healthy,
        reason: h.reason,
        lastRun: h.lastRun
          ? {
              id: h.lastRun.id,
              status: h.lastRun.status,
              startedAt: h.lastRun.startedAt?.toISOString() ?? null,
              finishedAt: h.lastRun.finishedAt?.toISOString() ?? null,
              attempt: h.lastRun.attempt,
              durationMs:
                h.lastRun.startedAt && h.lastRun.finishedAt
                  ? h.lastRun.finishedAt.getTime() - h.lastRun.startedAt.getTime()
                  : null,
              errorMessage: h.lastRun.errorMessage,
            }
          : null,
      })),
    })
  })

  // (Reserved for future POST /api/v1/admin/jobs/:name/run-now — see
  // PR 6a design §"Manual Run" + jobs/register.ts#jobNotFoundError.
  // Wiring deferred to PR 7 when the import-batch is the first
  // non-scheduler trigger.)
  void idParamSchema

  done()
}

declare module 'fastify' {
  interface FastifyInstance {
    container: AppContainer
  }
}
