import type { FastifyPluginCallback, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { throwIfInvalid } from '@athlos/errors'
import { requireRole } from '@athlos/auth'
import { getJobHealth, listRuns } from '@athlos/scheduler'
import type { FastifyInstance } from 'fastify'
import type { AppContainer } from '../../container.ts'
import { emitAudit } from '@athlos/audit'
import { projectSchedulerRun } from './scheduler-run-projector.ts'

/**
 * Admin scheduler management routes — `/api/v1/scheduler/jobs/*`.
 *
 * Three endpoints, all gated by `requireRole('ADMIN')`:
 *
 *   POST /api/v1/scheduler/jobs/:name/run-now
 *     Triggers an immediate one-shot run of the named job. Rate-limited
 *     to 1 request per 60 seconds per operator (via @fastify/rate-limit).
 *     Returns `{ jobRunId, status }` and emits an audit row with
 *     `action: 'PROMOTE_TRIGGER'`.
 *
 *   GET /api/v1/scheduler/jobs
 *     Returns the last 20 rows from `job_runs`, ordered by `started_at DESC`.
 *     Shape: `{ items: JobRunDTO[] }`.
 *
 *   GET /api/v1/scheduler/jobs/:name
 *     Returns a single job definition plus its last 5 runs.
 *     Shape: `{ name, cronExpr, timezone, cadenceMinutes, enabled,
 *              healthy, reason, lastRuns: JobRunDTO[] }`.
 *
 *   PATCH /api/v1/scheduler/jobs/:name
 *     Body: `{ enabled: boolean }`. Calls `scheduler.setEnabled(name, enabled)`.
 *     Emits an audit row with `action: 'PROMOTE_TRIGGER'` and `metadata.enabled`.
 */

const ADMIN_GATE = { preHandler: requireRole('ADMIN') }

export const schedulerAdminRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const container: AppContainer = (fastify as FastifyInstance).container

  // POST /api/v1/scheduler/jobs/:name/run-now
  fastify.post<{ Params: { name: string } }>(
    '/api/v1/scheduler/jobs/:name/run-now',
    {
      ...ADMIN_GATE,
      config: {
        rateLimit: {
          max: 1,
          timeWindow: '60 seconds',
          keyGenerator: (request: FastifyRequest) =>
            (request as { operator?: { sub: string } }).operator?.sub ?? 'anonymous',
        },
      } as never,
    },
    async (request, reply) => {
      const { name } = request.params
      const scheduler = (fastify as FastifyInstance).scheduler

      // Verify the job exists before calling runNow (gives a clear 404)
      const definitions = scheduler.list()
      if (!definitions.find((d) => d.name === name)) {
        return reply.code(404).send({ error: 'JOB_NOT_FOUND' })
      }

      const operatorId = (request as { operator?: { sub: string } }).operator?.sub ?? 'unknown'

      const { jobRunId } = await scheduler.runNow(name, {
        triggeredBy: 'manual',
        source: 'admin',
        operatorId,
      })

      // Audit row
      await emitAudit(container.db, {
        operatorId,
        action: 'PROMOTE_TRIGGER',
        entityType: 'job_run',
        entityId: jobRunId,
        oldValue: null,
        newValue: { jobName: name, triggeredBy: 'manual' },
        sourceIp: request.ip ?? null,
        payload: undefined,
      })

      return reply.code(200).send({ jobRunId, status: 'pending' })
    },
  )

  // GET /api/v1/scheduler/jobs
  fastify.get('/api/v1/scheduler/jobs', ADMIN_GATE, async (_request, reply) => {
    // listRuns returns all jobs; filter to last 20 overall
    const runs = await listRuns(container.db, { limit: 20 })

    return reply.code(200).send({
      items: runs.map(projectSchedulerRun),
    })
  })

  // GET /api/v1/scheduler/jobs/:name
  fastify.get<{ Params: { name: string } }>(
    '/api/v1/scheduler/jobs/:name',
    ADMIN_GATE,
    async (request, reply) => {
      const { name } = request.params
      const scheduler = (fastify as FastifyInstance).scheduler

      const definitions = scheduler.list()
      const def = definitions.find((d) => d.name === name)
      if (!def) {
        return reply.code(404).send({ error: 'JOB_NOT_FOUND' })
      }

      const lastRuns = await listRuns(container.db, { jobName: name, limit: 5 })
      const healthList = await getJobHealth(container.db, [def])
      const health = healthList[0]

      return reply.code(200).send({
        name: def.name,
        cronExpr: def.cronExpr,
        timezone: def.timezone ?? null,
        cadenceMinutes: def.cadenceMinutes,
        enabled: def.enabled,
        healthy: health?.healthy ?? false,
        reason: health?.reason ?? '',
        lastRuns: lastRuns.map(projectSchedulerRun),
      })
    },
  )

  // PATCH /api/v1/scheduler/jobs/:name
  fastify.patch<{ Params: { name: string }; Body: { enabled: boolean } }>(
    '/api/v1/scheduler/jobs/:name',
    ADMIN_GATE,
    async (request, reply) => {
      const { name } = request.params
      const { enabled } = throwIfInvalid(
        z.object({ enabled: z.boolean() }),
        request.body ?? {},
        'body',
      )
      const scheduler = (fastify as FastifyInstance).scheduler
      const operatorId = (request as { operator?: { sub: string } }).operator?.sub ?? 'unknown'

      try {
        scheduler.setEnabled(name, enabled)
      } catch (err) {
        if (err instanceof Error && err.message.includes('unknown job')) {
          return reply.code(404).send({ error: 'JOB_NOT_FOUND' })
        }
        throw err
      }

      // Audit row
      await emitAudit(container.db, {
        operatorId,
        action: 'PROMOTE_TRIGGER',
        entityType: 'job',
        entityId: name,
        oldValue: null,
        newValue: { jobName: name, enabled },
        sourceIp: request.ip ?? null,
        payload: undefined,
      })

      const def = scheduler.list().find((d) => d.name === name)!
      return reply.code(200).send({
        name: def.name,
        cronExpr: def.cronExpr,
        timezone: def.timezone ?? null,
        cadenceMinutes: def.cadenceMinutes,
        enabled: def.enabled,
      })
    },
  )

  done()
}
