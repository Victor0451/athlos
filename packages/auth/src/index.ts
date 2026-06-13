/**
 * @athlos/auth — public API.
 *
 * Three concerns:
 *   1. Password hashing (bcrypt) — see password.ts.
 *   2. JWT sign / verify — see jwt.ts. The claim shape is the contract
 *      with route handlers and the verification plugin.
 *   3. Fastify plugin + RBAC pre-handlers — see middleware.ts. These
 *      decorate `request.operator` and gate routes by role / permission.
 *
 * `authPlugin(getEnv)` MUST be registered exactly once at the top of
 * the Fastify instance. Routes that need auth add `[requireAuth()]` (or
 * a more specific gate) to their `preHandler` list.
 */
export { hashPassword, verifyPassword, needsRehash, BCRYPT_COST } from './password.ts'
export { signAccessToken, verifyAccessToken } from './jwt.ts'
export type { JWTPayload } from './jwt.ts'
export {
  authPlugin,
  requireAuth,
  requireRole,
  requirePermission,
  ATHLOS_GATE_MARKER,
} from './middleware.ts'
