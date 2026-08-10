export interface SqlTransactionSession {
  query(text: string, values?: unknown[]): Promise<unknown>
  release(): void
}

/** Explicit factory for one session that this module owns for the transaction. */
export interface SqlTransactionSource {
  acquire(): Promise<SqlTransactionSession>
}

export interface ClosurePhaseIdentity {
  executionIdentity: string
  fingerprint: string
}

export interface ClosurePhaseReceipt {
  phase: 'candidates' | 'members'
  eligibleCount: number
  projectedCount: number
  exceptionCount: number
  unknownTypeCount: number
  ambiguousIdentityCount: number
  missingIdentityCount: number
  status: 'committed'
}

function schemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) throw new Error(`Invalid schema: ${schema}`)
  return schema
}

async function transactional<T>(
  source: SqlTransactionSource,
  work: (client: SqlTransactionSession) => Promise<T>,
): Promise<T> {
  const session = await source.acquire()
  let failure: Error | undefined
  let committed = false
  try {
    await session.query('BEGIN')
    const result = await work(session)
    await session.query('COMMIT')
    committed = true
    return result
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error), { cause: error })
    if (!committed) {
      try {
        await session.query('ROLLBACK')
      } catch (rollbackError) {
        Object.defineProperty(failure, 'rollbackError', { value: rollbackError })
      }
    }
    throw failure
  } finally {
    try {
      session.release()
    } catch (releaseError) {
      if (failure) Object.defineProperty(failure, 'releaseError', { value: releaseError })
      else throw releaseError
    }
  }
}

type ReceiptRow = {
  selected_batch_id: string
  fingerprint: string
  phase: ClosurePhaseReceipt['phase']
  eligible_count: number | string
  projected_count: number | string
  exception_count: number | string
  unknown_type_count: number | string
  ambiguous_identity_count: number | string
  missing_identity_count: number | string
  status: 'committed'
}

function rows(result: unknown): ReceiptRow[] {
  return (result as { rows?: ReceiptRow[] }).rows ?? []
}

function receiptFrom(row: ReceiptRow): ClosurePhaseReceipt {
  return {
    phase: row.phase,
    eligibleCount: Number(row.eligible_count),
    projectedCount: Number(row.projected_count),
    exceptionCount: Number(row.exception_count),
    unknownTypeCount: Number(row.unknown_type_count),
    ambiguousIdentityCount: Number(row.ambiguous_identity_count),
    missingIdentityCount: Number(row.missing_identity_count),
    status: row.status,
  }
}

async function replayOrReject(
  client: SqlTransactionSession,
  schema: string,
  phase: ClosurePhaseReceipt['phase'],
  batchId: string,
  identity: ClosurePhaseIdentity,
): Promise<ClosurePhaseReceipt | undefined> {
  const existing = rows(
    await client.query(
      `SELECT selected_batch_id, fingerprint, phase, eligible_count, projected_count, exception_count,
        unknown_type_count, ambiguous_identity_count, missing_identity_count, status
       FROM ${schema}.evidence_closure_phase_receipts
       WHERE execution_identity = $1 AND phase = $2 FOR UPDATE`,
      [identity.executionIdentity, phase],
    ),
  )[0]
  if (!existing) return undefined
  if (existing.selected_batch_id !== batchId || existing.fingerprint !== identity.fingerprint) {
    throw new Error(`Incompatible ${phase} receipt binding: ${identity.executionIdentity}`)
  }
  return receiptFrom(existing)
}

async function insertReceipt(
  client: SqlTransactionSession,
  schema: string,
  phase: ClosurePhaseReceipt['phase'],
  batchId: string,
  identity: ClosurePhaseIdentity,
  receipt: ClosurePhaseReceipt,
): Promise<ClosurePhaseReceipt> {
  await client.query(
    `INSERT INTO ${schema}.evidence_closure_phase_receipts
      (execution_identity, phase, selected_batch_id, fingerprint, eligible_count, projected_count,
       exception_count, unknown_type_count, ambiguous_identity_count, missing_identity_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      identity.executionIdentity,
      phase,
      batchId,
      identity.fingerprint,
      receipt.eligibleCount,
      receipt.projectedCount,
      receipt.exceptionCount,
      receipt.unknownTypeCount,
      receipt.ambiguousIdentityCount,
      receipt.missingIdentityCount,
    ],
  )
  return receipt
}

/** Rebuilds one snapshot's deterministic catalog candidates from immutable source rows. */
export async function projectLegacyMembershipCandidates(
  source: SqlTransactionSource,
  batchId: string,
  identity: ClosurePhaseIdentity = { executionIdentity: batchId, fingerprint: batchId },
  schema = 'socios',
): Promise<ClosurePhaseReceipt> {
  const s = schemaName(schema)
  return transactional(source, async (client) => {
    const replay = await replayOrReject(client, s, 'candidates', batchId, identity)
    if (replay) return replay
    const snapshot = (await client.query(
      `SELECT batch_id FROM ${s}.legacy_membership_type_snapshots WHERE batch_id = $1 FOR UPDATE`,
      [batchId],
    )) as { rowCount?: number }
    if (!snapshot.rowCount) throw new Error(`Unknown legacy membership snapshot: ${batchId}`)

    await client.query(
      `DELETE FROM ${s}.legacy_membership_type_candidates WHERE snapshot_batch_id = $1`,
      [batchId],
    )
    await client.query(
      `INSERT INTO ${s}.legacy_membership_type_candidates (snapshot_batch_id, code, source_row_id)
       SELECT $1, code, id FROM (
          SELECT id, code, row_number() OVER (PARTITION BY code ORDER BY record_ordinal DESC, id DESC) AS rank
          FROM ${s}.legacy_membership_type_source_rows WHERE batch_id = $1
       ) rows WHERE rank = 1`,
      [batchId],
    )
    await client.query(
      `UPDATE ${s}.legacy_membership_type_snapshots
       SET state = 'applied', applied_at = now() WHERE batch_id = $1`,
      [batchId],
    )
    const metrics = rows(
      await client.query(
        `SELECT
          (SELECT count(*) FROM ${s}.legacy_membership_type_candidates WHERE snapshot_batch_id = $1) AS eligible_count,
          (SELECT count(*) FROM ${s}.legacy_membership_type_candidates WHERE snapshot_batch_id = $1) AS projected_count`,
        [batchId],
      ),
    )[0]
    const eligibleCount = Number(metrics?.eligible_count ?? 0)
    const projectedCount = Number(metrics?.projected_count ?? 0)
    return insertReceipt(client, s, 'candidates', batchId, identity, {
      phase: 'candidates',
      eligibleCount,
      projectedCount,
      exceptionCount: 0,
      unknownTypeCount: 0,
      ambiguousIdentityCount: 0,
      missingIdentityCount: 0,
      status: 'committed',
    })
  })
}

/** Projects reviewed Socios facts without assigning fee, status, or category policy. */
export async function projectLegacyMemberEvidence(
  source: SqlTransactionSource,
  importBatchId: string,
  schema = 'socios',
  identity: ClosurePhaseIdentity = { executionIdentity: importBatchId, fingerprint: importBatchId },
): Promise<ClosurePhaseReceipt> {
  const s = schemaName(schema)
  return transactional(source, async (client) => {
    const replay = await replayOrReject(client, s, 'members', importBatchId, identity)
    if (replay) return replay
    await client.query(
      `INSERT INTO ${s}.legacy_member_evidence
        (raw_event_id, import_batch, identity_evidence_id, member_id,
         membership_type_candidate_source_row_id, legacy_type_code, legacy_category,
         fee_state, fee_value, review_state)
       SELECT raw_event_id, import_batch, identity_evidence_id,
         CASE WHEN review_state = 'validated' AND member_id IS NOT NULL AND source_row_id IS NOT NULL THEN member_id END,
         CASE WHEN review_state = 'validated' AND member_id IS NOT NULL AND source_row_id IS NOT NULL THEN source_row_id END,
         legacy_type_code, legacy_category,
         (CASE WHEN fee_text IS NULL THEN 'blank' WHEN fee_text::numeric = 0 THEN 'zero' ELSE 'non_zero' END)::${s}.legacy_member_fee_state,
         CASE WHEN fee_text IS NULL THEN NULL ELSE fee_text::numeric END,
         (CASE WHEN review_state = 'validated' AND member_id IS NOT NULL AND source_row_id IS NOT NULL THEN 'validated'
               WHEN review_state = 'validated' AND member_id IS NULL THEN 'missing_identity'
               WHEN review_state = 'validated' THEN 'unknown_type' ELSE 'ambiguous_identity' END)::${s}.legacy_member_review_state
       FROM (
         SELECT re.id AS raw_event_id, re.import_batch, ie.id AS identity_evidence_id,
           ie.member_id, ie.review_state, selectable.source_row_id,
           re.payload->>'SOCTIPSOCI' AS legacy_type_code,
           re.payload->>'SOCCATEGOR' AS legacy_category,
           nullif(trim(re.payload->>'SOCIMPCUOT'), '') AS fee_text
         FROM ${s}.raw_events re
         JOIN ${s}.legacy_identity_evidence ie ON ie.raw_event_id = re.id
         LEFT JOIN ${s}.legacy_membership_type_selectable selectable
           ON selectable.code = re.payload->>'SOCTIPSOCI'
         WHERE re.source_table = 'socios' AND re.import_batch = $1
       ) source
       ON CONFLICT (raw_event_id) DO NOTHING`,
      [importBatchId],
    )
    const metrics = rows(
      await client.query(
        `SELECT
          (SELECT count(*) FROM ${s}.raw_events WHERE source_table = 'socios' AND import_batch = $1) AS eligible_count,
          count(*) FILTER (WHERE review_state = 'validated') AS projected_count,
          count(*) FILTER (WHERE review_state = 'unknown_type') AS unknown_type_count,
          count(*) FILTER (WHERE review_state = 'ambiguous_identity') AS ambiguous_identity_count,
          count(*) FILTER (WHERE review_state = 'missing_identity') AS missing_identity_count
         FROM ${s}.legacy_member_evidence WHERE import_batch = $1`,
        [importBatchId],
      ),
    )[0]
    const eligibleCount = Number(metrics?.eligible_count ?? 0)
    const projectedCount = Number(metrics?.projected_count ?? 0)
    const unknownTypeCount = Number(metrics?.unknown_type_count ?? 0)
    const ambiguousIdentityCount = Number(metrics?.ambiguous_identity_count ?? 0)
    const missingIdentityCount = Number(metrics?.missing_identity_count ?? 0)
    return insertReceipt(client, s, 'members', importBatchId, identity, {
      phase: 'members',
      eligibleCount,
      projectedCount,
      exceptionCount: unknownTypeCount + ambiguousIdentityCount + missingIdentityCount,
      unknownTypeCount,
      ambiguousIdentityCount,
      missingIdentityCount,
      status: 'committed',
    })
  })
}
