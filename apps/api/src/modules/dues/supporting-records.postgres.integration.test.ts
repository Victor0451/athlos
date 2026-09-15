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

const DUES_PATH =
  '[{"code":"4","name":"Ingresos"},{"code":"4.1","name":"Ingresos Operativos"},{"code":"4.1.01","name":"Cuotas sociales"}]'

beforeAll(async () => {
  if (!url) throw new Error('ATHLOS_TEST_DATABASE_URL is required')
  admin = createDb({ connectionString: new URL(url).toString(), poolMax: 2 })
  const dbName = `athlos_u6a_${randomUUID().replaceAll('-', '')}`
  await admin.pool.query(`CREATE DATABASE "${dbName}"`)
  const dbUrl = new URL(url)
  dbUrl.pathname = `/${dbName}`
  db = createDb({ connectionString: dbUrl.toString(), poolMax: 4 })
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
      INSERT INTO public.operators VALUES ('${operatorId}','O'),('${adminId}','A'),('${secondOperatorId}','O');
    `)
    const directory = join(import.meta.dirname, '../../../../../packages/db/drizzle')
    for (const f of [
      '0054_dues_cash_closes.sql',
      '0055_cash_policy_atomicity.sql',
      '0056_cash_recovery_policy.sql',
      '0057_cash_lifecycle_boundaries.sql',
      '0066_plan_cuentas.sql',
      '0070_cash_manual_sources.sql',
      '0072_cash_supporting_records.sql',
    ]) {
      await conn.query(await readFile(join(directory, f), 'utf8'))
    }
    await conn.query(
      `INSERT INTO tesoreria.dues_cash_shifts (id,desk_id,assigned_operator_id,opening_tenders,operator_id,authorization_evidence,caller_key,request_fingerprint,business_date,opened_at) VALUES ('${shiftId}','u6a-fixture','${operatorId}','{}','${operatorId}','{}','shift-key','${'e'.repeat(64)}',CURRENT_DATE,NOW())`,
    )
  } finally {
    conn.release()
  }
})

afterAll(async () => {
  if (db) await db.pool.end()
  if (admin) await admin.pool.end()
})

let sourceSeq = 0
async function insertManualSource(): Promise<string> {
  const conn = await db.pool.connect()
  try {
    const tenderId = randomUUID()
    await conn.query(
      `INSERT INTO tesoreria.dues_cash_tenders (id,shift_id,direction,tender,amount,source_type,reason,operator_id,caller_key,request_fingerprint) VALUES ($1,$2,'INCOME','CASH',150.00,'MANUAL','Fixture movement',$3,$4,$5)`,
      [tenderId, shiftId, operatorId, `u6a-tender-${++sourceSeq}`, 'f'.repeat(64)],
    )
    const result = await conn.query(
      `INSERT INTO tesoreria.dues_cash_manual_sources (tender_id,account_code_snapshot,account_name_snapshot,account_path_snapshot,description) VALUES ($1,'4.1.01','Cuotas sociales',$2,'Fixture manual source') RETURNING id`,
      [tenderId, DUES_PATH],
    )
    return result.rows[0].id as string
  } finally {
    conn.release()
  }
}

type ColumnValue = string | number | null | unknown[] | Record<string, unknown>
function insertRecord(values: Record<string, ColumnValue>) {
  const keys = Object.keys(values)
  const params = keys.map((key) => {
    const value = values[key]
    return typeof value === 'object' && value !== null ? JSON.stringify(value) : value
  })
  return db.pool.query(
    `INSERT INTO tesoreria.dues_cash_supporting_records (${keys.join(',')}) VALUES (${keys.map((_, index) => `$${index + 1}`).join(',')}) RETURNING *`,
    params,
  )
}

const external = (sourceId: string, overrides: Record<string, ColumnValue> = {}) => ({
  manual_source_id: sourceId,
  kind: 'EXTERNAL',
  doc_type: 'FACTURA_B',
  issuer: 'Proveedor Feria',
  point_of_sale: '00001',
  doc_number: '00000042',
  issue_date: '2026-09-15',
  currency: 'ARS',
  total: '1000.00',
  prior_references: [] as unknown[],
  tax_components: [] as unknown[],
  ...overrides,
})

const tax = (label: string, cents: number, semantic: string) => ({
  label,
  amount_cents: cents,
  semantic,
})

describe('U6-A supporting-record persistence', () => {
  it('retains leading-zero references and one optional record per manual source', async () => {
    const sourceId = await insertManualSource()
    const saved = await insertRecord(external(sourceId))
    expect(saved.rows[0].point_of_sale).toBe('00001')
    expect(saved.rows[0].doc_number).toBe('00000042')
    expect(saved.rows[0].total).toBe('1000.00')
    await expect(insertRecord(external(sourceId))).rejects.toMatchObject({ code: '23505' })
  })

  it('keeps internal evidence unnumbered and distinct from external documents', async () => {
    const sourceId = await insertManualSource()
    const saved = await insertRecord({
      manual_source_id: sourceId,
      kind: 'INTERNAL',
      issuer: 'Tesorería club',
      total: '1000.00',
    })
    expect(saved.rows[0].kind).toBe('INTERNAL')
    expect(saved.rows[0].doc_number).toBeNull()
    await expect(
      insertRecord(
        external(await insertManualSource(), { kind: 'INTERNAL', doc_number: '00000042' }),
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('requires a whitelisted external document type and retains historical M', async () => {
    await expect(
      insertRecord(external(await insertManualSource(), { doc_type: null })),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      insertRecord(external(await insertManualSource(), { doc_type: 'FACTURA_Z' })),
    ).rejects.toMatchObject({ code: '23514' })
    const saved = await insertRecord(
      external(await insertManualSource(), {
        doc_type: 'FACTURA_M',
        legend: 'Operación sujeta a retención',
      }),
    )
    expect(saved.rows[0].doc_type).toBe('FACTURA_M')
    expect(saved.rows[0].legend).toBe('Operación sujeta a retención')
  })

  it('blocks credit and debit notes without a prior-document reference', async () => {
    await expect(
      insertRecord(external(await insertManualSource(), { doc_type: 'NOTA_CREDITO' })),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      insertRecord(
        external(await insertManualSource(), {
          doc_type: 'NOTA_DEBITO',
          prior_references: ['   '],
        }),
      ),
    ).rejects.toMatchObject({ code: '23514' })
    const saved = await insertRecord(
      external(await insertManualSource(), {
        doc_type: 'NOTA_CREDITO',
        prior_references: ['00001-00000041'],
      }),
    )
    expect(saved.rows[0].prior_references).toEqual(['00001-00000041'])
  })

  it('rejects additive tax components that do not reconcile to the total', async () => {
    await expect(
      insertRecord(
        external(await insertManualSource(), {
          tax_components: [tax('Neto gravado', 79000, 'ADDITIVE')],
        }),
      ),
    ).rejects.toMatchObject({ code: '23514' })
    const saved = await insertRecord(
      external(await insertManualSource(), {
        tax_components: [tax('Neto gravado', 79000, 'ADDITIVE'), tax('IVA 21%', 21000, 'ADDITIVE')],
      }),
    )
    expect(saved.rows[0].total).toBe('1000.00')
  })

  it('keeps contained taxes informational without inferring semantics from equal amounts', async () => {
    const saved = await insertRecord(
      external(await insertManualSource(), {
        tax_components: [tax('IVA Contenido', 21000, 'CONTAINED')],
      }),
    )
    expect(saved.rows[0].total).toBe('1000.00')
    const equal = await insertRecord(
      external(await insertManualSource(), {
        tax_components: [
          tax('Percepción IIBB', 100000, 'ADDITIVE'),
          tax('IVA Contenido', 100000, 'CONTAINED'),
        ],
      }),
    )
    expect(equal.rows[0].tax_components).toHaveLength(2)
  })

  it('rejects malformed tax components', async () => {
    for (const component of [
      tax('Monto cero', 0, 'ADDITIVE'),
      tax('Monto negativo', -100, 'CONTAINED'),
      { label: 'Fraccionado', amount_cents: 10.5, semantic: 'ADDITIVE' },
      { label: 'Semántica inventada', amount_cents: 100000, semantic: 'MAYBE' },
      { label: '  ', amount_cents: 100000, semantic: 'ADDITIVE' },
    ]) {
      await expect(
        insertRecord(external(await insertManualSource(), { tax_components: [component] })),
      ).rejects.toMatchObject({ code: '23514' })
    }
  })

  it('is append-only, source-linked, and never a payment', async () => {
    const sourceId = await insertManualSource()
    const saved = await insertRecord(external(sourceId))
    const recordId = saved.rows[0].id
    await expect(
      db.pool.query(`UPDATE tesoreria.dues_cash_supporting_records SET total='1.00' WHERE id=$1`, [
        recordId,
      ]),
    ).rejects.toMatchObject({ code: '55000' })
    await expect(
      db.pool.query(`DELETE FROM tesoreria.dues_cash_supporting_records WHERE id=$1`, [recordId]),
    ).rejects.toMatchObject({ code: '55000' })
    await expect(insertRecord(external(randomUUID()))).rejects.toMatchObject({ code: '23503' })
    const columns = Object.keys(saved.rows[0])
    expect(columns).not.toEqual(expect.arrayContaining(['amount', 'tender', 'direction']))
  })
})

describe('U6-B supporting-record service on real PostgreSQL', () => {
  const command = (
    actorId: string,
    role: 'ADMIN' | 'TESORERO' | 'OPERADOR',
    manualSourceId: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    actorId,
    role,
    permissions: [] as string[],
    sourceIp: '127.0.0.1',
    callerKey: `u6b-${randomUUID()}`,
    requestFingerprint: 'a'.repeat(64),
    authorizationEvidence: {},
    manualSourceId,
    kind: 'EXTERNAL' as const,
    docType: 'FACTURA_B',
    issuer: 'Proveedor Feria',
    pointOfSale: '00001',
    docNumber: '00000043',
    totalCents: 100000,
    currency: 'ARS',
    taxComponents: [
      { label: 'Neto gravado', amountCents: 79000, semantic: 'ADDITIVE' as const },
      { label: 'IVA 21%', amountCents: 21000, semantic: 'ADDITIVE' as const },
    ],
    ...overrides,
  })
  const service = () => new CashDeskService(db.db)

  it('creates, audits, and reads back one supporting record per manual source', async () => {
    const sourceId = await insertManualSource()
    const created = await service().recordSupporting(command(operatorId, 'OPERADOR', sourceId))
    expect(created.pointOfSale).toBe('00001')
    expect(created.docNumber).toBe('00000043')
    expect(created.totalCents).toBe(100000)
    expect(created.taxComponents).toHaveLength(2)
    const audit = await db.pool.query(
      `SELECT action, metadata FROM public.audit_events WHERE entity_id=$1`,
      [created.id],
    )
    expect(audit.rows[0].action).toBe('DUES_CASH_SUPPORTING_RECORDED')
    const detail = await service().manualSourceDetail(command(operatorId, 'OPERADOR', sourceId))
    expect(detail.source.id).toBe(sourceId)
    expect(detail.supportingRecord?.docNumber).toBe('00000043')
    await expect(
      service().recordSupporting(command(operatorId, 'OPERADOR', sourceId)),
    ).rejects.toThrow('Manual cash source already has a supporting record')
  })

  it('enforces ownership: foreign operators denied, ADMIN cross-shift allowed', async () => {
    const sourceId = await insertManualSource()
    await expect(
      service().recordSupporting(command(secondOperatorId, 'OPERADOR', sourceId)),
    ).rejects.toThrow('Cash shift responsibility does not match the operator')
    await expect(
      service().manualSourceDetail(command(secondOperatorId, 'OPERADOR', sourceId)),
    ).rejects.toThrow('Cash shift responsibility does not match the operator')
    const created = await service().recordSupporting(command(adminId, 'ADMIN', sourceId))
    expect(created.id).toBeTruthy()
  })

  it('rejects additive mismatches atomically without leaving a record', async () => {
    const sourceId = await insertManualSource()
    await expect(
      service().recordSupporting(
        command(operatorId, 'OPERADOR', sourceId, {
          taxComponents: [{ label: 'Neto gravado', amountCents: 79000, semantic: 'ADDITIVE' }],
        }),
      ),
    ).rejects.toThrow('Additive tax components must reconcile exactly to the document total')
    const remaining = await db.pool.query(
      `SELECT COUNT(*)::int AS count FROM tesoreria.dues_cash_supporting_records WHERE manual_source_id=$1`,
      [sourceId],
    )
    expect(remaining.rows[0].count).toBe(0)
  })
})
