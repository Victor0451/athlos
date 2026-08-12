import { randomUUID } from 'node:crypto'
import { type SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '@athlos/db'
import { createClubStatusRepository } from './repository.ts'

const url = process.env.ATHLOS_TEST_DATABASE_URL
const schema = `club_status_${randomUUID().replaceAll('-', '')}`,
  q = `"${schema}"`
let pool: ReturnType<typeof createDb>['pool']
function db() {
  const dialect = new PgDialect()
  return {
    execute: (query: SQL) => {
      const x = dialect.sqlToQuery(query)
      return pool.query(
        x.sql.replaceAll('tesoreria.', `${q}.`).replaceAll('socios.', `${q}.`),
        x.params,
      )
    },
  }
}

describe('club status repository (PostgreSQL)', () => {
  beforeAll(async () => {
    if (!url) throw new Error('ATHLOS_TEST_DATABASE_URL is required')
    pool = createDb({ connectionString: url }).pool
    await pool.query(
      `CREATE SCHEMA ${q}; CREATE TABLE ${q}.ctacte (fecha date, debe numeric, haber numeric, anulado boolean); CREATE TABLE ${q}.socios (estado text);`,
    )
  })
  afterAll(async () => {
    if (pool) {
      try {
        await pool.query(`DROP SCHEMA IF EXISTS ${q} CASCADE`)
      } finally {
        await pool.end()
      }
    }
  })
  it('excludes annulled rows and preserves ledger signs', async () => {
    await pool.query(
      `INSERT INTO ${q}.ctacte VALUES ('2026-03-01', 10, 0, false), ('2026-03-02', 0, 4, false), ('2026-03-03', 99, 0, true)`,
    )
    await pool.query(`INSERT INTO ${q}.socios VALUES ('activo'), ('activo'), ('baja')`)
    const repository = createClubStatusRepository(db() as never)
    await expect(repository.finance({ from: '2026-03-01', until: '2026-04-01' })).resolves.toEqual({
      debits: '10.00',
      credits: '4.00',
      net: '6.00',
    })
    await expect(repository.activeMembership()).resolves.toBe(2)
  })
})
