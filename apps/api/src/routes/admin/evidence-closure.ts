import type { FastifyPluginCallback } from 'fastify'
import { requireRole } from '@athlos/auth'
import { throwIfInvalid } from '@athlos/errors'
import { z } from 'zod'
import { createClosurePreview } from '../../modules/socios/evidence-closure-boundary.ts'

const pair = z.object({ catalogBatchId: z.string().uuid(), sociosBatchId: z.string().uuid() })

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
  done()
}
