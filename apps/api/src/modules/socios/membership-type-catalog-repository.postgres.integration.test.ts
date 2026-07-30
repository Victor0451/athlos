import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { createDb } from '@athlos/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  getCurrentMembershipType,
  listAssociatedMembers,
  listMembershipTypeCatalog,
} from './membership-type-catalog-repository.ts'

const url = process.env.ATHLOS_TEST_DATABASE_URL
const schema = `membership_catalog_${randomUUID().replaceAll('-', '')}`
const q = `"${schema}"`
const migrations = ['0037', '0038', '0039', '0040', '0043', '0044', '0045', '0046']
let pool: ReturnType<typeof createDb>['pool']

function migratedSql(prefix: string) {
  const directory = join(
    import.meta.dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    'packages',
    'db',
    'drizzle',
  )
  const name = {
    '0037': '0037_socios_legacy_identity.sql',
    '0038': '0038_socios_legacy_membership_evidence.sql',
    '0039': '0039_socios_legacy_member_evidence.sql',
    '0040': '0040_socios_closure_receipts.sql',
    '0043': '0043_socios_closure_phase_receipts.sql',
    '0044': '0044_socios_member_evidence_resolutions.sql',
    '0045': '0045_socios_member_evidence_resolution_applications.sql',
    '0046': '0046_socios_resolution_application_reconciliation.sql',
  }[prefix]!
  return readFileSync(join(directory, name), 'utf8')
    .replaceAll('socios.', `${q}.`)
    .replaceAll('public.raw_events', `${q}.raw_events`)
    .replaceAll('public.operators', `${q}.operators`)
}

function repository() {
  const dialect = new PgDialect()
  return {
    execute: (query: SQL) => {
      const compiled = dialect.sqlToQuery(query)
      return pool.query(
        compiled.sql.replaceAll('"socios".', `${q}.`).replaceAll('socios.', `${q}.`),
        compiled.params,
      )
    },
  }
}

async function event() {
  const id = randomUUID()
  await pool.query(`INSERT INTO ${q}.raw_events VALUES ($1)`, [id])
  return id
}

async function evidence(input: {
  batch: string
  member?: string
  type?: string
  state: 'validated' | 'unknown_type'
}) {
  const identity = randomUUID()
  const rawIdentity = await event()
  const rawMember = await event()
  await pool.query(
    `INSERT INTO ${q}.legacy_identity_evidence
       (id, raw_event_id, source_key, import_batch, member_id, review_state)
     VALUES ($1, $2, 'fixture', $3, $4, 'validated')`,
    [identity, rawIdentity, input.batch, input.member ?? null],
  )
  const id = randomUUID()
  await pool.query(
    `INSERT INTO ${q}.legacy_member_evidence
       (id, raw_event_id, import_batch, identity_evidence_id, member_id,
        membership_type_candidate_source_row_id, legacy_type_code, fee_state, fee_value, review_state)
     VALUES ($1, $2, $3, $4, $5, $6, 'A', 'zero', 0, $7)`,
    [id, rawMember, input.batch, identity, input.member ?? null, input.type ?? null, input.state],
  )
  return id
}

async function resolution(evidenceId: string, member: string, type: string, supersedes?: string) {
  const id = randomUUID()
  await pool.query(
    `INSERT INTO ${q}.legacy_member_evidence_resolutions
       (id, legacy_member_evidence_id, resolution_kind, selected_member_id,
        selected_membership_type_candidate_source_row_id, steward_operator_id, reason,
        idempotency_key, evidence_fingerprint, supersedes_resolution_id)
     VALUES ($1, $2, 'unknown_type', $3, $4, $5, 'fixture', $6, $7, $8)`,
    [id, evidenceId, member, type, operator, randomUUID(), 'f'.repeat(64), supersedes ?? null],
  )
  return id
}

async function application(
  execution: string,
  batch: string,
  entries: Array<[string, string, string, string]>,
) {
  await pool.query(
    `INSERT INTO ${q}.legacy_member_evidence_resolution_application_receipts
       (execution_identity, selected_batch_id, application_fingerprint, eligible_count, applied_count,
        unresolved_count, stale_count, technical_count, unresolved_unknown_type_count,
        unresolved_ambiguous_identity_count)
     VALUES ($1, $2, $3, $4, $4, 0, 0, 0, 0, 0)`,
    [execution, batch, 'a'.repeat(64), entries.length],
  )
  for (const [evidenceId, resolutionId, member, type] of entries)
    await pool.query(
      `INSERT INTO ${q}.legacy_member_evidence_resolution_applications
         (execution_identity, legacy_member_evidence_id, resolution_id, member_id,
          membership_type_candidate_source_row_id, application_fingerprint)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [execution, evidenceId, resolutionId, member, type, 'a'.repeat(64)],
    )
}

let operator: string

describe('membership type catalog repository (PostgreSQL)', () => {
  beforeAll(async () => {
    if (!url) throw new Error('ATHLOS_TEST_DATABASE_URL is required')
    pool = createDb({ connectionString: url }).pool
    await pool.query(`CREATE SCHEMA ${q}; CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE TABLE ${q}.raw_events (id uuid PRIMARY KEY);
      CREATE TABLE ${q}.operators (id uuid PRIMARY KEY);`)
    for (const prefix of migrations) await pool.query(migratedSql(prefix))
    operator = randomUUID()
    await pool.query(`INSERT INTO ${q}.operators VALUES ($1)`, [operator])
  })

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${q} CASCADE`)
    await pool.end()
  })

  it('uses only the committed current catalog and latest Socios closure batch', async () => {
    const oldBatch = randomUUID()
    const currentBatch = randomUUID()
    const unmaterializedBatch = randomUUID()
    const oldSocios = randomUUID()
    const currentSocios = randomUUID()
    const oldRow = randomUUID()
    const typeA = randomUUID()
    const typeB = randomUUID()
    await pool.query(
      `INSERT INTO ${q}.legacy_membership_type_snapshots (batch_id, state) VALUES
       ($1, 'applied'), ($2, 'applied'), ($3, 'applied')`,
      [oldBatch, currentBatch, unmaterializedBatch],
    )
    await pool.query(
      `INSERT INTO ${q}.legacy_catalog_materialization_receipts
       (batch_id, input_hash, eligible_source_row_count, materialized_source_row_count)
       VALUES ($1, $2, 2, 2)`,
      [currentBatch, 'c'.repeat(64)],
    )
    await expect(
      listMembershipTypeCatalog(repository() as never, { page: 1, limit: 10 }),
    ).resolves.toMatchObject({ state: 'no_current_catalog', items: [] })
    await pool.query(
      `UPDATE ${q}.legacy_membership_type_snapshots SET state = 'rolled_back' WHERE batch_id = $1`,
      [unmaterializedBatch],
    )
    for (const [row, batch, code, name, letter, ordinal] of [
      [oldRow, oldBatch, 'OLD', 'Historical', 'H', 1],
      [typeA, currentBatch, 'A', 'Activo', 'A', 1],
      [typeB, currentBatch, 'B', 'Becado', 'B', 2],
    ] as const) {
      await pool.query(
        `INSERT INTO ${q}.legacy_membership_type_source_rows
         (id, raw_event_id, batch_id, record_ordinal, code, name, letter, content_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [row, await event(), batch, ordinal, code, name, letter, 'd'.repeat(64)],
      )
      await pool.query(
        `INSERT INTO ${q}.legacy_membership_type_candidates (snapshot_batch_id, code, source_row_id)
         VALUES ($1, $2, $3)`,
        [batch, code, row],
      )
    }
    await pool.query(
      `INSERT INTO ${q}.evidence_closure_phase_receipts
       (execution_identity, phase, selected_batch_id, fingerprint, eligible_count, projected_count,
        exception_count, committed_at)
       VALUES ('old', 'members', $1, 'old', 0, 0, 0, now() - interval '1 hour'),
              ('current', 'members', $2, 'current', 0, 0, 0, now())`,
      [oldSocios, currentSocios],
    )
    const members: string[] = []
    for (let index = 0; index < 6; index++) {
      const id = randomUUID()
      await pool.query(
        `INSERT INTO ${q}.member_identities (id, lifecycle_state, credential_ref)
         VALUES ($1, 'validated', $2)`,
        [id, `card-${index + 1}`],
      )
      members.push(id)
    }
    const validated = await evidence({
      batch: currentSocios,
      member: members[0]!,
      type: typeA,
      state: 'validated',
    })
    await evidence({
      batch: currentSocios,
      member: members[1]!,
      type: typeA,
      state: 'validated',
    })
    const overlap = await evidence({ batch: currentSocios, state: 'unknown_type' })
    const resolved = await evidence({ batch: currentSocios, state: 'unknown_type' })
    const pending = await evidence({ batch: currentSocios, state: 'unknown_type' })
    const stale = await evidence({ batch: currentSocios, state: 'unknown_type' })
    const crossBatch = await evidence({ batch: oldSocios, state: 'unknown_type' })
    await evidence({ batch: currentSocios, state: 'unknown_type' })
    const resolvedId = await resolution(resolved, members[2]!, typeA)
    const overlapId = await resolution(overlap, members[1]!, typeA)
    await resolution(pending, members[3]!, typeA)
    const staleId = await resolution(stale, members[3]!, typeA)
    await resolution(stale, members[3]!, typeA, staleId)
    const crossBatchId = await resolution(crossBatch, members[4]!, typeA)
    await application('current-1', currentSocios, [
      [resolved, resolvedId, members[2]!, typeA],
      [overlap, overlapId, members[1]!, typeA],
      [stale, staleId, members[3]!, typeA],
    ])
    await application('current-2', currentSocios, [[resolved, resolvedId, members[2]!, typeA]])
    await application('cross-batch', oldSocios, [[crossBatch, crossBatchId, members[4]!, typeA]])

    const db = repository()
    await expect(
      listMembershipTypeCatalog(db as never, { page: 1, limit: 1, search: 'a' }),
    ).resolves.toMatchObject({
      state: 'ready',
      snapshotBatchId: currentBatch,
      total: 2,
      items: [{ code: 'A', validatedCount: 2, resolvedCount: 2, distinctMemberCount: 3 }],
    })
    await expect(
      listMembershipTypeCatalog(db as never, { page: 2, limit: 1 }),
    ).resolves.toMatchObject({ items: [{ code: 'B' }], total: 2 })
    await expect(
      listAssociatedMembers(db as never, typeA, { page: 1, limit: 2, search: 'card' }),
    ).resolves.toMatchObject({
      total: 3,
      items: [
        { memberId: members[0], associationSources: ['validated'] },
        { memberId: members[1], associationSources: ['resolved', 'validated'] },
      ],
    })
    await expect(
      listAssociatedMembers(db as never, typeA, { page: 2, limit: 2 }),
    ).resolves.toMatchObject({
      total: 3,
      items: [{ memberId: members[2], associationSources: ['resolved'] }],
    })
    await expect(getCurrentMembershipType(db as never, oldRow)).resolves.toEqual({
      state: 'source_row_not_current',
      item: null,
    })
    expect(validated).toBeTruthy()
  })
})
