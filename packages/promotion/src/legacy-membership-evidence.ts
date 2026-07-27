export interface SqlTransactionSession {
  query(text: string, values?: unknown[]): Promise<unknown>
  release(): void
}

/** Explicit factory for one session that this module owns for the transaction. */
export interface SqlTransactionSource {
  acquire(): Promise<SqlTransactionSession>
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
  try {
    await session.query('BEGIN')
    const result = await work(session)
    await session.query('COMMIT')
    return result
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error), { cause: error })
    try {
      await session.query('ROLLBACK')
    } catch (rollbackError) {
      Object.defineProperty(failure, 'rollbackError', { value: rollbackError })
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

/** Rebuilds one snapshot's deterministic catalog candidates from immutable source rows. */
export async function projectLegacyMembershipCandidates(
  source: SqlTransactionSource,
  batchId: string,
): Promise<void> {
  await transactional(source, async (client) => {
    const snapshot = (await client.query(
      'SELECT batch_id FROM socios.legacy_membership_type_snapshots WHERE batch_id = $1 FOR UPDATE',
      [batchId],
    )) as { rowCount?: number }
    if (!snapshot.rowCount) throw new Error(`Unknown legacy membership snapshot: ${batchId}`)

    await client.query(
      'DELETE FROM socios.legacy_membership_type_candidates WHERE snapshot_batch_id = $1',
      [batchId],
    )
    await client.query(
      `INSERT INTO socios.legacy_membership_type_candidates (snapshot_batch_id, code, source_row_id)
       SELECT $1, code, id FROM (
         SELECT id, code, row_number() OVER (PARTITION BY code ORDER BY record_ordinal DESC) AS rank
         FROM socios.legacy_membership_type_source_rows WHERE batch_id = $1
       ) rows WHERE rank = 1`,
      [batchId],
    )
    await client.query(
      `UPDATE socios.legacy_membership_type_snapshots
       SET state = 'applied', applied_at = now() WHERE batch_id = $1`,
      [batchId],
    )
  })
}

/** Projects reviewed Socios facts without assigning fee, status, or category policy. */
export async function projectLegacyMemberEvidence(
  source: SqlTransactionSource,
  importBatchId: string,
  schema = 'socios',
): Promise<void> {
  const s = schemaName(schema)
  await transactional(source, async (client) => {
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
  })
}
