import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const url = process.env['ATHLOS_TEST_DATABASE_URL']
const drizzleDir = join(import.meta.dirname, '..', 'drizzle')
const migration = '0035_ctacte_comprobante_failure_reason.sql'
let pool: Pool

beforeAll(async () => {
  if (!url) throw new Error('ATHLOS_TEST_DATABASE_URL is required')
  pool = new Pool({ connectionString: url, connectionTimeoutMillis: 5_000 })
  await pool.query(`DROP SCHEMA IF EXISTS tesoreria CASCADE; CREATE SCHEMA tesoreria;
    CREATE TABLE tesoreria.ctacte_comprobante_retries (
      idempotency_key text PRIMARY KEY, status text NOT NULL,
      request_fingerprint text NOT NULL, expires_at timestamptz NOT NULL)`)
  await pool.query(`INSERT INTO tesoreria.ctacte_comprobante_retries VALUES
    ('rendering', 'rendering', 'same', now()),
    ('complete', 'complete', 'same', now()),
    ('failed', 'failed', 'same', now())`)
})
afterAll(async () => pool?.end())

describe('0035 comprobante failure reason', () => {
  it('is ordered after 0034 and applies twice without reclassifying existing rows', async () => {
    const ordered = readdirSync(drizzleDir)
      .filter((name) => /^003[1-5]_/.test(name))
      .sort()
      .map((name) => name.slice(0, 4))
    expect(ordered).toEqual(['0031', '0032', '0033', '0034', '0035'])

    const sql = readFileSync(join(drizzleDir, migration), 'utf8')
    await pool.query(sql)
    await pool.query(sql)
    const column = await pool.query<{
      data_type: string
      is_nullable: string
      column_default: string | null
    }>(
      `SELECT data_type, is_nullable, column_default FROM information_schema.columns
       WHERE table_schema = 'tesoreria' AND table_name = 'ctacte_comprobante_retries'
         AND column_name = 'failure_reason'`,
    )
    expect(column.rows).toEqual([{ data_type: 'text', is_nullable: 'YES', column_default: null }])
    const rows = await pool.query(`SELECT idempotency_key FROM tesoreria.ctacte_comprobante_retries
      WHERE failure_reason IS NOT NULL`)
    expect(rows.rowCount).toBe(0)
  })

  it('defaults new rows to null and rejects unsupported reasons through the named check', async () => {
    await pool.query(`INSERT INTO tesoreria.ctacte_comprobante_retries
      (idempotency_key, status, request_fingerprint, expires_at) VALUES ('new', 'failed', 'same', now())`)
    const value = await pool.query(`SELECT failure_reason FROM tesoreria.ctacte_comprobante_retries
      WHERE idempotency_key = 'new'`)
    expect(value.rows).toEqual([{ failure_reason: null }])
    const check = await pool.query(`SELECT convalidated FROM pg_constraint
      WHERE conname = 'ctacte_comprobante_retries_failure_reason_check'
        AND conrelid = 'tesoreria.ctacte_comprobante_retries'::regclass`)
    expect(check.rows).toEqual([{ convalidated: true }])
    await expect(
      pool.query(`UPDATE tesoreria.ctacte_comprobante_retries
      SET failure_reason = 'OTHER' WHERE idempotency_key = 'new'`),
    ).rejects.toMatchObject({
      code: '23514',
    })
  })
})
