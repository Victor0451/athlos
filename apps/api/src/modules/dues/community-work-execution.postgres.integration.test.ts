import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createDb } from '@athlos/db'
import { ErrorCode } from '@athlos/errors'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { CommunityWorkExecutionService } from './community-work-execution.ts'
import { AgreementService } from './agreements.ts'
import type { AuditContext } from './service.ts'

const testUrl = process.env.ATHLOS_TEST_DATABASE_URL
const namePattern = /^athlos_cw_execution_[0-9a-f]{32}$/
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
  '0071_community_work_approval.sql',
]

let db: ReturnType<typeof createDb>
let admin: ReturnType<typeof createDb> | undefined
let databaseName: string | undefined
let cleanup = 'not-run'
let requesterId: string
let approverId: string

const count = async (query: string, values: unknown[] = []) =>
  Number((await db.pool.query(query, values)).rows[0].count)
const obligationCounts = async (obligationId: string) => ({
  settlements: await count(
    `SELECT count(*)::int AS count FROM tesoreria.dues_settlements s WHERE s.kind='NON_CASH' AND EXISTS (SELECT 1 FROM tesoreria.dues_allocations a WHERE a.settlement_id=s.id AND a.obligation_id=$1)`,
    [obligationId],
  ),
  allocations: await count(
    'SELECT count(*)::int AS count FROM tesoreria.dues_allocations WHERE obligation_id=$1',
    [obligationId],
  ),
  works: await count(
    'SELECT count(*)::int AS count FROM tesoreria.dues_community_work WHERE obligation_id=$1',
    [obligationId],
  ),
})
const executionContext = (callerKey = randomUUID()): AuditContext => ({
  actorId: approverId,
  role: 'ADMIN',
  permissions: ['dues:settle'],
  sourceIp: '127.0.0.1',
  callerKey,
  requestFingerprint: randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64),
  authorizationEvidence: { role: 'ADMIN', permission: 'dues:settle' },
})
const terms = (amountCents: number) => ({
  amountCents,
  installments: [{ amountCents, dueDate: '2026-12-01' }],
})

async function fixtureObligation(amountCents = 10_000) {
  const socioId = randomUUID()
  const obligationId = randomUUID()
  const receiptId = randomUUID()
  await db.pool.query('INSERT INTO socios.socios VALUES ($1,$2,$3,$4,$5,$6,$7)', [
    socioId,
    `socio-${socioId.slice(0, 8)}`,
    'Community',
    'Executor',
    `dni-${socioId.slice(0, 8)}`,
    '2024-01-01',
    'activo',
  ])
  await db.pool.query(
    'INSERT INTO tesoreria.dues_generation_receipts (id,operator_id,caller_key,request_fingerprint,period_start,period_end) VALUES ($1,$2,$3,$4,$5,$6)',
    [receiptId, requesterId, `receipt-${receiptId}`, 'a'.repeat(64), '2024-01-01', '2024-02-01'],
  )
  await db.pool.query(
    'INSERT INTO tesoreria.dues_obligations (id,socio_id,kind,period_start,period_end,amount,generation_receipt_id,actor_id,snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [
      obligationId,
      socioId,
      'MONTHLY_DUES',
      '2024-01-01',
      '2024-02-01',
      `${(amountCents / 100).toFixed(2)}`,
      receiptId,
      requesterId,
      '{"inputs":{"currency":"ARS"}}',
    ],
  )
  return { socioId, obligationId, amountCents }
}

async function insertWorkToken(
  fixture: { socioId: string; obligationId: string; amountCents?: number },
  overrides: Record<string, unknown> = {},
) {
  const executionId = randomUUID()
  const values = {
    actionId: `action-${randomUUID()}`,
    executionId,
    requesterKey: `requester-${randomUUID()}`,
    status: 'approved',
    frozenAmountCents: fixture.amountCents ?? 10_000,
    agreementUuid: null as string | null,
    termsVersion: null as number | null,
    ...overrides,
  }
  const inserted = await db.pool.query(
    `INSERT INTO approval_tokens (token_hash,action_type,action_id,context_summary,created_by_operator_id,approver_channel,approver_address,expires_at,status,decided_by_operator_id,decided_at,execution_id,community_snapshot,request_reason,request_evidence,decision_reason,decision_evidence,requester_key,agreement_uuid,terms_version,actor_fingerprint)
     VALUES ($1,'dues.community-work-request',$2,'Community work fixture',$3,'email','treasury@example.test',now() + interval '1 hour',$4,$5,now(),$6,$7,'Fixture approved work','Fixture case','Approved fixture','Fixture evidence',$8,$9,$10,$11) RETURNING *`,
    [
      `hash-${randomUUID()}`,
      values.actionId,
      requesterId,
      values.status,
      approverId,
      values.executionId,
      JSON.stringify({
        memberId: fixture.socioId,
        obligations: [
          {
            obligationId: fixture.obligationId,
            currency: 'ARS',
            outstandingAmountCents: values.frozenAmountCents,
          },
        ],
      }),
      values.requesterKey,
      values.agreementUuid ?? null,
      values.termsVersion ?? null,
      'fp-exec-fixture',
    ],
  )
  return inserted.rows[0]
}
const executionCommand = (
  token: { action_id: string; execution_id: string },
  actorId = approverId,
) => ({
  requestId: token.action_id,
  executionId: token.execution_id,
  actorId,
  role: 'TESORERO' as const,
  permissions: ['dues:community-work'],
  callerKey: `exec-${randomUUID()}`,
  sourceIp: null,
})

beforeAll(async () => {
  const adminUrl = new URL(testUrl ?? 'invalid:')
  if (
    !/^postgres(?:ql)?:$/.test(adminUrl.protocol) ||
    !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(adminUrl.hostname) ||
    !/^(postgres|athlos_test)$/.test(adminUrl.pathname.slice(1))
  )
    throw new Error('ATHLOS_TEST_DATABASE_URL must name a local test PostgreSQL database')
  databaseName = `athlos_cw_execution_${randomUUID().replaceAll('-', '')}`
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
  for (const file of migrationFiles)
    await db.pool.query(
      await readFile(join(import.meta.dirname, '../../../../../packages/db/drizzle', file), 'utf8'),
    )
  requesterId = randomUUID()
  approverId = randomUUID()
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
  console.info(
    { database: databaseName, migrationHead: '0071' },
    'community work execution fixture',
  )
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
    console.info({ database: databaseName, cleanup }, 'community work execution cleanup')
  }
  if (closeError) throw closeError
}, 60_000)

it('executes an approved decision once with exact persisted effects and replays its receipt', async () => {
  const fixture = await fixtureObligation()
  const token = await insertWorkToken(fixture)
  const service = new CommunityWorkExecutionService(db.db)
  const result = await service.executeApproved(executionCommand(token))
  expect(result).toMatchObject({
    status: 'executed',
    requestId: token.action_id,
    socioId: fixture.socioId,
    obligationId: fixture.obligationId,
    amountCents: 10_000,
    currency: 'ARS',
  })
  expect(result.settlementId).toEqual(expect.any(String))
  expect(result.allocationId).toEqual(expect.any(String))
  expect(result.workId).toEqual(expect.any(String))
  expect(
    await count(
      `SELECT count(*)::int AS count FROM approval_tokens WHERE id=$1 AND used_at IS NOT NULL`,
      [token.id],
    ),
  ).toBe(1)
  expect(
    await count(
      `SELECT count(*)::int AS count FROM tesoreria.dues_community_work_executions WHERE approval_token_id=$1 AND settlement_id IS NOT NULL AND amount_cents=100.00 AND receipt IS NOT NULL`,
      [token.id],
    ),
  ).toBe(1)
  expect(
    await count(
      `SELECT count(*)::int AS count FROM audit_events WHERE action='COMMUNITY_WORK_EXECUTED' AND entity_id=$1`,
      [token.execution_id],
    ),
  ).toBe(1)
  expect(
    await count(
      `SELECT count(*)::int AS count FROM audit_events WHERE action IN ('DUES_SETTLEMENT_CREATED','DUES_ALLOCATION_CREATED','DUES_COMMUNITY_WORK_CREATED')`,
    ),
  ).toBe(3)
  const replay = await service.executeApproved(executionCommand(token))
  expect(replay).toMatchObject({
    status: 'replayed',
    workId: result.workId,
    settlementId: result.settlementId,
  })
  expect(await obligationCounts(fixture.obligationId)).toMatchObject({
    settlements: 1,
    allocations: 1,
    works: 1,
  })
  expect(
    await count('SELECT count(*)::int AS count FROM tesoreria.dues_community_work_executions'),
  ).toBe(1)
})

it('keeps an expired approval unexecutable and financially inert', async () => {
  const fixture = await fixtureObligation()
  const token = await insertWorkToken(fixture)
  await db.pool.query(
    `UPDATE approval_tokens SET expires_at = now() - interval '1 second' WHERE id = $1`,
    [token.id],
  )
  const service = new CommunityWorkExecutionService(db.db)
  await expect(service.executeApproved(executionCommand(token))).rejects.toMatchObject({
    code: ErrorCode.CONFLICT,
  })
  expect(await obligationCounts(fixture.obligationId)).toMatchObject({
    settlements: 0,
    allocations: 0,
    works: 0,
  })
  expect(
    await count(
      'SELECT count(*)::int AS count FROM tesoreria.dues_community_work_executions WHERE approval_token_id=$1',
      [token.id],
    ),
  ).toBe(0)
  expect(
    await count(
      'SELECT count(*)::int AS count FROM approval_tokens WHERE id=$1 AND used_at IS NOT NULL',
      [token.id],
    ),
  ).toBe(0)
})

it('detects a stale outstanding snapshot and writes nothing', async () => {
  const fixture = await fixtureObligation(5_000)
  const token = await insertWorkToken(fixture, { frozenAmountCents: 10_000 })
  const service = new CommunityWorkExecutionService(db.db)
  await expect(service.executeApproved(executionCommand(token))).rejects.toMatchObject({
    code: ErrorCode.CONFLICT,
  })
  expect(await obligationCounts(fixture.obligationId)).toMatchObject({
    settlements: 0,
    allocations: 0,
    works: 0,
  })
  expect(
    await count(
      'SELECT count(*)::int AS count FROM tesoreria.dues_community_work_executions WHERE approval_token_id=$1',
      [token.id],
    ),
  ).toBe(0)
  expect(
    await count(
      'SELECT count(*)::int AS count FROM approval_tokens WHERE id=$1 AND used_at IS NOT NULL',
      [token.id],
    ),
  ).toBe(0)
})

it('revalidates the frozen agreement context at execution time and writes nothing when stale', async () => {
  const fixture = await fixtureObligation()
  const agreements = new AgreementService(db.db)
  const agreement = (
    await agreements.create({
      ...executionContext(),
      socioId: fixture.socioId,
      obligationId: fixture.obligationId,
      kind: 'INSTALLMENT',
      terms: terms(6_000),
      reason: 'Work plan',
    })
  ).agreement
  const missing = await insertWorkToken(fixture, { agreementUuid: randomUUID(), termsVersion: 0 })
  const service = new CommunityWorkExecutionService(db.db)
  await expect(service.executeApproved(executionCommand(missing))).rejects.toMatchObject({
    code: ErrorCode.CONFLICT,
  })
  const drifted = await insertWorkToken(fixture, { agreementUuid: agreement.id, termsVersion: 3 })
  await expect(service.executeApproved(executionCommand(drifted))).rejects.toMatchObject({
    code: ErrorCode.CONFLICT,
  })
  expect(await obligationCounts(fixture.obligationId)).toMatchObject({
    settlements: 0,
    allocations: 0,
    works: 0,
  })
  const matching = await insertWorkToken(fixture, { agreementUuid: agreement.id, termsVersion: 0 })
  const result = await service.executeApproved(executionCommand(matching))
  expect(result.status).toBe('executed')
  expect(
    await count(
      `SELECT count(*)::int AS count FROM tesoreria.dues_community_work WHERE agreement_id=$1`,
      [agreement.id],
    ),
  ).toBe(1)
})

it('refuses a different deciding actor and writes nothing', async () => {
  const fixture = await fixtureObligation()
  const token = await insertWorkToken(fixture)
  const service = new CommunityWorkExecutionService(db.db)
  await expect(service.executeApproved(executionCommand(token, requesterId))).rejects.toMatchObject(
    { code: ErrorCode.CONFLICT },
  )
  expect(await obligationCounts(fixture.obligationId)).toMatchObject({
    settlements: 0,
    allocations: 0,
    works: 0,
  })
  expect(
    await count(
      'SELECT count(*)::int AS count FROM tesoreria.dues_community_work_executions WHERE approval_token_id=$1',
      [token.id],
    ),
  ).toBe(0)
  expect(
    await count(
      'SELECT count(*)::int AS count FROM approval_tokens WHERE id=$1 AND used_at IS NOT NULL',
      [token.id],
    ),
  ).toBe(0)
})

it('rolls back every effect when the execution audit cannot be recorded', async () => {
  const fixture = await fixtureObligation()
  const token = await insertWorkToken(fixture)
  const service = new CommunityWorkExecutionService(db.db, {
    audit: async () => {
      throw new Error('audit failure')
    },
  })
  await expect(service.executeApproved(executionCommand(token))).rejects.toThrow('audit failure')
  expect(await obligationCounts(fixture.obligationId)).toMatchObject({
    settlements: 0,
    allocations: 0,
    works: 0,
  })
  expect(
    await count(
      'SELECT count(*)::int AS count FROM tesoreria.dues_community_work_executions WHERE approval_token_id=$1',
      [token.id],
    ),
  ).toBe(0)
  expect(
    await count(
      `SELECT count(*)::int AS count FROM approval_tokens WHERE id=$1 AND used_at IS NOT NULL`,
      [token.id],
    ),
  ).toBe(0)
  expect(
    await count(
      `SELECT count(*)::int AS count FROM audit_events WHERE action='COMMUNITY_WORK_EXECUTED' AND entity_id=$1`,
      [token.execution_id],
    ),
  ).toBe(0)
})
