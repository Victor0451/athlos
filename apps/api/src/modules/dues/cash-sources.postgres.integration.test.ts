import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createDb } from '@athlos/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const url = process.env.ATHLOS_TEST_DATABASE_URL
const databaseName = `athlos_manual_source_${randomUUID().replaceAll('-', '')}`
const accountPath = [
  { code: '1', name: 'Activo' },
  { code: '1.1', name: 'Activo Corriente' },
  { code: '1.1.1', name: 'Caja y Bancos' },
  { code: '1.1.1.01', name: 'Caja (Pesos)' },
]
let admin: ReturnType<typeof createDb>
let db: ReturnType<typeof createDb>
let operatorId: string
let shiftId: string

const insertTender = async (overrides: Record<string, unknown> = {}) => {
  const values = {
    id: randomUUID(),
    shiftId,
    direction: 'INCOME',
    tender: 'CASH',
    amount: '12.50',
    sourceType: 'MANUAL',
    sourceId: null,
    operatorId,
    callerKey: randomUUID(),
    fingerprint: 'a'.repeat(64),
    ...overrides,
  }
  if (values.sourceType === 'SETTLEMENT' && values.sourceId) {
    await db.pool.query(`INSERT INTO tesoreria.dues_settlements (id) VALUES ($1)`, [
      values.sourceId,
    ])
  }
  return db.pool.query(
    `INSERT INTO tesoreria.dues_cash_tenders
      (id,shift_id,direction,tender,amount,source_type,source_id,operator_id,caller_key,request_fingerprint,reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Manual fixture') RETURNING id`,
    [
      values.id,
      values.shiftId,
      values.direction,
      values.tender,
      values.amount,
      values.sourceType,
      values.sourceId,
      values.operatorId,
      values.callerKey,
      values.fingerprint,
    ],
  )
}
const insertSource = (tenderId: string, overrides: Record<string, unknown> = {}) => {
  const values = {
    id: randomUUID(),
    tenderId,
    code: '1.1.1.01',
    name: 'Caja (Pesos)',
    path: accountPath,
    description: 'Ingreso manual de prueba',
    ...overrides,
  }
  return db.pool.query(
    `INSERT INTO tesoreria.dues_cash_manual_sources
      (id,tender_id,account_code_snapshot,account_name_snapshot,account_path_snapshot,description)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
    [
      values.id,
      values.tenderId,
      values.code,
      values.name,
      JSON.stringify(values.path),
      values.description,
    ],
  )
}

beforeAll(async () => {
  if (!url) throw new Error('ATHLOS_TEST_DATABASE_URL is required')
  const adminUrl = new URL(url)
  adminUrl.pathname = '/postgres'
  const databaseUrl = new URL(url)
  databaseUrl.pathname = `/${databaseName}`
  admin = createDb({ connectionString: adminUrl.toString() })
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`)
  db = createDb({ connectionString: databaseUrl.toString() })
  operatorId = randomUUID()
  shiftId = randomUUID()
  await db.pool.query(`
    CREATE EXTENSION pgcrypto;
    CREATE SCHEMA tesoreria;
    CREATE TABLE public.operators (id uuid PRIMARY KEY, role char(1) NOT NULL DEFAULT 'O');
    CREATE TABLE tesoreria.gastos (id uuid PRIMARY KEY, fecha date NOT NULL DEFAULT CURRENT_DATE);
    CREATE TABLE tesoreria.dues_settlements (id uuid PRIMARY KEY, kind text NOT NULL DEFAULT 'MONETARY');
    INSERT INTO public.operators VALUES ('${operatorId}');
  `)
  const files = [
    '0054_dues_cash_closes.sql',
    '0055_cash_policy_atomicity.sql',
    '0056_cash_recovery_policy.sql',
    '0057_cash_lifecycle_boundaries.sql',
    '0066_plan_cuentas.sql',
    '0070_cash_manual_sources.sql',
  ]
  await db.pool.query(
    (
      await Promise.all(
        files.map((file) =>
          readFile(join(import.meta.dirname, '../../../../../packages/db/drizzle', file), 'utf8'),
        ),
      )
    ).join('\n'),
  )
  await db.pool.query(
    `INSERT INTO tesoreria.dues_cash_shifts
      (id,desk_id,assigned_operator_id,opening_tenders,operator_id,caller_key,request_fingerprint,business_date)
     VALUES ($1,'manual-fixture',$2,'{}',$2,'shift-key',repeat('b',64),CURRENT_DATE)`,
    [shiftId, operatorId],
  )
})

afterAll(async () => {
  await db?.pool.end()
  try {
    await admin?.pool.query(`DROP DATABASE IF EXISTS "${databaseName}"`)
  } finally {
    await admin?.pool.end()
  }
})

describe('manual cash source persistence', () => {
  it('permits an ADMIN tender on another operator’s open shift', async () => {
    const adminId = randomUUID()
    const foreignShift = randomUUID()
    await db.pool.query(`INSERT INTO public.operators (id,role) VALUES ($1,'A')`, [adminId])
    await db.pool.query(
      `INSERT INTO tesoreria.dues_cash_shifts
              (id,desk_id,assigned_operator_id,opening_tenders,operator_id,caller_key,request_fingerprint,business_date)
             VALUES ($1,'admin-foreign-fixture',$2,'{}',$2,'admin-foreign-shift',repeat('e',64),CURRENT_DATE)`,
      [foreignShift, operatorId],
    )
    const tender = await insertTender({ shiftId: foreignShift, operatorId: adminId })
    await expect(insertSource(tender.rows[0]!.id)).resolves.toMatchObject({ rowCount: 1 })
  })

  it('links one eligible manual tender to immutable account metadata', async () => {
    const tender = await insertTender()
    await expect(insertSource(tender.rows[0]!.id)).resolves.toMatchObject({ rowCount: 1 })
    await expect(insertSource(tender.rows[0]!.id)).rejects.toMatchObject({ code: '23505' })
    await db.pool.query(
      `UPDATE contabilidad.plan_cuentas SET name='Caja renombrada' WHERE code='1.1.1.01'`,
    )
    await expect(
      db.pool.query(
        `SELECT account_name_snapshot,account_path_snapshot FROM tesoreria.dues_cash_manual_sources`,
      ),
    ).resolves.toMatchObject({
      rows: expect.arrayContaining([
        { account_name_snapshot: 'Caja (Pesos)', account_path_snapshot: accountPath },
      ]),
    })
    await expect(
      db.pool.query(`UPDATE tesoreria.dues_cash_manual_sources SET description='x'`),
    ).rejects.toMatchObject({ code: '55000' })
    await expect(
      db.pool.query(`DELETE FROM tesoreria.dues_cash_manual_sources`),
    ).rejects.toMatchObject({ code: '55000' })
  })

  it('accepts a BANK_DEBIT expense with a liability-leaf snapshot', async () => {
    const tender = await insertTender({ direction: 'EXPENSE', tender: 'BANK_DEBIT' })
    await expect(
      insertSource(tender.rows[0]!.id, {
        code: '2.1.1.01',
        name: 'Proveedores',
        path: [
          { code: '2', name: 'Pasivo' },
          { code: '2.1', name: 'Pasivo Corriente' },
          { code: '2.1.1', name: 'Deudas Comerciales' },
          { code: '2.1.1.01', name: 'Proveedores' },
        ],
      }),
    ).resolves.toMatchObject({ rowCount: 1 })
  })

  it.each([
    ['BANK_DEBIT income', { tender: 'BANK_DEBIT' }],
    ['settlement origin', { sourceType: 'SETTLEMENT', sourceId: randomUUID() }],
    ['wrong account snapshot', {}, { name: 'Forged' }],
    ['non-imputable group', {}, { code: '1.1.2', name: 'Inversiones', path: [] }],
  ])(
    'rejects %s',
    async (
      _name,
      tenderOverrides: Record<string, unknown>,
      sourceOverrides: Record<string, unknown> = {},
    ) => {
      const tender = await insertTender(tenderOverrides)
      await expect(insertSource(tender.rows[0]!.id, sourceOverrides)).rejects.toMatchObject({
        code: '23514',
      })
    },
  )

  it('rejects a missing tender, a foreign tender owner, and a nonpositive amount', async () => {
    await expect(insertSource(randomUUID())).rejects.toMatchObject({ code: '23503' })
    const foreignOperator = randomUUID()
    await db.pool.query(`INSERT INTO public.operators VALUES ($1)`, [foreignOperator])
    const foreignTender = await insertTender({ operatorId: foreignOperator })
    await expect(insertSource(foreignTender.rows[0]!.id)).rejects.toMatchObject({ code: '23514' })
    const closedOperator = randomUUID()
    const closedShift = randomUUID()
    await db.pool.query(`INSERT INTO public.operators VALUES ($1)`, [closedOperator])
    await db.pool.query(
      `INSERT INTO tesoreria.dues_cash_shifts
        (id,desk_id,assigned_operator_id,opening_tenders,operator_id,caller_key,request_fingerprint,business_date)
       VALUES ($1,'closed-fixture',$2,'{}',$2,'closed-shift',repeat('c',64),CURRENT_DATE)`,
      [closedShift, closedOperator],
    )
    const closedTender = await insertTender({ shiftId: closedShift, operatorId: closedOperator })
    await db.pool.query(
      `INSERT INTO tesoreria.dues_cash_closes
        (shift_id,expected_tenders,counted_tenders,discrepancy,operator_id,authorization_evidence,caller_key,request_fingerprint,closed_at)
       VALUES ($1,'{}','{}','{}',$2,'{}','closed-source',repeat('d',64),now())`,
      [closedShift, closedOperator],
    )
    await expect(insertSource(closedTender.rows[0]!.id)).rejects.toMatchObject({ code: '23514' })
    await expect(insertTender({ amount: '0.00' })).rejects.toMatchObject({ code: '23514' })
  })
})
