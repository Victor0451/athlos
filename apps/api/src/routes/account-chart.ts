import type { FastifyPluginCallback } from 'fastify'
import { requireRole } from '@athlos/auth'
import { throwIfInvalid } from '@athlos/errors'
import { z } from 'zod'
import type { AppContainer } from '../container.ts'
import { listAccountChart, type AccountChartFilter } from '../modules/account-chart/repository.ts'

const CHART_GATE = { preHandler: requireRole('ADMIN', 'TESORERO', 'OPERADOR') }
const filter = z
  .object({
    code: z.string().trim().min(1).max(100).optional(),
    name: z.string().trim().min(1).max(100).optional(),
    root: z.string().trim().min(1).max(20).optional(),
    group: z.string().trim().min(1).max(100).optional(),
    active: z.enum(['true', 'false']).optional(),
  })
  .strict()

export interface AccountChartRouteOptions {
  list?: typeof listAccountChart
}

const toFilter = (query: z.output<typeof filter>): AccountChartFilter => ({
  ...(query.code ? { code: query.code } : {}),
  ...(query.name ? { name: query.name } : {}),
  ...(query.root ? { root: query.root } : {}),
  ...(query.group ? { group: query.group } : {}),
  ...(query.active !== undefined ? { active: query.active === 'true' } : {}),
})

export const accountChartRoutes: FastifyPluginCallback<AccountChartRouteOptions> = (
  fastify,
  options,
  done,
) => {
  const container: AppContainer = fastify.container
  const list = options.list ?? listAccountChart
  fastify.get('/api/v1/account-chart', CHART_GATE, async (request, reply) => {
    const query = throwIfInvalid(filter, request.query, 'query')
    const items = await list(container.db, toFilter(query))
    return reply.code(200).send({
      items: items.map((item) => ({ ...item, eligible: item.active && item.imputable })),
    })
  })
  done()
}

declare module 'fastify' {
  interface FastifyInstance {
    container: AppContainer
  }
}
