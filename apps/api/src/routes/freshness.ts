/**
 * GET /api/v1/freshness — query per-domain freshness status.
 * Any authenticated operator can check freshness (no admin gate).
 *
 * Reads from the domain_freshness cache table (refreshed every 60s
 * by the freshness-refresh job). Computes status + ageDisplay on the fly.
 */
import type { FastifyPluginCallback } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '@athlos/auth'
import type { AppContainer } from '../container.ts'

const domainSchema = z
  .enum([
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
  .optional()

export const freshnessRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const container = fastify.container as AppContainer

  fastify.get('/api/v1/freshness', { preHandler: requireAuth() }, async (request, reply) => {
    const domain =
      domainSchema.parse((request.query as Record<string, unknown>).domain) ?? undefined

    const items = await container.freshnessService.getFreshness(domain ? { domain } : {})
    return reply.code(200).send({ items })
  })

  done()
}
