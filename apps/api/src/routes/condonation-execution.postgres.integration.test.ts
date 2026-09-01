import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AuditAction, emitAudit } from '@athlos/audit'
import { createDb } from '@athlos/db'
import { createCondonationApprovalRequest, decideCondonationApproval } from '@athlos/approval'
import { ErrorCode } from '@athlos/errors'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { CondonationExecutionService } from '../modules/dues/condonations.ts'
import { getDebt } from '../modules/dues/allocations.ts'

const testUrl = process.env.ATHLOS_TEST_DATABASE_URL
const namePattern = /^athlos_condonation_execution_[0-9a-f]{32}$/
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
  '0064_dues_condonation_treatments.sql',
]
const immutableFinancialState = [
  'SELECT id,socio_id,kind,amount::text,snapshot FROM tesoreria.dues_obligations ORDER BY id',
  'SELECT * FROM tesoreria.dues_allocations ORDER BY id',
  'SELECT * FROM tesoreria.dues_settlements ORDER BY id',
  'SELECT * FROM tesoreria.dues_cash_shifts ORDER BY id',
  'SELECT * FROM tesoreria.dues_cash_tenders ORDER BY id',
  'SELECT * FROM tesoreria.dues_cash_shift_expenses ORDER BY id',
  'SELECT * FROM tesoreria.dues_cash_closes ORDER BY id',
  'SELECT * FROM tesoreria.gastos ORDER BY id',
  'SELECT * FROM tesoreria.gasto_compensations ORDER BY id',
  'SELECT * FROM tesoreria.gasto_mutation_receipts ORDER BY id',
  'SELECT * FROM tesoreria.caja_movimiento ORDER BY id',
  'SELECT * FROM tesoreria.ctacte ORDER BY id',
]

let db: ReturnType<typeof createDb>
let admin: ReturnType<typeof createDb> | undefined
let databaseName: string | undefined
let cleanup = 'not-run'
let requesterId: string
let approverId: string
let memberId: string
let obligationId: string
let staleObligationId: string

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const snapshot = async (queries: readonly string[]) =>
  Promise.all(
    queries.map(async (query) => {
      const rows = (await db.pool.query(query)).rows
      return { count: rows.length, hash: hash(rows) }
    }),
  )
const financialSnapshot = () => snapshot(immutableFinancialState)
const treatmentSnapshot = () =>
  snapshot([
    'SELECT * FROM tesoreria.dues_condonation_executions ORDER BY execution_id',
    'SELECT * FROM tesoreria.dues_condonation_treatments ORDER BY id',
    'SELECT action,entity_id,old_value,new_value,metadata FROM audit_events ORDER BY created_at,id',
  ])

async function migrate() {
  for (const file of migrationFiles)
    await db.pool.query(
      await readFile(join(import.meta.dirname, '../../../../packages/db/drizzle', file), 'utf8'),
    )
}

async function approval(
  status: 'approved' | 'pending' | 'rejected' = 'approved',
  expired = false,
  target = obligationId,
) {
  const request = {
    requestId: randomUUID(),
    contextSummary: 'Condonation review',
    requesterId,
    approverChannel: 'email' as const,
    approverAddress: 'treasury@example.test',
    snapshot: {
      memberId,
      obligations: [{ obligationId: target, currency: 'ARS', outstandingAmountCents: 10_000 }],
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
  if (status === 'pending') return created
  const decided = await db.db.transaction(async (tx) => {
    const result = await decideCondonationApproval(tx, {
      requestId: created.actionId,
      actorId: approverId,
      decision: status,
      reason: `${status} review`,
      evidence: 'Treasury evidence',
    })
    await emitAudit(tx, {
      operatorId: approverId,
      action: AuditAction.CONDONATION_DECISION_RECORDED,
      entityType: 'condonation_request',
      entityId: created.actionId,
      oldValue: { status: 'pending' },
      newValue: { status },
      sourceIp: null,
      callerKey: `decision-${created.actionId}`,
    })
    return result
  })
  if (expired)
    await db.pool.query(
      "UPDATE approval_tokens SET expires_at = now() - interval '1 second' WHERE id = $1",
      [decided.id],
    )
  return decided
}

beforeAll(async () => {
  const adminUrl = new URL(testUrl ?? 'invalid:')
  if (
    !/^postgres(?:ql)?:$/.test(adminUrl.protocol) ||
    !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(adminUrl.hostname) ||
    !/^(postgres|athlos_test)$/.test(adminUrl.pathname.slice(1))
  )
    throw new Error('ATHLOS_TEST_DATABASE_URL must name a local test PostgreSQL database')
  databaseName = `athlos_condonation_execution_${randomUUID().replaceAll('-', '')}`
  if (!namePattern.test(databaseName)) throw new Error('unsafe disposable database name')
  const disposableUrl = new URL(adminUrl)
  disposableUrl.pathname = `/${databaseName}`
  admin = createDb({ connectionString: adminUrl.toString(), poolMax: 2 })
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`)
  db = createDb({ connectionString: disposableUrl.toString(), poolMax: 4 })
  await db.pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto')
  await db.pool.query('CREATE SCHEMA socios')
  await db.pool.query('CREATE SCHEMA deportes')
  await db.pool.query('CREATE SCHEMA tesoreria')
  await db.pool.query(
    'CREATE TABLE operators (id uuid PRIMARY KEY,username text UNIQUE NOT NULL,password_hash text NOT NULL,role char(1) NOT NULL)',
  )
  await db.pool.query(
    'CREATE TABLE socios.socios (id uuid PRIMARY KEY,numero_socio text NOT NULL,nombre text NOT NULL,apellido text NOT NULL,dni text NOT NULL,fecha_alta date NOT NULL,estado text NOT NULL)',
  )
  await db.pool.query(
    'CREATE TABLE deportes.disciplinas (id uuid PRIMARY KEY,codigo text UNIQUE NOT NULL,nombre text NOT NULL)',
  )
  await db.pool.query(
    'CREATE TABLE deportes.ejercicios (id uuid PRIMARY KEY,anio integer NOT NULL,descripcion text NOT NULL,fecha_inicio date NOT NULL,fecha_fin date NOT NULL)',
  )
  await db.pool.query(
    'CREATE TABLE deportes.inscripciones (id uuid PRIMARY KEY,socio_id uuid NOT NULL REFERENCES socios.socios,disciplina_id uuid NOT NULL REFERENCES deportes.disciplinas,ejercicio_id uuid NOT NULL REFERENCES deportes.ejercicios,estado text NOT NULL,fecha_alta date NOT NULL,fecha_baja date)',
  )
  await db.pool.query(
    "CREATE TABLE approval_tokens (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),token_hash text UNIQUE NOT NULL,action_type text NOT NULL,action_id text NOT NULL,context_summary text NOT NULL,created_by_operator_id uuid NOT NULL REFERENCES operators(id),approver_channel text NOT NULL,approver_address text NOT NULL,expires_at timestamptz NOT NULL,used_at timestamptz,status text NOT NULL DEFAULT 'pending',created_at timestamptz NOT NULL DEFAULT now())",
  )
  await db.pool.query(
    'CREATE TABLE audit_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),operator_id uuid,action text NOT NULL,entity_type text NOT NULL,entity_id text NOT NULL,old_value jsonb,new_value jsonb,source_ip text,metadata jsonb,idempotency_key text,created_at timestamptz NOT NULL DEFAULT now())',
  )
  await db.pool.query(
    'CREATE UNIQUE INDEX audit_idempotency_key ON audit_events (idempotency_key) WHERE idempotency_key IS NOT NULL',
  )
  await db.pool.query(
    "CREATE TABLE tesoreria.gastos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tipo integer NOT NULL,tipo_cuenta integer NOT NULL,cuenta_principal text NOT NULL,cuenta_auxiliar integer,secuencia integer NOT NULL DEFAULT 0,comprobante text NOT NULL DEFAULT '',fecha date NOT NULL,importe text NOT NULL,iva text NOT NULL DEFAULT '0.00')",
  )
  await db.pool.query(
    'CREATE TABLE tesoreria.caja_movimiento (id uuid PRIMARY KEY DEFAULT gen_random_uuid())',
  )
  await db.pool.query(
    'CREATE TABLE tesoreria.ctacte (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),socio_id uuid NOT NULL,fecha date NOT NULL,tipo text NOT NULL,concepto text NOT NULL,debe numeric(14,2) NOT NULL DEFAULT 0,haber numeric(14,2) NOT NULL DEFAULT 0)',
  )
  await migrate()
  requesterId = randomUUID()
  approverId = randomUUID()
  memberId = randomUUID()
  obligationId = randomUUID()
  staleObligationId = randomUUID()
  await db.pool.query('INSERT INTO operators VALUES ($1,$2,$3,$4)', [
    requesterId,
    'operator',
    'fixture',
    'O',
  ])
  await db.pool.query('INSERT INTO operators VALUES ($1,$2,$3,$4)', [
    approverId,
    'treasury',
    'fixture',
    'A',
  ])
  await db.pool.query('INSERT INTO socios.socios VALUES ($1,$2,$3,$4,$5,$6,$7)', [
    memberId,
    'execution-member',
    'Execution',
    'Member',
    'execution-dni',
    '2024-01-01',
    'activo',
  ])
  const receiptId = randomUUID()
  await db.pool.query(
    'INSERT INTO tesoreria.dues_generation_receipts (id,operator_id,caller_key,request_fingerprint,period_start,period_end) VALUES ($1,$2,$3,$4,$5,$6)',
    [receiptId, requesterId, 'fixture-receipt', 'a'.repeat(64), '2024-01-01', '2024-02-01'],
  )
  await db.pool.query(
    'INSERT INTO tesoreria.dues_obligations (id,socio_id,kind,period_start,period_end,amount,generation_receipt_id,actor_id,snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [
      obligationId,
      memberId,
      'MONTHLY_DUES',
      '2024-01-01',
      '2024-02-01',
      '100.00',
      receiptId,
      requesterId,
      '{"inputs":{"currency":"ARS"}}',
    ],
  )
  await db.pool.query(
    'INSERT INTO tesoreria.dues_obligations (id,socio_id,kind,period_start,period_end,amount,generation_receipt_id,actor_id,snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [
      staleObligationId,
      memberId,
      'MONTHLY_DUES',
      '2024-02-01',
      '2024-03-01',
      '100.00',
      receiptId,
      requesterId,
      '{"inputs":{"currency":"ARS"}}',
    ],
  )
  console.info({ database: databaseName, migrationHead: '0064' }, 'condonation execution fixture')
}, 60_000)

afterAll(async () => {
  let closeError: unknown
  try {
    await db?.pool.end()
  } catch (error) {
    closeError = error
  }
  try {
    if (admin && databaseName) await admin.pool.query(`DROP DATABASE IF EXISTS "${databaseName}"`)
    cleanup = 'dropped'
  } finally {
    await admin?.pool.end()
    console.info({ database: databaseName, cleanup }, 'condonation execution cleanup')
  }
  if (closeError) throw closeError
}, 60_000)

it('executes an approved condonation once without cash or accounting mutation', async () => {
  const approved = await approval()
  const executionId = approved.executionId!
  const service = new CondonationExecutionService(db.db)
  const beforeFinancial = await financialSnapshot()
  const beforeDebt = await getDebt(db.db, memberId)
  const beforeTreatments = await treatmentSnapshot()
  const result = await service.executeApproved({
    requestId: approved.actionId,
    executionId,
    actorId: approverId,
    callerKey: `execute-${randomUUID()}`,
    sourceIp: null,
  })
  expect(result).toEqual({
    status: 'executed',
    executionId,
    approvalId: approved.id,
    memberId,
    actorId: approverId,
    currency: 'ARS',
    totalAmountCents: 10_000,
    treatments: [{ obligationId, amountCents: 10_000 }],
    treatmentIds: expect.any(Array),
    snapshot: {
      memberId,
      obligations: [{ obligationId, currency: 'ARS', outstandingAmountCents: 10_000 }],
    },
    reason: 'Hardship review',
    evidence: 'Fixture evidence',
  })
  expect(Object.hasOwn(result, 'totalAmount')).toBe(false)
  expect(
    (await db.pool.query('SELECT used_at FROM approval_tokens WHERE id = $1', [approved.id]))
      .rows[0]?.used_at,
  ).toEqual(expect.any(Date))
  expect(await getDebt(db.db, memberId)).toMatchObject({
    totalCents: beforeDebt.totalCents - 10_000,
  })
  expect((await getDebt(db.db, memberId)).obligations).toContainEqual(
    expect.objectContaining({ id: obligationId, outstandingCents: 0 }),
  )
  expect(await financialSnapshot()).toEqual(beforeFinancial)
  expect((await treatmentSnapshot()).slice(0, 2)).not.toEqual(beforeTreatments.slice(0, 2))
  const after = await treatmentSnapshot()
  const replay = await service.executeApproved({
    requestId: approved.actionId,
    executionId,
    actorId: approverId,
    callerKey: `replay-${randomUUID()}`,
    sourceIp: null,
  })
  expect(replay).toEqual({ ...result, status: 'replayed' })
  expect(await treatmentSnapshot()).toEqual(after)
  await expect(
    service.execute({
      executionId,
      actorId: approverId,
      memberId: randomUUID(),
      obligationIds: [obligationId],
    }),
  ).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
  expect(await treatmentSnapshot()).toEqual(after)
  await expect(
    db.pool.query(
      'SELECT action,count(*)::int AS count FROM audit_events GROUP BY action ORDER BY action',
    ),
  ).resolves.toMatchObject({
    rows: [
      { action: AuditAction.CONDONATION_DECISION_RECORDED, count: 1 },
      { action: AuditAction.CONDONATION_EXECUTED, count: 1 },
      { action: AuditAction.CONDONATION_REQUEST_CREATED, count: 1 },
    ],
  })
  const stale = await approval('approved', false, staleObligationId)
  const prior = await approval('approved', false, staleObligationId)
  await expect(
    service.executeApproved({
      requestId: prior.actionId,
      executionId: prior.executionId!,
      actorId: approverId,
      callerKey: `prior-${randomUUID()}`,
      sourceIp: null,
    }),
  ).resolves.toMatchObject({
    status: 'executed',
    executionId: prior.executionId,
    approvalId: prior.id,
    treatments: [{ obligationId: staleObligationId, amountCents: 10_000 }],
  })
  const beforeStale = await Promise.all([financialSnapshot(), treatmentSnapshot()])
  await expect(
    service.executeApproved({
      requestId: stale.actionId,
      executionId: stale.executionId!,
      actorId: approverId,
      callerKey: `stale-${randomUUID()}`,
      sourceIp: null,
    }),
  ).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
  await expect(Promise.all([financialSnapshot(), treatmentSnapshot()])).resolves.toEqual(
    beforeStale,
  )
  for (const authorization of [
    await approval('pending'),
    await approval('rejected'),
    await approval('approved', true),
  ]) {
    const beforeRejected = await Promise.all([financialSnapshot(), treatmentSnapshot()])
    await expect(
      service.executeApproved({
        requestId: authorization.actionId,
        executionId: authorization.executionId ?? randomUUID(),
        actorId: approverId,
        callerKey: `rejected-${randomUUID()}`,
        sourceIp: null,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT })
    await expect(Promise.all([financialSnapshot(), treatmentSnapshot()])).resolves.toEqual(
      beforeRejected,
    )
  }
  expect(cleanup).toBe('not-run')
})
