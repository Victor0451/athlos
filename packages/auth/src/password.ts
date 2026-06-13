import bcrypt from 'bcrypt'

/**
 * bcrypt cost factor. 12 is the OWASP 2023 baseline for interactive
 * auth at the scale of a single club (≤50 operators). Each increment
 * doubles the work factor; 12 lands at ~250ms per hash on a modern CPU,
 * well inside the 1s budget for a login round trip.
 */
export const BCRYPT_COST = 12

/**
 * Hash a plaintext password. Returns the full bcrypt string (algorithm
 * tag + cost + salt + digest) — store the result, not a rehash.
 */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST)
}

/**
 * Verify a plaintext password against a stored bcrypt hash. Returns
 * `false` for any malformed input — never throws on bad hashes.
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash)
  } catch {
    return false
  }
}

/**
 * Decide whether a stored hash should be re-hashed at the current cost
 * factor. Returns `true` if the hash uses a different cost or is not a
 * bcrypt hash at all. Callers do the actual rehash after a successful
 * login (background upgrade, not in the verify path).
 */
export function needsRehash(hash: string): boolean {
  const parts = hash.split('$')
  // bcrypt format: $2b$<cost>$<salt+hash>
  if (parts.length < 4 || !parts[1]?.startsWith('2')) return true
  const cost = Number.parseInt(parts[2] ?? '0', 10)
  return Number.isNaN(cost) || cost < BCRYPT_COST
}
