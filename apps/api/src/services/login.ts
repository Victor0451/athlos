import { createHash, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { operators, refreshTokens, type Operator } from '@athlos/db/schema'
import { BusinessError, ErrorCode } from '@athlos/errors'
import { hashPassword, verifyPassword } from '@athlos/auth'
import { signAccessToken, type JWTPayload } from '@athlos/auth'
import type { Env } from '@athlos/config'
import type { Db, Db as DbType } from '@athlos/db'

// Re-export so the route handler doesn't reach across two barrels.
export type { JWTPayload }

/**
 * Login input. Both fields required, validated by Zod at the route edge.
 */
export interface LoginInput {
  username: string
  password: string
}

/**
 * Login response. Shape matches the auth-login spec §"Login Endpoint".
 */
export interface LoginResult {
  access_token: string
  refresh_token: string
  expires_in: number
  operator_id: string
  role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA'
  permissions: { can_reprint: boolean; can_anulate: boolean }
}

const LOCKOUT_THRESHOLD = 5
const LOCKOUT_MINUTES = 15

/**
 * Authenticate an operator by username + password and issue an access +
 * refresh token pair.
 *
 * Failure surface (the spec requires distinct codes for distinct cases):
 *   - INVALID_CREDENTIALS   — bad username, bad password, or inactive
 *   - ACCOUNT_LOCKED        — `locked_until` in the future
 *
 * On every failed password attempt the `failed_login_attempts` counter
 * is incremented. On the 5th consecutive failure within the lockout
 * window the account is locked for 15 minutes. The counter resets on
 * success.
 */
export async function login(db: DbType, env: Env, input: LoginInput): Promise<LoginResult> {
  const username = input.username.trim()
  const [op] = await db.select().from(operators).where(eq(operators.username, username)).limit(1)

  // Single error code for "no such user" and "wrong password" so the
  // login endpoint can't be used for username enumeration.
  if (!op || !op.isActive) {
    throw BusinessError(ErrorCode.INVALID_CREDENTIALS, 'Invalid credentials')
  }

  if (op.lockedUntil && op.lockedUntil > new Date()) {
    throw BusinessError(ErrorCode.ACCOUNT_LOCKED, 'Account is locked. Try again later.')
  }

  const passwordOk = await verifyPassword(input.password, op.passwordHash)
  if (!passwordOk) {
    await recordFailedAttempt(db, op)
    throw BusinessError(ErrorCode.INVALID_CREDENTIALS, 'Invalid credentials')
  }

  const role = charToRole(op.role)
  const payload: Omit<JWTPayload, 'iat' | 'exp'> = {
    sub: op.id,
    role,
    permissions: {
      can_reprint: op.canReprint,
      can_anulate: op.canAnulate,
    },
  }
  const access_token = signAccessToken(payload, env)
  const { raw: refresh_token, hash: refreshHash } = generateRefreshToken()
  const expiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL_SECONDS * 1000)

  await db.transaction(async (tx) => {
    await tx.insert(refreshTokens).values({
      operatorId: op.id,
      tokenHash: refreshHash,
      expiresAt,
    })
    await tx
      .update(operators)
      .set({
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(operators.id, op.id))
  })

  return {
    access_token,
    refresh_token,
    expires_in: env.JWT_ACCESS_TTL_SECONDS,
    operator_id: op.id,
    role,
    permissions: payload.permissions,
  }
}

async function recordFailedAttempt(db: Db, op: Operator): Promise<void> {
  const nextAttempts = op.failedLoginAttempts + 1
  const update: Partial<Operator> = {
    failedLoginAttempts: nextAttempts,
    updatedAt: new Date(),
  }
  if (nextAttempts >= LOCKOUT_THRESHOLD) {
    update.lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
    update.failedLoginAttempts = 0
  }
  await db.update(operators).set(update).where(eq(operators.id, op.id))
}

/**
 * Map the single-char DB code (`A|T|O|C`) to the readable role name
 * used in the JWT and on the response. Throws if the code is unknown
 * — that would be a schema-integrity failure and a 500 is right.
 */
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

/**
 * Generate a refresh token. 32 random bytes hex-encoded (64 chars) +
 * SHA-256 hash for storage. The raw value goes to the client ONCE.
 */
function generateRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('hex')
  const hash = createHash('sha256').update(raw).digest('hex')
  return { raw, hash }
}

// Used to keep the unused-import linter happy when password helpers
// expand to include upgrade-on-login logic in PR 3b.
void hashPassword
