import { sql } from 'drizzle-orm'
import type { Db } from '@athlos/db'

/**
 * 5-field lineage response. `audit_event_id` is null in 7b.1a
 * because no operator mutation has touched this entity yet.
 */
export interface LineageResponse {
  entity_id: string
  source_table: string
  source_key: string
  content_hash: string
  imported_at: string
  import_batch: string
  audit_event_id: string | null
}

/**
 * Look up the full import chain for a UUID entity.
 *
 * First resolves `entity_uuid` from `entity_uuids` by the input `entityId`.
 * Then returns the most recent `raw_events` row (by `imported_at DESC`)
 * that belongs to that entity, enriched with the source metadata.
 *
 * Returns `null` if the `entityId` has no rows in `entity_uuids`.
 *
 * The `audit_event_id` field is always `null` in 7b.1a (no mutations yet).
 * It will be populated in 7b.2 when the audit middleware lands.
 */
export async function queryLineage(db: Db, entityId: string): Promise<LineageResponse | null> {
  // Resolve the source metadata from entity_uuids
  // Drizzle's db.execute(sql) returns QueryResult<Record<string, unknown>>
  // with shape { rows: T[] } — NOT an array. Access via .rows.
  const sourceRows = (await db.execute(sql`
    SELECT source_table, source_key
    FROM entity_uuids
    WHERE entity_uuid = ${entityId}
    LIMIT 1
  `)) as unknown as { rows: Array<{ source_table: string; source_key: string }> }
  const source = sourceRows.rows[0]
  if (!source) return null

  // Get the most recent raw_events row for this (source_table, source_key)
  const eventRows = (await db.execute(sql`
    SELECT content_hash, imported_at, import_batch
    FROM raw_events
    WHERE source_table = ${source.source_table}
      AND source_key = ${source.source_key}
    ORDER BY imported_at DESC
    LIMIT 1
  `)) as unknown as {
    rows: Array<{
      content_hash: string
      imported_at: Date
      import_batch: string
    }>
  }
  const event = eventRows.rows[0]
  if (!event) return null

  return {
    entity_id: entityId,
    source_table: source.source_table,
    source_key: source.source_key,
    content_hash: event.content_hash,
    imported_at: event.imported_at.toISOString(),
    import_batch: event.import_batch,
    audit_event_id: null, // 7b.1a: no mutations yet
  }
}
