import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import fastifyHelmet from '@fastify/helmet'

/**
 * Helmet plugin.
 *
 * Sets the standard set of security headers (`X-Frame-Options`,
 * `Strict-Transport-Security`, `X-Content-Type-Options`,
 * `Referrer-Policy`, ...). We disable `contentSecurityPolicy` —
 * this is a JSON API, not an HTML page; CSP belongs to the web
 * app (TASK-063), not the API surface. The other Helmet headers
 * are still useful (defense in depth).
 *
 * Wrapped with `fastify-plugin` so the headers apply to the parent
 * scope.
 */
const helmetPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(fastifyHelmet, {
    contentSecurityPolicy: false,
  })
}

export const helmet = fp(helmetPlugin, { name: 'athlos-helmet' })
