import type { FastifyPluginCallback } from 'fastify'
import { z } from 'zod'
import { throwIfInvalid } from '@athlos/errors'
import { requireAuth } from '@athlos/auth'
import { listByDisciplina } from '../modules/padrones/repository.ts'
import type { AppContainer } from '../container.ts'

/**
 * Padrones routes — `GET /api/v1/padrones`.
 *
 * One read-only endpoint. The query params are required
 * (`disciplina` + `ejercicio`) — without them the caller is
 * asking for "everything" which is not a sensible ask for a
 * padron. The route returns 400 with a field path on each
 * missing param.
 *
 * Role: any authenticated operator. The padron is the operator's
 * daily reference list (who's enrolled where); restricting it
 * to ADMIN would block the front-desk CONSULTA workflow.
 */

const querySchema = z.object({
  disciplina: z.string().min(1).max(40),
  ejercicio: z.coerce.number().int().min(1900).max(2200),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

const AUTH = { preHandler: requireAuth() }

export const padronesRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const container: AppContainer = fastify.container

  fastify.get('/api/v1/padrones', AUTH, async (request, reply) => {
    const q = throwIfInvalid(querySchema, request.query, 'query')
    const result = await listByDisciplina(container.db, {
      disciplinaCodigo: q.disciplina,
      ejercicioAnio: q.ejercicio,
      page: q.page ?? 1,
      limit: q.limit ?? 50,
    })
    return reply.code(200).send({
      disciplina: q.disciplina,
      ejercicio: q.ejercicio,
      items: result.items,
      page: result.page,
      limit: result.limit,
      total: result.total,
      has_more: result.page * result.limit < result.total,
    })
  })

  done()
}

declare module 'fastify' {
  interface FastifyInstance {
    container: AppContainer
  }
}
