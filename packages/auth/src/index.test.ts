import { describe, it, expect } from 'vitest'
import { BCRYPT_COST, hashPassword, needsRehash, verifyPassword } from './password.ts'
import { signAccessToken, verifyAccessToken } from './jwt.ts'
import { ATHLOS_GATE_MARKER, requireAuth, requirePermission, requireRole } from './middleware.ts'
import type { Env } from '@athlos/config'

/**
 * Build a minimal valid `Env` for JWT helpers. Only `JWT_SECRET`,
 * `JWT_REFRESH_SECRET`, and the TTL fields are read by the auth
 * primitives; everything else is irrelevant for these tests.
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

describe('password', () => {
  it('hashes and verifies roundtrip', async () => {
    const hash = await hashPassword('correct-password')
    expect(hash).not.toBe('correct-password')
    expect(hash.startsWith('$2')).toBe(true)
    expect(await verifyPassword('correct-password', hash)).toBe(true)
    expect(await verifyPassword('wrong-password', hash)).toBe(false)
  })

  it('produces hashes at the configured cost factor', async () => {
    const hash = await hashPassword('x')
    // bcrypt format: $2b$<cost>$...
    const cost = Number.parseInt(hash.split('$')[2] ?? '0', 10)
    expect(cost).toBe(BCRYPT_COST)
  })

  it('verifyPassword returns false for malformed hash', async () => {
    expect(await verifyPassword('x', 'not-a-bcrypt-hash')).toBe(false)
  })

  it('needsRehash flags lower-cost hashes', () => {
    const low = `$2b$${BCRYPT_COST - 1}$abcdefghijklmnopqrstuvwxyz`
    const ok = `$2b$${BCRYPT_COST}$abcdefghijklmnopqrstuvwxyz`
    expect(needsRehash(low)).toBe(true)
    expect(needsRehash(ok)).toBe(false)
    expect(needsRehash('not-a-hash')).toBe(true)
  })
})

describe('jwt', () => {
  const env = makeEnv()
  const payload = {
    sub: '00000000-0000-0000-0000-000000000001',
    role: 'TESORERO' as const,
    permissions: { can_reprint: true, can_anulate: false },
  }

  it('signs and verifies a roundtrip', () => {
    const token = signAccessToken(payload, env)
    const decoded = verifyAccessToken(token, env)
    expect(decoded.sub).toBe(payload.sub)
    expect(decoded.role).toBe(payload.role)
    expect(decoded.permissions).toEqual(payload.permissions)
    expect(typeof decoded.iat).toBe('number')
    expect(typeof decoded.exp).toBe('number')
    expect((decoded.exp ?? 0) > (decoded.iat ?? 0)).toBe(true)
  })

  it('rejects a token signed with a different secret', () => {
    const token = signAccessToken(payload, env)
    const other = makeEnv({ JWT_SECRET: 'c'.repeat(32) })
    expect(() => verifyAccessToken(token, other)).toThrow()
  })

  it('rejects a malformed token', () => {
    expect(() => verifyAccessToken('not-a-jwt', env)).toThrow()
  })
})

/**
 * The `ATHLOS_GATE_MARKER` is the contract between @athlos/auth
 * and the route-audit plugin in apps/api. Every gate function
 * (requireAuth / requireRole / requirePermission) MUST mark its
 * returned preHandler with this symbol so the audit can detect
 * protected routes at registration time.
 */
describe('gate marker', () => {
  it('requireAuth marks its returned function', () => {
    const fn = requireAuth()
    const marker = (fn as unknown as Record<symbol, { kind: string } | undefined>)[
      ATHLOS_GATE_MARKER
    ]
    expect(marker).toBeDefined()
    expect(marker?.kind).toBe('auth')
  })

  it('requireRole marks its returned function', () => {
    const fn = requireRole('ADMIN')
    const marker = (fn as unknown as Record<symbol, { kind: string } | undefined>)[
      ATHLOS_GATE_MARKER
    ]
    expect(marker).toBeDefined()
    expect(marker?.kind).toBe('role')
  })

  it('requirePermission marks its returned function', () => {
    const fn = requirePermission('can_anulate')
    const marker = (fn as unknown as Record<symbol, { kind: string } | undefined>)[
      ATHLOS_GATE_MARKER
    ]
    expect(marker).toBeDefined()
    expect(marker?.kind).toBe('permission')
  })
})
