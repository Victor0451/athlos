import type { FastifyPluginCallback } from 'fastify'
import { z } from 'zod'
import { idSchema } from '@athlos/validation'
import { throwIfInvalid } from '@athlos/errors'
import { requireAuth } from '@athlos/auth'
import { getCuentaCorriente, listMovimientos } from '../modules/ctacte/service.ts'
import type { AppContainer } from '../container.ts'

/**
 * Cuenta Corriente (ledger) routes.
 *
 * Two read-only endpoints, both nested under `/api/v1/socios/:id`
 * so the URL is the canonical "this socio's ledger" view — a
 * consumer doesn't need to know which schema the data lives in.
 *
 *   GET /api/v1/socios/:id/cuenta-corriente
 *     Returns { socio_id, saldo, saldo_calculado_at, movimientos, ... }
 *
 *   GET /api/v1/socios/:id/cuenta-corriente/movimientos
 *     Returns { items, page, limit, total, has_more } (page-only).
 *
 * Role: any authenticated operator. The READ surface is shared
 * across the operator console (TESORERO) and the front-desk
 * CONSULTA view — restricting it would block legitimate use cases.
 */

const idParamSchema = z.object({ id: idSchema })

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  desde: z.string().datetime({ offset: true }).optional(),
  hasta: z.string().datetime({ offset: true }).optional(),
  incluir_anuladas: z.union([z.literal('true'), z.literal('false')]).default('false'),
})

const AUTH = { preHandler: requireAuth() }

export const ctacteRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const container: AppContainer = fastify.container

  // GET /api/v1/socios/:id/cuenta-corriente
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/socios/:id/cuenta-corriente',
    AUTH,
    async (request, reply) => {
      const params = throwIfInvalid(idParamSchema, request.params, 'params')
      const q = throwIfInvalid(listQuerySchema, request.query, 'query')
      const result = await getCuentaCorriente(container.db, {
        socioId: params.id,
        page: q.page ?? 1,
        limit: q.limit ?? 20,
        ...(q.desde ? { desde: new Date(q.desde) } : {}),
        ...(q.hasta ? { hasta: new Date(q.hasta) } : {}),
        incluirAnuladas: q.incluir_anuladas === 'true',
      })
      return reply.code(200).send(result)
    },
  )

  // GET /api/v1/socios/:id/cuenta-corriente/movimientos
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/socios/:id/cuenta-corriente/movimientos',
    AUTH,
    async (request, reply) => {
      const params = throwIfInvalid(idParamSchema, request.params, 'params')
      const q = throwIfInvalid(listQuerySchema, request.query, 'query')
      const result = await listMovimientos(container.db, {
        socioId: params.id,
        page: q.page ?? 1,
        limit: q.limit ?? 20,
        ...(q.desde ? { desde: new Date(q.desde) } : {}),
        ...(q.hasta ? { hasta: new Date(q.hasta) } : {}),
        incluirAnuladas: q.incluir_anuladas === 'true',
      })
      return reply.code(200).send(result)
    },
  )

  done()
}

declare module 'fastify' {
  interface FastifyInstance {
    container: AppContainer
  }
}
