import type { FastifyRequest, FastifyPluginCallback, preHandlerHookHandler } from 'fastify'
import { verifyAccessToken, type JWTPayload } from './jwt.ts'
import type { Env } from '@athlos/config'
import { BusinessError, ErrorCode } from '@athlos/errors'

/**
 * Augment Fastify's request type so route handlers can write
 * `request.operator` and get the typed payload (or `undefined` if the
 * request is unauthenticated). The decorator in `authPlugin` below
 * initializes the field to `null`; this declaration is the type-level
 * promise to consumers.
 */
declare module 'fastify' {
  interface FastifyRequest {
    operator?: JWTPayload | null
  }
}

export type { JWTPayload }

/**
 * Build a Fastify plugin that reads the `Authorization: Bearer <jwt>`
 * header on every request, verifies it, and decorates
 * `request.operator` with the payload. Missing / invalid tokens do
 * NOT throw — anonymous routes stay reachable. The `requireAuth`
 * pre-handler below is the gate that rejects unauthenticated calls.
 *
 * `getEnv` is a thunk (not a captured value) so the plugin can be
 * registered in tests with a stub env without rebuilding the server.
 */
export function authPlugin(getEnv: () => Env): FastifyPluginCallback {
  return (fastify, _opts, done) => {
    fastify.decorateRequest('operator', null)

    fastify.addHook('onRequest', async (request: FastifyRequest) => {
      const auth = request.headers.authorization
      if (!auth?.startsWith('Bearer ')) return
      const token = auth.slice('Bearer '.length).trim()
      if (token.length === 0) return
      try {
        request.operator = verifyAccessToken(token, getEnv())
      } catch {
        // Surface as a typed business error so the global error handler
        // emits a 401 with the right code. We don't decorate the request
        // — anonymous downstream handlers still work.
        throw BusinessError(ErrorCode.TOKEN_INVALID, 'Invalid or expired token')
      }
    })

    done()
  }
}

/**
 * Reject requests that arrive without a verified operator. Use as a
 * `preHandler` on any route that should be authenticated but doesn't
 * care about the role.
 */
export function requireAuth(): preHandlerHookHandler {
  return async (request, _reply) => {
    if (!request.operator) {
      throw BusinessError(ErrorCode.TOKEN_INVALID, 'Authentication required')
    }
  }
}

/**
 * Reject requests whose operator's role is not in the allow-list.
 * Compose with `requireAuth()` (or rely on this hook — it already
 * checks for a present operator).
 */
export function requireRole(...roles: Array<JWTPayload['role']>): preHandlerHookHandler {
  return async (request) => {
    if (!request.operator) {
      throw BusinessError(ErrorCode.TOKEN_INVALID, 'Authentication required')
    }
    if (!roles.includes(request.operator.role)) {
      throw BusinessError(
        ErrorCode.INSUFFICIENT_PERMISSIONS,
        `Role ${request.operator.role} cannot access this resource`,
      )
    }
  }
}

/**
 * Reject requests whose operator lacks a specific permission flag.
 * Permissions are typed via `keyof JWTPayload['permissions']` so a typo
 * at the call site is a compile error.
 */
export function requirePermission(perm: keyof JWTPayload['permissions']): preHandlerHookHandler {
  return async (request) => {
    if (!request.operator) {
      throw BusinessError(ErrorCode.TOKEN_INVALID, 'Authentication required')
    }
    if (!request.operator.permissions[perm]) {
      throw BusinessError(ErrorCode.INSUFFICIENT_PERMISSIONS, `Missing permission: ${perm}`)
    }
  }
}
