import type { FastifyPluginAsync, RawRequestDefaultExpression, RawServerDefault } from 'fastify'
import fp from 'fastify-plugin'
import { randomUUID } from 'node:crypto'

/**
 * Request ID plugin.
 *
 * Responsibilities:
 *
 *   1. Accept an inbound `x-request-id` header (max 128 chars,
 *      validated to a safe charset) and use it as the request id.
 *   2. If absent or invalid, generate a UUID v4.
 *   3. Echo the chosen id back as `x-request-id` on the response so
 *      clients (and reverse proxies) can correlate logs.
 *
 * The validation charset is intentionally narrow: alphanumeric,
 * dashes, underscores. This stops header-injection attempts (`\r\n`,
 * `<script>`, ...) from polluting the id that ends up in logs
 * and audit events.
 *
 * Implementation note: Fastify's built-in `genReqId` factory (in
 * `lib/req-id-gen-factory.js`) does
 *   `req.headers[requestIdHeader] || genReqId(req)`
 * — meaning it uses the inbound header UNCONDITIONALLY when present,
 * without calling our genReqId. We can't validate the value at the
 * genReqId layer. Instead we validate in an `onRequest` hook and
 * reassign `request.id` when the inbound value is malformed. This
 * keeps Fastify's request-id machinery (logging, error handler)
 * consistent: `request.id` is always a safe value.
 *
 * Wrapped with `fastify-plugin` so the hook + response header
 * apply to the parent scope (every route registered after this
 * plugin gets the header for free).
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * The validated request id. Mirrors `request.id` but is the
     * post-validation value (Fastify's `request.id` may be the
     * raw inbound header before our `onRequest` hook runs).
     */
    validatedRequestId?: string
  }
}

const requestIdPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', async (request) => {
    const inbound = request.headers['x-request-id']
    if (typeof inbound === 'string' && ID_PATTERN.test(inbound)) {
      // Override Fastify's id with the validated value. This is the
      // single source of truth downstream.
      ;(request as { id: string }).id = inbound
      request.validatedRequestId = inbound
    } else {
      // Replace a malformed inbound id with a fresh UUID. We assign
      // to `request.id` so logs / errors carry the safe value.
      const safe = randomUUID()
      ;(request as { id: string }).id = safe
      request.validatedRequestId = safe
    }
  })

  fastify.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', String(request.id))
    return payload
  })
}

export const requestId = fp(requestIdPlugin, { name: 'athlos-request-id' })

/**
 * genReqId factory used by the Fastify constructor. Fastify wraps
 * this in `req.headers[requestIdHeader] || genReqId(req)`, so we
 * only see requests WITHOUT an inbound header. The validation runs
 * in the `onRequest` hook above (which sees the raw header) — see
 * the file-level doc for the rationale.
 */
export function genRequestId(_request: RawRequestDefaultExpression<RawServerDefault>): string {
  return randomUUID()
}
