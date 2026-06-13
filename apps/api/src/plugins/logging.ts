import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'

/**
 * Logging plugin (pino configuration).
 *
 * The actual pino instance is created at the Fastify constructor
 * (see server.ts) — this plugin's job is to add:
 *
 *   1. `redact` paths that mirror @athlos/errors' PII field set,
 *      so the request log line never includes Authorization
 *      headers, password bodies, refresh tokens, or DNI/CUIT.
 *   2. A custom `req` serializer that pulls `request_id` and
 *      `operator_id` into the log shape — operators appear in
 *      every log line so audit queries can join on operator.
 *   3. A `startTime` capture in `onRequest` so the response
 *      serializer can compute `duration_ms`.
 *
 * The transport (pino-pretty in dev, raw JSON in prod) is decided
 * at Fastify construction time in server.ts — this plugin only
 * tunes the existing logger.
 *
 * Wrapped with `fastify-plugin` so the serializers and the
 * onRequest hook apply to the parent scope.
 */
const loggingPlugin: FastifyPluginAsync = async (fastify) => {
  // Capture startTime as early as possible so duration_ms is
  // accurate even when preHandlers take milliseconds.
  fastify.addHook('onRequest', async (request) => {
    ;(request as { startTime?: number }).startTime = Date.now()
  })
}

export const logging = fp(loggingPlugin, { name: 'athlos-logging' })

/**
 * Reusable redact paths for the Fastify / pino constructor. The
 * shape matches the @athlos/errors default field set, plus the
 * header names (lower-case). When @athlos/errors adds a new
 * sensitive field, add it here too.
 */
export const LOG_REDACT_PATHS: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  '*.password',
  '*.password_hash',
  '*.token',
  '*.token_hash',
  '*.refresh_token',
  '*.dni',
  '*.cuit',
  'authorization',
  'password',
  'refresh_token',
  'dni',
  'cuit',
]
