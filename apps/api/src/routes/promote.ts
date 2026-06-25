/**
 * promote.ts — Admin promotion trigger endpoint (E2 — Slice E closure).
 *
 * POST /api/v1/promote/trigger — ADMIN: trigger a full or per-domain promotion (sync HTTP)
 * GET  /api/v1/promote/status  — ADMIN: last 20 promotion runs (read-only)
 *
 * Mirrors apps/api/src/routes/import.ts but SYNCHRONOUSLY (returns 200
 * when done, NOT 202 + batchId). The CLI runner (pnpm db:promote) IS
 * the same code path — this endpoint just wraps it with auth + per-operator
 * rate limit + audit emission.
 *
 * 120s request timeout to avoid NGINX proxy_read_timeout 60s mid-flight
 * cut for full domain:all promotions (~60-90s on live DB).
 */
import type { FastifyPluginCallback } from 'fastify'
import { z } from 'zod'
import { requireRole } from '@athlos/auth'
import { emitAudit } from '@athlos/audit'
import { desc, eq } from 'drizzle-orm'
import { auditEvents } from '@athlos/db/schema'
import { promoteDomain, type Domain, type PromotionResult } from '@athlos/promotion'
import { PROMOTION_ORDER } from '@athlos/promotion'
import type { AppContainer } from '../container.ts'

const triggerBodySchema = z.object({
  domain: z
    .enum([
      'all',
      'socios',
      'escuela',
      'deportes',
      'locacion',
      'caja',
      'gastos',
      'ctacte',
      'ctacte1',
    ])
    .default('all'),
})

export const promoteRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const container = fastify.container as AppContainer

  // POST /api/v1/promote/trigger — ADMIN only, per-operator rate-limited (1/min)
  fastify.post<{ Body: z.infer<typeof triggerBodySchema> }>(
    '/api/v1/promote/trigger',
    {
      preHandler: requireRole('ADMIN'),
      config: { timeout: 120_000 },
    },
    async (request, reply) => {
      const body = triggerBodySchema.parse(request.body ?? {})

      // Concurrent-trigger guard (in-memory flag on container)
      if (container.promotionInFlight) {
        return reply.code(200).send({ status: 'already_running' })
      }
      container.promotionInFlight = true

      const t0 = Date.now()
      try {
        // Build the domain list per body.domain
        const domains: Domain[] =
          body.domain === 'all' ? [...PROMOTION_ORDER] : [body.domain as Domain]

        // Run promotion synchronously in the request thread
        const results: PromotionResult[] = []
        for (const domain of domains) {
          results.push(await promoteDomain(container.db, domain))
        }

        // Aggregate totals
        const totals = results.reduce(
          (acc, r) => ({
            inserted: acc.inserted + r.inserted,
            skipped: acc.skipped + r.skipped,
            failed: acc.failed + r.failed,
          }),
          { inserted: 0, skipped: 0, failed: 0 },
        )
        const durationMs = Date.now() - t0
        const status: 'completed' | 'failed' = totals.failed === 0 ? 'completed' : 'failed'

        // Audit row (1 per trigger — 10s bucket dedup handles double-clicks)
        await emitAudit(container.db, {
          operatorId: request.operator!.sub,
          action: 'PROMOTE_TRIGGER',
          entityType: 'promotion',
          entityId: `promotion-${t0}`,
          oldValue: null,
          newValue: { domain: body.domain, totals, durationMs },
          sourceIp: request.ip ?? null,
          payload: {
            domain: body.domain,
            results: results.map((r) => ({
              domain: r.domain,
              attempted: r.attempted,
              inserted: r.inserted,
              skipped: r.skipped,
              failed: r.failed,
              errors: r.errors.length,
            })),
          },
        })

        return reply.code(200).send({
          status,
          inserted: totals.inserted,
          skipped: totals.skipped,
          failed: totals.failed,
          durationMs,
          domains: results,
        })
      } catch (err) {
        return reply.code(500).send({
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - t0,
        })
      } finally {
        // ALWAYS reset the flag — even on timeout, exception, or 500
        container.promotionInFlight = false
      }
    },
  )

  // GET /api/v1/promote/status — ADMIN only, last 20 promotion runs
  fastify.get(
    '/api/v1/promote/status',
    { preHandler: requireRole('ADMIN') },
    async (_request, reply) => {
      const runs = await container.db
        .select({
          id: auditEvents.id,
          operatorId: auditEvents.operatorId,
          action: auditEvents.action,
          entityId: auditEvents.entityId,
          newValue: auditEvents.newValue,
          createdAt: auditEvents.createdAt,
        })
        .from(auditEvents)
        .where(eq(auditEvents.action, 'PROMOTE_TRIGGER'))
        .orderBy(desc(auditEvents.createdAt))
        .limit(20)

      return reply.code(200).send({ runs })
    },
  )

  done()
}
