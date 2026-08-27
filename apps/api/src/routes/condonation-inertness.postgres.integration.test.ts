import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AuditAction, emitAudit } from '@athlos/audit'
import { createDb } from '@athlos/db'
import { createCondonationApprovalRequest, decideCondonationApproval } from '@athlos/approval'
import { ErrorCode } from '@athlos/errors'
import { afterAll, beforeAll, expect, it } from 'vitest'

const testUrl = process.env.ATHLOS_TEST_DATABASE_URL
const namePattern = /^athlos_condonation_inertness_[0-9a-f]{32}$/
const migrationFiles = [
  '0049_dues_pricing_obligations.sql',
  '0050_dues_benefit_rules.sql',
  '0051_dues_family_groups.sql',
  '0052_dues_settlements.sql',
  '0053_dues_agreements_community_work.sql',
  '0054_dues_cash_closes.sql',
  '0055_cash_policy_atomicity.sql',
  '0056_cash_recovery_policy.sql',
  '0057_cash_lifecycle_boundaries.sql',
  '0058_dues_open_agreements.sql',
  '0060_dues_settlement_reversal_unique.sql',
  '0061_dues_cash_settlement_reversal_expense.sql',
  '0062_approval_condonation_lifecycle.sql',
  '0063_approval_condonation_request_idempotency.sql',
]
const financialState = [
  [
    'obligations',
    'SELECT id,socio_id,kind,amount::text,snapshot FROM tesoreria.dues_obligations ORDER BY id',
  ],
  ['allocations', 'SELECT * FROM tesoreria.dues_allocations ORDER BY id'],
  ['settlements', 'SELECT * FROM tesoreria.dues_settlements ORDER BY id'],
  ['cash_shifts', 'SELECT * FROM tesoreria.dues_cash_shifts ORDER BY id'],
  ['cash_tenders', 'SELECT * FROM tesoreria.dues_cash_tenders ORDER BY id'],
  ['cash_closes', 'SELECT * FROM tesoreria.dues_cash_closes ORDER BY id'],
  ['cash_shift_expenses', 'SELECT * FROM tesoreria.dues_cash_shift_expenses ORDER BY id'],
  ['gasto_compensations', 'SELECT * FROM tesoreria.gasto_compensations ORDER BY id'],
  ['gasto_mutation_receipts', 'SELECT * FROM tesoreria.gasto_mutation_receipts ORDER BY id'],
  ['cash_movements', 'SELECT * FROM tesoreria.caja_movimiento ORDER BY id'],
  ['accounting_ledger', 'SELECT * FROM tesoreria.ctacte ORDER BY id'],
] as const

let db: ReturnType<typeof createDb>
let admin: ReturnType<typeof createDb> | undefined
let databaseName: string | undefined
let cleanup = 'not-run'
let requesterId: string
let approverId: string
let memberId: string
let obligationId: string

const snapshot = async () =>
  Object.fromEntries(
    await Promise.all(
      financialState.map(async ([name, query]) => {
        const rows = (await db.pool.query(query)).rows
        return [
          name,
          {
            count: rows.length,
            hash: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
          },
        ]
      }),
    ),
  )

const migrate = async () => {
  for (const file of migrationFiles) {
    const sql = await readFile(
      join(import.meta.dirname, '../../../../packages/db/drizzle', file),
      'utf8',
    )
    await db.pool.query(sql)
  }
}

beforeAll(async () => {
  if (!testUrl) throw new Error('ATHLOS_TEST_DATABASE_URL is required')
  databaseName = `athlos_condonation_inertness_${randomUUID().replaceAll('-', '')}`
  if (!namePattern.test(databaseName)) throw new Error('unsafe disposable database name')
  const adminUrl = new URL(testUrl)
  const disposableUrl = new URL(testUrl)
  adminUrl.pathname = '/postgres'
  disposableUrl.pathname = `/${databaseName}`
  admin = createDb({ connectionString: adminUrl.toString(), poolMax: 2 })
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`)
  db = createDb({ connectionString: disposableUrl.toString(), poolMax: 4 })
  await db.pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE SCHEMA socios; CREATE SCHEMA deportes; CREATE SCHEMA tesoreria;
    CREATE TABLE operators (id uuid PRIMARY KEY,username text UNIQUE NOT NULL,password_hash text NOT NULL,role char(1) NOT NULL);
    CREATE TABLE socios.socios (id uuid PRIMARY KEY,numero_socio text NOT NULL,nombre text NOT NULL,apellido text NOT NULL,dni text NOT NULL,fecha_alta date NOT NULL,estado text NOT NULL);
    CREATE TABLE deportes.disciplinas (id uuid PRIMARY KEY,codigo text UNIQUE NOT NULL,nombre text NOT NULL);
    CREATE TABLE deportes.ejercicios (id uuid PRIMARY KEY,anio integer NOT NULL,descripcion text NOT NULL,fecha_inicio date NOT NULL,fecha_fin date NOT NULL);
    CREATE TABLE deportes.inscripciones (id uuid PRIMARY KEY,socio_id uuid NOT NULL REFERENCES socios.socios,disciplina_id uuid NOT NULL REFERENCES deportes.disciplinas,ejercicio_id uuid NOT NULL REFERENCES deportes.ejercicios,estado text NOT NULL,fecha_alta date NOT NULL,fecha_baja date);
    CREATE TABLE approval_tokens (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),token_hash text UNIQUE NOT NULL,action_type text NOT NULL,action_id text NOT NULL,context_summary text NOT NULL,created_by_operator_id uuid NOT NULL REFERENCES operators(id),approver_channel text NOT NULL,approver_address text NOT NULL,expires_at timestamptz NOT NULL,used_at timestamptz,status text NOT NULL DEFAULT 'pending',created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE audit_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),operator_id uuid,action text NOT NULL,entity_type text NOT NULL,entity_id text NOT NULL,old_value jsonb,new_value jsonb,source_ip text,metadata jsonb,idempotency_key text,created_at timestamptz NOT NULL DEFAULT now());
    CREATE UNIQUE INDEX audit_idempotency_key ON audit_events (idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE TABLE tesoreria.gastos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tipo integer NOT NULL,tipo_cuenta integer NOT NULL,cuenta_principal text NOT NULL,cuenta_auxiliar integer,secuencia integer NOT NULL DEFAULT 0,comprobante text NOT NULL DEFAULT '',fecha date NOT NULL,importe text NOT NULL,iva text NOT NULL DEFAULT '0.00');
    CREATE TABLE tesoreria.caja_movimiento (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE tesoreria.ctacte (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),socio_id uuid NOT NULL,fecha date NOT NULL,tipo text NOT NULL,concepto text NOT NULL,debe numeric(14,2) NOT NULL DEFAULT 0,haber numeric(14,2) NOT NULL DEFAULT 0);
  `)
  await migrate()
  requesterId = randomUUID()
  approverId = randomUUID()
  memberId = randomUUID()
  obligationId = randomUUID()
  const receiptId = randomUUID()
  await db.pool.query(
    `INSERT INTO operators VALUES ($1,'operator','fixture','O'),($2,'treasury','fixture','A')`,
    [requesterId, approverId],
  )
  await db.pool.query(
    `INSERT INTO socios.socios VALUES ($1,'inertness-member','Inert','Member','inertness-dni',DATE '2024-01-01','activo')`,
    [memberId],
  )
  await db.pool.query(
    `INSERT INTO tesoreria.dues_generation_receipts (id,operator_id,caller_key,request_fingerprint,period_start,period_end) VALUES ($1,$2,'fixture-receipt',repeat('a',64),DATE '2024-01-01',DATE '2024-02-01')`,
    [receiptId, requesterId],
  )
  await db.pool.query(
    `INSERT INTO tesoreria.dues_obligations (id,socio_id,kind,period_start,period_end,amount,generation_receipt_id,actor_id,snapshot) VALUES ($1,$2,'MONTHLY_DUES',DATE '2024-01-01',DATE '2024-02-01',100.00,$3,$4,'{"inputs":{"currency":"ARS"}}')`,
    [obligationId, memberId, receiptId, requesterId],
  )
  console.info(
    { database: databaseName, container: 'athlos-test-pg', migrationHead: '0063' },
    'condonation inertness fixture',
  )
}, 60_000)

afterAll(async () => {
  await db?.pool.end()
  try {
    if (admin && databaseName)
      await admin.pool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
    cleanup = 'dropped'
  } finally {
    await admin?.pool.end()
    console.info(
      { database: databaseName, container: 'athlos-test-pg', cleanup },
      'condonation inertness cleanup',
    )
  }
}, 60_000)

it('keeps request, approval, rejection, replay, and conflict financially inert', async () => {
  const before = await snapshot()
  const request = {
    requestId: randomUUID(),
    contextSummary: 'Condonation review',
    requesterId,
    approverChannel: 'email' as const,
    approverAddress: 'treasury@example.test',
    snapshot: {
      memberId,
      obligations: [{ obligationId, currency: 'ARS', outstandingAmountCents: 10_000 }],
    },
    reason: 'Hardship review',
    evidence: 'Fixture evidence',
    callerKey: `request-${randomUUID()}`,
  }
  const created = await db.db.transaction(async (tx) => {
    const result = await createCondonationApprovalRequest(tx, request)
    await emitAudit(tx, {
      operatorId: requesterId,
      action: AuditAction.CONDONATION_REQUEST_CREATED,
      entityType: 'condonation_request',
      entityId: result.record.id,
      oldValue: null,
      newValue: { status: 'pending', financial_execution: false },
      sourceIp: null,
      callerKey: request.callerKey,
    })
    return result.record
  })
  expect(await snapshot()).toEqual(before)
  const approved = await db.db.transaction(async (tx) =>
    decideCondonationApproval(tx, {
      requestId: created.actionId,
      actorId: approverId,
      decision: 'approved',
      reason: 'Approved review',
      evidence: 'Treasury evidence',
    }),
  )
  expect(approved).toMatchObject({ status: 'approved', usedAt: null })
  expect(approved.executionId).toEqual(expect.any(String))
  expect(await snapshot()).toEqual(before)
  const rejectedRequest = await createCondonationApprovalRequest(db.db, {
    ...request,
    requestId: randomUUID(),
    callerKey: `reject-${randomUUID()}`,
  })
  const rejected = await decideCondonationApproval(db.db, {
    requestId: rejectedRequest.record.actionId,
    actorId: approverId,
    decision: 'rejected',
    reason: 'Rejected review',
    evidence: 'Treasury evidence',
  })
  expect(rejected).toMatchObject({ status: 'rejected', executionId: null, usedAt: null })
  expect(await snapshot()).toEqual(before)
  await expect(createCondonationApprovalRequest(db.db, request)).resolves.toMatchObject({
    record: { id: created.id },
  })
  await expect(
    createCondonationApprovalRequest(db.db, { ...request, reason: 'Changed' }),
  ).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
  expect(await snapshot()).toEqual(before)
  await expect(
    db.pool.query(
      'SELECT action,count(*)::int AS count FROM audit_events GROUP BY action ORDER BY action',
    ),
  ).resolves.toMatchObject({
    rows: [{ action: AuditAction.CONDONATION_REQUEST_CREATED, count: 1 }],
  })
  expect(cleanup).toBe('not-run')
})
