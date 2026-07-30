import { createHash } from 'node:crypto'
import type { SqlTransactionSource } from './legacy-membership-evidence.ts'

export type ResolutionApplicationReceipt = {
  applicationFingerprint: string
  eligibleCount: number
  appliedCount: number
  unresolvedCount: number
  unresolvedUnknownTypeCount: number
  unresolvedAmbiguousIdentityCount: number
  staleCount: number
  technicalCount: number
  status: 'committed'
}

type Leaf = {
  evidence_id: string
  evidence_kind: 'unknown_type' | 'ambiguous_identity' | 'missing_identity'
  content_hash: string
  resolution_id: string | null
  resolution_kind: string | null
  evidence_fingerprint: string | null
  resolution_reason: string | null
  steward_operator_id: string | null
  resolution_key: string | null
  selected_member_id: string | null
  selected_type_id: string | null
  member_exists: boolean | null
  type_exists: boolean | null
}
type StoredReceipt = ResolutionApplicationReceipt & { selected_batch_id: string }
const rows = <T>(result: unknown): T[] => (result as { rows?: T[] }).rows ?? []
const number = (value: unknown) => Number(value)

/** Stable binding of every exception and active resolution leaf visible to an execution. */
export function resolutionApplicationFingerprint(leaves: Leaf[]): string {
  const canonical = leaves
    .map((leaf) => [
      leaf.evidence_id,
      leaf.evidence_kind,
      leaf.content_hash,
      leaf.resolution_id,
      leaf.resolution_kind,
      leaf.evidence_fingerprint,
      leaf.resolution_reason,
      leaf.steward_operator_id,
      leaf.resolution_key,
      leaf.selected_member_id,
      leaf.selected_type_id,
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

function receipt(row: StoredReceipt): ResolutionApplicationReceipt {
  return {
    applicationFingerprint: row.applicationFingerprint,
    eligibleCount: number(row.eligibleCount),
    appliedCount: number(row.appliedCount),
    unresolvedCount: number(row.unresolvedCount),
    unresolvedUnknownTypeCount: number(row.unresolvedUnknownTypeCount),
    unresolvedAmbiguousIdentityCount: number(row.unresolvedAmbiguousIdentityCount),
    staleCount: number(row.staleCount),
    technicalCount: number(row.technicalCount),
    status: row.status,
  }
}

function outcome(leaf: Leaf): 'applied' | 'unresolved' | 'stale' | 'technical' {
  if (leaf.evidence_kind === 'missing_identity') return 'technical'
  if (!leaf.resolution_id) return 'unresolved'
  if (
    leaf.resolution_kind !== leaf.evidence_kind ||
    leaf.evidence_fingerprint !== leaf.content_hash ||
    !leaf.member_exists ||
    !leaf.type_exists
  )
    return 'stale'
  return 'applied'
}

export async function applyLegacyMemberEvidenceResolutions(
  source: SqlTransactionSource,
  importBatchId: string,
  executionIdentity: string,
  schema = 'socios',
  expectedApplicationFingerprint?: string,
): Promise<ResolutionApplicationReceipt> {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) throw new Error(`Invalid schema: ${schema}`)
  const client = await source.acquire()
  let committed = false
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [executionIdentity])
    const leaves = rows<Leaf>(
      await client.query(
        `SELECT e.id AS evidence_id, e.review_state AS evidence_kind, raw.content_hash,
          r.id AS resolution_id, r.resolution_kind, r.evidence_fingerprint, r.reason AS resolution_reason,
          r.steward_operator_id, r.idempotency_key AS resolution_key,
          r.selected_member_id, r.selected_membership_type_candidate_source_row_id AS selected_type_id,
          m.id IS NOT NULL AS member_exists, c.source_row_id IS NOT NULL AS type_exists
         FROM ${schema}.legacy_member_evidence e
         JOIN ${schema}.raw_events raw ON raw.id = e.raw_event_id
         LEFT JOIN ${schema}.legacy_member_evidence_resolutions r ON r.legacy_member_evidence_id = e.id
          AND NOT EXISTS (SELECT 1 FROM ${schema}.legacy_member_evidence_resolutions next WHERE next.supersedes_resolution_id = r.id)
         LEFT JOIN ${schema}.member_identities m ON m.id = r.selected_member_id
         LEFT JOIN ${schema}.legacy_membership_type_candidates c ON c.source_row_id = r.selected_membership_type_candidate_source_row_id
         WHERE e.import_batch = $1 AND e.review_state IN ('unknown_type', 'ambiguous_identity', 'missing_identity')
         ORDER BY e.id FOR UPDATE OF e`,
        [importBatchId],
      ),
    )
    const applicationFingerprint = resolutionApplicationFingerprint(leaves)
    if (
      expectedApplicationFingerprint !== undefined &&
      expectedApplicationFingerprint !== applicationFingerprint
    )
      throw new Error('incompatible resolution application fingerprint')
    const existing = rows<StoredReceipt>(
      await client.query(
        `SELECT selected_batch_id, application_fingerprint AS "applicationFingerprint",
           eligible_count AS "eligibleCount", applied_count AS "appliedCount",
           unresolved_count AS "unresolvedCount", stale_count AS "staleCount",
           unresolved_unknown_type_count AS "unresolvedUnknownTypeCount",
           unresolved_ambiguous_identity_count AS "unresolvedAmbiguousIdentityCount",
           technical_count AS "technicalCount", status
         FROM ${schema}.legacy_member_evidence_resolution_application_receipts
         WHERE execution_identity = $1 FOR UPDATE`,
        [executionIdentity],
      ),
    )[0]
    if (existing) {
      if (
        existing.selected_batch_id !== importBatchId ||
        existing.applicationFingerprint !== applicationFingerprint
      )
        throw new Error(`Incompatible resolution application binding: ${executionIdentity}`)
      await client.query('COMMIT')
      committed = true
      return receipt(existing)
    }
    const counts = { applied: 0, unresolved: 0, unknown: 0, ambiguous: 0, stale: 0, technical: 0 }
    for (const leaf of leaves) {
      const state = outcome(leaf)
      counts[state]++
      if (state === 'unresolved')
        counts[leaf.evidence_kind === 'unknown_type' ? 'unknown' : 'ambiguous']++
    }
    const result: ResolutionApplicationReceipt = {
      applicationFingerprint,
      eligibleCount: leaves.length,
      appliedCount: counts.applied,
      unresolvedCount: counts.unresolved,
      unresolvedUnknownTypeCount: counts.unknown,
      unresolvedAmbiguousIdentityCount: counts.ambiguous,
      staleCount: counts.stale,
      technicalCount: counts.technical,
      status: 'committed',
    }
    await client.query(
      `INSERT INTO ${schema}.legacy_member_evidence_resolution_application_receipts
        (execution_identity, selected_batch_id, application_fingerprint, eligible_count, applied_count,
         unresolved_count, unresolved_unknown_type_count, unresolved_ambiguous_identity_count,
         stale_count, technical_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        executionIdentity,
        importBatchId,
        applicationFingerprint,
        result.eligibleCount,
        result.appliedCount,
        result.unresolvedCount,
        result.unresolvedUnknownTypeCount,
        result.unresolvedAmbiguousIdentityCount,
        result.staleCount,
        result.technicalCount,
      ],
    )
    for (const leaf of leaves) {
      if (outcome(leaf) !== 'applied') continue
      await client.query(
        `INSERT INTO ${schema}.legacy_member_evidence_resolution_applications
          (execution_identity, legacy_member_evidence_id, resolution_id, member_id,
           membership_type_candidate_source_row_id, application_fingerprint)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          executionIdentity,
          leaf.evidence_id,
          leaf.resolution_id,
          leaf.selected_member_id,
          leaf.selected_type_id,
          applicationFingerprint,
        ],
      )
    }
    await client.query('COMMIT')
    committed = true
    return result
  } catch (error) {
    if (!committed) await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
