import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { Db } from '@athlos/db'

export interface HashVerificationResult {
  entity_id: string
  match: boolean
  stored_hash: string
  recomputed_hash: string
  verified_at: string
}

/**
 * Recompute SHA-256 from `raw_events.payload` and compare to the stored
 * `content_hash` for the given entity's most recent raw_events row.
 *
 * Uses `db.execute(sql...)` for both the lookup and the hash recompute
 * so the function is testable with a simple mock.
 */
export async function verifyHash(db: Db, entityId: string): Promise<HashVerificationResult> {
  // Get the latest raw_events row for this entity
  const rows = await db.execute(sql`
    SELECT r.content_hash, r.payload
    FROM raw_events r
    JOIN entity_uuids e
      ON e.source_table = r.source_table AND e.source_key = r.source_key
    WHERE e.entity_uuid = ${entityId}
    ORDER BY r.imported_at DESC
    LIMIT 1
  `)

  const row = rows[0] as { content_hash: string; payload: Record<string, unknown> } | undefined
  if (!row) {
    throw new Error(`verifyHash: entity ${entityId} not found in raw_events`)
  }

  const storedHash = row.content_hash
  const recomputedHash = computeContentHash(row.payload)

  return {
    entity_id: entityId,
    match: storedHash === recomputedHash,
    stored_hash: storedHash,
    recomputed_hash: recomputedHash,
    verified_at: new Date().toISOString(),
  }
}

/**
 * Canonical SHA-256 hash of a legacy record payload.
 * Must match the hashing logic used by the import pipeline
 * (`@athlos/import.computeHash`).
 */
export function computeContentHash(payload: Record<string, unknown>): string {
  // Canonicalize: sort keys, stringify, encode as UTF-8 bytes
  const canonical = JSON.stringify(sortObjectKeys(payload))
  return createHash('sha256').update(canonical, 'utf-8').digest('hex')
}

function sortObjectKeys(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.keys(obj)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      const val = obj[key]
      acc[key] =
        typeof val === 'object' && val !== null && !Array.isArray(val)
          ? sortObjectKeys(val as Record<string, unknown>)
          : val
      return acc
    }, {})
}
