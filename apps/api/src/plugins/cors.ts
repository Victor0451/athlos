import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import fastifyCors from '@fastify/cors'
import type { Env } from '@athlos/config'

/**
 * CORS plugin.
 *
 * Uses `@fastify/cors` with the allowlist parsed from
 * `CORS_ORIGINS` (comma-separated). The config schema defaults the
 * value to `http://localhost:3000` for dev. The web app (TASK-063+)
 * runs on port 3000 in dev and on its production origin in prod —
 * both are added to the allowlist at deploy time.
 *
 * `credentials: true` is set so the browser can send the
 * `Authorization: Bearer <jwt>` header on cross-origin XHR. Per the
 * CORS spec, `Access-Control-Allow-Credentials: true` requires a
 * non-wildcard `Access-Control-Allow-Origin`. `@fastify/cors` handles
 * this correctly when the origin matches the allowlist.
 *
 * `maxAge: 86400` caches the preflight response for 24 hours,
 * reducing the OPTIONS chatter for SPA clients.
 *
 * Wrapped with `fastify-plugin` so the cors headers reach the
 * parent scope.
 */
const corsPlugin: FastifyPluginAsync<{ getEnv: () => Env }> = async (fastify, { getEnv }) => {
  const origins = getEnv()
    .CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  await fastify.register(fastifyCors, {
    origin: origins,
    credentials: true,
    maxAge: 86400,
  })
}

export const cors = fp(corsPlugin, { name: 'athlos-cors' })
