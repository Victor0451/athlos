import { describe, it, expect, beforeEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { hashPassword, verifyPassword } from '@athlos/auth'
import type { Env } from '@athlos/config'
import { createStandinDb } from '../test-standins/db.ts'
import {
  changePassword,
  generateRefreshToken,
  getMe,
  hashRefreshToken,
  logout,
  refresh,
} from '../services/auth.ts'
import type { Db } from '@athlos/db'
import type { Operator } from '@athlos/db/schema'

/**
 * Service-level tests for the auth surface (refresh / logout / me /
 * change-password). The route layer is exercised in a separate file
 * via buildServer; this file pins the service contracts so the
 * routes can rely on them.
 */

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: 'test',
    PORT: 3001,
    HOST: '0.0.0.0',
    LOG_LEVEL: 'info',
    DATABASE_URL: 'postgresql://test/test',
    JWT_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    JWT_ACCESS_TTL_SECONDS: 900,
    JWT_REFRESH_TTL_SECONDS: 604800,
    LEGACY_DB_PATH: '/tmp/legacy',
    CORS_ORIGINS: 'http://localhost:3000',
    FROM_ADDRESS: 'noreply@gorriti.app',
    ...overrides,
  } as Env
}

function makeOperator(overrides: Partial<Operator> = {}): Operator {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    username: 'op-test',
    passwordHash: '$2b$12$placeholderplaceholderplaceholderplaceholder',
    role: 'A',
    canReprint: true,
    canAnulate: true,
    isActive: true,
    lastLoginAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

describe('refresh', () => {
  let db: ReturnType<typeof createStandinDb>
  let env: Env

  beforeEach(() => {
    db = createStandinDb()
    env = makeEnv()
  })

  it('issues a new pair for a valid refresh token', async () => {
    const op = makeOperator()
    db.state.operators.push(op)
    const { raw, hash } = generateRefreshToken()
    db.state.refreshTokens.push({
      id: randomBytes(8).toString('hex'),
      operatorId: op.id,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      createdAt: new Date(),
    })

    const result = await refresh(db.drizzle as unknown as Db, env, { refresh_token: raw })
    expect(result.access_token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(result.refresh_token).toMatch(/^[0-9a-f]{64}$/)
    expect(result.expires_in).toBe(900)

    // Old token must be revoked; new token must exist.
    const oldRow = db.state.refreshTokens.find((t) => t.tokenHash === hash)
    expect(oldRow?.revokedAt).toBeInstanceOf(Date)
    const newRow = db.state.refreshTokens.find(
      (t) => t.tokenHash === hashRefreshToken(result.refresh_token),
    )
    expect(newRow).toBeDefined()
  })

  it('rejects a revoked refresh token', async () => {
    const op = makeOperator()
    db.state.operators.push(op)
    const { raw, hash } = generateRefreshToken()
    db.state.refreshTokens.push({
      id: randomBytes(8).toString('hex'),
      operatorId: op.id,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: new Date(), // already revoked
      createdAt: new Date(),
    })

    await expect(
      refresh(db.drizzle as unknown as Db, env, { refresh_token: raw }),
    ).rejects.toMatchObject({
      code: 'TOKEN_INVALID',
    })
  })

  it('rejects an expired refresh token', async () => {
    const op = makeOperator()
    db.state.operators.push(op)
    const { raw, hash } = generateRefreshToken()
    db.state.refreshTokens.push({
      id: randomBytes(8).toString('hex'),
      operatorId: op.id,
      tokenHash: hash,
      expiresAt: new Date(Date.now() - 1000), // expired
      revokedAt: null,
      createdAt: new Date(),
    })

    await expect(
      refresh(db.drizzle as unknown as Db, env, { refresh_token: raw }),
    ).rejects.toMatchObject({
      code: 'TOKEN_INVALID',
    })
  })

  it('rejects an unknown refresh token', async () => {
    const { raw } = generateRefreshToken()
    await expect(
      refresh(db.drizzle as unknown as Db, env, { refresh_token: raw }),
    ).rejects.toMatchObject({
      code: 'TOKEN_INVALID',
    })
  })

  it('fails when the operator is inactive', async () => {
    const op = makeOperator({ isActive: false })
    db.state.operators.push(op)
    const { raw, hash } = generateRefreshToken()
    db.state.refreshTokens.push({
      id: randomBytes(8).toString('hex'),
      operatorId: op.id,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      createdAt: new Date(),
    })

    await expect(
      refresh(db.drizzle as unknown as Db, env, { refresh_token: raw }),
    ).rejects.toMatchObject({
      code: 'TOKEN_INVALID',
    })
    // The token should also be revoked (defensive cleanup).
    const row = db.state.refreshTokens.find((t) => t.tokenHash === hash)
    expect(row?.revokedAt).toBeInstanceOf(Date)
  })
})

describe('logout', () => {
  let db: ReturnType<typeof createStandinDb>

  beforeEach(() => {
    db = createStandinDb()
  })

  it('sets revoked_at on a valid token', async () => {
    const { raw, hash } = generateRefreshToken()
    db.state.refreshTokens.push({
      id: 'rt-1',
      operatorId: '00000000-0000-4000-8000-000000000001',
      tokenHash: hash,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      createdAt: new Date(),
    })
    await logout(db.drizzle as unknown as Db, { refresh_token: raw })
    expect(db.state.refreshTokens[0]?.revokedAt).toBeInstanceOf(Date)
  })

  it('is a no-op for an unknown token', async () => {
    const { raw } = generateRefreshToken()
    await expect(
      logout(db.drizzle as unknown as Db, { refresh_token: raw }),
    ).resolves.toBeUndefined()
  })

  it('is a no-op for an already-revoked token', async () => {
    const { raw, hash } = generateRefreshToken()
    const originalRevokedAt = new Date()
    db.state.refreshTokens.push({
      id: 'rt-1',
      operatorId: '00000000-0000-4000-8000-000000000001',
      tokenHash: hash,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: originalRevokedAt,
      createdAt: new Date(),
    })
    await logout(db.drizzle as unknown as Db, { refresh_token: raw })
    expect(db.state.refreshTokens[0]?.revokedAt).toBe(originalRevokedAt)
  })
})

describe('getMe', () => {
  let db: ReturnType<typeof createStandinDb>

  beforeEach(() => {
    db = createStandinDb()
  })

  it('returns the operator DTO without password_hash', async () => {
    const op = makeOperator()
    db.state.operators.push(op)
    const dto = await getMe(db.drizzle as unknown as Db, op.id)
    expect(dto.id).toBe(op.id)
    expect(dto.username).toBe('op-test')
    expect(dto.role).toBe('ADMIN')
    expect(dto.can_reprint).toBe(true)
    expect(dto.can_anulate).toBe(true)
    expect(dto.is_active).toBe(true)
    // The whole point of the DTO: no password_hash.
    expect((dto as unknown as Record<string, unknown>)['password_hash']).toBeUndefined()
    expect((dto as unknown as Record<string, unknown>)['passwordHash']).toBeUndefined()
  })

  it('throws NOT_FOUND for an unknown id', async () => {
    await expect(
      getMe(db.drizzle as unknown as Db, '00000000-0000-4000-8000-000000000099'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('changePassword', () => {
  let db: ReturnType<typeof createStandinDb>

  beforeEach(() => {
    db = createStandinDb()
  })

  it('updates the hash when the current password is correct', async () => {
    const passwordHash = await hashPassword('correct-current')
    const op = makeOperator({ passwordHash })
    db.state.operators.push(op)
    await changePassword(db.drizzle as unknown as Db, {
      operatorId: op.id,
      currentPassword: 'correct-current',
      newPassword: 'new-secret-123',
    })
    const updated = db.state.operators[0]
    expect(updated?.passwordHash).not.toBe(passwordHash)
    expect(await verifyPassword('new-secret-123', updated?.passwordHash ?? '')).toBe(true)
  })

  it('throws INVALID_CREDENTIALS on wrong current password', async () => {
    const passwordHash = await hashPassword('correct-current')
    const op = makeOperator({ passwordHash })
    db.state.operators.push(op)
    await expect(
      changePassword(db.drizzle as unknown as Db, {
        operatorId: op.id,
        currentPassword: 'wrong-current',
        newPassword: 'new-secret-123',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    // Hash should NOT have changed.
    expect(db.state.operators[0]?.passwordHash).toBe(passwordHash)
  })

  it('throws NOT_FOUND for an unknown id', async () => {
    await expect(
      changePassword(db.drizzle as unknown as Db, {
        operatorId: '00000000-0000-4000-8000-000000000099',
        currentPassword: 'x',
        newPassword: 'new-secret-123',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('hashRefreshToken', () => {
  it('produces a stable sha256 of the raw token', () => {
    const raw = 'a'.repeat(64)
    const a = hashRefreshToken(raw)
    const b = hashRefreshToken(raw)
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })
})
