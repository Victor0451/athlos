/**
 * GET /api/v1/lineage/:entityId — query lineage for an entity.
 * Any authenticated operator can query lineage (no admin gate).
 *
 * The route reads from entity_uuids + raw_events to reconstruct
 * the import chain for an entity.
 */
import type { FastifyPluginCallback } from 'fastify'
import { z } from 'zod'
import { throwIfInvalid, BusinessError, ErrorCode } from '@athlos/errors'
import { requireAuth } from '@athlos/auth'
import { queryLineage } from '@athlos/lineage'
import type { AppContainer } from '../container.ts'

const idSchema = z.string().uuid()

export const lineageRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const container = fastify.container as AppContainer

  fastify.get<{ Params: { entityId: string } }>(
    '/api/v1/lineage/:entityId',
    { preHandler: requireAuth() },
    async (request, reply) => {
      const { entityId } = throwIfInvalid(
        z.object({ entityId: idSchema }),
        request.params,
        'params',
      )

      const result = await queryLineage(container.db, entityId)
      if (!result) {
        throw BusinessError(ErrorCode.NOT_FOUND, `Entity ${entityId} not found in lineage`, {
          entityId,
        })
      }

      return reply.code(200).send(result)
    },
  )

  done()
}
