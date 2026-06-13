import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { ATHLOS_GATE_MARKER } from '@athlos/auth'

/**
 * Route-audit plugin — startup check that verifies every
 * `/api/v1/*` route is protected by an auth gate.
 *
 * The PR 3a bug: `authPlugin` was registered via `app.register`
 * but lacked the `fastify-plugin` wrapper, so its `onRequest` hook
 * and `request.operator` decorator only applied inside the
 * plugin's encapsulated context (no routes). Every protected
 * request silently bounced to 401. The route-audit makes that
 * class of bug a STARTUP failure, not a runtime surprise.
 *
 * Audit rules (run via Fastify's `onRoute` hook on every
 * `fastify.route` / `fastify.get` / `fastify.post` call):
 *
 *   1. Skip if the URL is in the explicit allow-list
 *      (`/api/v1/auth/login`, `/api/v1/auth/refresh`,
 *      `/api/v1/approval/:token` — the token IS the auth).
 *
 *   2. Skip if the route's `config.skipRouteAudit === true`
 *      (escape hatch for genuinely-public endpoints).
 *
 *   3. Otherwise verify that at least one preHandler carries
 *      the `ATHLOS_GATE_MARKER` symbol from @athlos/auth. The
 *      marker is set by `requireAuth` / `requireRole` /
 *      `requirePermission` on every gate function they return.
 *      The marker survives the function-anonymization that
 *      happens inside the factories, so it's the only reliable
 *      signal at registration time.
 *
 * Behavior:
 *
 *   - In development (NODE_ENV !== 'production'): a violation
 *     logs a warning so the developer sees it in the console.
 *     The server still boots.
 *
 *   - In production: a violation THROWS during route
 *     registration, preventing the boot. Deploys with
 *     unauthenticated routes fail fast.
 *
 * The marker check is a smoke test, not a security boundary — a
 * route could pass by attaching the marker to a no-op handler
 * without calling the real gate. The real boundary is the auth
 * handler running on every request. But the smoke test catches
 * the 95% case of "I forgot to add the preHandler at all".
 */

/**
 * Routes that are intentionally unauthenticated. The token in
 * `/api/v1/approval/:token` IS the authentication — the approver
 * doesn't have an operator account (per the approval spec).
 * The auth endpoints are also public (you can't login if you
 * need to be logged in to login).
 */
const ALWAYS_ALLOW = new Set<string>([
  '/api/v1/auth/login',
  '/api/v1/auth/refresh',
  '/api/v1/approval/:token',
])

/**
 * Check whether a single route's preHandler chain contains at
 * least one gate function (one that carries the
 * `ATHLOS_GATE_MARKER` symbol from @athlos/auth).
 */
function routeHasGate(preHandler: unknown): boolean {
  const chain = Array.isArray(preHandler) ? preHandler : preHandler ? [preHandler] : []
  return chain.some((handler) => {
    if (typeof handler !== 'function') return false
    const marker = (handler as unknown as Record<symbol, unknown>)[ATHLOS_GATE_MARKER]
    return marker !== undefined
  })
}

/**
 * Test-only override: when set, the audit uses this value to
 * decide between dev (warn) and production (throw) behavior.
 * The vitest test runner sets `NODE_ENV=test` globally, but a
 * test that wants to exercise the production branch needs to
 * flip the mode without touching the rest of the env.
 *
 * Exported for the route-audit test to use.
 */
export function setRouteAuditMode(mode: 'development' | 'production'): void {
  process.env['NODE_ENV'] = mode
}

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Set to `true` on a route's config to bypass the route-audit. */
    skipRouteAudit?: boolean
  }
}

const routeAuditPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRoute', (routeOptions) => {
    const url = routeOptions.url
    if (!url || !url.startsWith('/api/v1')) return
    if (ALWAYS_ALLOW.has(url)) return
    if (routeOptions.config?.skipRouteAudit === true) return

    // The routeOptions.preHandler may live in different places
    // depending on how the route was registered. Fastify exposes
    // it on the route options object after registration. We use
    // a type-narrow to read it safely.
    const preHandler = (routeOptions as { preHandler?: unknown }).preHandler
    if (routeHasGate(preHandler)) return

    const method = routeOptions.method
    const violation = `${method} ${url}`

    if (process.env['NODE_ENV'] === 'production') {
      throw new Error(
        `route-audit (production): unprotected /api/v1 route detected — ${violation}. ` +
          `Add a preHandler from @athlos/auth (requireAuth / requireRole / requirePermission), ` +
          `add the URL to ALWAYS_ALLOW, or set config.skipRouteAudit = true.`,
      )
    }
    // Dev: warn but allow the boot. The log line is on the
    // parent app's logger if available.
    const log = (fastify as { log?: { warn: (obj: unknown, msg: string) => void } }).log
    if (log) {
      log.warn({ route: violation }, 'route-audit (dev): unprotected /api/v1 route')
    }
  })
}

export const routeAudit = fp(routeAuditPlugin, { name: 'athlos-route-audit' })
