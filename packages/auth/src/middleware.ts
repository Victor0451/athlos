import type { FastifyRequest, FastifyPluginCallback, preHandlerHookHandler } from 'fastify'
import fp from 'fastify-plugin'
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
 * Marker property on gate functions. Set on every preHandler
 * returned by `requireAuth` / `requireRole` / `requirePermission`
 * so the route-audit (apps/api/src/plugins/route-audit.ts) can
 * detect auth-gated routes at registration time. The function's
 * `.name` is anonymous after the factory returns, so the marker
 * is the only reliable signal.
 *
 * Exported for the route-audit plugin to read.
 */
export const ATHLOS_GATE_MARKER = Symbol.for('@athlos/auth/gate')

/**
 * Wrap a preHandler factory's return value with the gate marker.
 * Used internally by the three gate functions below.
 */
function markGate(
  fn: preHandlerHookHandler,
  kind: 'auth' | 'role' | 'permission',
): preHandlerHookHandler {
  ;(fn as unknown as Record<symbol, { kind: string }>)[ATHLOS_GATE_MARKER] = { kind }
  return fn
}

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
  // Wrap with `fastify-plugin` so the onRequest hook and request
  // decorator registered here apply to the PARENT scope, not the
  // plugin's encapsulated context. Without this, the hook only
  // fires for routes registered inside `authPlugin` itself — which
  // is none — so every request would reach `requireAuth` with no
  // operator and bounce to 401.
  const plugin: FastifyPluginCallback = (fastify, _opts, done) => {
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
  return fp(plugin, { name: 'athlos-auth' })
}

/**
 * Reject requests that arrive without a verified operator. Use as a
 * `preHandler` on any route that should be authenticated but doesn't
 * care about the role.
 */
export function requireAuth(): preHandlerHookHandler {
  return markGate(async (request, _reply) => {
    if (!request.operator) {
      throw BusinessError(ErrorCode.TOKEN_INVALID, 'Authentication required')
    }
  }, 'auth')
}

/**
 * Reject requests whose operator's role is not in the allow-list.
 * Compose with `requireAuth()` (or rely on this hook — it already
 * checks for a present operator).
 */
export function requireRole(...roles: Array<JWTPayload['role']>): preHandlerHookHandler {
  return markGate(async (request) => {
    if (!request.operator) {
      throw BusinessError(ErrorCode.TOKEN_INVALID, 'Authentication required')
    }
    if (!roles.includes(request.operator.role)) {
      throw BusinessError(
        ErrorCode.INSUFFICIENT_PERMISSIONS,
        `Role ${request.operator.role} cannot access this resource`,
      )
    }
  }, 'role')
}

/**
 * Reject requests whose operator lacks a specific permission flag.
 *
 * Permission keys are checked against TWO sources:
 *   1. JWT payload permissions (can_reprint, can_anulate — set at login)
 *   2. role_permissions table (arbitrary keys like 'data_steward')
 *      — checked via permissionsRepo in container for live grants
 *
 * The `perm` parameter accepts a string so arbitrary keys compile.
 * Known keys (can_reprint, can_anulate) are still typed via
 * keyof JWTPayload['permissions'] at the call site for compile-time safety.
 */
export function requirePermission(perm: string): preHandlerHookHandler {
  return markGate(async (request) => {
    if (!request.operator) {
      throw BusinessError(ErrorCode.TOKEN_INVALID, 'Authentication required')
    }
    // First check the JWT payload (for can_reprint, can_anulate, etc.)
    const perms = (request.operator as { permissions?: Record<string, boolean> }).permissions
    if (perms !== undefined && perm in perms) {
      if (perms[perm]) return // permission granted in JWT
      throw BusinessError(ErrorCode.INSUFFICIENT_PERMISSIONS, `Missing permission: ${perm}`)
    }
    // For arbitrary keys (e.g. 'data_steward'), check the role_permissions table

    const serverWithContainer = request.server as {
      container?: {
        permissionsRepo?: { hasPermission: (operatorId: string, key: string) => Promise<boolean> }
      }
    }
    const repo = serverWithContainer.container?.permissionsRepo
    if (repo) {
      if (await repo.hasPermission(request.operator.sub, perm)) return
    }
    throw BusinessError(ErrorCode.INSUFFICIENT_PERMISSIONS, `Missing permission: ${perm}`)
  }, 'permission')
}
