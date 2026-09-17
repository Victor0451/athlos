import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createDb } from '@athlos/db'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { CashDeskService } from './cash-desk.ts'

const url = process.env.ATHLOS_TEST_DATABASE_URL
let admin: ReturnType<typeof createDb>
let db: ReturnType<typeof createDb>
let operatorId: string
let adminId: string
let secondOperatorId: string
let shiftId: string

beforeAll(async () => {
  if (!url) throw new Error('ATHLOS_TEST_DATABASE_URL is required')
  admin = createDb({ connectionString: new URL(url).toString(), poolMax: 2 })
  const dbName = `athlos_u5b1_${randomUUID().replaceAll('-', '')}`
  await admin.pool.query(`CREATE DATABASE "${dbName}"`)
  const dbUrl = new URL(url)
  dbUrl.pathname = `/${dbName}`
  db = createDb({ connectionString: dbUrl.toString(), poolMax: 8 })
  operatorId = randomUUID()
  adminId = randomUUID()
  secondOperatorId = randomUUID()
  shiftId = randomUUID()
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
      INSERT INTO public.operators VALUES ('${operatorId}','A'),('${adminId}','A'),('${secondOperatorId}','O');
    `)
    // Migration bootstrap per file
    const directory = join(import.meta.dirname, '../../../../../packages/db/drizzle')
    for (const f of [
      '0054_dues_cash_closes.sql',
      '0055_cash_policy_atomicity.sql',
      '0056_cash_recovery_policy.sql',
      '0057_cash_lifecycle_boundaries.sql',
      '0066_plan_cuentas.sql',
      '0070_cash_manual_sources.sql',
    ]) {
      await conn.query(await readFile(join(directory, f), 'utf8'))
    }
    const fp = 'e'.repeat(64)
    await conn.query(
      `INSERT INTO tesoreria.dues_cash_shifts (id,desk_id,assigned_operator_id,opening_tenders,operator_id,authorization_evidence,caller_key,request_fingerprint,business_date,opened_at) VALUES ('${shiftId}','u5b1-fixture','${operatorId}','{}','${operatorId}','{}','shift-key','${fp}',CURRENT_DATE,NOW())`,
    )
  } finally {
    conn.release()
  }
})

afterAll(async () => {
  await db?.pool.end()
  if (admin) {
    const dbs = await admin.pool.query('SELECT datname FROM pg_database WHERE datname LIKE $1', [
      `athlos_u5b1_%`,
    ])
    for (const { datname } of dbs.rows)
      await admin.pool.query(`DROP DATABASE IF EXISTS "${datname}"`)
    await admin.pool.end()
  }
})

// Shared fixtures: disable triggers and FK so test cleanup works reliably
const fixtures = async () => {
  const c = await db.pool.connect()
  try {
    await c.query('ALTER TABLE tesoreria.dues_cash_tenders DISABLE TRIGGER ALL')
    await c.query('ALTER TABLE tesoreria.dues_cash_shifts DISABLE TRIGGER ALL')
    await c.query('ALTER TABLE tesoreria.dues_cash_manual_sources DISABLE TRIGGER ALL')
    await c.query(
      "DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dues_cash_manual_source_tender_fkey') THEN ALTER TABLE tesoreria.dues_cash_manual_sources DROP CONSTRAINT dues_cash_manual_source_tender_fkey; END IF; END $$",
    )
    await c.query('DELETE FROM tesoreria.dues_cash_manual_sources')
    await c.query('DELETE FROM tesoreria.dues_cash_tenders')
  } finally {
    c.release()
  }
}

const insertForeignShift = async (fid: string, ownerId: string) => {
  const fp = 'e'.repeat(64)
  const callerKey = `fk-${randomUUID().slice(0, 8)}`
  await db.pool.query(
    `INSERT INTO tesoreria.dues_cash_shifts (id,desk_id,assigned_operator_id,opening_tenders,operator_id,authorization_evidence,caller_key,request_fingerprint,business_date,opened_at) VALUES ($1,$2,$3,'{}',$3,'{}',$4,$5,CURRENT_DATE,NOW())`,
    [fid, callerKey, ownerId, randomUUID(), fp],
  )
}

const service = () => new CashDeskService(db.db, () => new Date())

// Combined builder: generates full TenderCommand with unique identity per call.
// Replays share callerKey — derive deterministic fingerprint from it.
const manualInput = (
  overrides: Record<string, unknown>,
  ctxOptions?: { admin?: boolean; role?: 'TESORERO'; actorId?: string; callerKey?: string },
) => {
  // callerKey may be in overrides (replay) or ctxOptions (admin override)
  const ck =
    (typeof overrides.callerKey === 'string'
      ? overrides.callerKey
      : (ctxOptions as { callerKey?: string } | undefined)?.callerKey) ?? `key-${randomUUID()}`
  return {
    actorId: ctxOptions?.actorId ?? operatorId,
    role: ctxOptions?.admin
      ? ('ADMIN' as const)
      : ((ctxOptions?.role ?? 'ADMIN') as 'TESORERO' | 'ADMIN'),
    permissions: [] as string[],
    sourceIp: '127.0.0.1',
    callerKey: ck,
    // Derive fingerprint solely from callerKey so replays share identity.
    requestFingerprint: `replay-${ck}`.padEnd(64, '0').slice(0, 64),
    authorizationEvidence: {},
    shiftId,
    direction: 'INCOME' as const,
    tender: 'CASH' as const,
    amountCents: 1500,
    sourceType: 'MANUAL' as const,
    reason: 'Test',
    accountCode: '1.1.1.01',
    description: 'Manual test',
    ...overrides,
  }
}

// Lightweight row counter helper
const count = (table: string) => db.pool.query(`SELECT count(*)::int c FROM tesoreria.${table}`)

describe('manual-source-writer atomic persistence', () => {
  beforeEach(fixtures)

  it('persists tender and manual source atomically with exact snapshots on happy path', async () => {
    const tender = await service().recordTender(
      manualInput({
        direction: 'INCOME',
        amountCents: 15000,
        accountCode: '1.1.1.01',
        description: 'Morning receipts',
      }),
    )
    expect(tender.direction).toBe('INCOME')
    expect(tender.amountCents).toBe(15000)
    const r = await db.pool.query(
      'SELECT account_code_snapshot,account_name_snapshot,account_path_snapshot,description FROM tesoreria.dues_cash_manual_sources WHERE tender_id=$1',
      [tender.id],
    )
    expect(r.rows[0]).toMatchObject({
      account_code_snapshot: '1.1.1.01',
      account_name_snapshot: 'Caja (Pesos)',
      description: 'Morning receipts',
    })
  })

  it('rejects inactive account and rolls back tender atomically', async () => {
    await db.pool.query(
      "UPDATE contabilidad.plan_cuentas SET active=false, imputable=false WHERE code='1.1.1.01'",
    )
    try {
      await expect(
        service().recordTender(manualInput({ accountCode: '1.1.1.01' })),
      ).rejects.toThrow('unavailable')
    } finally {
      await db.pool.query(
        "UPDATE contabilidad.plan_cuentas SET active=true, imputable=true WHERE code='1.1.1.01'",
      )
    }
    expect((await count('dues_cash_tenders')).rows[0].c).toBe(0)
    expect((await count('dues_cash_manual_sources')).rows[0].c).toBe(0)
  })

  it('rejects non-imputable account and rolls back tender atomically', async () => {
    await db.pool.query("UPDATE contabilidad.plan_cuentas SET imputable=false WHERE code='1.1.2'")
    try {
      await expect(service().recordTender(manualInput({ accountCode: '1.1.2' }))).rejects.toThrow(
        'unavailable',
      )
    } finally {
      await db.pool.query("UPDATE contabilidad.plan_cuentas SET imputable=true WHERE code='1.1.2'")
    }
    expect((await count('dues_cash_tenders')).rows[0].c).toBe(0)
  })

  it('replays same caller key returning persisted tender without duplicate source', async () => {
    const key = `replay-${randomUUID()}`
    const first = await service().recordTender(
      manualInput({ callerKey: key, amountCents: 2000, description: 'Replay v1' }),
    )
    const second = await service().recordTender(
      manualInput({ callerKey: key, amountCents: 2000, description: 'Replay v2' }),
    )
    expect(first.id).toBe(second.id)
    expect((await count('dues_cash_manual_sources')).rows[0].c).toBe(1)
  })

  it('accepts BANK_DEBIT expense per method matrix', async () => {
    await db.pool.query(
      "INSERT INTO contabilidad.plan_cuentas (code,name,parent_code,root_code,active,imputable) VALUES ('2.1.1.01','Proveedores','2.1.1','2',true,true) ON CONFLICT DO NOTHING",
    )
    const tender = await service().recordTender(
      manualInput({
        direction: 'EXPENSE',
        tender: 'BANK_DEBIT',
        amountCents: 5000,
        accountCode: '2.1.1.01',
        description: 'Supplier payment',
      }),
    )
    expect(tender.direction).toBe('EXPENSE')
    expect(tender.tender).toBe('BANK_DEBIT')
  })

  it('allows ADMIN to record on another operators open shift', async () => {
    const foreign = randomUUID()
    await insertForeignShift(foreign, operatorId)
    const tender = await service().recordTender(
      manualInput(
        { callerKey: `adm-${randomUUID()}`, shiftId: foreign, actorId: adminId },
        { admin: true },
      ),
    )
    expect(tender.direction).toBe('INCOME')
  })

  it('denies non-owner finance user from foreign shift', async () => {
    const foreign = randomUUID()
    await insertForeignShift(foreign, operatorId)
    await expect(
      service().recordTender(
        manualInput(
          {
            callerKey: `tes-${randomUUID()}`,
            shiftId: foreign,
            actorId: secondOperatorId,
            accountCode: undefined,
            description: undefined,
          },
          { role: 'TESORERO' },
        ),
      ),
    ).rejects.toThrow('responsibility')
  })
})
