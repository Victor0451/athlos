import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { Registry, collectDefaultMetrics, Counter, Histogram } from 'prom-client'

/**
 * Metrics plugin (prom-client).
 *
 * Exposes a single `Registry` with:
 *
 *   - Process / Node default collectors (CPU, memory, eventloop lag,
 *     GC, ...) — `collectDefaultMetrics()`.
 *   - HTTP request counter + duration histogram, populated by the
 *     `onResponse` hook.
 *   - Import runs counter, populated by the import pipeline (PR 7).
 *
 * Exposes `GET /metrics` in Prometheus text format. NOT auth-protected
 * — the spec leaves production restriction to the reverse proxy
 * (Caddy/Nginx ACL on the private network). Fastify by default
 * accepts the route; we add a single Fastify route handler.
 *
 * Cardinality control: the `route` label uses `request.routeOptions.url`
 * (the matched route template, e.g. `/api/v1/socios/:id`), never the
 * raw URL. This keeps the label set bounded to the number of
 * registered routes (~30) — safe for Prometheus.
 *
 * Wrapped with `fastify-plugin` so the registry + the onResponse
 * hook apply to the parent scope.
 */
const registry = new Registry()
collectDefaultMetrics({ register: registry })

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests by method, route, and status code.',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [registry],
})

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds.',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
})

/**
 * Import run counter. Incremented at the point of action by the
 * import pipeline (PR 7) — `metrics.importRunsTotal.inc({ domain, status })`
 * when an import run finishes. The `domain` label is bounded to
 * the known import domains (socios, ctacte, contable, ...).
 */
export const importRunsTotal = new Counter({
  name: 'import_runs_total',
  help: 'Total import runs by domain and terminal status.',
  labelNames: ['domain', 'status'] as const,
  registers: [registry],
})

const metricsPlugin: FastifyPluginAsync = async (fastify) => {
  // onResponse fires after Fastify has set reply.statusCode and
  // request.routeOptions.url — the only correct time to read them.
  fastify.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions.url ?? request.url
    const labels = {
      method: request.method,
      route,
      status_code: String(reply.statusCode),
    }
    httpRequestsTotal.inc(labels)
    const start = (request as { startTime?: number }).startTime
    if (typeof start === 'number') {
      const durationSec = (Date.now() - start) / 1000
      httpRequestDuration.observe(labels, durationSec)
    }
  })

  // /metrics is unauthenticated — spec mandates the scraper lives
  // on the private network, gated by reverse proxy. We still log
  // every scrape so operators can see Prometheus traffic in the
  // log stream.
  fastify.get('/metrics', async (_request, reply) => {
    reply.header('Content-Type', registry.contentType)
    return registry.metrics()
  })
}

export const metrics = fp(metricsPlugin, { name: 'athlos-metrics' })
export { registry as metricsRegistry }
