import { createHash } from 'node:crypto'

/**
 * SHA-256 of a legacy record's canonicalized JSON form.
 *
 * The hash is the import pipeline's idempotency key (it feeds the
 * `ON CONFLICT (source_table, source_key, content_hash) DO NOTHING`
 * clause in the `raw_events` insert) and the drift detector's
 * "has the legacy content changed?" signal.
 *
 * Canonicalization rules:
 *   1. Strip the `legacyKey` field — it is derived, not content.
 *   2. Recursively sort object keys (so `{a:1,b:2}` and `{b:2,a:1}`
 *      hash to the same value).
 *   3. Drop `undefined` values and `null` values uniformly
 *      (VFP's null handling is column-shape dependent; we treat
 *      absence and explicit null as the same).
 *   4. Normalize Date to its ISO string.
 *
 * The function is pure — same input always yields the same hash.
 * Two legacy records with identical column content but different
 * property insertion order produce the same hash, which is what
 * idempotency requires.
 */
export function computeHash(record: Record<string, unknown>): string {
  const canonical = canonicalize(record)
  const json = JSON.stringify(canonical)
  return createHash('sha256').update(json, 'utf8').digest('hex')
}

/**
 * Recursively canonicalize a value:
 *   - Objects: drop the `legacyKey` field, then recurse, then emit
 *     a NEW object with keys in sorted order.
 *   - Arrays: recurse element-by-element (preserving order).
 *   - Date: emit the ISO string.
 *   - null/undefined: emit `null` (dropped from objects at the parent
 *     call so they don't appear as keys).
 *   - Primitives: returned as-is.
 */
function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) {
    return value.map((v) => canonicalize(v))
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj)
      .filter((k) => k !== 'legacyKey' && obj[k] !== undefined && obj[k] !== null)
      .sort()
    const out: Record<string, unknown> = {}
    for (const k of keys) {
      out[k] = canonicalize(obj[k])
    }
    return out
  }
  return value
}
