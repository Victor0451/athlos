/**
 * Import routes:
 *   POST /api/v1/import/trigger       — ADMIN: manually trigger an import batch
 *   DELETE /api/v1/import/trigger/:batchId — ADMIN: cancel a queued batch
 *   GET /api/v1/import/status         — ADMIN: last 20 import runs
 *   GET /api/v1/import/status/:batchId   — ADMIN: single run with progress
 *
 * TASK-060a: DELETE while queued returns 200, while running returns 409,
 * not found returns 404, and cancelled is idempotent 200.
 * The `cancelled` status is a new job_runs status value — no migration needed
 * (the column is text with $type<>(), widened to include 'cancelled').
 */
import type { FastifyPluginCallback } from 'fastify'
import { z } from 'zod'
import { throwIfInvalid, BusinessError, ErrorCode } from '@athlos/errors'
import { requireRole } from '@athlos/auth'
import { and, desc, eq } from 'drizzle-orm'
import { jobRuns } from '@athlos/db/schema'
import type { AppContainer } from '../container.ts'

const idSchema = z.string().uuid()
const triggerBodySchema = z.object({
  domain: z
    .enum([
      'all',
      'socios',
      'ctacte',
      'ctacte1',
      'contable',
      'contabl1',
      'catastros',
      'escuela',
      'deportes',
      'locacion',
      'caja',
      'gastos',
    ])
    .default('all'),
})

export const importRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const container = fastify.container as AppContainer

  // POST /api/v1/import/trigger — ADMIN only
  fastify.post(
    '/api/v1/import/trigger',
    { preHandler: requireRole('ADMIN') },
    async (request, reply) => {
      const body = throwIfInvalid(triggerBodySchema, request.body ?? {}, 'body')

      // Trigger the scheduled-import job
      const jobRunId = await fastify.scheduler.runNow('scheduled-import', {
        triggeredBy: 'manual',
        domain: body.domain,
      })

      return reply.code(202).send({
        batchId: jobRunId,
        status: 'queued',
        estimatedTables: body.domain === 'all' ? 14 : 1,
      })
    },
  )

  // DELETE /api/v1/import/trigger/:batchId — ADMIN only
  // TASK-060a cancel semantics:
  //   queued → 200 + status set to 'cancelled'
  //   running → 409 (cannot cancel mid-run)
  //   not found → 404
  //   already cancelled → 200 (idempotent)
  fastify.delete<{ Params: { batchId: string } }>(
    '/api/v1/import/trigger/:batchId',
    { preHandler: requireRole('ADMIN') },
    async (request, reply) => {
      const { batchId } = throwIfInvalid(z.object({ batchId: idSchema }), request.params, 'params')

      const [run] = await container.db
        .select()
        .from(jobRuns)
        .where(and(eq(jobRuns.id, batchId), eq(jobRuns.jobName, 'scheduled-import')))
        .limit(1)

      if (!run) {
        throw BusinessError(ErrorCode.NOT_FOUND, `Import batch ${batchId} not found`, {
          code: 'NOT_FOUND',
        })
      }

      if (run.status === 'running') {
        throw BusinessError(ErrorCode.CONFLICT, 'Import is already running; cannot cancel', {
          code: 'IMPORT_ALREADY_STARTED',
        })
      }

      if (run.status === 'cancelled') {
        // Idempotent: already cancelled
        return reply.code(200).send({ batchId, status: 'cancelled' })
      }

      // queued — safe to cancel
      await container.db
        .update(jobRuns)
        .set({
          status: 'cancelled',
          finishedAt: new Date(),
          errorMessage: 'cancelled by admin',
        })
        .where(eq(jobRuns.id, batchId))

      return reply.code(200).send({ batchId, status: 'cancelled' })
    },
  )

  // GET /api/v1/import/status — ADMIN: last 20 scheduled-import runs
  fastify.get(
    '/api/v1/import/status',
    { preHandler: requireRole('ADMIN') },
    async (_request, reply) => {
      const runs = await container.db
        .select({
          id: jobRuns.id,
          jobName: jobRuns.jobName,
          scheduledAt: jobRuns.scheduledAt,
          startedAt: jobRuns.startedAt,
          finishedAt: jobRuns.finishedAt,
          status: jobRuns.status,
          triggeredBy: jobRuns.triggeredBy,
          metadata: jobRuns.metadata,
        })
        .from(jobRuns)
        .where(eq(jobRuns.jobName, 'scheduled-import'))
        .orderBy(desc(jobRuns.scheduledAt))
        .limit(20)

      return reply.code(200).send({ runs })
    },
  )

  // GET /api/v1/import/status/:batchId — ADMIN: single run with progress
  fastify.get<{ Params: { batchId: string } }>(
    '/api/v1/import/status/:batchId',
    { preHandler: requireRole('ADMIN') },
    async (request, reply) => {
      const { batchId } = throwIfInvalid(z.object({ batchId: idSchema }), request.params, 'params')

      const [run] = await container.db
        .select({
          id: jobRuns.id,
          jobName: jobRuns.jobName,
          scheduledAt: jobRuns.scheduledAt,
          startedAt: jobRuns.startedAt,
          finishedAt: jobRuns.finishedAt,
          status: jobRuns.status,
          triggeredBy: jobRuns.triggeredBy,
          attempt: jobRuns.attempt,
          errorMessage: jobRuns.errorMessage,
          metadata: jobRuns.metadata,
        })
        .from(jobRuns)
        .where(and(eq(jobRuns.id, batchId), eq(jobRuns.jobName, 'scheduled-import')))
        .limit(1)

      if (!run) {
        throw BusinessError(ErrorCode.NOT_FOUND, `Import batch ${batchId} not found`, {
          code: 'NOT_FOUND',
        })
      }

      return reply.code(200).send(run)
    },
  )

  done()
}
