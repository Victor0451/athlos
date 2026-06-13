import jwt, { type SignOptions } from 'jsonwebtoken'
import type { Env } from '@athlos/config'

/**
 * Access token claims. Mirrors the auth-login spec §"JWT Claims Structure".
 *
 *   - `sub` is the operator's UUID (operator_id).
 *   - `role` is the coarse gate (`requireRole`).
 *   - `permissions` carries the fine-grained flags (`requirePermission`).
 *   - `iat` / `exp` are set by `jsonwebtoken` from the `expiresIn` option.
 *
 * Username and email are intentionally NOT in the token — the token is
 * signed but not encrypted, and minimal claims shrink the blast radius
 * if a token leaks into a log or a downstream service.
 */
export interface JWTPayload {
  sub: string
  role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA'
  permissions: { can_reprint: boolean; can_anulate: boolean }
  iat?: number
  exp?: number
}

/**
 * Sign a short-lived access token. Algorithm pinned to HS256 because
 * the API verifies tokens with the same secret it signs with — no
 * asymmetric crypto to manage at this scale.
 */
export function signAccessToken(payload: Omit<JWTPayload, 'iat' | 'exp'>, env: Env): string {
  const options: SignOptions = {
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
    algorithm: 'HS256',
  }
  return jwt.sign(payload, env.JWT_SECRET, options)
}

/**
 * Verify a token's signature and expiry, returning the decoded payload.
 * Throws `TokenExpiredError` / `JsonWebTokenError` from `jsonwebtoken`
 * on bad tokens — the auth plugin catches these and emits
 * `BusinessError(TOKEN_INVALID)` so route code never sees them.
 */
export function verifyAccessToken(token: string, env: Env): JWTPayload {
  return jwt.verify(token, env.JWT_SECRET, {
    algorithms: ['HS256'],
  }) as JWTPayload
}
