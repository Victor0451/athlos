import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createCommunityWorkApprovalRequest,
  createCondonationApprovalRequest,
  decideCommunityWorkApproval,
  listCommunityWorkLifecycle,
  listCommunityWorkQueue,
} from '@athlos/approval'
import type { CommunityWorkLifecycle, CreateCommunityWorkApprovalRequest } from '@athlos/approval'
import { createDb } from '@athlos/db'
import { ErrorCode } from '@athlos/errors'
import { afterAll, beforeAll, expect, it } from 'vitest'

const testUrl = process.env.ATHLOS_TEST_DATABASE_URL
const namePattern = /^athlos_community_work_reads_[0-9a-f]{32}$/
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
  '0071_community_work_approval.sql',
]

let db: ReturnType<typeof createDb>
let admin: ReturnType<typeof createDb> | undefined
let databaseName: string | undefined
let cleanup = 'not-run'
let requesterId: string
let otherRequesterId: string
let approverId: string
let obligationId: string

type Executor = Parameters<typeof createCommunityWorkApprovalRequest>[0]

const createRequest = async (
  executor: Executor,
  snapshotMemberId: string,
  overrides: Partial<CreateCommunityWorkApprovalRequest> = {},
) =>
  (
    await createCommunityWorkApprovalRequest(executor, {
      requestId: randomUUID(),
      contextSummary: 'Community work review',
      requesterId,
      requesterKey: `requester-key-${randomUUID()}`,
      approverChannel: 'email' as const,
      approverAddress: 'treasury@example.test',
      snapshot: {
        memberId: snapshotMemberId,
        obligations: [{ obligationId, currency: 'ARS', outstandingAmountCents: 10_000 }],
      },
      reason: 'Community work review',
      evidence: 'Fixture evidence',
      callerKey: `cw-${randomUUID()}`,
      ...overrides,
    })
  ).record

/** Same state derivation as the route DTO: a receipt row implies executed. */
const executionStatusOf = (row: CommunityWorkLifecycle) =>
  row.executionReceiptId === null ? (row.executionId ? 'recoverable' : 'unavailable') : 'executed'

/** The queue joins socios on the snapshot memberId; every queued member needs a matching row. */
const insertSocio = (id: string) =>
  db.pool.query(
    `INSERT INTO socios.socios (id, numero_socio, nombre, apellido, dni, fecha_alta, estado)
         VALUES ($1, '0042', 'Ana', 'Gorriti', '30000000', '2020-01-01', 'activo')`,
    [id],
  )

/** Same encoding the route uses to build next_cursor from a page's last row. */
const cursorOf = (row: { createdAtCursor: string; id: string } | undefined) =>
  row
    ? Buffer.from(JSON.stringify({ t: row.createdAtCursor, id: row.id })).toString('base64url')
    : undefined

beforeAll(async () => {
  if (!testUrl) throw new Error('ATHLOS_TEST_DATABASE_URL is required')
  databaseName = `athlos_community_work_reads_${randomUUID().replaceAll('-', '')}`
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
  for (const file of migrationFiles) {
    const sql = await readFile(
      join(import.meta.dirname, '../../../../packages/db/drizzle', file),
      'utf8',
    )
    await db.pool.query(sql)
  }
  requesterId = randomUUID()
  otherRequesterId = randomUUID()
  approverId = randomUUID()
  obligationId = randomUUID()
  await db.pool.query(
    `INSERT INTO operators VALUES ($1,'requester','fixture','O'),($2,'other','fixture','O'),($3,'approver','fixture','A')`,
    [requesterId, otherRequesterId, approverId],
  )
  console.info({ database: databaseName, cleanup: 'pending' }, 'community work reads fixture')
}, 60_000)

afterAll(async () => {
  await db?.pool.end()
  try {
    if (admin && databaseName) await admin.pool.query(`DROP DATABASE IF EXISTS "${databaseName}"`)
    cleanup = 'dropped'
  } finally {
    await admin?.pool.end()
    console.info({ database: databaseName, cleanup }, 'community work reads cleanup')
  }
}, 60_000)

it('isolates members by communitySnapshot memberId with no cross-member leak', async () => {
  const memberA = randomUUID()
  const memberB = randomUUID()
  await createRequest(db.db, memberA)
  await createRequest(db.db, memberA)
  const onlyB = await createRequest(db.db, memberB)
  const forA = await listCommunityWorkLifecycle(db.db, { memberId: memberA, limit: 100 })
  const forB = await listCommunityWorkLifecycle(db.db, { memberId: memberB, limit: 100 })
  expect(forA).toHaveLength(2)
  expect(forB.map((row) => row.actionId)).toEqual([onlyB.actionId])
  expect(
    forA.every((row) => (row.communitySnapshot as { memberId: string }).memberId === memberA),
  ).toBe(true)
  expect(
    forB.every((row) => (row.communitySnapshot as { memberId: string }).memberId === memberB),
  ).toBe(true)
})

it('scopes reads by requesterId only when the caller provides it', async () => {
  const member = randomUUID()
  const mine = await createRequest(db.db, member)
  const mineToo = await createRequest(db.db, member)
  const others = await createRequest(db.db, member, { requesterId: otherRequesterId })
  const unscoped = await listCommunityWorkLifecycle(db.db, { memberId: member, limit: 100 })
  const scoped = await listCommunityWorkLifecycle(db.db, {
    memberId: member,
    requesterId,
    limit: 100,
  })
  expect(unscoped).toHaveLength(3)
  expect([...scoped].map((row) => row.actionId).sort()).toEqual(
    [mine.actionId, mineToo.actionId].sort(),
  )
  expect(scoped.map((row) => row.actionId)).not.toContain(others.actionId)
})

it('never mixes condonation rows into the community-work read', async () => {
  const member = randomUUID()
  const community = await createRequest(db.db, member)
  await createCondonationApprovalRequest(db.db, {
    requestId: randomUUID(),
    contextSummary: 'Condonation review',
    requesterId,
    approverChannel: 'email' as const,
    approverAddress: 'treasury@example.test',
    snapshot: {
      memberId: member,
      obligations: [{ obligationId, currency: 'ARS', outstandingAmountCents: 10_000 }],
    },
    reason: 'Hardship review',
    evidence: 'Fixture evidence',
    callerKey: `cond-${randomUUID()}`,
  })
  const rows = await listCommunityWorkLifecycle(db.db, { memberId: member, limit: 100 })
  expect(rows.map((row) => row.actionId)).toEqual([community.actionId])
})

it('orders by createdAt desc then token id desc and respects limit', async () => {
  const member = randomUUID()
  await db.db.transaction(async (tx) => {
    for (let index = 0; index < 3; index += 1) await createRequest(tx, member)
  })
  const { rows: tokens } = await db.pool.query<{ id: string; action_id: string }>(
    `SELECT id, action_id FROM approval_tokens WHERE action_type = 'dues.community-work-request'
       AND community_snapshot->>'memberId' = $1`,
    [member],
  )
  expect(tokens).toHaveLength(3)
  // One transaction => identical created_at; PG uuid order equals lowercase hex string order.
  const expectedOrder = [...tokens]
    .sort((left, right) => (left.id < right.id ? 1 : -1))
    .map((token) => token.action_id)
  const all = await listCommunityWorkLifecycle(db.db, { memberId: member, limit: 100 })
  expect(all.map((row) => row.actionId)).toEqual(expectedOrder)
  const limited = await listCommunityWorkLifecycle(db.db, { memberId: member, limit: 2 })
  expect(limited.map((row) => row.actionId)).toEqual(expectedOrder.slice(0, 2))
})

it('derives execution_status from the executions receipt join', async () => {
  const member = randomUUID()
  const pending = await createRequest(db.db, member)
  const approved = await createRequest(db.db, member)
  const executed = await createRequest(db.db, member)
  const decided = await decideCommunityWorkApproval(db.db, {
    requestId: approved.actionId,
    actorId: approverId,
    decision: 'approved',
    reason: 'Approved review',
    evidence: 'Treasury evidence',
  })
  const executedToken = await decideCommunityWorkApproval(db.db, {
    requestId: executed.actionId,
    actorId: approverId,
    decision: 'approved',
    reason: 'Approved review',
    evidence: 'Treasury evidence',
  })
  await db.pool.query(
    `INSERT INTO tesoreria.dues_community_work_executions
       (approval_token_id, action_id, requester_key, snapshot_actor_fingerprint, receipt, amount_cents)
     VALUES ($1, $2, $3, $4, $5, 100.00)`,
    [
      executedToken.id,
      executedToken.actionId,
      executedToken.requesterKey ?? 'fixture-requester-key',
      executedToken.actorFingerprint ?? 'fixture-fingerprint',
      'fixture-receipt',
    ],
  )
  const rows = await listCommunityWorkLifecycle(db.db, { memberId: member, limit: 100 })
  const byActionId = new Map(rows.map((row) => [row.actionId, row]))
  const statusByActionId = new Map(rows.map((row) => [row.actionId, executionStatusOf(row)]))
  expect(byActionId.get(pending.actionId)).toMatchObject({
    status: 'pending',
    executionId: null,
    executionReceiptId: null,
  })
  expect(statusByActionId.get(pending.actionId)).toBe('unavailable')
  expect(byActionId.get(approved.actionId)).toMatchObject({
    executionId: decided.executionId,
    executionReceiptId: null,
  })
  expect(statusByActionId.get(approved.actionId)).toBe('recoverable')
  expect(byActionId.get(executed.actionId)).toMatchObject({
    executionId: executedToken.executionId,
  })
  expect(byActionId.get(executed.actionId)?.executionReceiptId).not.toBeNull()
  expect(statusByActionId.get(executed.actionId)).toBe('executed')
})

it("view 'actionable' excludes used, expired, and executed requests while 'all' includes them", async () => {
  // The queue reads across members; earlier fixtures have no socios match, so start clean.
  await db.pool.query('DELETE FROM tesoreria.dues_community_work_executions')
  await db.pool.query(
    "DELETE FROM approval_tokens WHERE action_type = 'dues.community-work-request'",
  )
  const member = randomUUID()
  await insertSocio(member)
  const fresh = await createRequest(db.db, member)
  const used = await createRequest(db.db, member)
  const expired = await createRequest(db.db, member)
  const executed = await createRequest(db.db, member)
  await db.pool.query('UPDATE approval_tokens SET used_at = now() WHERE id = $1', [used.id])
  await db.pool.query(
    "UPDATE approval_tokens SET expires_at = now() - interval '1 hour' WHERE id = $1",
    [expired.id],
  )
  const decided = await decideCommunityWorkApproval(db.db, {
    requestId: executed.actionId,
    actorId: approverId,
    decision: 'approved',
    reason: 'Approved review',
    evidence: 'Treasury evidence',
  })
  await db.pool.query(
    `INSERT INTO tesoreria.dues_community_work_executions
           (id, approval_token_id, action_id, requester_key, snapshot_actor_fingerprint, receipt)
         VALUES ($1, $2, $3, $4, $5, 'fixture-receipt')`,
    [
      decided.executionId,
      decided.id,
      decided.actionId,
      decided.requesterKey ?? 'fixture-requester-key',
      decided.actorFingerprint ?? 'fixture-fingerprint',
    ],
  )
  const actionable = await listCommunityWorkQueue(db.db, { view: 'actionable', limit: 100 })
  const actionableIds = actionable.map((row) => row.id)
  expect(actionableIds).toContain(fresh.id)
  expect(actionableIds).not.toContain(used.id)
  expect(actionableIds).not.toContain(expired.id)
  expect(actionableIds).not.toContain(executed.id)
  const all = await listCommunityWorkQueue(db.db, { view: 'all', limit: 100 })
  const allIds = all.map((row) => row.id)
  for (const request of [fresh, used, expired, executed]) expect(allIds).toContain(request.id)
})

it('never mixes condonation rows into the community-work queue', async () => {
  await db.pool.query('DELETE FROM tesoreria.dues_community_work_executions')
  await db.pool.query(
    "DELETE FROM approval_tokens WHERE action_type = 'dues.community-work-request'",
  )
  const member = randomUUID()
  await insertSocio(member)
  const community = await createRequest(db.db, member)
  const condonation = (
    await createCondonationApprovalRequest(db.db, {
      requestId: randomUUID(),
      contextSummary: 'Condonation review',
      requesterId,
      approverChannel: 'email' as const,
      approverAddress: 'treasury@example.test',
      snapshot: {
        memberId: member,
        obligations: [{ obligationId, currency: 'ARS', outstandingAmountCents: 10_000 }],
      },
      reason: 'Hardship review',
      evidence: 'Fixture evidence',
      callerKey: `cond-${randomUUID()}`,
    })
  ).record
  const rows = await listCommunityWorkQueue(db.db, { view: 'all', limit: 100 })
  expect(rows).toHaveLength(1)
  expect(rows[0]?.id).toBe(community.id)
  expect(rows.map((row) => row.id)).not.toContain(condonation.id)
})

it('paginates by the (createdAt, id) keyset with the desc(id) tiebreak, gap-free', async () => {
  await db.pool.query('DELETE FROM tesoreria.dues_community_work_executions')
  await db.pool.query(
    "DELETE FROM approval_tokens WHERE action_type = 'dues.community-work-request'",
  )
  const member = randomUUID()
  await insertSocio(member)
  await db.db.transaction(async (tx) => {
    for (let index = 0; index < 5; index += 1) await createRequest(tx, member)
  })
  const { rows: tokens } = await db.pool.query<{ id: string; action_id: string }>(
    `SELECT id, action_id FROM approval_tokens WHERE action_type = 'dues.community-work-request'
           AND community_snapshot->>'memberId' = $1`,
    [member],
  )
  const expectedOrder = [...tokens]
    .sort((left, right) => (left.id < right.id ? 1 : -1))
    .map((token) => token.action_id)
  const page = async (cursor?: string) =>
    listCommunityWorkQueue(db.db, {
      view: 'all',
      limit: 2,
      ...(cursor === undefined ? {} : { cursor }),
    })
  const first = await page()
  const second = await page(cursorOf(first.at(-1)))
  const third = await page(cursorOf(second.at(-1)))
  expect([first, second, third].map((rows) => rows.length)).toEqual([2, 2, 1])
  expect([...first, ...second, ...third].map((row) => row.actionId)).toEqual(expectedOrder)
  expect(await page(cursorOf(third.at(-1)))).toEqual([])
})

it('rejects a malformed cursor and never restarts from page one on a stale one', async () => {
  const member = randomUUID()
  await insertSocio(member)
  await createRequest(db.db, member)
  await expect(
    listCommunityWorkQueue(db.db, { view: 'all', limit: 10, cursor: 'not-a-cursor' }),
  ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })
  const fullPage = await listCommunityWorkQueue(db.db, { view: 'all', limit: 100 })
  const beyond = await listCommunityWorkQueue(db.db, {
    view: 'all',
    limit: 10,
    cursor: cursorOf(fullPage.at(-1)) ?? '',
  })
  expect(beyond).toEqual([])
})
