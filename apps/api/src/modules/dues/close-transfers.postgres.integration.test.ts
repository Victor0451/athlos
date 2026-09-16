import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createDb } from '@athlos/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CashDeskService } from './cash-desk.ts'

const url = process.env.ATHLOS_TEST_DATABASE_URL
let admin: ReturnType<typeof createDb>
let db: ReturnType<typeof createDb>
let operatorId: string
let adminId: string
let secondOperatorId: string
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
  adminId = randomUUID()
  secondOperatorId = randomUUID()
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
      CREATE TABLE IF NOT EXISTS public.audit_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),operator_id uuid,action text NOT NULL,entity_type text NOT NULL,entity_id text NOT NULL,old_value jsonb,new_value jsonb,source_ip text,metadata jsonb,idempotency_key text,created_at timestamptz NOT NULL DEFAULT now());
      INSERT INTO public.operators VALUES ('${operatorId}','O'),('${adminId}','A'),('${secondOperatorId}','O');
    `)
    const directory = join(import.meta.dirname, '../../../../../packages/db/drizzle')
    for (const f of [
      '0054_dues_cash_closes.sql',
      '0055_cash_policy_atomicity.sql',
      '0056_cash_recovery_policy.sql',
      '0057_cash_lifecycle_boundaries.sql',
      '0066_plan_cuentas.sql',
      '0067_personal_cash_shift_owner.sql',
      '0068_personal_cash_shift_desk_release.sql',
      '0070_cash_manual_sources.sql',
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

describe('U8-B computed close service on real PostgreSQL', () => {
  let fixtureSeq = 0
  async function openShift(opts: { opening?: string; ageHours?: number } = {}) {
    const id = randomUUID()
    const owner = randomUUID()
    await db.pool.query(`INSERT INTO public.operators VALUES ($1,'O')`, [owner])
    await db.pool.query(
      `INSERT INTO tesoreria.dues_cash_shifts (id,desk_id,assigned_operator_id,opening_tenders,operator_id,authorization_evidence,caller_key,request_fingerprint,business_date,opened_at) VALUES ($1,$2,$3,$4::jsonb,$3,'{}',$5,$6,CURRENT_DATE,NOW() - ($7 || ' hours')::interval)`,
      [
        id,
        `u8b-fixture-${++fixtureSeq}`,
        owner,
        opts.opening ?? '{}',
        `u8b-shift-${fixtureSeq}`,
        'e'.repeat(64),
        String(opts.ageHours ?? 0),
      ],
    )
    return { id, owner }
  }
  async function addTender(
    id: string,
    owner: string,
    direction: string,
    tender: string,
    amountCents: number,
    ageHours?: number,
  ) {
    await db.pool.query(
      `INSERT INTO tesoreria.dues_cash_tenders (id,shift_id,direction,tender,amount,source_type,reason,operator_id,caller_key,request_fingerprint,created_at) VALUES ($1,$2,$3,$4,$5,'MANUAL','Fixture',$6,$7,$8,NOW() - (($9)::numeric * interval '1 hour'))`,
      [
        randomUUID(),
        id,
        direction,
        tender,
        (amountCents / 100).toFixed(2),
        owner,
        `u8b-tender-${++fixtureSeq}`,
        'a'.repeat(64),
        String(ageHours ?? 0),
      ],
    )
  }
  const closeCommand = (id: string, owner: string, overrides: Record<string, unknown> = {}) => ({
    actorId: owner,
    role: 'OPERADOR' as const,
    permissions: [] as string[],
    sourceIp: '127.0.0.1',
    callerKey: `u8b-close-${++fixtureSeq}`,
    requestFingerprint: 'b'.repeat(64),
    authorizationEvidence: {},
    shiftId: id,
    countedTenders: {} as Record<string, number>,
    forceClose: false,
    ...overrides,
  })
  const service = () => new CashDeskService(db.db)

  it('creates exactly one computed transfer on a positive mixed-method close', async () => {
    const { id, owner } = await openShift({ opening: '{"CASH":100000}' })
    await addTender(id, owner, 'INCOME', 'CASH', 3000000)
    await addTender(id, owner, 'EXPENSE', 'CASH', 500000)
    await addTender(id, owner, 'EXPENSE', 'TRANSFER', 400000)
    const command = closeCommand(id, owner, { countedTenders: { CASH: 2600000 } })
    const closed = await service().close(command)
    expect(closed.closeTransfer).toMatchObject({
      accountCodeSnapshot: '1.1.3.02',
      accountNameSnapshot: 'Valores a Depositar',
      amountCents: 2600000,
    })
    const audit = await db.pool.query(
      `SELECT metadata FROM public.audit_events WHERE entity_id=$1 AND action='DUES_CASH_SHIFT_CLOSED'`,
      [id],
    )
    expect(audit.rows[0].metadata.closeTransferId).toBe(closed.closeTransfer?.id)
    const replay = await service().close({ ...command })
    expect(replay.id).toBe(closed.id)
    expect(replay.closeTransfer?.id).toBe(closed.closeTransfer?.id)
    const count = await db.pool.query(
      `SELECT COUNT(*)::int AS count FROM tesoreria.dues_cash_close_transfers WHERE shift_id=$1`,
      [id],
    )
    expect(count.rows[0].count).toBe(1)
    await expect(
      service().close({ ...command, requestFingerprint: 'c'.repeat(64) }),
    ).rejects.toThrow('Idempotency key was already used for a different close')
    const detail = await service().detail(closeCommand(id, owner))
    expect(detail.close?.closeTransfer?.amountCents).toBe(2600000)
  })

  it('persists no transfer at zero and blocks negative closes with a breakdown', async () => {
    const { id: zero, owner: zeroOwner } = await openShift()
    await addTender(zero, zeroOwner, 'INCOME', 'CASH', 50000)
    await addTender(zero, zeroOwner, 'EXPENSE', 'CASH', 50000)
    const closed = await service().close(closeCommand(zero, zeroOwner))
    expect(closed.closeTransfer).toBeUndefined()
    const transfers = await db.pool.query(
      `SELECT COUNT(*)::int AS count FROM tesoreria.dues_cash_close_transfers WHERE shift_id=$1`,
      [zero],
    )
    expect(transfers.rows[0].count).toBe(0)

    const { id: negative, owner: negativeOwner } = await openShift()
    await addTender(negative, negativeOwner, 'INCOME', 'CASH', 100000)
    await addTender(negative, negativeOwner, 'EXPENSE', 'CASH', 300000)
    await expect(
      service().close(closeCommand(negative, negativeOwner, { reason: 'Conteo físico menor' })),
    ).rejects.toThrow(
      'Computed cash is negative (opening 0, cash income 100000, cash expense 300000); refetch the current shift state',
    )
    const rows = await db.pool.query(
      `SELECT COUNT(*)::int AS count FROM tesoreria.dues_cash_closes WHERE shift_id=$1`,
      [negative],
    )
    expect(rows.rows[0].count).toBe(0)
  })

  it('keeps forced and foreign close authority narrow', async () => {
    const { id: expired, owner } = await openShift({ ageHours: 25 })
    // An expired shift cannot receive new movements (0055 interval guard), so a negative forced
    // close is not fixturable; the computed-cash block in close() is unconditional and proven on
    // the ordinary path above.
    await expect(
      service().close(closeCommand(expired, owner, { actorId: secondOperatorId })),
    ).rejects.toThrow('Cash shift responsibility does not match the operator')
    await expect(
      service().close(closeCommand(expired, owner, { forceClose: true, reason: 'x' })),
    ).rejects.toThrow('Forced cash close is restricted to finance operators')
    const forced = await service().close(
      closeCommand(expired, owner, {
        role: 'ADMIN',
        actorId: adminId,
        forceClose: true,
        reason: 'Cierre forzado',
        authorizationEvidence: { role: 'ADMIN' },
      }),
    )
    expect(forced.forceClose).toBe(true)
    expect(forced.closeTransfer).toBeUndefined()
    const shift = await db.pool.query(`SELECT status FROM tesoreria.dues_cash_shifts WHERE id=$1`, [
      expired,
    ])
    expect(shift.rows[0].status).toBe('CLOSED')
  })
})

describe('U9-A detail movements on real PostgreSQL', () => {
  let seq = 0
  async function openShift(opening = '{}') {
    const id = randomUUID()
    const owner = randomUUID()
    await db.pool.query(`INSERT INTO public.operators VALUES ($1,'O')`, [owner])
    await db.pool.query(
      `INSERT INTO tesoreria.dues_cash_shifts (id,desk_id,assigned_operator_id,opening_tenders,operator_id,authorization_evidence,caller_key,request_fingerprint,business_date,opened_at) VALUES ($1,$2,$3,$4::jsonb,$3,'{}',$5,$6,CURRENT_DATE,NOW())`,
      [id, `u9a-fixture-${++seq}`, owner, opening, `u9a-shift-${seq}`, 'e'.repeat(64)],
    )
    return { id, owner }
  }
  const base = <T extends Record<string, unknown>>(owner: string, overrides: T = {} as T) => ({
    actorId: owner,
    role: 'OPERADOR' as const,
    permissions: [] as string[],
    sourceIp: '127.0.0.1',
    callerKey: `u9a-${++seq}`,
    requestFingerprint: 'b'.repeat(64),
    authorizationEvidence: {},
    ...overrides,
  })

  it('exposes attributed movements, per-method rows, and the computed expectation', async () => {
    const { id, owner } = await openShift('{"CASH":100000}')
    const service = new CashDeskService(db.db)
    await service.recordTender(
      base(owner, {
        shiftId: id,
        direction: 'INCOME',
        tender: 'CASH',
        amountCents: 3000000,
        sourceType: 'MANUAL',
        reason: 'Venta buffet',
        accountCode: '4.1.01',
        description: 'Cuota septiembre',
      }) as never,
    )
    for (const [direction, tender, amountCents] of [
      ['EXPENSE', 'CASH', 500000],
      ['EXPENSE', 'TRANSFER', 400000],
      ['EXPENSE', 'BANK_DEBIT', 700000],
    ] as const) {
      await db.pool.query(
        `INSERT INTO tesoreria.dues_cash_tenders (id,shift_id,direction,tender,amount,source_type,reason,operator_id,caller_key,request_fingerprint) VALUES ($1,$2,$3,$4,$5,'MANUAL','Fixture',$6,$7,$8)`,
        [
          randomUUID(),
          id,
          direction,
          tender,
          (amountCents / 100).toFixed(2),
          owner,
          `u9a-tender-${++seq}`,
          'a'.repeat(64),
        ],
      )
    }
    const detail = await service.detail(base(owner, { shiftId: id }))
    expect(detail.openingTenders).toEqual({ CASH: 100000 })
    // expected CASH = 1000 + 30000 − 5000; TRANSFER/BANK_DEBIT expenses stay outside physical cash.
    expect(detail.expectedTenders).toEqual({ CASH: 2600000 })
    expect(detail.movements).toHaveLength(4)
    const attributed = detail.movements.find(
      (movement) => movement.sourceType === 'MANUAL' && movement.direction === 'INCOME',
    )
    expect(attributed).toMatchObject({
      tender: 'CASH',
      amountCents: 3000000,
      accountCodeSnapshot: '4.1.01',
      accountNameSnapshot: 'Cuotas sociales',
      description: 'Cuota septiembre',
    })
    expect(attributed?.id).toBeTruthy()
    expect(attributed?.createdAt).toBeTruthy()
    const bankDebit = detail.movements.find((movement) => movement.tender === 'BANK_DEBIT')
    expect(bankDebit?.amountCents).toBe(700000)
    // A closed shift reads its stored close as the authority: movements persist, no recomputation.
    await service.close(base(owner, { shiftId: id, countedTenders: { CASH: 2600000 } }))
    const closed = await service.detail(base(owner, { shiftId: id }))
    expect(closed).not.toHaveProperty('expectedTenders')
    expect(closed.close?.expectedTenders).toEqual({ CASH: 2600000 })
    expect(closed.movements).toHaveLength(4)
    expect(closed.close?.closeTransfer?.amountCents).toBe(2600000)
  })
})
