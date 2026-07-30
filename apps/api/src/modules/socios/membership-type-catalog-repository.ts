import { sql } from 'drizzle-orm'
import type { Db } from '@athlos/db'

export type CatalogState =
  | 'ready'
  | 'no_current_catalog'
  | 'no_current_members_batch'
  | 'source_row_not_current'
export type CatalogPage<T> = {
  state: CatalogState
  snapshotBatchId?: string
  items: T[]
  total: number
  page: number
  limit: number
}
export type MembershipTypeCatalogItem = {
  sourceRowId: string
  snapshotBatchId: string
  code: string
  name: string
  letter: string
  validatedCount: number
  resolvedCount: number
  distinctMemberCount: number
}
export type AssociatedMember = {
  memberId: string
  memberNumber: number
  credentialRef: string | null
  lifecycleState: 'imported' | 'validated' | 'review_required'
  associationSources: string[]
}
export type MembershipTypeSummary = Pick<
  MembershipTypeCatalogItem,
  'sourceRowId' | 'snapshotBatchId' | 'code' | 'name' | 'letter'
>

type Result<T> = { rows: T[] }
type StateRow = { state: CatalogState; snapshotBatchId: string | null }
const rows = async <T>(db: Db, query: ReturnType<typeof sql>): Promise<T[]> =>
  ((await db.execute(query)) as unknown as Result<T>).rows
const page = (input: { page: number; limit: number }) => ({
  page: Math.max(input.page, 1),
  limit: Math.min(Math.max(input.limit, 1), 100),
})

function scope(sourceRowId?: string) {
  return sql`
    WITH newest_catalog AS (
      SELECT batch_id FROM socios.legacy_membership_type_snapshots
      WHERE state = 'applied' ORDER BY sequence DESC LIMIT 1
    ), catalog AS (
      SELECT n.batch_id FROM newest_catalog n
      JOIN socios.legacy_catalog_materialization_receipts r ON r.batch_id = n.batch_id
    ), members_batch AS (
      SELECT selected_batch_id FROM socios.evidence_closure_phase_receipts
      WHERE phase = 'members' AND status = 'committed'
      ORDER BY committed_at DESC, execution_identity DESC LIMIT 1
    )
    SELECT CASE
      WHEN NOT EXISTS (SELECT 1 FROM catalog) THEN 'no_current_catalog'
      WHEN NOT EXISTS (SELECT 1 FROM members_batch) THEN 'no_current_members_batch'
      ${
        sourceRowId
          ? sql`WHEN NOT EXISTS (
        SELECT 1 FROM socios.legacy_membership_type_candidates c
        JOIN catalog ON catalog.batch_id = c.snapshot_batch_id
        WHERE c.source_row_id = ${sourceRowId}
      ) THEN 'source_row_not_current'`
          : sql.empty()
      }
      ELSE 'ready'
    END AS state, (SELECT batch_id FROM catalog) AS "snapshotBatchId"`
}

export async function listMembershipTypeCatalog(
  db: Db,
  input: { page: number; limit: number; search?: string },
): Promise<CatalogPage<MembershipTypeCatalogItem>> {
  const paging = page(input)
  const [status] = await rows<StateRow>(db, scope())
  if (!status || status.state !== 'ready')
    return {
      state: status?.state ?? 'no_current_catalog',
      ...(status?.snapshotBatchId ? { snapshotBatchId: status.snapshotBatchId } : {}),
      items: [],
      total: 0,
      ...paging,
    }
  const term = input.search?.trim()
  const result = await rows<MembershipTypeCatalogItem & { total: number }>(
    db,
    sql`
    WITH newest_catalog AS (
      SELECT batch_id FROM socios.legacy_membership_type_snapshots WHERE state = 'applied' ORDER BY sequence DESC LIMIT 1
    ), catalog_types AS (
      SELECT c.source_row_id, c.snapshot_batch_id, c.code, r.name, r.letter FROM socios.legacy_membership_type_candidates c
      JOIN newest_catalog n ON n.batch_id = c.snapshot_batch_id
      JOIN socios.legacy_catalog_materialization_receipts receipt ON receipt.batch_id = n.batch_id
      JOIN socios.legacy_membership_type_source_rows r ON r.id = c.source_row_id
    ), members_batch AS (
      SELECT selected_batch_id FROM socios.evidence_closure_phase_receipts
      WHERE phase = 'members' AND status = 'committed' ORDER BY committed_at DESC, execution_identity DESC LIMIT 1
    ), associations AS (
      SELECT e.member_id, e.membership_type_candidate_source_row_id AS source_row_id, 'validated' AS source
      FROM socios.legacy_member_evidence e JOIN members_batch b ON b.selected_batch_id = e.import_batch
      WHERE e.review_state = 'validated'
      UNION ALL
      SELECT a.member_id, a.membership_type_candidate_source_row_id, 'resolved' AS source
      FROM socios.legacy_member_evidence_resolution_applications a
      JOIN socios.legacy_member_evidence_resolution_application_receipts receipt ON receipt.execution_identity = a.execution_identity AND receipt.status = 'committed'
      JOIN members_batch b ON b.selected_batch_id = receipt.selected_batch_id
      JOIN socios.legacy_member_evidence e ON e.id = a.legacy_member_evidence_id AND e.import_batch = b.selected_batch_id
      JOIN socios.legacy_member_evidence_resolutions r ON r.id = a.resolution_id
      WHERE NOT EXISTS (SELECT 1 FROM socios.legacy_member_evidence_resolutions next WHERE next.supersedes_resolution_id = r.id)
    )
    SELECT t.source_row_id AS "sourceRowId", t.snapshot_batch_id AS "snapshotBatchId", t.code, t.name, t.letter,
      count(DISTINCT a.member_id) FILTER (WHERE a.source = 'validated')::int AS "validatedCount",
      count(DISTINCT a.member_id) FILTER (WHERE a.source = 'resolved')::int AS "resolvedCount",
      count(DISTINCT a.member_id)::int AS "distinctMemberCount", count(*) OVER()::int AS total
    FROM catalog_types t LEFT JOIN associations a ON a.source_row_id = t.source_row_id
    WHERE ${term ? sql`(t.code ILIKE ${`%${term}%`} OR t.name ILIKE ${`%${term}%`} OR t.letter ILIKE ${`%${term}%`})` : sql`TRUE`}
    GROUP BY t.source_row_id, t.snapshot_batch_id, t.code, t.name, t.letter
    ORDER BY t.code ASC, t.name ASC, t.letter ASC, t.source_row_id ASC
    LIMIT ${paging.limit} OFFSET ${(paging.page - 1) * paging.limit}`,
  )
  return {
    state: 'ready',
    snapshotBatchId: status.snapshotBatchId!,
    items: result,
    total: result[0]?.total ?? 0,
    ...paging,
  }
}

export async function getCurrentMembershipType(
  db: Db,
  sourceRowId: string,
): Promise<{ state: CatalogState; item: MembershipTypeSummary | null }> {
  const [status] = await rows<StateRow>(db, scope(sourceRowId))
  if (!status || status.state !== 'ready')
    return { state: status?.state ?? 'no_current_catalog', item: null }
  const [item] = await rows<MembershipTypeSummary>(
    db,
    sql`
      SELECT c.source_row_id AS "sourceRowId", c.snapshot_batch_id AS "snapshotBatchId", c.code, r.name, r.letter
      FROM socios.legacy_membership_type_candidates c
      JOIN socios.legacy_membership_type_source_rows r ON r.id = c.source_row_id
      WHERE c.source_row_id = ${sourceRowId} AND c.snapshot_batch_id = ${status.snapshotBatchId!}`,
  )
  return { state: item ? 'ready' : 'source_row_not_current', item: item ?? null }
}

export async function listAssociatedMembers(
  db: Db,
  sourceRowId: string,
  input: { page: number; limit: number; search?: string },
): Promise<CatalogPage<AssociatedMember>> {
  const paging = page(input)
  const [status] = await rows<StateRow>(db, scope(sourceRowId))
  if (!status || status.state !== 'ready')
    return {
      state: status?.state ?? 'no_current_catalog',
      ...(status?.snapshotBatchId ? { snapshotBatchId: status.snapshotBatchId } : {}),
      items: [],
      total: 0,
      ...paging,
    }
  const term = input.search?.trim()
  const result = await rows<AssociatedMember & { total: number }>(
    db,
    sql`
    WITH members_batch AS (
      SELECT selected_batch_id FROM socios.evidence_closure_phase_receipts WHERE phase = 'members' AND status = 'committed'
      ORDER BY committed_at DESC, execution_identity DESC LIMIT 1
    ), associations AS (
      SELECT e.member_id, 'validated'::text AS source FROM socios.legacy_member_evidence e JOIN members_batch b ON b.selected_batch_id = e.import_batch
      WHERE e.review_state = 'validated' AND e.membership_type_candidate_source_row_id = ${sourceRowId}
      UNION ALL
      SELECT a.member_id, 'resolved'::text FROM socios.legacy_member_evidence_resolution_applications a
      JOIN socios.legacy_member_evidence_resolution_application_receipts receipt ON receipt.execution_identity = a.execution_identity AND receipt.status = 'committed'
      JOIN members_batch b ON b.selected_batch_id = receipt.selected_batch_id
      JOIN socios.legacy_member_evidence e ON e.id = a.legacy_member_evidence_id AND e.import_batch = b.selected_batch_id
      JOIN socios.legacy_member_evidence_resolutions r ON r.id = a.resolution_id
      WHERE a.membership_type_candidate_source_row_id = ${sourceRowId}
        AND NOT EXISTS (SELECT 1 FROM socios.legacy_member_evidence_resolutions next WHERE next.supersedes_resolution_id = r.id)
    )
    SELECT m.id AS "memberId", m.member_number::int AS "memberNumber", m.credential_ref AS "credentialRef", m.lifecycle_state AS "lifecycleState",
      array_agg(DISTINCT a.source ORDER BY a.source) AS "associationSources", count(*) OVER()::int AS total
    FROM associations a JOIN socios.member_identities m ON m.id = a.member_id
    WHERE ${term ? sql`(m.member_number::text ILIKE ${`%${term}%`} OR m.credential_ref ILIKE ${`%${term}%`})` : sql`TRUE`}
    GROUP BY m.id, m.member_number, m.credential_ref, m.lifecycle_state
    ORDER BY m.member_number ASC, m.id ASC LIMIT ${paging.limit} OFFSET ${(paging.page - 1) * paging.limit}`,
  )
  return {
    state: 'ready',
    snapshotBatchId: status.snapshotBatchId!,
    items: result,
    total: result[0]?.total ?? 0,
    ...paging,
  }
}
