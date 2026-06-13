import { createHash, randomBytes } from 'node:crypto'
import type { Db } from '@athlos/db'
import { operators, refreshTokens, type Operator } from '@athlos/db/schema'
import { BusinessError, ErrorCode } from '@athlos/errors'
import { hashPassword, verifyPassword } from '@athlos/auth'
import { signAccessToken, type JWTPayload } from '@athlos/auth'
import type { Env } from '@athlos/config'
import { eq } from 'drizzle-orm'

export type { JWTPayload }

export interface LoginInput {
  username: string
  password: string
}

export interface LoginResult {
  access_token: string
  refresh_token: string
  expires_in: number
  operator_id: string
  role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA'
  permissions: { can_reprint: boolean; can_anulate: boolean }
}

/** Failed attempts before the account locks. */
export const LOCKOUT_THRESHOLD = 5
/** Minutes the account stays locked. */
export const LOCKOUT_MINUTES = 15

/**
 * Pure helper: given a current `failedLoginAttempts` and the current
 * time, return the new `failedLoginAttempts` and `lockedUntil` values
 * to persist. Exported separately from `login` so unit tests can
 * exercise the threshold math without a real DB.
 */
export function computeLockoutUpdate(
  currentAttempts: number,
  now: Date,
): { failedLoginAttempts: number; lockedUntil: Date | null } {
  const nextAttempts = currentAttempts + 1
  if (nextAttempts >= LOCKOUT_THRESHOLD) {
    return {
      failedLoginAttempts: 0,
      lockedUntil: new Date(now.getTime() + LOCKOUT_MINUTES * 60 * 1000),
    }
  }
  return { failedLoginAttempts: nextAttempts, lockedUntil: null }
}

export async function login(db: Db, env: Env, input: LoginInput): Promise<LoginResult> {
  const username = input.username.trim()
  const [op] = await db.select().from(operators).where(eq(operators.username, username)).limit(1)

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
  const update = computeLockoutUpdate(op.failedLoginAttempts, new Date())
  await db
    .update(operators)
    .set({ ...update, updatedAt: new Date() })
    .where(eq(operators.id, op.id))
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

function generateRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('hex')
  const hash = createHash('sha256').update(raw).digest('hex')
  return { raw, hash }
}

void hashPassword
