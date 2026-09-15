import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createDb } from '@athlos/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const url = process.env.ATHLOS_TEST_DATABASE_URL
let admin: ReturnType<typeof createDb>
let db: ReturnType<typeof createDb>
let operatorId: string
let shiftId: string
let closeId: string

const VALORES_PATH =
  '[{"code":"1","name":"Activo"},{"code":"1.1","name":"Activo Corriente"},{"code":"1.1.3","name":"Créditos por Ventas"},{"code":"1.1.3.02","name":"Valores a Depositar"}]'

beforeAll(async () => {
  if (!url) throw new Error('ATHLOS_TEST_DATABASE_URL is required')
  admin = createDb({ connectionString: new URL(url).toString(), poolMax: 2 })
  const dbName = `athlos_u8a_${randomUUID().replaceAll('-', '')}`
  await admin.pool.query(`CREATE DATABASE "${dbName}"`)
  const dbUrl = new URL(url)
  dbUrl.pathname = `/${dbName}`
  db = createDb({ connectionString: dbUrl.toString(), poolMax: 4 })
  operatorId = randomUUID()
  shiftId = randomUUID()
  closeId = randomUUID()
  const conn = await db.pool.connect()
  try {
    await conn.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE SCHEMA IF NOT EXISTS tesoreria;
      CREATE SCHEMA IF NOT EXISTS contabilidad;
      CREATE TABLE public.operators (id uuid PRIMARY KEY, role char(1) NOT NULL DEFAULT 'O');
      CREATE TABLE tesoreria.gastos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), fecha date NOT NULL DEFAULT CURRENT_DATE, importe text NOT NULL DEFAULT '0.00');
      CREATE TABLE tesoreria.dues_settlements (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL DEFAULT 'MONETARY');
      INSERT INTO public.operators VALUES ('${operatorId}','O');
    `)
    const directory = join(import.meta.dirname, '../../../../../packages/db/drizzle')
    for (const f of [
      '0054_dues_cash_closes.sql',
      '0055_cash_policy_atomicity.sql',
      '0056_cash_recovery_policy.sql',
      '0057_cash_lifecycle_boundaries.sql',
      '0066_plan_cuentas.sql',
      '0073_cash_close_transfers.sql',
    ]) {
      await conn.query(await readFile(join(directory, f), 'utf8'))
    }
    await conn.query(
      `INSERT INTO tesoreria.dues_cash_shifts (id,desk_id,assigned_operator_id,opening_tenders,operator_id,authorization_evidence,caller_key,request_fingerprint,business_date,opened_at) VALUES ('${shiftId}','u8a-fixture','${operatorId}','{}','${operatorId}','{}','shift-key','${'e'.repeat(64)}',CURRENT_DATE,NOW())`,
    )
    await conn.query(
      `INSERT INTO tesoreria.dues_cash_closes (id,shift_id,expected_tenders,counted_tenders,discrepancy,operator_id,authorization_evidence,caller_key,request_fingerprint) VALUES ('${closeId}','${shiftId}','{"CASH":25000}','{"CASH":25000}','{}','${operatorId}','{}','close-key','${'f'.repeat(64)}')`,
    )
  } finally {
    conn.release()
  }
})

afterAll(async () => {
  if (db) await db.pool.end()
  if (admin) await admin.pool.end()
})

function insertTransfer(overrides: Record<string, string | number | null> = {}) {
  const values: Record<string, string | number | null> = {
    close_id: closeId,
    shift_id: shiftId,
    account_code_snapshot: '1.1.3.02',
    account_name_snapshot: 'Valores a Depositar',
    account_path_snapshot: VALORES_PATH,
    amount: '250.00',
    ...overrides,
  }
  const keys = Object.keys(values)
  return db.pool.query(
    `INSERT INTO tesoreria.dues_cash_close_transfers (${keys.join(',')}) VALUES (${keys
      .map((_, index) => `$${index + 1}`)
      .join(',')}) RETURNING *`,
    keys.map((key) => values[key]),
  )
}

describe('U8-A close-transfer persistence', () => {
  it('persists one positive immutable transfer per close and shift', async () => {
    const saved = await insertTransfer()
    expect(saved.rows[0].amount).toBe('250.00')
    expect(saved.rows[0].account_code_snapshot).toBe('1.1.3.02')
    expect(saved.rows[0].account_path_snapshot).toEqual(JSON.parse(VALORES_PATH))
    await expect(insertTransfer()).rejects.toMatchObject({ code: '23505' })
  })

  it('pins the account snapshot to the active Valores a Depositar catalog leaf', async () => {
    const other = randomUUID()
    await db.pool.query(
      `INSERT INTO tesoreria.dues_cash_shifts (id,desk_id,assigned_operator_id,opening_tenders,operator_id,authorization_evidence,caller_key,request_fingerprint,business_date,opened_at) VALUES ($1,'u8a-fixture',$2,'{}',$2,'{}','shift-key-2',$3,CURRENT_DATE,NOW())`,
      [other, operatorId, 'f'.repeat(64)],
    )
    const close2 = randomUUID()
    await db.pool.query(
      `INSERT INTO tesoreria.dues_cash_closes (id,shift_id,expected_tenders,counted_tenders,discrepancy,operator_id,authorization_evidence,caller_key,request_fingerprint) VALUES ($1,$2,'{}','{}','{}',$3,'{}','close-key-2',$4)`,
      [close2, other, operatorId, 'f'.repeat(64)],
    )
    for (const overrides of [
      { account_code_snapshot: '4.1.01', account_name_snapshot: 'Cuotas sociales' },
      { account_name_snapshot: 'Otra cuenta' },
      { account_path_snapshot: '[]' },
    ])
      await expect(
        insertTransfer({ close_id: close2, shift_id: other, ...overrides }),
      ).rejects.toMatchObject({ code: '23514' })
    const valid = await insertTransfer({ close_id: close2, shift_id: other })
    expect(valid.rows[0].id).toBeTruthy()
  })

  it('rejects non-positive amounts and mismatched close/shift correlation', async () => {
    await expect(insertTransfer({ amount: '0.00' })).rejects.toMatchObject({ code: '23514' })
    await expect(insertTransfer({ amount: '-250.00' })).rejects.toMatchObject({ code: '23514' })
    const otherShift = randomUUID()
    await db.pool.query(
      `INSERT INTO tesoreria.dues_cash_shifts (id,desk_id,assigned_operator_id,opening_tenders,operator_id,authorization_evidence,caller_key,request_fingerprint,business_date,opened_at) VALUES ($1,'u8a-fixture',$2,'{}',$2,'{}','shift-key-3',$3,CURRENT_DATE,NOW())`,
      [otherShift, operatorId, 'f'.repeat(64)],
    )
    // The close belongs to shiftId, so referencing another real shift must fail correlation.
    await expect(insertTransfer({ shift_id: otherShift })).rejects.toMatchObject({ code: '23514' })
  })

  it('requires an authoritative close and is append-only', async () => {
    await expect(insertTransfer({ close_id: randomUUID() })).rejects.toMatchObject({
      code: '23503',
    })
    const existing = await db.pool.query(
      `SELECT id FROM tesoreria.dues_cash_close_transfers WHERE close_id=$1`,
      [closeId],
    )
    const id = existing.rows[0].id
    await expect(
      db.pool.query(`UPDATE tesoreria.dues_cash_close_transfers SET amount='1.00' WHERE id=$1`, [
        id,
      ]),
    ).rejects.toMatchObject({ code: '55000' })
    await expect(
      db.pool.query(`DELETE FROM tesoreria.dues_cash_close_transfers WHERE id=$1`, [id]),
    ).rejects.toMatchObject({ code: '55000' })
  })
})
