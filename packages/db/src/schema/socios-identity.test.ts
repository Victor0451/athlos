import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ensurePgcrypto } from '../pgcrypto.ts'

const url = process.env.ATHLOS_TEST_DATABASE_URL
const schema = `identity_${randomUUID().replaceAll('-', '')}`
const q = `"${schema}"`
const migration = join(
  import.meta.dirname,
  '..',
  '..',
  'drizzle',
  '0037_socios_legacy_identity.sql',
)
let pool: Pool

const migrate = () =>
  pool.query(`CREATE TABLE IF NOT EXISTS ${q}.raw_events (id uuid PRIMARY KEY, source_key text NOT NULL, import_batch uuid NOT NULL);
SET search_path TO ${q}, public;
${readFileSync(migration, 'utf8').replaceAll('socios.', `${q}.`).replaceAll('public.raw_events', `${q}.raw_events`)}`)
const count = (table: string) => pool.query(`SELECT count(*)::int AS count FROM ${q}.${table}`)

beforeAll(async () => {
  if (!url) throw new Error('ATHLOS_TEST_DATABASE_URL is required')
  pool = new Pool({ connectionString: url })
  await ensurePgcrypto(pool)
  await pool.query(`CREATE SCHEMA ${q}`)
})
afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${q} CASCADE`)
  await pool.end()
})
afterEach(() => pool.query(`DROP SCHEMA ${q} CASCADE; CREATE SCHEMA ${q}`))

describe('0037 socios legacy identity', () => {
  it('assigns independent UUID-backed numbers atomically', async () => {
    await migrate()
    const rows = await Promise.all(
      Array.from({ length: 2 }, () =>
        pool.query(`WITH account AS (INSERT INTO ${q}.membership_accounts (lifecycle_state)
          VALUES ('review_required') RETURNING id, account_number), member AS
          (INSERT INTO ${q}.member_identities (lifecycle_state) VALUES ('review_required')
          RETURNING id, member_number) SELECT account.id AS account_id, account_number, member.id AS member_id, member_number FROM account CROSS JOIN member`),
      ),
    )
    expect(new Set(rows.map((row) => row.rows[0].account_number)).size).toBe(2)
    expect(new Set(rows.map((row) => row.rows[0].member_number)).size).toBe(2)
    expect(rows.every((row) => row.rows[0].account_id && row.rows[0].member_id)).toBe(true)
  })

  it('enforces one effective holder and preserves history after a collision', async () => {
    await migrate()
    const account = (
      await pool.query(
        `INSERT INTO ${q}.membership_accounts (lifecycle_state) VALUES ('review_required') RETURNING id`,
      )
    ).rows[0].id
    const members = await Promise.all(
      Array.from({ length: 3 }, () =>
        pool.query(
          `INSERT INTO ${q}.member_identities (lifecycle_state) VALUES ('validated') RETURNING id`,
        ),
      ),
    )
    const memberships = await Promise.all(
      members.map(({ rows }) =>
        pool.query(
          `INSERT INTO ${q}.account_memberships (account_id, member_id) VALUES ($1, $2) RETURNING id`,
          [account, rows[0].id],
        ),
      ),
    )
    await pool.query(
      `INSERT INTO ${q}.account_holder_history (account_id, membership_id, source) VALUES ($1, $2, 'test')`,
      [account, memberships[0]!.rows[0].id],
    )
    await pool.query(
      `UPDATE ${q}.membership_accounts SET lifecycle_state = 'validated' WHERE id = $1`,
      [account],
    )
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `UPDATE ${q}.account_holder_history SET effective_to = now() WHERE account_id = $1`,
        [account],
      )
      await client.query(
        `INSERT INTO ${q}.account_holder_history (account_id, membership_id, predecessor_id, source) VALUES ($1, $2, (SELECT id FROM ${q}.account_holder_history WHERE account_id = $1), 'transfer')`,
        [account, memberships[1]!.rows[0].id],
      )
      await client.query('COMMIT')
    } finally {
      client.release()
    }
    await expect(
      pool.query(
        `INSERT INTO ${q}.account_holder_history (account_id, membership_id, source) VALUES ($1, $2, 'test')`,
        [account, memberships[2]!.rows[0].id],
      ),
    ).rejects.toMatchObject({ code: '23P01' })
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS count FROM ${q}.account_holder_history WHERE effective_to IS NULL`,
        )
      ).rows,
    ).toEqual([{ count: 1 }])
  })

  it('allows only one concurrent current holder for a validated account', async () => {
    await migrate()
    const account = (
      await pool.query(
        `INSERT INTO ${q}.membership_accounts (lifecycle_state) VALUES ('review_required') RETURNING id`,
      )
    ).rows[0].id
    const members = await Promise.all(
      Array.from({ length: 2 }, () =>
        pool.query(
          `INSERT INTO ${q}.member_identities (lifecycle_state) VALUES ('validated') RETURNING id`,
        ),
      ),
    )
    const memberships = await Promise.all(
      members.map(({ rows }) =>
        pool.query(
          `INSERT INTO ${q}.account_memberships (account_id, member_id) VALUES ($1, $2) RETURNING id`,
          [account, rows[0].id],
        ),
      ),
    )
    await pool.query('SET session_replication_role = replica')
    await pool.query(
      `UPDATE ${q}.membership_accounts SET lifecycle_state = 'validated' WHERE id = $1`,
      [account],
    )
    await pool.query('SET session_replication_role = origin')
    const first = await pool.connect()
    const second = await pool.connect()
    try {
      await Promise.all([first.query('BEGIN'), second.query('BEGIN')])
      await first.query(
        `INSERT INTO ${q}.account_holder_history (account_id, membership_id, source) VALUES ($1, $2, 'first')`,
        [account, memberships[0]!.rows[0].id],
      )
      const secondInsert = second.query(
        `INSERT INTO ${q}.account_holder_history (account_id, membership_id, source) VALUES ($1, $2, 'second')`,
        [account, memberships[1]!.rows[0].id],
      )
      expect(
        await Promise.race([
          secondInsert.then(() => 'resolved'),
          new Promise((resolve) => setTimeout(() => resolve('blocked'), 50)),
        ]),
      ).toBe('blocked')
      await first.query('COMMIT')
      await expect(secondInsert).rejects.toMatchObject({ code: '23505' })
    } finally {
      await Promise.all([
        first.query('ROLLBACK').catch(() => undefined),
        second.query('ROLLBACK').catch(() => undefined),
      ])
      first.release()
      second.release()
    }
  })

  it('keeps raw evidence idempotent and ambiguous pairs separate for review', async () => {
    await migrate()
    const batch = randomUUID()
    const ids = [randomUUID(), randomUUID(), randomUUID()]
    await pool.query(
      `INSERT INTO ${q}.raw_events VALUES ($1, 'one', $4), ($2, 'two', $4), ($3, 'three', $4)`,
      [...ids, batch],
    )
    await pool.query(`INSERT INTO ${q}.legacy_identity_evidence (raw_event_id, source_key, import_batch, soccarnet, socfamilia, review_state)
      SELECT id, source_key, import_batch, '12', '9', CASE WHEN source_key = 'one' THEN 'imported' ELSE 'review_required' END FROM ${q}.raw_events`)
    await expect(
      pool.query(
        `INSERT INTO ${q}.legacy_identity_evidence (raw_event_id, source_key, import_batch, review_state) SELECT id, source_key, import_batch, 'imported' FROM ${q}.raw_events WHERE source_key = 'one'`,
      ),
    ).rejects.toMatchObject({ code: '23505' })
    expect(
      (
        await pool.query(
          `SELECT review_state FROM ${q}.legacy_identity_evidence ORDER BY source_key`,
        )
      ).rows,
    ).toEqual([
      { review_state: 'imported' },
      { review_state: 'review_required' },
      { review_state: 'review_required' },
    ])
  })

  it('reapplies safely and rolls back an invalid aggregate write and its audit history', async () => {
    await pool.query(
      `CREATE TABLE ${q}.socios (id uuid PRIMARY KEY); CREATE TABLE ${q}.ctacte (socio_id uuid REFERENCES ${q}.socios(id))`,
    )
    await migrate()
    await migrate()
    const socio = randomUUID()
    await pool.query(`INSERT INTO ${q}.socios VALUES ($1)`, [socio])
    await pool.query(`INSERT INTO ${q}.ctacte VALUES ($1)`, [socio])
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const account = (
        await client.query(
          `INSERT INTO ${q}.membership_accounts (lifecycle_state) VALUES ('review_required') RETURNING id`,
        )
      ).rows[0].id
      const member = (
        await client.query(
          `INSERT INTO ${q}.member_identities (lifecycle_state) VALUES ('review_required') RETURNING id`,
        )
      ).rows[0].id
      const membership = (
        await client.query(
          `INSERT INTO ${q}.account_memberships (account_id, member_id) VALUES ($1, $2) RETURNING id`,
          [account, member],
        )
      ).rows[0].id
      await client.query(
        `INSERT INTO ${q}.account_holder_history (account_id, membership_id, source) VALUES ($1, $2, 'audit')`,
        [account, membership],
      )
      await expect(
        client.query(
          `INSERT INTO ${q}.account_holder_history (account_id, membership_id, source) VALUES ($1, $2, 'duplicate')`,
          [account, membership],
        ),
      ).rejects.toMatchObject({ code: '23P01' })
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }
    await expect(
      Promise.all(
        [
          'membership_accounts',
          'member_identities',
          'account_memberships',
          'account_holder_history',
        ].map(count),
      ),
    ).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ rows: [{ count: 0 }] })]))
  })
})
