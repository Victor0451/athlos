import { sql } from 'drizzle-orm'
import type { Db } from '@athlos/db'

export interface DriftReport {
  domain: string | null
  scanned: number
  driftCount: number
  drifts: Array<{
    entityUuid: string
    oldHash: string
    newHash: string
    lastImportedAt: Date
  }>
}

type Domain = string

/**
 * Detect drift by comparing the latest raw_events content_hash per entity
 * against the stored snapshot.
 *
 * Algorithm (design §3):
 *   1. WITH latest AS (DISTINCT ON (source_table, source_key) → latest hash per entity)
 *   2. LEFT JOIN drift_snapshots ON entity_uuid
 *   3. WHERE last_hash IS DISTINCT FROM new_hash  → drift detected
 *
 * Uses `IS DISTINCT FROM` (Postgres "not equals" that treats NULL as a value)
 * so new entities (no snapshot yet) are NOT reported as drift.
 *
 * @param db   - Drizzle DB client
 * @param opts - optional domain filter; absent = all domains
 */
export async function detect(db: Db, opts: { domain?: Domain } = {}): Promise<DriftReport> {
  // The subquery to get all domains when no filter is provided
  const allDomainsSubquery = sql`(SELECT DISTINCT source_table FROM raw_events)`

  const rows = (await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (r.source_table, r.source_key)
             r.source_table,
             r.source_key,
             r.content_hash,
             r.imported_at,
             e.entity_uuid
      FROM raw_events r
      JOIN entity_uuids e
        ON e.source_table = r.source_table
       AND e.source_key = r.source_key
      WHERE r.source_table = ${opts.domain ?? allDomainsSubquery}
      ORDER BY r.source_table, r.source_key, r.imported_at DESC
    )
    SELECT
      l.entity_uuid,
      l.source_table,
      l.content_hash AS new_hash,
      l.imported_at,
      s.last_hash    AS old_hash
    FROM latest l
    LEFT JOIN drift_snapshots s ON s.entity_uuid = l.entity_uuid
    WHERE s.last_hash IS DISTINCT FROM l.content_hash
  `)) as unknown as {
    rows: Array<{
      entity_uuid: string
      source_table: string
      new_hash: string
      imported_at: Date
      old_hash: string | null
    }>
    rowCount: number
  }

  const drifts = rows.rows.map((row) => ({
    entityUuid: row.entity_uuid,
    oldHash: row.old_hash ?? 'no-snapshot',
    newHash: row.new_hash,
    lastImportedAt: row.imported_at,
  }))

  return {
    domain: opts.domain ?? null,
    scanned: rows.rowCount,
    driftCount: drifts.length,
    drifts,
  }
}
