export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<unknown>
}

/** Rebuilds one snapshot's deterministic catalog candidates from immutable source rows. */
export async function projectLegacyMembershipCandidates(
  client: SqlClient,
  batchId: string,
): Promise<void> {
  await client.query('BEGIN')
  try {
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
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}
