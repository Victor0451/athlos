import type { FastifyPluginCallback } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '@athlos/auth'
import { throwIfInvalid } from '@athlos/errors'
import type { AppContainer } from '../container.ts'
import { createClubStatusRepository } from '../modules/club-status/repository.ts'
import { buildClubStatus } from '../modules/club-status/service.ts'

const query = z.object({
  period: z.enum(['current-month', 'last-60-days', 'last-90-days']).default('current-month'),
})
export const clubStatusRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const container: AppContainer = fastify.container
  fastify.get('/api/v1/club-status', { preHandler: requireAuth() }, async (request, reply) => {
    const { period } = throwIfInvalid(query, request.query, 'query')
    const role = request.operator!.role
    return reply.send(
      await buildClubStatus({
        role,
        period: period ?? 'current-month',
        now: container.clock.now(),
        repo: createClubStatusRepository(container.db),
        freshness: await container.freshnessService.getFreshness(),
      }),
    )
  })
  done()
}
