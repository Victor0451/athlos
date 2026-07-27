import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

const url = process.env.ATHLOS_TEST_DATABASE_URL
const schema = `membership_${randomUUID().replaceAll('-', '')}`
const q = `"${schema}"`
const migration = join(
  import.meta.dirname,
  '..',
  '..',
  'drizzle',
  '0038_socios_legacy_membership_evidence.sql',
)
let pool: Pool

async function migrate() {
  await pool.query(`CREATE TABLE IF NOT EXISTS ${q}.raw_events (id uuid PRIMARY KEY)`)
  await pool.query(
    `SET search_path TO ${q}, public; ${readFileSync(migration, 'utf8')
      .replaceAll('socios.', `${q}.`)
      .replaceAll('public.raw_events', `${q}.raw_events`)}`,
  )
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
    await migrate()
    await migrate()
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
    await migrate()
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
    await migrate()
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
})
