import { createHash, randomBytes } from 'node:crypto'

/**
 * Generate a brand-new approval token: a 32-byte random source hashed
 * to 64 hex chars for the DB, and the raw token to embed in the link.
 *
 * Returning the raw value is the ONE place in the system where the
 * plaintext token exists. The caller is responsible for showing it
 * to the user exactly once (the create-link response) and never
 * persisting it.
 */
export function generateApprovalToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('hex')
  const hash = hashApprovalToken(raw)
  return { raw, hash }
}

/**
 * SHA-256 hash the raw token for storage / lookup. The hex encoding
 * matches what `randomBytes(32).toString('hex')` produces on the way
 * out, so the round-trip is deterministic.
 */
export function hashApprovalToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}
