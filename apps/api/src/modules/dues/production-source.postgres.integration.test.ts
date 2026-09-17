import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createDb } from '@athlos/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const url = process.env.ATHLOS_TEST_DATABASE_URL
const databaseName = `athlos_production_source_${randomUUID().replaceAll('-', '')}`
const databaseNamePattern = /^athlos_production_source_[0-9a-f]{32}$/
const sourcePath = [
  { code: '4', name: 'Ingresos' },
  { code: '4.1', name: 'Ingresos Operativos' },
  { code: '4.1.01', name: 'Cuotas sociales' },
]
let admin: ReturnType<typeof createDb>
let db: ReturnType<typeof createDb>
let shiftId: string
type SourceValues = [string, string, string, string, string, string, string]

const source = (settlementId: string = randomUUID()): SourceValues => [
  randomUUID(),
  shiftId,
  settlementId,
  'AUTOMATIC_DUES_PRODUCTION',
  '4.1.01',
  'Cuotas sociales',
  JSON.stringify(sourcePath),
]
const insertSource = async (values = source()) => {
  await db.pool.query(
    'INSERT INTO tesoreria.dues_settlements (id) VALUES ($1) ON CONFLICT DO NOTHING',
    [values[2]],
  )
  return db.pool.query(
    `INSERT INTO tesoreria.dues_cash_sources
      (id,shift_id,settlement_id,origin,account_code_snapshot,account_name_snapshot,account_path_snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    values,
  )
}
const countSources = () =>
  db.pool.query<{ count: number }>('SELECT count(*)::int AS count FROM tesoreria.dues_cash_sources')

beforeAll(async () => {
  if (!url) throw new Error('ATHLOS_TEST_DATABASE_URL is required')
  if (!databaseNamePattern.test(databaseName)) throw new Error('unsafe disposable database name')
  const adminUrl = new URL(url)
  adminUrl.pathname = '/postgres'
  const databaseUrl = new URL(url)
  databaseUrl.pathname = `/${databaseName}`
  admin = createDb({ connectionString: adminUrl.toString() })
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`)
  db = createDb({ connectionString: databaseUrl.toString() })
  shiftId = randomUUID()
  await db.pool.query(`
    CREATE EXTENSION pgcrypto;
    CREATE SCHEMA tesoreria;
    CREATE TABLE tesoreria.dues_cash_shifts (id uuid PRIMARY KEY);
    CREATE TABLE tesoreria.dues_settlements (id uuid PRIMARY KEY);
    INSERT INTO tesoreria.dues_cash_shifts VALUES ('${shiftId}');
  `)
  const migrations = await Promise.all(
    ['0066_plan_cuentas.sql', '0069_settlement_production_sources.sql'].map((file) =>
      readFile(join(import.meta.dirname, '../../../../../packages/db/drizzle', file), 'utf8'),
    ),
  )
  await db.pool.query(migrations.join('\n'))
})

afterAll(async () => {
  await db?.pool.end()
  try {
    await admin?.pool.query(`DROP DATABASE IF EXISTS "${databaseName}"`)
  } finally {
    await admin?.pool.end()
  }
})

describe('automatic dues production source persistence', () => {
  it('stores one immutable Cuotas sociales snapshot for a linked settlement and shift', async () => {
    const values = source()
    await expect(insertSource(values)).resolves.toMatchObject({ rowCount: 1 })
    await expect(
      db.pool.query(
        `SELECT shift_id,settlement_id,origin,account_code_snapshot,account_name_snapshot,account_path_snapshot
         FROM tesoreria.dues_cash_sources WHERE id=$1`,
        [values[0]],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          shift_id: shiftId,
          settlement_id: values[2],
          origin: 'AUTOMATIC_DUES_PRODUCTION',
          account_code_snapshot: '4.1.01',
          account_name_snapshot: 'Cuotas sociales',
          account_path_snapshot: sourcePath,
        },
      ],
    })
    await expect(insertSource(source(values[2] as string))).rejects.toMatchObject({ code: '23505' })
  })

  it('rejects an inactive, group, or unsupported production mapping', async () => {
    await db.pool.query(
      `UPDATE contabilidad.plan_cuentas SET imputable=false,active=false WHERE code='4.1.01'`,
    )
    await expect(insertSource()).rejects.toMatchObject({ code: '23514' })
    await db.pool.query(
      `UPDATE contabilidad.plan_cuentas SET imputable=true,active=true WHERE code='4.1.01'`,
    )
    await expect(
      insertSource([
        randomUUID(),
        shiftId,
        randomUUID(),
        'AUTOMATIC_DUES_PRODUCTION',
        '4.1',
        'Ingresos Operativos',
        JSON.stringify(sourcePath.slice(0, -1)),
      ]),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      insertSource([
        randomUUID(),
        shiftId,
        randomUUID(),
        'AUTOMATIC_DUES_PRODUCTION',
        '4.1.02',
        'Ventas de Mercaderías',
        JSON.stringify([
          ...sourcePath.slice(0, -1),
          { code: '4.1.02', name: 'Ventas de Mercaderías' },
        ]),
      ]),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('is append-only and rolls a failed source transaction back', async () => {
    const values = source()
    await insertSource(values)
    await expect(
      db.pool.query(
        `UPDATE tesoreria.dues_cash_sources SET account_name_snapshot='Otro' WHERE id=$1`,
        [values[0]],
      ),
    ).rejects.toMatchObject({ code: '55000' })
    await expect(
      db.pool.query(`DELETE FROM tesoreria.dues_cash_sources WHERE id=$1`, [values[0]]),
    ).rejects.toMatchObject({ code: '55000' })

    const client = await db.pool.connect()
    const before = (await countSources()).rows[0]!.count
    try {
      await client.query('BEGIN')
      const duplicate = randomUUID()
      await client.query(`INSERT INTO tesoreria.dues_settlements (id) VALUES ($1)`, [duplicate])
      await client.query(
        `INSERT INTO tesoreria.dues_cash_sources
          (id,shift_id,settlement_id,origin,account_code_snapshot,account_name_snapshot,account_path_snapshot)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        source(duplicate),
      )
      await expect(
        client.query(
          `INSERT INTO tesoreria.dues_cash_sources
            (id,shift_id,settlement_id,origin,account_code_snapshot,account_name_snapshot,account_path_snapshot)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
          source(duplicate),
        ),
      ).rejects.toMatchObject({ code: '23505' })
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
    await expect(countSources()).resolves.toMatchObject({ rows: [{ count: before }] })
  })
})
