import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createDb } from '@athlos/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { listAccountChart } from './repository.ts'

const url = process.env.ATHLOS_TEST_DATABASE_URL
let db: ReturnType<typeof createDb>

beforeAll(async () => {
  if (!url) throw new Error('ATHLOS_TEST_DATABASE_URL is required')
  db = createDb({ connectionString: url, poolMax: 2 })
  const migration = await readFile(
    join(import.meta.dirname, '../../../../../packages/db/drizzle/0066_plan_cuentas.sql'),
    'utf8',
  )
  await db.pool.query(migration)
  await db.pool.query(
    `INSERT INTO contabilidad.plan_cuentas (code,name,parent_code,root_code,active,imputable)
     VALUES ('2.9','Pasivo inactivo','2','2',false,false)`,
  )
})

afterAll(async () => {
  try {
    await db?.pool.query('DROP SCHEMA IF EXISTS contabilidad CASCADE')
  } finally {
    await db?.pool.end()
  }
})

describe('account-chart PostgreSQL repository', () => {
  it('filters code/name/root/group with stable hierarchy order and preserves Assets and Liabilities leaves', async () => {
    const assets = await listAccountChart(db.db, { root: '1' })
    const liabilities = await listAccountChart(db.db, { group: '2.1.1' })
    const cuotas = await listAccountChart(db.db, { name: 'CUOTAS SOCIALES' })
    const values = await listAccountChart(db.db, { code: '1.1.3.02' })

    expect(assets.slice(0, 4).map((account) => account.code)).toEqual([
      '1',
      '1.1',
      '1.1.1',
      '1.1.1.01',
    ])
    expect(assets.some((account) => account.imputable && account.active)).toBe(true)
    expect(liabilities.map((account) => account.code)).toEqual([
      '2.1.1',
      '2.1.1.01',
      '2.1.1.02',
      '2.1.1.03',
    ])
    expect(cuotas).toMatchObject([{ code: '4.1.01', name: 'Cuotas sociales' }])
    expect(values).toMatchObject([
      {
        parent: { code: '1.1.3', name: 'Créditos por Ventas' },
        root: { code: '1', name: 'Activo' },
        path: expect.arrayContaining([{ code: '1.1.3.02', name: 'Valores a Depositar' }]),
      },
    ])
  })

  it('supports explicit active states, no-match results, and literal wildcard search without escaping its hierarchy scope', async () => {
    expect(await listAccountChart(db.db, { active: false })).toMatchObject([
      { code: '2.9', active: false, imputable: false },
    ])
    expect(await listAccountChart(db.db, { name: 'CREDITOS POR VENTAS' })).toMatchObject([
      { code: '1.1.3', name: 'Créditos por Ventas' },
    ])
    expect(await listAccountChart(db.db, { name: 'no existe' })).toEqual([])
    expect(await listAccountChart(db.db, { name: '%_' })).toEqual([])
    expect(
      (await listAccountChart(db.db, { group: '4.1' })).map((account) => account.code),
    ).toEqual(['4.1', '4.1.01', '4.1.02', '4.1.03'])
  })
})
