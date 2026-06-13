import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import fastifyRateLimit from '@fastify/rate-limit'

/**
 * Rate-limit plugin.
 *
 * Two layers per the api-security spec:
 *
 *   1. Per-IP — 100 requests / 60s window for the global API.
 *      Counted on the source IP (Fastify's `request.ip`).
 *
 *   2. Per-route — the `/api/v1/auth/login` and `/api/v1/auth/refresh`
 *      endpoints are throttled harder (5 requests / 60s) to slow
 *      credential-stuffing and token-replay attacks. The route-level
 *      `config.rateLimit` field is honoured by `@fastify/rate-limit`
 *      when set.
 *
 * Exempt endpoints (health probes, approval-by-token) bypass the
 * global rate limit via `allowList` — the spec lists
 * `/health*`, `/api/v1/approval/:token`, and the unauthenticated
 * version-discovery endpoint.
 *
 * The 429 response shape mirrors the spec:
 *   HTTP 429
 *   Retry-After: <seconds>
 *   { error: "RATE_LIMIT_EXCEEDED", message: ..., retry_after: <seconds> }
 *
 * Wrapped with `fastify-plugin` so the limit applies to the parent
 * scope (every route registered after this plugin is throttled
 * unless explicitly exempt).
 */
const rateLimitPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(fastifyRateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
    // Exempt paths — keep short, match the spec's allow-list.
    allowList: (request) => {
      const url = request.url
      return (
        url === '/health' ||
        url.startsWith('/health/') ||
        url === '/metrics' ||
        url === '/api/versions' ||
        // Approval-by-token (the token IS the auth) — see PR 3b.
        url.startsWith('/api/v1/approval/')
      )
    },
    errorResponseBuilder: (_request, context) => ({
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests',
      retry_after: Math.ceil(context.ttl / 1000),
    }),
  })
}

/**
 * Strict limiter for the auth endpoints. Apply via the route's
 * `config.rateLimit` field:
 *
 *   fastify.post('/api/v1/auth/login', {
 *     config: { rateLimit: authRateLimitConfig },
 *   }, handler)
 */
export const authRateLimitConfig = { max: 5, timeWindow: '1 minute' }

export const rateLimit = fp(rateLimitPlugin, { name: 'athlos-rate-limit' })
