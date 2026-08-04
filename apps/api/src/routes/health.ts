import type { FastifyPluginAsync } from 'fastify'
import type { Pool } from 'pg'
import { probeReadiness } from '../services/readiness.ts'

/**
 * Health endpoints — three surfaces per the monitoring design.
 *
 *   GET /health           Liveness — no deps, returns 200 with
 *                         { status, version, uptime, timestamp }.
 *   GET /health/ready     Readiness — pings PostgreSQL with a 2s
 *                         `SELECT 1` timeout. 503 on failure so a
 *                         load balancer can pull the instance out.
 *   GET /health/startup   Startup probe — returns 200 once the
 *                         Fastify instance is ready (the route
 *                         is registered in the same ready()
 *                         callback, so it's effectively a no-op
 *                         for now; the real startup-completion
 *                         signal is "server up and listening").
 *
 * `pool` is required so the readiness probe can run a real query.
 * The pool is the one wired by the DI container — when it points
 * at the test standin DB, the probe returns ok (the standin's
 * `query()` resolves with empty rows).
 */
export interface HealthDeps {
  pool: Pool
  /** API version from package.json. */
  version: string
}

interface ReadinessBody {
  status: 'ok' | 'down'
  db: 'ok' | 'down'
  schema: 'ok' | 'down'
  latency_ms: number
}

export const healthRoutes: FastifyPluginAsync<HealthDeps> = async (fastify, { pool, version }) => {
  // Liveness — no DB call, no auth.
  fastify.get('/health', async () => ({
    status: 'ok',
    version,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }))

  // Readiness — pings the DB with a 2s ceiling.
  fastify.get('/health/ready', async (_request, reply) => {
    const start = Date.now()
    const result = await probeReadiness(pool)
    const ok = result.db === 'ok' && result.schema === 'ok'
    const body: ReadinessBody = {
      status: ok ? 'ok' : 'down',
      db: result.db,
      schema: result.schema,
      latency_ms: Date.now() - start,
    }
    return reply.code(ok ? 200 : 503).send(body)
  })

  // Startup probe — returns 200 once the server is ready to serve.
  // The route is registered during `app.ready()`, so the answer is
  // always "ready" once a request reaches it. Kept as a separate
  // surface for future startup-completion gating (migrations, cache
  // warm-up, ...) that PR 9 (deployment) introduces.
  fastify.get('/health/startup', async (_request, reply) => {
    return reply.code(200).send({ status: 'ok' })
  })
}
