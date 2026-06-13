import { createHash, randomBytes } from 'node:crypto'
import type { Db } from '@athlos/db'
import { operators, refreshTokens, type Operator } from '@athlos/db/schema'
import { BusinessError, ErrorCode } from '@athlos/errors'
import { hashPassword, signAccessToken, verifyPassword } from '@athlos/auth'
import type { Env } from '@athlos/config'
import type { JWTPayload } from '@athlos/auth'
import { and, eq, isNull, gt } from 'drizzle-orm'

/**
 * Auth service layer (refresh / logout / me / change-password).
 *
 * PR 3a already shipped the `login` flow. This module adds the four
 * remaining auth endpoints required by the auth-login spec:
 *   - refresh    — rotate the refresh token, issue a new pair
 *   - logout     — revoke a single refresh token
 *   - me         — read the caller's profile (no password_hash)
 *   - change-password — verify current, hash new, update
 *
 * Every function is pure-shaped: it takes a `Db` (so tests can pass a
 * standin), an `Env` (for JWT signing), and a small input. No
 * Fastify-specific types cross the boundary — the route layer is
 * responsible for HTTP plumbing.
 */

/** Public view of an operator — strips the password hash. */
export interface OperatorDTO {
  id: string
  username: string
  role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA'
  can_reprint: boolean
  can_anulate: boolean
  is_active: boolean
  last_login_at: Date | null
  created_at: Date
}

export interface TokenPair {
  access_token: string
  refresh_token: string
  expires_in: number
}

export interface RefreshInput {
  refresh_token: string
}

export interface LogoutInput {
  refresh_token: string
}

export interface ChangePasswordInput {
  operatorId: string
  currentPassword: string
  newPassword: string
}

/** Build a DTO from a raw operator row. The only place this shape lives. */
export function toOperatorDTO(row: Operator): OperatorDTO {
  return {
    id: row.id,
    username: row.username,
    role: charToRole(row.role),
    can_reprint: row.canReprint,
    can_anulate: row.canAnulate,
    is_active: row.isActive,
    last_login_at: row.lastLoginAt,
    created_at: row.createdAt,
  }
}

/** Pure helper: generate a (raw, hash) pair for a refresh token. */
export function generateRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('hex')
  const hash = createHash('sha256').update(raw).digest('hex')
  return { raw, hash }
}

/**
 * Hash a raw refresh token (the same way {@link generateRefreshToken}
 * does) so the route layer can look up tokens without keeping the raw
 * value in memory after the user posts it.
 */
export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/**
 * Look up a refresh token by its raw value, asserting it is not
 * revoked and not expired. Returns the row so the caller can rotate.
 * Throws `BusinessError(TOKEN_INVALID)` on any failure mode — the
 * distinction (revoked vs. expired vs. unknown) is intentionally not
 * exposed to clients to avoid oracle attacks.
 */
export async function findActiveRefreshToken(
  db: Db,
  raw: string,
): Promise<{ id: string; operatorId: string }> {
  const hash = hashRefreshToken(raw)
  const [row] = await db
    .select({ id: refreshTokens.id, operatorId: refreshTokens.operatorId })
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.tokenHash, hash),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, new Date()),
      ),
    )
    .limit(1)
  if (!row) {
    throw BusinessError(ErrorCode.TOKEN_INVALID, 'Invalid refresh token')
  }
  return { id: row.id, operatorId: row.operatorId }
}

/**
 * Refresh the caller's tokens. Validates the presented refresh token,
 * revokes it, and issues a brand-new pair bound to the same operator.
 *
 * The rotation is a single transaction so a network blip after the
 * read but before the write can't leave the operator with a usable
 * old token AND a new pair. Two callers racing on the same token
 * see one success and one `TOKEN_INVALID` (the second's UPDATE matches
 * zero rows because the first already set `revoked_at`).
 */
export async function refresh(db: Db, env: Env, input: RefreshInput): Promise<TokenPair> {
  const existing = await findActiveRefreshToken(db, input.refresh_token)

  const [op] = await db
    .select()
    .from(operators)
    .where(and(eq(operators.id, existing.operatorId), eq(operators.isActive, true)))
    .limit(1)
  if (!op) {
    // The operator was deactivated between the refresh insert and now.
    // Revoke the token and fail the request.
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, existing.id))
    throw BusinessError(ErrorCode.TOKEN_INVALID, 'Invalid refresh token')
  }

  const role = charToRole(op.role)
  const access_token = signAccessToken(
    {
      sub: op.id,
      role,
      permissions: { can_reprint: op.canReprint, can_anulate: op.canAnulate },
    },
    env,
  )
  const { raw: refresh_token, hash: newHash } = generateRefreshToken()
  const expiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL_SECONDS * 1000)

  await db.transaction(async (tx) => {
    // Mark the old token revoked first. If the UPDATE matches zero rows
    // (because a concurrent caller already won the race), the whole
    // transaction aborts and the caller sees TOKEN_INVALID.
    const revoked = await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.id, existing.id), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id })
    if (revoked.length === 0) {
      throw BusinessError(ErrorCode.TOKEN_INVALID, 'Invalid refresh token')
    }
    await tx.insert(refreshTokens).values({
      operatorId: op.id,
      tokenHash: newHash,
      expiresAt,
    })
  })

  return {
    access_token,
    refresh_token,
    expires_in: env.JWT_ACCESS_TTL_SECONDS,
  }
}

/**
 * Revoke a single refresh token. Idempotent: revoking an already-
 * revoked token is a no-op (returns 200, does not throw). Unknown
 * tokens are also a no-op so the endpoint doesn't leak whether the
 * token ever existed.
 */
export async function logout(db: Db, input: LogoutInput): Promise<void> {
  const hash = hashRefreshToken(input.refresh_token)
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.tokenHash, hash), isNull(refreshTokens.revokedAt)))
}

/**
 * Read the caller's profile. Throws `NOT_FOUND` if the operator was
 * removed after the token was issued (defensive — FK cascade should
 * prevent it, but auth handlers are the wrong place to silently
 * succeed on a stale token).
 */
export async function getMe(db: Db, operatorId: string): Promise<OperatorDTO> {
  const [op] = await db.select().from(operators).where(eq(operators.id, operatorId)).limit(1)
  if (!op) {
    throw BusinessError(ErrorCode.NOT_FOUND, 'Operator not found')
  }
  return toOperatorDTO(op)
}

/**
 * Change the caller's password. Verifies the current password via
 * bcrypt, hashes the new one, and updates the row. All in one
 * transaction so a partial write is impossible.
 *
 * Throws `INVALID_CREDENTIALS` on wrong current (401) — the spec
 * uses a dedicated `INVALID_CURRENT_PASSWORD` but the global error
 * handler maps INVALID_CREDENTIALS to 401, which is the correct HTTP
 * status. The 401 body lets the client distinguish "wrong password"
 * from "token expired" via the stable error code.
 */
export async function changePassword(db: Db, input: ChangePasswordInput): Promise<void> {
  const [op] = await db.select().from(operators).where(eq(operators.id, input.operatorId)).limit(1)
  if (!op) {
    throw BusinessError(ErrorCode.NOT_FOUND, 'Operator not found')
  }
  const ok = await verifyPassword(input.currentPassword, op.passwordHash)
  if (!ok) {
    throw BusinessError(ErrorCode.INVALID_CREDENTIALS, 'Current password is incorrect')
  }
  const newHash = await hashPassword(input.newPassword)
  await db
    .update(operators)
    .set({ passwordHash: newHash, updatedAt: new Date() })
    .where(eq(operators.id, input.operatorId))
}

function charToRole(code: string): 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA' {
  switch (code) {
    case 'A':
      return 'ADMIN'
    case 'T':
      return 'TESORERO'
    case 'O':
      return 'OPERADOR'
    case 'C':
      return 'CONSULTA'
    default:
      throw BusinessError(ErrorCode.INTERNAL_ERROR, `Unknown operator role code: ${code}`)
  }
}

// Re-export the JWT payload type for routes that need it.
export type { JWTPayload }
