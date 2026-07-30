import { acquireClosureLease, previewFingerprint } from '@athlos/db'
import { resolutionApplicationFingerprint } from '@athlos/promotion'

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }> }
type Input = { source_table: string; import_batch: string; id: string; content_hash: string }
type ResolutionLeaf = Parameters<typeof resolutionApplicationFingerprint>[0][number]

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
  const resolutionRows = await db.query(
    `SELECT e.id AS evidence_id, e.review_state AS evidence_kind, raw.content_hash, r.id AS resolution_id,
      r.resolution_kind, r.evidence_fingerprint, r.reason AS resolution_reason, r.steward_operator_id,
      r.idempotency_key AS resolution_key, r.selected_member_id,
      r.selected_membership_type_candidate_source_row_id AS selected_type_id, m.id IS NOT NULL AS member_exists,
      c.source_row_id IS NOT NULL AS type_exists FROM "${schema}".legacy_member_evidence e
      JOIN "${schema}".raw_events raw ON raw.id = e.raw_event_id
      LEFT JOIN "${schema}".legacy_member_evidence_resolutions r ON r.legacy_member_evidence_id = e.id
        AND NOT EXISTS (SELECT 1 FROM "${schema}".legacy_member_evidence_resolutions next WHERE next.supersedes_resolution_id = r.id)
      LEFT JOIN "${schema}".member_identities m ON m.id = r.selected_member_id
      LEFT JOIN "${schema}".legacy_membership_type_candidates c ON c.source_row_id = r.selected_membership_type_candidate_source_row_id
      WHERE e.import_batch = $1 AND e.review_state IN ('unknown_type', 'ambiguous_identity', 'missing_identity') ORDER BY e.id`,
    [sociosBatchId],
  )
  const leaves = resolutionRows.rows as ResolutionLeaf[]
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
    resolutionSetFingerprint: resolutionApplicationFingerprint(leaves),
    resolutionCount: leaves.filter((leaf) => leaf.resolution_id !== null).length,
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
    `INSERT INTO "${closureSchema}".evidence_closure_previews (catalog_batch_id, socios_batch_id, fingerprint, resolution_set_fingerprint, catalog_count, socios_count) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [
      catalogBatchId,
      sociosBatchId,
      value.fingerprint,
      value.resolutionSetFingerprint,
      value.catalog.length,
      value.socios.length,
    ],
  )
  return {
    previewId: (result.rows[0] as { id: string }).id,
    fingerprint: value.fingerprint,
    resolutionSetFingerprint: value.resolutionSetFingerprint,
    counts: {
      catalog: value.catalog.length,
      socios: value.socios.length,
      resolutions: value.resolutionCount,
    },
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
    `SELECT catalog_batch_id, socios_batch_id, fingerprint, resolution_set_fingerprint, expires_at FROM "${closureSchema}".evidence_closure_previews WHERE id = $1`,
    [previewId],
  )
  const preview = result.rows[0] as
    | {
        catalog_batch_id: string
        socios_batch_id: string
        fingerprint: string
        resolution_set_fingerprint: string
        expires_at: Date
      }
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
    return value.fingerprint === preview.fingerprint &&
      value.resolutionSetFingerprint === preview.resolution_set_fingerprint
      ? {
          outcome: 'fresh' as const,
          fingerprint: preview.fingerprint,
          resolutionSetFingerprint: preview.resolution_set_fingerprint,
          counts: {
            catalog: value.catalog.length,
            socios: value.socios.length,
            resolutions: value.resolutionCount,
          },
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
  resolutionSetFingerprint: string
  idempotencyKey: string
}

export async function reserveClosureConfirmation(
  db: Queryable,
  schema: string,
  input: ReservationInput,
  closureSchema = schema,
) {
  const existing = await db.query(
    `SELECT catalog_batch_id, socios_batch_id, preview_id, fingerprint, resolution_set_fingerprint FROM "${closureSchema}".evidence_closure_confirmations WHERE idempotency_key = $1`,
    [input.idempotencyKey],
  )
  const prior = existing.rows[0] as
    | {
        catalog_batch_id: string
        socios_batch_id: string
        preview_id: string
        fingerprint: string
        resolution_set_fingerprint: string
      }
    | undefined
  if (prior)
    return prior.catalog_batch_id === input.catalogBatchId &&
      prior.socios_batch_id === input.sociosBatchId &&
      prior.preview_id === input.previewId &&
      prior.fingerprint === input.fingerprint &&
      prior.resolution_set_fingerprint === input.resolutionSetFingerprint
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
  if (
    freshness.outcome !== 'fresh' ||
    freshness.fingerprint !== input.fingerprint ||
    freshness.resolutionSetFingerprint !== input.resolutionSetFingerprint
  )
    return { outcome: 'stale' as const }
  const reservation = await db.query(
    `INSERT INTO "${closureSchema}".evidence_closure_confirmations (idempotency_key, catalog_batch_id, socios_batch_id, preview_id, fingerprint, resolution_set_fingerprint) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key RETURNING catalog_batch_id, socios_batch_id, preview_id, fingerprint, resolution_set_fingerprint, (xmax = 0) AS created`,
    [
      input.idempotencyKey,
      input.catalogBatchId,
      input.sociosBatchId,
      input.previewId,
      input.fingerprint,
      input.resolutionSetFingerprint,
    ],
  )
  const row = reservation.rows[0] as {
    catalog_batch_id: string
    socios_batch_id: string
    preview_id: string
    fingerprint: string
    resolution_set_fingerprint: string
    created: boolean
  }
  if (
    row.catalog_batch_id !== input.catalogBatchId ||
    row.socios_batch_id !== input.sociosBatchId ||
    row.preview_id !== input.previewId ||
    row.fingerprint !== input.fingerprint ||
    row.resolution_set_fingerprint !== input.resolutionSetFingerprint
  )
    return { outcome: 'conflict' as const }
  if (!row.created) return { outcome: 'replay' as const }

  return { outcome: 'reserved' as const }
}

/**
 * Converts a durable reservation into the fenced handoff consumed by PR3.
 * Cancellation is checked on both sides of the reservation COMMIT; once it
 * exists it is intentionally never deleted by the caller.
 */
export async function confirmClosureReservation(
  db: Queryable,
  schema: string,
  input: ReservationInput,
  owner: string,
  isCancelled: () => boolean,
  closureSchema = schema,
) {
  if (isCancelled()) return { outcome: 'cancelled' as const }
  const reservation = await reserveClosureConfirmation(db, schema, input, closureSchema)
  if (isCancelled()) return { outcome: 'cancelled' as const }
  if (reservation.outcome !== 'reserved') return reservation
  const lease = await acquireClosureLease(
    db,
    closureSchema,
    input.fingerprint,
    owner,
    new Date(),
    60_000,
  )
  return lease.acquired
    ? { outcome: 'accepted' as const, fence: lease.fence }
    : { outcome: 'held' as const }
}
