import { createHash } from 'node:crypto'

export interface SqlTransactionSession {
  query(text: string, values?: unknown[]): Promise<{ rows?: Record<string, unknown>[] }>
  release(): void
}

export interface SqlTransactionSource {
  acquire(): Promise<SqlTransactionSession>
}

function schemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) throw new Error(`Invalid schema: ${schema}`)
  return schema
}

export function catalogInputHash(
  rows: readonly { id: unknown; recordOrdinal: unknown; contentHash: unknown }[],
): string {
  return createHash('sha256')
    .update(rows.map((row) => [row.id, row.recordOrdinal, row.contentHash].join(':')).join('|'))
    .digest('hex')
}

export async function materializeLegacyMembershipCatalog(
  source: SqlTransactionSource,
  batchId: string,
  schema = 'socios',
): Promise<void> {
  const s = schemaName(schema)
  const session = await source.acquire()
  try {
    await session.query('BEGIN')
    const batch = await session.query(
      `SELECT exists(SELECT 1 FROM ${s}.raw_events WHERE import_batch = $1) AS exists`,
      [batchId],
    )
    if (batch.rows?.[0]?.exists !== true) throw new Error(`Unknown import batch: ${batchId}`)
    const events = await session.query(
      `SELECT id, content_hash, payload->>'RECORD_ORDINAL' AS record_ordinal,
        payload->>'TSOCODIGO' AS code, payload->>'TSONOMBRE' AS name, payload->>'TSOLETRA' AS letter
       FROM ${s}.raw_events WHERE source_table = 'tiposoci' AND import_batch = $1
       ORDER BY (payload->>'RECORD_ORDINAL')::integer, id`,
      [batchId],
    )
    const rows = events.rows ?? []
    if (rows.length === 0) throw new Error(`Missing tiposoci input for import batch: ${batchId}`)
    const inputHash = catalogInputHash(
      rows.map((row) => ({
        id: row.id,
        recordOrdinal: row.record_ordinal,
        contentHash: row.content_hash,
      })),
    )

    await session.query(
      `INSERT INTO ${s}.legacy_membership_type_snapshots (batch_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [batchId],
    )
    for (const row of rows) {
      await session.query(
        `INSERT INTO ${s}.legacy_membership_type_source_rows
          (raw_event_id, batch_id, record_ordinal, code, name, letter, content_hash)
          VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (raw_event_id) DO NOTHING`,
        [row.id, batchId, row.record_ordinal, row.code, row.name, row.letter, row.content_hash],
      )
    }
    await session.query(
      `INSERT INTO ${s}.legacy_catalog_materialization_receipts
        (batch_id, input_hash, eligible_source_row_count, materialized_source_row_count)
       VALUES ($1, $2, $3, $3) ON CONFLICT DO NOTHING`,
      [batchId, inputHash, rows.length],
    )
    await session.query('COMMIT')
  } catch (error) {
    await session.query('ROLLBACK')
    throw error
  } finally {
    session.release()
  }
}
