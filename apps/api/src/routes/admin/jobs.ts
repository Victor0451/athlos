import type { FastifyPluginCallback } from 'fastify'
import { z } from 'zod'
import { throwIfInvalid } from '@athlos/errors'
import { requireRole } from '@athlos/auth'
import { getJobHealth, listRuns } from '@athlos/scheduler'
import type { JobRunStatus } from '@athlos/db/schema'
import type { FastifyInstance } from 'fastify'
import type { AppContainer } from '../../container.ts'
import { projectSchedulerRun } from './scheduler-run-projector.ts'

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
  'completed_with_review',
  'failed',
  'dead_letter',
  'cancelled',
] as const satisfies readonly JobRunStatus[]

const runsQuerySchema = z.object({
  job: z.string().min(1).max(64).optional(),
  status: z.enum(JOB_RUN_STATUSES).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

const ADMIN_GATE = { preHandler: requireRole('ADMIN') }

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
      items: items.map(projectSchedulerRun),
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
        lastRun: h.lastRun ? projectSchedulerRun(h.lastRun) : null,
      })),
    })
  })

  void idParamSchema

  done()
}

declare module 'fastify' {
  interface FastifyInstance {
    container: AppContainer
  }
}
