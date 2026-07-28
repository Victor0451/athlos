import { previewFingerprint } from '@athlos/db'

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }> }
type Input = { source_table: string; import_batch: string; id: string; content_hash: string }

async function inputs(
  db: Queryable,
  schema: string,
  catalogBatchId: string,
  sociosBatchId: string,
) {
  if (catalogBatchId === sociosBatchId) throw new Error('invalid closure batch pair')
  const result = await db.query(
    `SELECT source_table, import_batch, id, content_hash FROM "${schema}".raw_events WHERE import_batch IN ($1,$2) ORDER BY source_table, id`,
    [catalogBatchId, sociosBatchId],
  )
  const rows = result.rows as Input[]
  const catalog = rows.filter(
    (row) => row.import_batch === catalogBatchId && row.source_table === 'tiposoci',
  )
  const socios = rows.filter(
    (row) => row.import_batch === sociosBatchId && row.source_table === 'socios',
  )
  if (
    !catalog.length ||
    !socios.length ||
    rows.some(
      (row) =>
        (row.import_batch === catalogBatchId && row.source_table !== 'tiposoci') ||
        (row.import_batch === sociosBatchId && row.source_table !== 'socios'),
    )
  )
    throw new Error('invalid closure batch pair')
  return {
    catalog,
    socios,
    fingerprint: previewFingerprint(
      catalogBatchId,
      sociosBatchId,
      [...catalog, ...socios].map(({ source_table, id, content_hash }) => ({
        sourceTable: source_table,
        id,
        contentHash: content_hash,
      })),
    ),
  }
}

export async function createClosurePreview(
  db: Queryable,
  schema: string,
  catalogBatchId: string,
  sociosBatchId: string,
  closureSchema = schema,
) {
  const value = await inputs(db, schema, catalogBatchId, sociosBatchId)
  const result = await db.query(
    `INSERT INTO "${closureSchema}".evidence_closure_previews (catalog_batch_id, socios_batch_id, fingerprint, catalog_count, socios_count) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [catalogBatchId, sociosBatchId, value.fingerprint, value.catalog.length, value.socios.length],
  )
  return {
    previewId: (result.rows[0] as { id: string }).id,
    fingerprint: value.fingerprint,
    counts: { catalog: value.catalog.length, socios: value.socios.length },
  }
}
export async function validateClosurePreview(
  db: Queryable,
  schema: string,
  previewId: string,
  catalogBatchId: string,
  sociosBatchId: string,
  closureSchema = schema,
) {
  const result = await db.query(
    `SELECT catalog_batch_id, socios_batch_id, fingerprint, expires_at FROM "${closureSchema}".evidence_closure_previews WHERE id = $1`,
    [previewId],
  )
  const preview = result.rows[0] as
    | { catalog_batch_id: string; socios_batch_id: string; fingerprint: string; expires_at: Date }
    | undefined
  if (!preview) return { outcome: 'missing' as const }
  if (
    preview.catalog_batch_id !== catalogBatchId ||
    preview.socios_batch_id !== sociosBatchId ||
    preview.expires_at <= new Date()
  )
    return { outcome: 'stale' as const }
  try {
    const value = await inputs(db, schema, catalogBatchId, sociosBatchId)
    return value.fingerprint === preview.fingerprint
      ? {
          outcome: 'fresh' as const,
          fingerprint: preview.fingerprint,
          counts: { catalog: value.catalog.length, socios: value.socios.length },
        }
      : { outcome: 'stale' as const }
  } catch {
    return { outcome: 'stale' as const }
  }
}

type ReservationInput = {
  catalogBatchId: string
  sociosBatchId: string
  previewId: string
  fingerprint: string
  idempotencyKey: string
}

export async function reserveClosureConfirmation(
  db: Queryable,
  schema: string,
  input: ReservationInput,
  closureSchema = schema,
) {
  const existing = await db.query(
    `SELECT catalog_batch_id, socios_batch_id, preview_id, fingerprint FROM "${closureSchema}".evidence_closure_confirmations WHERE idempotency_key = $1`,
    [input.idempotencyKey],
  )
  const prior = existing.rows[0] as
    | { catalog_batch_id: string; socios_batch_id: string; preview_id: string; fingerprint: string }
    | undefined
  if (prior)
    return prior.catalog_batch_id === input.catalogBatchId &&
      prior.socios_batch_id === input.sociosBatchId &&
      prior.preview_id === input.previewId &&
      prior.fingerprint === input.fingerprint
      ? { outcome: 'replay' as const }
      : { outcome: 'conflict' as const }
  const freshness = await validateClosurePreview(
    db,
    schema,
    input.previewId,
    input.catalogBatchId,
    input.sociosBatchId,
    closureSchema,
  )
  if (freshness.outcome !== 'fresh' || freshness.fingerprint !== input.fingerprint)
    return { outcome: 'stale' as const }
  const reservation = await db.query(
    `INSERT INTO "${closureSchema}".evidence_closure_confirmations (idempotency_key, catalog_batch_id, socios_batch_id, preview_id, fingerprint) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key RETURNING catalog_batch_id, socios_batch_id, preview_id, fingerprint, (xmax = 0) AS created`,
    [
      input.idempotencyKey,
      input.catalogBatchId,
      input.sociosBatchId,
      input.previewId,
      input.fingerprint,
    ],
  )
  const row = reservation.rows[0] as {
    catalog_batch_id: string
    socios_batch_id: string
    preview_id: string
    fingerprint: string
    created: boolean
  }
  if (
    row.catalog_batch_id !== input.catalogBatchId ||
    row.socios_batch_id !== input.sociosBatchId ||
    row.preview_id !== input.previewId ||
    row.fingerprint !== input.fingerprint
  )
    return { outcome: 'conflict' as const }
  if (!row.created) return { outcome: 'replay' as const }

  return { outcome: 'reserved' as const }
}
