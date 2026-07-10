import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const databaseUrl = process.env['ATHLOS_TEST_DATABASE_URL']
let pool: Pool | undefined

beforeAll(async () => {
  if (!databaseUrl)
    throw new Error('ATHLOS_TEST_DATABASE_URL is required for PostgreSQL migration tests')
  pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 })
  await pool.query('SELECT 1')
})

beforeEach(async () => {
  if (!pool) return
  await pool.query('DROP SCHEMA IF EXISTS tesoreria CASCADE; CREATE SCHEMA tesoreria')
})

afterAll(async () => {
  await pool?.end()
})

describe('0033 ctacte comprobante retry migration', () => {
  it('repairs the prior draft shape and is safe to apply twice on PostgreSQL', async () => {
    if (!pool) throw new Error('PostgreSQL pool was not initialized')
    await pool.query('CREATE TABLE tesoreria.ctacte (id uuid PRIMARY KEY)')
    await pool.query(`
      CREATE TABLE tesoreria.ctacte_comprobante_retries (
        idempotency_key text PRIMARY KEY,
        status text NOT NULL,
        pdf_base64 text,
        sha256 text,
        byte_size integer,
        filename text,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`)
    const migration = await readFile(
      new URL('../drizzle/0033_ctacte_comprobante_retries.sql', import.meta.url),
      'utf8',
    )
    await pool.query(migration)
    await pool.query(migration)

    const columns = await pool.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'tesoreria' AND table_name = 'ctacte_comprobante_retries'
      ORDER BY column_name`)
    expect(columns.rows.map((row) => row.column_name)).toEqual(
      expect.arrayContaining([
        'lease_owner',
        'lease_expires_at',
        'attempt_count',
        'updated_at',
        'movement_count',
      ]),
    )
    const constraints = await pool.query<{ pg_get_constraintdef: string }>(`
      SELECT pg_get_constraintdef(oid) FROM pg_constraint
      WHERE conrelid = 'tesoreria.ctacte_comprobante_retries'::regclass AND contype = 'c'`)
    expect(constraints.rows.map((row) => row.pg_get_constraintdef).join(' ')).toMatch(
      /status.*rendering.*complete.*failed/i,
    )
    const indexes = await pool.query<{ indexname: string }>(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'tesoreria' AND tablename = 'ctacte_comprobante_retries'`)
    expect(indexes.rows.map((row) => row.indexname)).toContain(
      'ctacte_comprobante_retries_expires_at_idx',
    )
  })
})
