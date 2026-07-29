import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

const url = process.env.ATHLOS_TEST_DATABASE_URL
const schema = `membership_${randomUUID().replaceAll('-', '')}`
const q = `"${schema}"`
const catalogMigration = join(
  import.meta.dirname,
  '..',
  '..',
  'drizzle',
  '0038_socios_legacy_membership_evidence.sql',
)
const memberEvidenceMigration = join(
  import.meta.dirname,
  '..',
  '..',
  'drizzle',
  '0039_socios_legacy_member_evidence.sql',
)
const closurePhaseMigration = join(
  import.meta.dirname,
  '..',
  '..',
  'drizzle',
  '0043_socios_closure_phase_receipts.sql',
)
const resolutionMigration = join(
  import.meta.dirname,
  '..',
  '..',
  'drizzle',
  '0044_socios_member_evidence_resolutions.sql',
)
let pool: Pool

async function applyMigration(migration: string) {
  await pool.query(
    `SET search_path TO ${q}, public; ${readFileSync(migration, 'utf8')
      .replaceAll('socios.', `${q}.`)
      .replaceAll('public.raw_events', `${q}.raw_events`)
      .replaceAll('public.operators', `${q}.operators`)}`,
  )
}

async function migrateCatalog() {
  await pool.query(`CREATE TABLE IF NOT EXISTS ${q}.raw_events (id uuid PRIMARY KEY)`)
  await pool.query(`CREATE TABLE IF NOT EXISTS ${q}.operators (id uuid PRIMARY KEY)`)
  await pool.query(`CREATE TABLE IF NOT EXISTS ${q}.member_identities (id uuid PRIMARY KEY)`)
  await pool.query(`CREATE TABLE IF NOT EXISTS ${q}.legacy_identity_evidence (id uuid PRIMARY KEY)`)
  await applyMigration(catalogMigration)
}

async function migrateMemberEvidence() {
  await applyMigration(memberEvidenceMigration)
}

async function migrateResolutions() {
  await migrateMemberEvidence()
  await applyMigration(closurePhaseMigration)
  await applyMigration(resolutionMigration)
}

async function seed(batch: string, rows: Array<[number, string, string]>) {
  await pool.query(`INSERT INTO ${q}.legacy_membership_type_snapshots (batch_id) VALUES ($1)`, [
    batch,
  ])
  for (const [recordOrdinal, code, name] of rows) {
    const event = randomUUID()
    await pool.query(`INSERT INTO ${q}.raw_events VALUES ($1)`, [event])
    await pool.query(
      `INSERT INTO ${q}.legacy_membership_type_source_rows
        (raw_event_id, batch_id, record_ordinal, code, name, letter, content_hash)
       VALUES ($1, $2, $3, $4, $5, 'L', $6)`,
      [event, batch, recordOrdinal, code, name, `${batch}:${recordOrdinal}`],
    )
  }
}

async function project(batch: string) {
  await pool.query('BEGIN')
  try {
    await pool.query(
      `DELETE FROM ${q}.legacy_membership_type_candidates WHERE snapshot_batch_id = $1`,
      [batch],
    )
    await pool.query(
      `INSERT INTO ${q}.legacy_membership_type_candidates (snapshot_batch_id, code, source_row_id)
       SELECT $1, code, id FROM (
         SELECT id, code, row_number() OVER (PARTITION BY code ORDER BY record_ordinal DESC) AS rank
         FROM ${q}.legacy_membership_type_source_rows WHERE batch_id = $1
       ) rows WHERE rank = 1`,
      [batch],
    )
    await pool.query(
      `UPDATE ${q}.legacy_membership_type_snapshots SET state = 'applied', applied_at = now() WHERE batch_id = $1`,
      [batch],
    )
    await pool.query('COMMIT')
  } catch (error) {
    await pool.query('ROLLBACK')
    throw error
  }
}

beforeAll(async () => {
  if (!url) throw new Error('ATHLOS_TEST_DATABASE_URL is required')
  pool = new Pool({ connectionString: url })
  await pool.query(`CREATE SCHEMA ${q}; CREATE EXTENSION IF NOT EXISTS pgcrypto`)
})
afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${q} CASCADE`)
  await pool.end()
})
afterEach(() => pool.query(`DROP SCHEMA ${q} CASCADE; CREATE SCHEMA ${q}`))

describe('legacy membership catalog evidence', () => {
  it('retains duplicate occurrences and selects the greatest ordinal per code idempotently', async () => {
    await migrateCatalog()
    await migrateCatalog()
    const batch = randomUUID()
    await seed(batch, [
      [1, '4', 'First'],
      [2, '4', 'Last'],
      [3, '9', 'Other'],
    ])

    await project(batch)
    await project(batch)

    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS count FROM ${q}.legacy_membership_type_source_rows`,
        )
      ).rows,
    ).toEqual([{ count: 3 }])
    expect(
      (
        await pool.query(
          `SELECT c.code, r.name, r.record_ordinal FROM ${q}.legacy_membership_type_candidates c JOIN ${q}.legacy_membership_type_source_rows r ON r.id = c.source_row_id ORDER BY c.code`,
        )
      ).rows,
    ).toEqual([
      { code: '4', name: 'Last', record_ordinal: 2 },
      { code: '9', name: 'Other', record_ordinal: 3 },
    ])
  })

  it('keeps obsolete candidates historical while only the latest applied snapshot is selectable', async () => {
    await migrateCatalog()
    const first = randomUUID()
    const latest = randomUUID()
    await seed(first, [
      [1, '4', 'Old'],
      [2, '9', 'Obsolete'],
    ])
    await seed(latest, [[1, '4', 'New']])
    await project(first)
    await project(latest)

    expect(
      (
        await pool.query(
          `SELECT code FROM ${q}.legacy_membership_type_candidates WHERE snapshot_batch_id = $1 ORDER BY code`,
          [first],
        )
      ).rows,
    ).toEqual([{ code: '4' }, { code: '9' }])
    expect(
      (await pool.query(`SELECT code, name FROM ${q}.legacy_membership_type_selectable`)).rows,
    ).toEqual([{ code: '4', name: 'New' }])
  })

  it('rolls back a failed projection and re-applies retained source facts', async () => {
    await migrateCatalog()
    const batch = randomUUID()
    await seed(batch, [[1, '4', 'Retained']])
    await project(batch)
    await pool.query('BEGIN')
    await pool.query(
      `DELETE FROM ${q}.legacy_membership_type_candidates WHERE snapshot_batch_id = $1`,
      [batch],
    )
    await pool.query(
      `UPDATE ${q}.legacy_membership_type_snapshots SET state = 'rolled_back' WHERE batch_id = $1`,
      [batch],
    )
    await pool.query('COMMIT')
    await pool.query(
      `CREATE FUNCTION ${q}.reject_candidate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END $$; CREATE TRIGGER reject_candidate BEFORE INSERT ON ${q}.legacy_membership_type_candidates FOR EACH ROW EXECUTE FUNCTION ${q}.reject_candidate()`,
    )

    await expect(project(batch)).rejects.toThrow('test rollback')
    expect(
      (
        await pool.query(
          `SELECT state FROM ${q}.legacy_membership_type_snapshots WHERE batch_id = $1`,
          [batch],
        )
      ).rows,
    ).toEqual([{ state: 'rolled_back' }])
    await pool.query(`DROP TRIGGER reject_candidate ON ${q}.legacy_membership_type_candidates`)
    await project(batch)
    expect(
      (await pool.query(`SELECT code FROM ${q}.legacy_membership_type_selectable`)).rows,
    ).toEqual([{ code: '4' }])
  })

  it('stores reviewed member evidence with independent type, category, and fee facts', async () => {
    await migrateCatalog()
    await expect(pool.query(`SELECT * FROM ${q}.legacy_member_evidence`)).rejects.toThrow(
      'does not exist',
    )
    await migrateMemberEvidence()
    await migrateMemberEvidence()
    const batch = randomUUID()
    const rawEvent = randomUUID()
    const identityEvidence = randomUUID()
    const member = randomUUID()
    await seed(batch, [[1, '4', 'Type four']])
    await project(batch)
    const candidate = await pool.query<{ source_row_id: string }>(
      `SELECT source_row_id FROM ${q}.legacy_membership_type_candidates`,
    )
    await pool.query(`INSERT INTO ${q}.raw_events VALUES ($1)`, [rawEvent])
    await pool.query(`INSERT INTO ${q}.legacy_identity_evidence VALUES ($1)`, [identityEvidence])
    await pool.query(`INSERT INTO ${q}.member_identities VALUES ($1)`, [member])
    await pool.query(
      `INSERT INTO ${q}.legacy_member_evidence
       (raw_event_id, import_batch, identity_evidence_id, member_id, membership_type_candidate_source_row_id,
        legacy_type_code, legacy_category, fee_state, fee_value, review_state)
       VALUES ($1, $2, $3, $4, $5, '4', 'legacy-category', 'non_zero', 125.50, 'validated')`,
      [rawEvent, batch, identityEvidence, member, candidate.rows[0]?.source_row_id],
    )

    expect(
      (
        await pool.query(
          `SELECT legacy_type_code, legacy_category, fee_state, fee_value FROM ${q}.legacy_member_evidence`,
        )
      ).rows,
    ).toEqual([
      {
        legacy_type_code: '4',
        legacy_category: 'legacy-category',
        fee_state: 'non_zero',
        fee_value: '125.50',
      },
    ])
  })

  it('requires reviewed identity provenance and preserves blank, zero, and non-zero fee states', async () => {
    await migrateCatalog()
    await migrateMemberEvidence()
    const batch = randomUUID()
    await seed(batch, [[1, '4', 'Type four']])
    await project(batch)
    const identityEvidence = randomUUID()
    await pool.query(`INSERT INTO ${q}.legacy_identity_evidence VALUES ($1)`, [identityEvidence])

    await expect(
      (async () => {
        const rawEvent = randomUUID()
        await pool.query(`INSERT INTO ${q}.raw_events VALUES ($1)`, [rawEvent])
        return pool.query(
          `INSERT INTO ${q}.legacy_member_evidence
         (raw_event_id, import_batch, identity_evidence_id, legacy_type_code, fee_state, fee_value, review_state)
         VALUES ($1, $2, $3, '99', 'blank', 0, 'unknown_type')`,
          [rawEvent, batch, randomUUID()],
        )
      })(),
    ).rejects.toThrow()
    for (const [feeState, feeValue] of [
      ['blank', null],
      ['zero', 0],
      ['non_zero', 9.5],
    ]) {
      const rawEvent = randomUUID()
      await pool.query(`INSERT INTO ${q}.raw_events VALUES ($1)`, [rawEvent])
      await pool.query(
        `INSERT INTO ${q}.legacy_member_evidence
         (raw_event_id, import_batch, identity_evidence_id, legacy_type_code, fee_state, fee_value, review_state)
         VALUES ($1, $2, $3, '99', $4, $5, 'unknown_type')`,
        [rawEvent, batch, identityEvidence, feeState, feeValue],
      )
    }

    expect(
      (
        await pool.query(
          `SELECT fee_state, fee_value FROM ${q}.legacy_member_evidence ORDER BY fee_state`,
        )
      ).rows,
    ).toEqual([
      { fee_state: 'blank', fee_value: null },
      { fee_state: 'zero', fee_value: '0.00' },
      { fee_state: 'non_zero', fee_value: '9.50' },
    ])
  })

  it('keeps exception resolutions immutable, evidence-bound, and singly superseded', async () => {
    await migrateCatalog()
    await migrateResolutions()
    const batch = randomUUID()
    const rawEvent = randomUUID()
    const identityEvidence = randomUUID()
    const member = randomUUID()
    const operator = randomUUID()
    await seed(batch, [[1, '4', 'Type four']])
    await project(batch)
    const candidate = await pool.query<{ source_row_id: string }>(
      `SELECT source_row_id FROM ${q}.legacy_membership_type_candidates`,
    )
    await pool.query(`INSERT INTO ${q}.raw_events VALUES ($1)`, [rawEvent])
    await pool.query(`INSERT INTO ${q}.legacy_identity_evidence VALUES ($1)`, [identityEvidence])
    await pool.query(`INSERT INTO ${q}.member_identities VALUES ($1)`, [member])
    await pool.query(`INSERT INTO ${q}.operators VALUES ($1)`, [operator])
    const evidence = (
      await pool.query<{ id: string }>(
        `INSERT INTO ${q}.legacy_member_evidence
          (raw_event_id, import_batch, identity_evidence_id, legacy_type_code, fee_state, review_state)
         VALUES ($1, $2, $3, '99', 'blank', 'unknown_type') RETURNING id`,
        [rawEvent, batch, identityEvidence],
      )
    ).rows[0]!.id
    const fingerprint = 'a'.repeat(64)
    await expect(
      pool.query(
        `INSERT INTO ${q}.legacy_member_evidence_resolutions
          (legacy_member_evidence_id, resolution_kind, selected_member_id, steward_operator_id, reason, idempotency_key, evidence_fingerprint)
         VALUES ($1, 'unknown_type', $2, $3, 'reason', 'missing-type', $4)`,
        [evidence, member, operator, fingerprint],
      ),
    ).rejects.toThrow()
    await expect(
      pool.query(
        `INSERT INTO ${q}.legacy_member_evidence_resolutions
          (legacy_member_evidence_id, resolution_kind, selected_member_id, steward_operator_id, reason, idempotency_key, evidence_fingerprint)
         VALUES ($1, 'ambiguous_identity', $2, $3, 'reason', 'wrong-kind', $4)`,
        [evidence, member, operator, fingerprint],
      ),
    ).rejects.toThrow()
    const resolution = (
      await pool.query<{ id: string }>(
        `INSERT INTO ${q}.legacy_member_evidence_resolutions
          (legacy_member_evidence_id, resolution_kind, selected_member_id, selected_membership_type_candidate_source_row_id,
           steward_operator_id, reason, idempotency_key, evidence_fingerprint)
         VALUES ($1, 'unknown_type', $2, $3, $4, 'resolved from retained source', 'resolution-1', $5) RETURNING id`,
        [evidence, member, candidate.rows[0]!.source_row_id, operator, fingerprint],
      )
    ).rows[0]!.id
    await expect(
      pool.query(
        `INSERT INTO ${q}.legacy_member_evidence_resolutions
          (legacy_member_evidence_id, resolution_kind, selected_member_id, selected_membership_type_candidate_source_row_id,
           steward_operator_id, reason, idempotency_key, evidence_fingerprint)
         VALUES ($1, 'unknown_type', $2, $3, $4, 'competing root', 'root-conflict', $5)`,
        [evidence, member, candidate.rows[0]!.source_row_id, operator, fingerprint],
      ),
    ).rejects.toThrow()
    await expect(
      pool.query(`DELETE FROM ${q}.member_identities WHERE id = $1`, [member]),
    ).rejects.toThrow()
    await expect(
      pool.query(
        `UPDATE ${q}.legacy_member_evidence_resolutions SET reason = 'changed' WHERE id = $1`,
        [resolution],
      ),
    ).rejects.toThrow('append-only')
    await pool.query(
      `INSERT INTO ${q}.legacy_member_evidence_resolutions
        (legacy_member_evidence_id, resolution_kind, selected_member_id, selected_membership_type_candidate_source_row_id,
         steward_operator_id, reason, idempotency_key, evidence_fingerprint, supersedes_resolution_id)
       VALUES ($1, 'unknown_type', $2, $3, $4, 'corrected selection', 'resolution-2', $5, $6)`,
      [evidence, member, candidate.rows[0]!.source_row_id, operator, fingerprint, resolution],
    )
    const ambiguousRawEvent = randomUUID()
    await pool.query(`INSERT INTO ${q}.raw_events VALUES ($1)`, [ambiguousRawEvent])
    const ambiguousEvidence = (
      await pool.query<{ id: string }>(
        `INSERT INTO ${q}.legacy_member_evidence
          (raw_event_id, import_batch, identity_evidence_id, legacy_type_code, fee_state, review_state)
         VALUES ($1, $2, $3, '4', 'blank', 'ambiguous_identity') RETURNING id`,
        [ambiguousRawEvent, batch, identityEvidence],
      )
    ).rows[0]!.id
    await expect(
      pool.query(
        `INSERT INTO ${q}.legacy_member_evidence_resolutions
          (legacy_member_evidence_id, resolution_kind, selected_member_id, steward_operator_id, reason, idempotency_key, evidence_fingerprint)
         VALUES ($1, 'ambiguous_identity', $2, $3, 'duplicate caller key', 'resolution-2', $4)`,
        [ambiguousEvidence, member, operator, fingerprint],
      ),
    ).rejects.toThrow()
    await expect(
      pool.query(
        `INSERT INTO ${q}.legacy_member_evidence_resolutions
          (legacy_member_evidence_id, resolution_kind, selected_member_id, selected_membership_type_candidate_source_row_id,
           steward_operator_id, reason, idempotency_key, evidence_fingerprint, supersedes_resolution_id)
         VALUES ($1, 'unknown_type', $2, $3, $4, 'competing correction', 'resolution-3', $5, $6)`,
        [evidence, member, candidate.rows[0]!.source_row_id, operator, fingerprint, resolution],
      ),
    ).rejects.toThrow()
  })
})
