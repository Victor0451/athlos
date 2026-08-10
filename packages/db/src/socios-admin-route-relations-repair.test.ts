import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ensurePgcrypto } from './pgcrypto.ts'

const migrationUrl = new URL(
  '../drizzle/0048_socios_admin_route_relations_repair.sql',
  import.meta.url,
)
const journalUrl = new URL('../drizzle/meta/_journal.json', import.meta.url)
const databaseUrl = process.env.ATHLOS_TEST_DATABASE_URL
const schema = `route_repair_${randomUUID().replaceAll('-', '')}`
const quotedSchema = `"${schema}"`
let pool: Pool | undefined

describe('0048 Socios admin route relation repair', () => {
  it('is discoverable and contains no data or ledger writes', async () => {
    const journal = JSON.parse(await readFile(journalUrl, 'utf8')) as {
      entries: Array<{ tag: string }>
    }
    const migration = await readFile(migrationUrl, 'utf8')

    expect(journal.entries.map((entry) => entry.tag)).toContain(
      '0048_socios_admin_route_relations_repair',
    )
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS socios.legacy_member_evidence')
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS socios.legacy_member_evidence_resolution_applications',
    )
    expect(migration).toContain('FROM pg_constraint c')
    expect(migration).toContain('FROM pg_class c')
    expect(migration).toContain('FROM pg_index i')
    expect(migration).not.toMatch(/INSERT\s+INTO\s+.*(?:drizzle|__drizzle_migrations)/is)
  })
})

describe.skipIf(!databaseUrl)('0048 PostgreSQL upgrade and idempotency', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 })
    await ensurePgcrypto(pool)
    await pool.query(`CREATE SCHEMA ${quotedSchema}`)
    await pool.query(`CREATE TABLE ${quotedSchema}.raw_events (id uuid PRIMARY KEY)`)
    await pool.query(`CREATE TABLE ${quotedSchema}.operators (id uuid PRIMARY KEY)`)
  })

  afterAll(async () => {
    await pool?.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`)
    await pool?.end()
  })

  it('creates every relation used by the two admin GET repositories and applies twice', async () => {
    if (!pool) throw new Error('PostgreSQL pool was not initialized')
    const migration = (await readFile(migrationUrl, 'utf8'))
      .replaceAll('socios.', `${quotedSchema}.`)
      .replaceAll('public.raw_events', `${quotedSchema}.raw_events`)
      .replaceAll('public.operators', `${quotedSchema}.operators`)

    await pool.query(migration)
    await pool.query(migration)

    const expected = [
      'member_identities',
      'legacy_identity_evidence',
      'legacy_membership_type_snapshots',
      'legacy_membership_type_source_rows',
      'legacy_membership_type_candidates',
      'legacy_catalog_materialization_receipts',
      'legacy_member_evidence',
      'evidence_closure_phase_receipts',
      'legacy_member_evidence_resolutions',
      'legacy_member_evidence_resolution_application_receipts',
      'legacy_member_evidence_resolution_applications',
    ]
    const result = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
      [schema],
    )
    expect(result.rows.map((row) => row.table_name)).toEqual(expect.arrayContaining(expected))
  })
})
