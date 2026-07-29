import type { FastifyPluginCallback } from 'fastify'
import { randomUUID } from 'node:crypto'
import { requireRole } from '@athlos/auth'
import { throwIfInvalid } from '@athlos/errors'
import { z } from 'zod'
import {
  confirmClosureReservation,
  createClosurePreview,
} from '../../modules/socios/evidence-closure-boundary.ts'

const pair = z.object({ catalogBatchId: z.string().uuid(), sociosBatchId: z.string().uuid() })
const confirmation = pair.extend({
  previewId: z.string().uuid(),
  fingerprint: z.string().length(64),
})
export const evidenceClosureRoutes: FastifyPluginCallback = (app, _opts, done) => {
  app.post(
    '/api/v1/admin/socios-evidence-closures/preview',
    { preHandler: requireRole('ADMIN') },
    async (request, reply) => {
      const body = throwIfInvalid(pair, request.body ?? {}, 'body')
      try {
        return reply
          .code(201)
          .send(
            await createClosurePreview(
              app.container.pool,
              'public',
              body.catalogBatchId,
              body.sociosBatchId,
              'socios',
            ),
          )
      } catch (error) {
        if (error instanceof Error && error.message === 'invalid closure batch pair')
          return reply.code(400).send({ error: 'INVALID_CLOSURE_BATCH_PAIR' })
        throw error
      }
    },
  )
  app.post(
    '/api/v1/admin/socios-evidence-closures/confirm',
    { preHandler: requireRole('ADMIN') },
    async (request, reply) => {
      let cancelled = request.raw.aborted
      const onAborted = () => {
        cancelled = true
      }
      const onClose = () => {
        if (!reply.raw.writableEnded) cancelled = true
      }
      request.raw.once('aborted', onAborted)
      reply.raw.once('close', onClose)
      try {
        const body = throwIfInvalid(confirmation, request.body ?? {}, 'body')
        const idempotencyKey = throwIfInvalid(
          z.string().min(1).max(128),
          request.headers['idempotency-key'] ?? '',
        )
        const result = await confirmClosureReservation(
          app.container.pool,
          'public',
          { ...body, idempotencyKey },
          randomUUID(),
          () => cancelled,
          'socios',
        )
        if (result.outcome === 'cancelled') return reply.code(499).send()
        if (result.outcome === 'replay') return reply.code(200).send({ status: 'replay' })
        if (result.outcome === 'accepted')
          return reply.code(202).send({ status: 'accepted', fence: result.fence })
        return reply.code(409).send({ error: 'CLOSURE_CONFIRMATION_CONFLICT' })
      } finally {
        request.raw.removeListener('aborted', onAborted)
        reply.raw.removeListener('close', onClose)
      }
    },
  )
  done()
}
