import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createDb } from '@athlos/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CashDeskService, businessDateForOpening, recordExpenseCompensation } from './cash-desk.ts'
import type { AuditContext } from './service.ts'
import { assertGastoMutable } from '../../routes/admin/gastos.ts'

const url = process.env.ATHLOS_TEST_DATABASE_URL
let db: ReturnType<typeof createDb>
let admin: ReturnType<typeof createDb> | undefined
let isolatedDatabaseName: string | undefined
let operatorId: string
let secondOperatorId: string
let socioId: string

const context = (key = randomUUID()): AuditContext => ({
  actorId: operatorId,
  role: 'ADMIN',
  permissions: ['treasury:close'],
  sourceIp: '127.0.0.1',
  callerKey: key,
  requestFingerprint: randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64),
  authorizationEvidence: { role: 'ADMIN' },
})

async function applyMigrations() {
  const directory = join(import.meta.dirname, '../../../../../packages/db/drizzle')
  for (const name of [
    '0049_dues_pricing_obligations.sql',
    '0050_dues_benefit_rules.sql',
    '0051_dues_family_groups.sql',
    '0052_dues_settlements.sql',
    '0053_dues_agreements_community_work.sql',
    '0054_dues_cash_closes.sql',
    '0055_cash_policy_atomicity.sql',
    '0056_cash_recovery_policy.sql',
    '0057_cash_lifecycle_boundaries.sql',
  ]) {
    await db.pool.query(await readFile(join(directory, name), 'utf8'))
  }
}

beforeAll(async () => {
  if (!url) throw new Error('ATHLOS_TEST_DATABASE_URL is required')
  isolatedDatabaseName = `athlos_cash_${randomUUID().replaceAll('-', '')}`
  const adminUrl = new URL(url)
  adminUrl.pathname = '/postgres'
  const isolatedUrl = new URL(url)
  isolatedUrl.pathname = `/${isolatedDatabaseName}`
  admin = createDb({ connectionString: adminUrl.toString(), poolMax: 2 })
  await admin.pool.query(`CREATE DATABASE "${isolatedDatabaseName}"`)
  db = createDb({ connectionString: isolatedUrl.toString(), poolMax: 8 })
  operatorId = randomUUID()
  secondOperatorId = randomUUID()
  socioId = randomUUID()
  await db.pool.query('CREATE SCHEMA tesoreria')
  await db.pool.query('CREATE SCHEMA IF NOT EXISTS socios')
  await db.pool.query('CREATE SCHEMA IF NOT EXISTS deportes')
  await db.pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto')
  await db.pool.query(
    'CREATE TABLE IF NOT EXISTS public.operators (id uuid PRIMARY KEY,username text UNIQUE NOT NULL,password_hash text NOT NULL,role char(1) NOT NULL)',
  )
  await db.pool.query(
    'CREATE TABLE IF NOT EXISTS public.audit_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),operator_id uuid,action text NOT NULL,entity_type text NOT NULL,entity_id text NOT NULL,old_value jsonb,new_value jsonb,source_ip text,metadata jsonb,idempotency_key text,created_at timestamptz NOT NULL DEFAULT now())',
  )
  await db.pool.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS cash_fixture_audit_key ON public.audit_events (idempotency_key) WHERE idempotency_key IS NOT NULL',
  )
  await db.pool.query(
    "INSERT INTO public.operators (id,username,password_hash,role) VALUES ($1,$2,'fixture','A') ON CONFLICT DO NOTHING",
    [secondOperatorId, `cash-${secondOperatorId}`],
  )
  await db.pool.query(
    'CREATE TABLE IF NOT EXISTS socios.socios (id uuid PRIMARY KEY,numero_socio text NOT NULL,nombre text NOT NULL,apellido text NOT NULL,dni text NOT NULL,fecha_alta date NOT NULL,estado text NOT NULL)',
  )
  await db.pool.query(
    'CREATE TABLE IF NOT EXISTS deportes.disciplinas (id uuid PRIMARY KEY, nombre text NOT NULL)',
  )
  await db.pool.query(
    'CREATE TABLE IF NOT EXISTS deportes.ejercicios (id uuid PRIMARY KEY, nombre text NOT NULL)',
  )
  await db.pool.query(
    'CREATE TABLE IF NOT EXISTS deportes.inscripciones (id uuid PRIMARY KEY, socio_id uuid NOT NULL, disciplina_id uuid NOT NULL, ejercicio_id uuid NOT NULL)',
  )
  await db.pool.query(
    "CREATE TABLE IF NOT EXISTS tesoreria.gastos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tipo integer NOT NULL,tipo_cuenta integer NOT NULL,cuenta_principal text NOT NULL,cuenta_auxiliar integer,secuencia integer NOT NULL DEFAULT 0,comprobante text NOT NULL DEFAULT '',fecha date NOT NULL,concepto text,importe text NOT NULL,iva text NOT NULL DEFAULT '0.00',ingreso_bruto text,socio_id uuid,legacy_id text,anulado boolean NOT NULL DEFAULT false,anulado_at timestamptz,anulado_motivo text,created_at timestamptz NOT NULL DEFAULT now())",
  )
  await db.pool.query(
    "INSERT INTO public.operators (id,username,password_hash,role) VALUES ($1,$2,'fixture','A') ON CONFLICT DO NOTHING",
    [operatorId, `cash-${operatorId}`],
  )
  await db.pool.query(
    "INSERT INTO socios.socios (id,numero_socio,nombre,apellido,dni,fecha_alta,estado) VALUES ($1,'cash-member','Cash','Fixture','cash-dni',DATE '2024-01-01','activo') ON CONFLICT DO NOTHING",
    [socioId],
  )
  await applyMigrations()
})

afterAll(async () => {
  await db?.pool.end()
  if (!admin || !isolatedDatabaseName) return
  try {
    await admin.pool.query(`DROP DATABASE IF EXISTS "${isolatedDatabaseName}"`)
  } finally {
    await admin.pool.end()
  }
})

describe('cash desk PostgreSQL policy', () => {
  it('closes with an inclusive interval, retains businessDate, replays, and excludes NON_CASH', async () => {
    const service = new CashDeskService(db.db)
    const opening = context(`open-${randomUUID()}`)
    const openingInput = {
      ...opening,
      deskId: `desk-${randomUUID()}`,
      openingTenders: { CASH: 1000 },
    }
    const [opened, openReplay] = await Promise.all([
      service.open(openingInput),
      service.open({ ...openingInput, deskId: `other-${randomUUID()}` }),
    ])
    expect(openReplay).toEqual(opened)
    await expect(
      service.open({
        ...openingInput,
        openingTenders: { CASH: 1 },
        requestFingerprint: 'f'.repeat(64),
      }),
    ).rejects.toThrow('different shift')
    expect(opened.businessDate).toBe(businessDateForOpening(new Date(opened.openedAt)))
    const tender = context(`tender-${randomUUID()}`)
    const tenderInput = {
      ...tender,
      shiftId: opened.id,
      direction: 'INCOME' as const,
      tender: 'CASH',
      amountCents: 2000,
      sourceType: 'MANUAL' as const,
      reason: 'Receipt batch',
    }
    const [recorded, tenderReplay] = await Promise.all([
      service.recordTender(tenderInput),
      service.recordTender(tenderInput),
    ])
    expect(tenderReplay).toEqual(recorded)
    const gasto = randomUUID()
    const today = businessDateForOpening(new Date(opened.openedAt))
    await db.pool.query(
      `INSERT INTO tesoreria.gastos (id,tipo,tipo_cuenta,cuenta_principal,fecha,importe) VALUES ($1,1,1,'600',$2,'1.00')`,
      [gasto, today],
    )
    await service.includeExpense({
      ...context(`expense-${randomUUID()}`),
      shiftId: opened.id,
      gastoId: gasto,
      tender: 'CASH',
    })
    const closeInput = {
      ...context(`close-${randomUUID()}`),
      shiftId: opened.id,
      countedTenders: { CASH: 2890 },
      reason: 'Cash count was short',
    }
    const [close, closeReplay] = await Promise.all([
      service.close(closeInput),
      service.close(closeInput),
    ])
    expect(closeReplay).toEqual(close)
    expect(close.discrepancy).toEqual({ CASH: -10 })
    expect(
      (
        await db.pool.query('SELECT status FROM tesoreria.dues_cash_shifts WHERE id=$1', [
          opened.id,
        ])
      ).rows[0].status,
    ).toBe('CLOSED')
    const second = await service.open({
      ...context(`open-${randomUUID()}`),
      deskId: `desk-${randomUUID()}`,
      openingTenders: {},
    })
    const settlement = randomUUID()
    await db.pool.query(
      `INSERT INTO tesoreria.dues_settlements (id,socio_id,kind,amount,currency,operator_id,caller_key,request_fingerprint) VALUES ($1,$2,'NON_CASH',5.00,'ARS',$3,$4,$5)`,
      [settlement, socioId, operatorId, randomUUID(), 'a'.repeat(64)],
    )
    await expect(
      service.recordTender({
        ...context(`noncash-${randomUUID()}`),
        shiftId: second.id,
        direction: 'INCOME',
        tender: 'CASH',
        amountCents: 500,
        sourceType: 'SETTLEMENT',
        sourceId: settlement,
      }),
    ).rejects.toThrow('Non-cash')
    await expect(
      db.pool.query(
        `INSERT INTO tesoreria.dues_cash_tenders (shift_id,direction,tender,amount,source_type,source_id,operator_id,caller_key,request_fingerprint) VALUES ($1,'INCOME','CASH',1,'SETTLEMENT',$2,$3,$4,$5)`,
        [second.id, randomUUID(), operatorId, randomUUID(), 'e'.repeat(64)],
      ),
    ).rejects.toMatchObject({ code: '55000' })
  })

  it('serializes close against update, delete, and anular, and blocks direct bypasses', async () => {
    const service = new CashDeskService(db.db)
    const opened = await service.open({
      ...context(`open-${randomUUID()}`),
      deskId: `desk-${randomUUID()}`,
      openingTenders: {},
    })
    const gasto = randomUUID()
    const today = businessDateForOpening(new Date(opened.openedAt))
    await db.pool.query(
      `INSERT INTO tesoreria.gastos (id,tipo,tipo_cuenta,cuenta_principal,fecha,importe) VALUES ($1,1,1,'601',$2,'1.00')`,
      [gasto, today],
    )
    await service.includeExpense({
      ...context(`expense-${randomUUID()}`),
      shiftId: opened.id,
      gastoId: gasto,
      tender: 'CASH',
    })
    const client = await db.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT id FROM tesoreria.gastos WHERE id=$1 FOR UPDATE', [gasto])
      const close = service.close({
        ...context(`close-${randomUUID()}`),
        shiftId: opened.id,
        countedTenders: { CASH: 0 },
        reason: 'sealed',
      })
      await new Promise((resolve) => setTimeout(resolve, 25))
      const mutations = Promise.allSettled([
        db.pool.query(`UPDATE tesoreria.gastos SET importe='2.00' WHERE id=$1`, [gasto]),
        db.pool.query(`DELETE FROM tesoreria.gastos WHERE id=$1`, [gasto]),
        db.pool.query(
          `UPDATE tesoreria.gastos SET anulado=true,anulado_at=now(),anulado_motivo='race' WHERE id=$1`,
          [gasto],
        ),
      ])
      await close
      await client.query('COMMIT')
      const mutationResults = await mutations
      expect(mutationResults.every((result) => result.status === 'rejected')).toBe(true)
    } finally {
      await client.query('ROLLBACK').catch(() => undefined)
      client.release()
    }
    await expect(
      db.pool.query(
        `UPDATE tesoreria.dues_cash_shifts SET status='OPEN',closed_at=NULL WHERE id=$1`,
        [opened.id],
      ),
    ).rejects.toMatchObject({ code: '55000' })
    await expect(
      db.pool.query(
        `INSERT INTO tesoreria.dues_cash_tenders (shift_id,direction,tender,amount,source_type,operator_id,caller_key,request_fingerprint) VALUES ($1,'INCOME','CASH',1,'MANUAL',$2,$3,$4)`,
        [opened.id, operatorId, randomUUID(), 'b'.repeat(64)],
      ),
    ).rejects.toMatchObject({ code: '55000' })
    await expect(
      db.pool.query(
        `INSERT INTO tesoreria.dues_cash_shifts (desk_id,assigned_operator_id,status,opening_tenders,operator_id,caller_key,request_fingerprint,business_date) VALUES ('direct-closed',$1,'CLOSED','{}',$1,$2,$3,CURRENT_DATE)`,
        [operatorId, randomUUID(), 'c'.repeat(64)],
      ),
    ).rejects.toMatchObject({ code: '55000' })
    await expect(assertGastoMutable(db.db, gasto)).rejects.toThrow('cash inclusion')
  })

  it('makes an included OPEN-shift gasto immediately immutable and force-closes an expired shift', async () => {
    let now = new Date()
    const service = new CashDeskService(db.db, () => now)
    const opened = await service.open({
      ...context(`open-${randomUUID()}`),
      deskId: `desk-${randomUUID()}`,
      openingTenders: {},
    })
    const gasto = randomUUID()
    const today = businessDateForOpening(new Date(opened.openedAt))
    await db.pool.query(
      `INSERT INTO tesoreria.gastos (id,tipo,tipo_cuenta,cuenta_principal,fecha,importe) VALUES ($1,1,1,'605',$2,'1.00')`,
      [gasto, today],
    )
    await service.includeExpense({
      ...context(`expense-${randomUUID()}`),
      shiftId: opened.id,
      gastoId: gasto,
      tender: 'CASH',
    })
    await expect(
      db.pool.query(`UPDATE tesoreria.gastos SET importe='2.00' WHERE id=$1`, [gasto]),
    ).rejects.toMatchObject({ code: '55000' })
    await expect(
      db.pool.query(`DELETE FROM tesoreria.gastos WHERE id=$1`, [gasto]),
    ).rejects.toMatchObject({ code: '55000' })
    await expect(
      db.pool.query(`UPDATE tesoreria.gastos SET anulado=true WHERE id=$1`, [gasto]),
    ).rejects.toMatchObject({ code: '55000' })

    now = new Date(new Date(opened.openedAt).getTime() + 23 * 60 * 60 * 1000)
    await expect(
      service.close({
        ...context(`early-force-${randomUUID()}`),
        shiftId: opened.id,
        countedTenders: { CASH: 0 },
        forceClose: true,
        reason: 'Premature recovery attempt',
      }),
    ).rejects.toThrow('after 24 hours')

    const exactOpened = await service.open({
      ...context(`exact-open-${randomUUID()}`),
      deskId: `desk-${randomUUID()}`,
      openingTenders: {},
    })
    now = new Date(new Date(exactOpened.openedAt).getTime() + 24 * 60 * 60 * 1000)
    const exactForceInput = {
      ...context(`exact-force-${randomUUID()}`),
      shiftId: exactOpened.id,
      countedTenders: {},
      forceClose: true,
      reason: 'Exact recovery boundary',
    }
    const exactForce = await service.close(exactForceInput)
    const auditCount = (
      await db.pool.query(
        `SELECT count(*)::int AS count FROM public.audit_events WHERE action='DUES_CASH_SHIFT_CLOSED' AND entity_id=$1`,
        [exactOpened.id],
      )
    ).rows[0].count
    expect(await service.close(exactForceInput)).toEqual(exactForce)
    expect(
      (
        await db.pool.query(
          `SELECT count(*)::int AS count FROM public.audit_events WHERE action='DUES_CASH_SHIFT_CLOSED' AND entity_id=$1`,
          [exactOpened.id],
        )
      ).rows[0].count,
    ).toBe(auditCount)

    now = new Date(new Date(opened.openedAt).getTime() + 25 * 60 * 60 * 1000)
    await expect(
      service.close({
        ...context(`expired-normal-${randomUUID()}`),
        shiftId: opened.id,
        countedTenders: { CASH: 0 },
      }),
    ).rejects.toThrow('24 hours')
    await expect(
      service.close({
        ...context(`expired-force-${randomUUID()}`),
        shiftId: opened.id,
        countedTenders: { CASH: 0 },
        forceClose: true,
      }),
    ).rejects.toThrow('reason')
    await expect(
      service.close({
        ...context(`expired-operator-${randomUUID()}`),
        role: 'OPERADOR',
        shiftId: opened.id,
        countedTenders: { CASH: 0 },
        forceClose: true,
        reason: 'Recovery',
      }),
    ).rejects.toThrow('not authorized')
    const forceInput = {
      ...context(`expired-force-success-${randomUUID()}`),
      shiftId: opened.id,
      countedTenders: { CASH: 0 },
      forceClose: true,
      reason: 'Recovery after unattended shift',
    }
    const forced = await service.close(forceInput)
    expect(forced.reason).toBe('Recovery after unattended shift')
    expect(forced.forceClose).toBe(true)
    expect(
      await service.close({ ...forceInput, countedTenders: { CASH: 9 }, reason: 'changed' }),
    ).toEqual(forced)
  })

  it('makes a direct SQL close atomic and rejects manual tenders without a reason', async () => {
    const opened = await new CashDeskService(db.db).open({
      ...context(`direct-open-${randomUUID()}`),
      deskId: `desk-${randomUUID()}`,
      openingTenders: {},
    })
    const closedAt = new Date(new Date(opened.openedAt).getTime() + 60_000)
    await db.pool.query(
      `INSERT INTO tesoreria.dues_cash_closes (shift_id,expected_tenders,counted_tenders,discrepancy,operator_id,authorization_evidence,caller_key,request_fingerprint,closed_at) VALUES ($1,'{}','{}','{}',$2,'{}',$3,$4,$5)`,
      [opened.id, operatorId, randomUUID(), 'f'.repeat(64), closedAt],
    )
    expect(
      (
        await db.pool.query('SELECT status,closed_at FROM tesoreria.dues_cash_shifts WHERE id=$1', [
          opened.id,
        ])
      ).rows[0],
    ).toMatchObject({ status: 'CLOSED' })

    await expect(
      db.pool.query(
        `INSERT INTO tesoreria.dues_cash_tenders (shift_id,direction,tender,amount,source_type,operator_id,caller_key,request_fingerprint) VALUES ($1,'INCOME','CASH',1,'MANUAL',$2,$3,$4)`,
        [opened.id, operatorId, randomUUID(), '1'.repeat(64)],
      ),
    ).rejects.toMatchObject({ code: '55000' })

    const manualShift = await new CashDeskService(db.db).open({
      ...context(`manual-open-${randomUUID()}`),
      deskId: `desk-${randomUUID()}`,
      openingTenders: {},
    })
    await expect(
      db.pool.query(
        `INSERT INTO tesoreria.dues_cash_tenders (shift_id,direction,tender,amount,source_type,operator_id,caller_key,request_fingerprint) VALUES ($1,'INCOME','CASH',1,'MANUAL',$2,$3,$4)`,
        [manualShift.id, operatorId, randomUUID(), '2'.repeat(64)],
      ),
    ).rejects.toMatchObject({ code: '23514' })

    const recoveryShift = await new CashDeskService(db.db).open({
      ...context(`recovery-open-${randomUUID()}`),
      deskId: `desk-${randomUUID()}`,
      openingTenders: {},
    })
    const earlyClose = new Date(new Date(recoveryShift.openedAt).getTime() + 60_000)
    await expect(
      db.pool.query(
        `INSERT INTO tesoreria.dues_cash_closes (shift_id,expected_tenders,counted_tenders,discrepancy,reason,force_close,operator_id,authorization_evidence,caller_key,request_fingerprint,closed_at) VALUES ($1,'{}','{}','{}','Recovery',true,$2,'{"role":"ADMIN"}',$3,$4,$5)`,
        [recoveryShift.id, operatorId, randomUUID(), '3'.repeat(64), earlyClose],
      ),
    ).rejects.toMatchObject({ code: '55000' })
    const exactClose = new Date(new Date(recoveryShift.openedAt).getTime() + 24 * 60 * 60 * 1000)
    await expect(
      db.pool.query(
        `INSERT INTO tesoreria.dues_cash_closes (shift_id,expected_tenders,counted_tenders,discrepancy,reason,force_close,operator_id,authorization_evidence,caller_key,request_fingerprint,closed_at) VALUES ($1,'{}','{}','{}','Recovery',true,$2,'{}',$3,$4,$5)`,
        [recoveryShift.id, operatorId, randomUUID(), '4'.repeat(64), exactClose],
      ),
    ).rejects.toMatchObject({ code: '55000' })
  })

  it('requires accounting-date equality and makes compensation replay/conflict atomic', async () => {
    const service = new CashDeskService(db.db)
    const opened = await service.open({
      ...context(`open-${randomUUID()}`),
      deskId: `desk-${randomUUID()}`,
      openingTenders: {},
    })
    const wrongDate = randomUUID()
    await db.pool.query(
      `INSERT INTO tesoreria.gastos (id,tipo,tipo_cuenta,cuenta_principal,fecha,importe) VALUES ($1,1,1,'602',$2,'1.00')`,
      [wrongDate, '2000-01-01'],
    )
    await expect(
      service.includeExpense({
        ...context(`wrong-${randomUUID()}`),
        shiftId: opened.id,
        gastoId: wrongDate,
        tender: 'CASH',
      }),
    ).rejects.toThrow('accounting date')
    const gasto = randomUUID()
    const today = businessDateForOpening(new Date(opened.openedAt))
    await db.pool.query(
      `INSERT INTO tesoreria.gastos (id,tipo,tipo_cuenta,cuenta_principal,fecha,importe) VALUES ($1,1,1,'603',$2,'1.00')`,
      [gasto, today],
    )
    await service.includeExpense({
      ...context(`expense-${randomUUID()}`),
      shiftId: opened.id,
      gastoId: gasto,
      tender: 'CASH',
    })
    await service.close({
      ...context(`close-${randomUUID()}`),
      shiftId: opened.id,
      countedTenders: { CASH: 0 },
      reason: 'sealed',
    })
    const compensating = randomUUID()
    await db.pool.query(
      `INSERT INTO tesoreria.gastos (id,tipo,tipo_cuenta,cuenta_principal,fecha,importe) VALUES ($1,1,1,'604',$2,'1.00')`,
      [compensating, today],
    )
    const input = {
      originalGastoId: gasto,
      compensatingGastoId: compensating,
      operatorId,
      callerKey: `comp-${randomUUID()}`,
      requestFingerprint: 'c'.repeat(64),
      reason: 'Correct closed-period expense',
    }
    const result = await recordExpenseCompensation(db.db, input)
    expect(await recordExpenseCompensation(db.db, input)).toEqual(result)
    await expect(
      recordExpenseCompensation(db.db, { ...input, requestFingerprint: 'd'.repeat(64) }),
    ).rejects.toThrow('different compensation')
    const secondCompensating = randomUUID()
    await db.pool.query(
      `INSERT INTO tesoreria.gastos (id,tipo,tipo_cuenta,cuenta_principal,fecha,importe) VALUES ($1,1,1,'607',$2,'1.00')`,
      [secondCompensating, today],
    )
    const crossOperator = await recordExpenseCompensation(db.db, {
      ...input,
      operatorId: secondOperatorId,
      compensatingGastoId: secondCompensating,
      callerKey: input.callerKey,
      requestFingerprint: 'e'.repeat(64),
    })
    expect(crossOperator.compensatingGastoId).toBe(secondCompensating)
  })
})
