import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'

const databaseUrl = process.env['ATHLOS_TEST_DATABASE_URL']
let pool: Pool | undefined

beforeAll(async () => {
  if (!databaseUrl) return
  pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 })
  await pool.query('SELECT 1')
})

afterAll(async () => {
  await pool?.end()
})

describe('PostgreSQL payment idempotency index', () => {
  it('permits ON CONFLICT (idempotency_key) inference against the forward migration shape', async () => {
    if (!pool) return
    const table = `ctacte_idempotency_${randomUUID().replaceAll('-', '')}`
    await pool.query(`CREATE TEMPORARY TABLE ${table} (id uuid PRIMARY KEY, idempotency_key text)`)
    await pool.query(`CREATE UNIQUE INDEX ${table}_key_unique ON ${table} (idempotency_key)`)
    await pool.query(`INSERT INTO ${table} (id, idempotency_key) VALUES ($1, $2)`, [
      randomUUID(),
      'retry-key',
    ])
    const result = await pool.query(
      `INSERT INTO ${table} (id, idempotency_key) VALUES ($1, $2) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [randomUUID(), 'retry-key'],
    )
    expect(result.rowCount).toBe(0)
  })
})
