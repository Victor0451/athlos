import { createHash } from 'node:crypto'

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }> }
type Counts = { catalog: number; socios: number }

export function previewFingerprint(
  catalogBatchId: string,
  sociosBatchId: string,
  inputs: ReadonlyArray<{ sourceTable: string; id: string; contentHash: string }>,
) {
  return createHash('sha256')
    .update(JSON.stringify({ v: 1, catalogBatchId, sociosBatchId, inputs }))
    .digest('hex')
}

async function previewInput(
  db: Queryable,
  schema: string,
  catalogBatchId: string,
  sociosBatchId: string,
) {
  const rows = await db.query(
    `SELECT source_table, id, content_hash FROM "${schema}".raw_events WHERE (import_batch = $1 AND source_table = 'tiposoci') OR (import_batch = $2 AND source_table = 'socios') ORDER BY source_table, id`,
    [catalogBatchId, sociosBatchId],
  )
  const inputs = rows.rows as Array<{ source_table: string; id: string; content_hash: string }>
  const catalog = inputs.filter((row) => row.source_table === 'tiposoci'),
    socios = inputs.filter((row) => row.source_table === 'socios')
  const counts: Counts = { catalog: catalog.length, socios: socios.length }
  const fingerprint = previewFingerprint(
    catalogBatchId,
    sociosBatchId,
    inputs.map((r) => ({ sourceTable: r.source_table, id: r.id, contentHash: r.content_hash })),
  )
  return { catalogBatchId, sociosBatchId, fingerprint, counts }
}
export async function createClosurePreview(
  db: Queryable,
  schema: string,
  catalogBatchId: string,
  sociosBatchId: string,
  closureSchema = schema,
) {
  const preview = await previewInput(db, schema, catalogBatchId, sociosBatchId)
  const inserted = await db.query(
    `INSERT INTO "${closureSchema}".evidence_closure_previews (catalog_batch_id, socios_batch_id, fingerprint, catalog_count, socios_count) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [
      catalogBatchId,
      sociosBatchId,
      preview.fingerprint,
      preview.counts.catalog,
      preview.counts.socios,
    ],
  )
  return { id: (inserted.rows[0] as { id: string }).id, ...preview }
}
export async function acquireClosureLease(
  db: Queryable,
  schema: string,
  fingerprint: string,
  owner: string,
  now: Date,
  durationMs: number,
) {
  const result = await db.query(
    `INSERT INTO "${schema}".evidence_closure_leases (pair_fingerprint, owner, expires_at) VALUES ($1,$2,$3) ON CONFLICT (pair_fingerprint) DO UPDATE SET owner = EXCLUDED.owner, fence = "${schema}".evidence_closure_leases.fence + 1, expires_at = EXCLUDED.expires_at, updated_at = now() WHERE "${schema}".evidence_closure_leases.expires_at <= $4 RETURNING fence`,
    [fingerprint, owner, new Date(now.valueOf() + durationMs), now],
  )
  return result.rows[0]
    ? { acquired: true as const, fence: Number((result.rows[0] as { fence: number }).fence) }
    : { acquired: false as const }
}

export async function renewClosureLease(
  db: Queryable,
  schema: string,
  fingerprint: string,
  owner: string,
  fence: number,
  now: Date,
  durationMs: number,
) {
  const result = await db.query(
    `UPDATE "${schema}".evidence_closure_leases SET expires_at = $1, updated_at = now() WHERE pair_fingerprint = $2 AND owner = $3 AND fence = $4 AND expires_at > $5 RETURNING fence`,
    [new Date(now.valueOf() + durationMs), fingerprint, owner, fence, now],
  )
  return result.rows.length === 1
}
export async function releaseClosureLease(
  db: Queryable,
  schema: string,
  fingerprint: string,
  owner: string,
  fence: number,
  now: Date,
) {
  const result = await db.query(
    `UPDATE "${schema}".evidence_closure_leases SET expires_at = $1, updated_at = now() WHERE pair_fingerprint = $2 AND owner = $3 AND fence = $4 AND expires_at > $1 RETURNING fence`,
    [now, fingerprint, owner, fence],
  )
  return result.rows.length === 1
}
