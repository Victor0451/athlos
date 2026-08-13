import type { FastifyError, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import { ApiError, redact } from '@athlos/errors'

/**
 * Global error handler — `setErrorHandler` runs after the request
 * finishes with an error and BEFORE the response is sent. We funnel
 * every error shape (ApiError business, ApiError technical, Zod
 * validation, Fastify built-in validation, unknown) through a single
 * mapping so the response shape is consistent across the API.
 *
 * Response body shape:
 *
 *   {
 *     error: <ErrorCode>,         // machine-readable code from @athlos/errors
 *     message: <string>,          // safe to return for business errors
 *     details?: <unknown>,        // optional payload (Zod field errors, etc.)
 *     request_id: <string>        // correlates with the request_id in logs
 *   }
 *
 * PII redaction runs on whatever reaches the log line — never on the
 * response body (clients need the validation field paths). The
 * `redact()` utility from @athlos/errors strips password / token /
 * dni / cuit / authorization values before they hit disk.
 *
 * Wrapped with `fastify-plugin` so the `setErrorHandler` applies to
 * the parent scope (PR 3a / 3b lesson — without `fp`, the handler
 * is encapsulated and never sees the routes registered after it).
 */
const errorHandlerPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.setErrorHandler((err: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    // 1. Our own ApiError — the most common case for business errors
    //    (NOT_FOUND, INVALID_CREDENTIALS, ...) and technical errors
    //    (uncaught DB failures wrapped by the service layer).
    if (err instanceof ApiError) {
      if (!err.isBusiness) {
        request.log.error(
          { err: redact(err), code: err.code, request_id: request.id },
          'technical error',
        )
      }
      return reply.code(err.statusCode).send({
        error: err.code,
        message: err.isBusiness ? err.message : 'Internal server error',
        ...(err.details !== undefined ? { details: err.details } : {}),
        request_id: request.id,
      })
    }

    // 2. Zod errors thrown directly (the route layer usually catches
    //    them via `throwIfInvalid`, but if a route forgets and lets
    //    the error escape, we still want a clean 400).
    if (err.name === 'ZodError') {
      request.log.warn(
        { err: redact(err), request_id: request.id },
        'unhandled zod error — route should use throwIfInvalid',
      )
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: { issues: (err as unknown as { issues: unknown }).issues },
        request_id: request.id,
      })
    }

    // 3. Fastify built-in validation (e.g. schema declared via
    //    `schema:` on the route — we use Zod in this codebase so
    //    this branch is rare, but we keep it for safety).
    if ((err as { validation?: unknown }).validation) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: (err as { validation: unknown }).validation,
        request_id: request.id,
      })
    }

    // Fastify raises parser and rate-limit failures before the route handler.
    // Preserve their safe HTTP semantics instead of collapsing them into 500s.
    const statusCode = (err as { statusCode?: unknown }).statusCode
    if (statusCode === 413) {
      return reply.code(413).send({
        error: 'PAYLOAD_TOO_LARGE',
        message: 'Request payload is too large',
        request_id: request.id,
      })
    }
    if (statusCode === 429 || (err as { error?: unknown }).error === 'RATE_LIMIT_EXCEEDED') {
      return reply.code(429).send({
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests',
        retry_after: reply.getHeader('retry-after'),
        request_id: request.id,
      })
    }

    // 4. Unknown error: log the redacted shape, return a generic 500.
    //    The original message is NEVER sent to the client — it would
    //    leak stack-trace fragments, file paths, and SQL fragments.
    request.log.error({ err: redact(err), request_id: request.id }, 'unhandled error')
    return reply.code(500).send({
      error: 'INTERNAL_ERROR',
      message: 'Internal server error',
      request_id: request.id,
    })
  })

  // 404 handler — keeps the response shape consistent when no
  // route matches. Without this, Fastify returns a plain string
  // body that breaks client JSON parsers.
  fastify.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: 'NOT_FOUND',
      message: `Route ${request.method} ${request.url} not found`,
      request_id: request.id,
    })
  })
}

export const errorHandler = fp(errorHandlerPlugin, { name: 'athlos-error-handler' })
