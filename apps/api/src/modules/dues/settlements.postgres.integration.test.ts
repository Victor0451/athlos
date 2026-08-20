import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createDb } from '@athlos/db'
import { AuditAction } from '@athlos/audit'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { insertObligation, claimReceipt, type ObligationInput } from './repository.ts'
import { SettlementService } from './settlements.ts'
import { AgreementService } from './agreements.ts'
import { CommunityWorkService } from './community-work.ts'
import { CtacteProjectionService } from './ctacte-projection.ts'
import type { AuditContext } from './service.ts'

const url = process.env.ATHLOS_TEST_DATABASE_URL
let db: ReturnType<typeof createDb>
let admin: ReturnType<typeof createDb> | undefined
let isolatedDatabaseName: string | undefined
let operatorId: string
const period = (year: number, month: number) => ({
  start: `${year}-${String(month).padStart(2, '0')}-01`,
  end: month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`,
})
const context = (key: string = randomUUID()): AuditContext => ({
  actorId: operatorId,
  role: 'ADMIN',
  permissions: ['dues:settle'],
  sourceIp: '127.0.0.1',
  callerKey: key,
  requestFingerprint: randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64),
  authorizationEvidence: { role: 'ADMIN', permission: 'dues:settle' },
})
const member = async () => {
  const id = randomUUID()
  await db.pool.query(
    `INSERT INTO socios.socios (id,numero_socio,nombre,apellido,dni,fecha_alta,estado) VALUES ($1,$2,'Settlement','Fixture',$3,DATE '2024-01-01','activo')`,
    [id, `settlement-${id}`, `dni-${id}`],
  )
  return id
}
const obligation = async (
  socioId: string,
  amountCents: number,
  p: { start: string; end: string },
) => {
  const receipt = await claimReceipt(db.db, {
    operatorId,
    callerKey: randomUUID(),
    requestFingerprint: randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64),
    periodStart: p.start,
    periodEnd: p.end,
    authorizationEvidence: { source: 'fixture' },
  })
  const input: ObligationInput = {
    socioId,
    periodStart: p.start,
    periodEnd: p.end,
    amountCents,
    generationReceiptId: receipt.receipt.id,
    actorId: operatorId,
    snapshot: { source: 'fixture' },
    authorizationEvidence: { source: 'fixture' },
    components: [
      {
        kind: 'BASE',
        componentKey: `base-${randomUUID()}`,
        amountCents,
        calculationInputs: {},
        eligibilitySnapshot: {},
        priceSnapshot: {},
      },
    ],
  }
  return (await insertObligation(db.db, input)).obligation.id
}
const terms = (amountCents: number, installments = 3, firstDate = '2099-01-01') => ({
  amountCents,
  installments: Array.from({ length: installments }, (_, index) => ({
    amountCents:
      index === installments - 1
        ? amountCents - Math.floor(amountCents / installments) * index
        : Math.floor(amountCents / installments),
    dueDate: `${firstDate.slice(0, 8)}${String(Number(firstDate.slice(-2)) + index).padStart(2, '0')}`,
  })),
})

beforeAll(async () => {
  if (!url) throw new Error('ATHLOS_TEST_DATABASE_URL is required')
  isolatedDatabaseName = `athlos_dues_settlement_${randomUUID().replaceAll('-', '')}`
  const adminUrl = new URL(url)
  adminUrl.pathname = '/postgres'
  const isolatedUrl = new URL(url)
  isolatedUrl.pathname = `/${isolatedDatabaseName}`
  admin = createDb({ connectionString: adminUrl.toString(), poolMax: 2 })
  await admin.pool.query(`CREATE DATABASE "${isolatedDatabaseName}"`)
  db = createDb({ connectionString: isolatedUrl.toString(), poolMax: 8 })
  operatorId = randomUUID()
  await db.pool.query(
    `CREATE SCHEMA IF NOT EXISTS socios; CREATE SCHEMA IF NOT EXISTS deportes; CREATE TABLE IF NOT EXISTS public.operators (id uuid PRIMARY KEY,username text UNIQUE NOT NULL,password_hash text NOT NULL,role char(1) NOT NULL); CREATE TABLE IF NOT EXISTS socios.socios (id uuid PRIMARY KEY,numero_socio text NOT NULL,nombre text NOT NULL,apellido text NOT NULL,dni text NOT NULL,fecha_alta date NOT NULL,estado text NOT NULL); CREATE TABLE IF NOT EXISTS deportes.disciplinas (id uuid PRIMARY KEY,codigo text UNIQUE NOT NULL,nombre text NOT NULL); CREATE TABLE IF NOT EXISTS deportes.ejercicios (id uuid PRIMARY KEY,anio integer NOT NULL,descripcion text NOT NULL,fecha_inicio date NOT NULL,fecha_fin date NOT NULL); CREATE TABLE IF NOT EXISTS deportes.inscripciones (id uuid PRIMARY KEY,socio_id uuid NOT NULL REFERENCES socios.socios,disciplina_id uuid NOT NULL REFERENCES deportes.disciplinas,ejercicio_id uuid NOT NULL REFERENCES deportes.ejercicios,estado text NOT NULL,fecha_alta date NOT NULL,fecha_baja date)`,
  )
  await db.pool.query(
    `INSERT INTO public.operators (id,username,password_hash,role) VALUES ($1,$2,'fixture','A') ON CONFLICT DO NOTHING`,
    [operatorId, `settlement-${operatorId}`],
  )
  await db.pool.query(
    'DROP TABLE IF EXISTS tesoreria.dues_community_work, tesoreria.dues_agreements CASCADE',
  )
  const files = [
    '0049_dues_pricing_obligations.sql',
    '0050_dues_benefit_rules.sql',
    '0051_dues_family_groups.sql',
    '0052_dues_settlements.sql',
    '0053_dues_agreements_community_work.sql',
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
    `CREATE TABLE IF NOT EXISTS public.audit_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),operator_id uuid,action text NOT NULL,entity_type text NOT NULL,entity_id text NOT NULL,old_value jsonb,new_value jsonb,source_ip text,metadata jsonb,idempotency_key text,created_at timestamptz NOT NULL DEFAULT now()); CREATE UNIQUE INDEX IF NOT EXISTS settlement_audit_key ON public.audit_events (idempotency_key) WHERE idempotency_key IS NOT NULL; CREATE TABLE IF NOT EXISTS tesoreria.caja_movimiento (id uuid PRIMARY KEY DEFAULT gen_random_uuid()); CREATE TABLE IF NOT EXISTS tesoreria.ctacte (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),socio_id uuid NOT NULL,fecha date NOT NULL,tipo text NOT NULL,concepto text NOT NULL,debe numeric(14,2) NOT NULL DEFAULT 0,haber numeric(14,2) NOT NULL DEFAULT 0,legacy_id text UNIQUE,idempotency_key text UNIQUE,idempotency_operator_id uuid); ALTER TABLE tesoreria.ctacte ADD COLUMN IF NOT EXISTS legacy_id text; CREATE UNIQUE INDEX IF NOT EXISTS projection_ctacte_legacy_id_unique ON tesoreria.ctacte (legacy_id) WHERE legacy_id IS NOT NULL`,
  )
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

it('runs the projection fixture in a disposable database', async () => {
  const currentDatabase = (
    await db.pool.query<{ name: string }>('SELECT current_database() AS name')
  ).rows[0]?.name
  const configuredDatabase = new URL(url!).pathname.slice(1)

  expect(currentDatabase).not.toBe(configuredDatabase)
})

// prettier-ignore
it('allocates only the explicitly selected obligation and reports aging',async()=>{const socioId=await member(),first=await obligation(socioId,10_000,period(2500,1)),second=await obligation(socioId,20_000,period(2500,2)),service=new SettlementService(db.db); await service.create({...context(),socioId,kind:'MONETARY',amountCents:5_000,currency:'ARS',evidence:{},allocations:[{obligationId:second,amountCents:5_000}]}); await expect(service.debt({role:'TESORERO',socioId})).resolves.toMatchObject({totalCents:25_000,obligations:[{id:first,outstandingCents:10_000},{id:second,outstandingCents:15_000}]})})
// prettier-ignore
it('keeps non-cash settlement out of cash income and replays idempotently',async()=>{const socioId=await member(),target=await obligation(socioId,8_000,period(2500,3)),key=`noncash-${randomUUID()}`,beforeCash=(await db.pool.query('SELECT count(*)::int AS count FROM tesoreria.caja_movimiento')).rows[0].count,service=new SettlementService(db.db),input={...context(key),socioId,kind:'NON_CASH' as const,amountCents:8_000,currency:'ARS',evidence:{approval:'fixture'},reason:'Approved non-cash value',allocations:[{obligationId:target,amountCents:8_000}]}; const first=await service.create(input),replay=await service.create(input); expect(replay).toEqual(first); expect((await db.pool.query('SELECT count(*)::int AS count FROM tesoreria.dues_settlements WHERE caller_key=$1',[key])).rows[0].count).toBe(1); expect((await db.pool.query('SELECT count(*)::int AS count FROM tesoreria.dues_allocations WHERE settlement_id=$1',[first.settlementId])).rows[0].count).toBe(1); expect((await db.pool.query('SELECT count(*)::int AS count FROM tesoreria.caja_movimiento')).rows[0].count).toBe(beforeCash); await expect(db.pool.query('SELECT action FROM public.audit_events WHERE entity_id=$1',[first.settlementId])).resolves.toMatchObject({rows:[{action:AuditAction.DUES_SETTLEMENT_CREATED}]})})
// prettier-ignore
it('reverses by compensation without deleting the original allocation',async()=>{const socioId=await member(),target=await obligation(socioId,6_000,period(2500,4)),service=new SettlementService(db.db),created=await service.create({...context(),socioId,kind:'MONETARY',amountCents:6_000,currency:'ARS',evidence:{},allocations:[{obligationId:target,amountCents:6_000}]}),reversed=await service.reverse({...context(),settlementId:created.settlementId,allocationId:created.allocations[0]!.id,reason:'Incorrect allocation'}); expect(reversed).toMatchObject({kind:'MONETARY',amountCents:6_000}); expect((await db.pool.query('SELECT count(*)::int AS count FROM tesoreria.dues_allocations WHERE obligation_id=$1',[target])).rows[0].count).toBe(2); await expect(service.debt({role:'TESORERO',socioId})).resolves.toMatchObject({totalCents:6_000,obligations:[{id:target,outstandingCents:6_000}]})})

it('serializes different-key allocations for one obligation', async () => {
  const socioId = await member()
  const target = await obligation(socioId, 10_000, period(2500, 5))
  const service = new SettlementService(db.db)
  const inputs = [
    {
      ...context(`allocation-a-${randomUUID()}`),
      socioId,
      kind: 'MONETARY' as const,
      amountCents: 6_000,
      currency: 'ARS',
      evidence: {},
      allocations: [{ obligationId: target, amountCents: 6_000 }],
    },
    {
      ...context(`allocation-b-${randomUUID()}`),
      socioId,
      kind: 'MONETARY' as const,
      amountCents: 6_000,
      currency: 'ARS',
      evidence: {},
      allocations: [{ obligationId: target, amountCents: 6_000 }],
    },
  ]
  const outcomes = await Promise.allSettled(inputs.map((input) => service.create(input)))
  expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
  expect(outcomes.filter((outcome) => outcome.status === 'rejected')[0]).toMatchObject({
    reason: { code: 'CONFLICT' },
  })
  await expect(service.debt({ role: 'TESORERO', socioId })).resolves.toMatchObject({
    totalCents: 4_000,
  })
})

it('maps concurrent different-key duplicate reversals to one success and one conflict', async () => {
  const socioId = await member()
  const target = await obligation(socioId, 8_000, period(2500, 6))
  const service = new SettlementService(db.db)
  const created = await service.create({
    ...context(),
    socioId,
    kind: 'MONETARY',
    amountCents: 8_000,
    currency: 'ARS',
    evidence: {},
    allocations: [{ obligationId: target, amountCents: 8_000 }],
  })
  const reversals = await Promise.allSettled([
    service.reverse({
      ...context(`reverse-a-${randomUUID()}`),
      settlementId: created.settlementId,
      allocationId: created.allocations[0]!.id,
      reason: 'Duplicate correction',
    }),
    service.reverse({
      ...context(`reverse-b-${randomUUID()}`),
      settlementId: created.settlementId,
      allocationId: created.allocations[0]!.id,
      reason: 'Duplicate correction',
    }),
  ])
  expect(reversals.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
  expect(reversals.filter((outcome) => outcome.status === 'rejected')[0]).toMatchObject({
    reason: { code: 'CONFLICT', statusCode: 409 },
  })
  expect(
    (
      await db.pool.query(
        'SELECT count(*)::int AS count FROM tesoreria.dues_allocations WHERE obligation_id=$1',
        [target],
      )
    ).rows[0].count,
  ).toBe(2)
})

// prettier-ignore
it('keeps original agreement debt terms immutable and records work outside cash income', async () => {
  const socioId = await member(), target = await obligation(socioId, 6_000, period(2500, 8)), beforeCash = (await db.pool.query('SELECT count(*)::int AS count FROM tesoreria.caja_movimiento')).rows[0].count
  const originalTerms = terms(6_000), revisionTerms = terms(6_000, 4), agreements = new AgreementService(db.db), createContext = context(`agreement-create-${randomUUID()}`), original = await agreements.create({ ...createContext, socioId, obligationId: target, kind: 'INSTALLMENT', terms: originalTerms, reason: 'Approved plan' }), replay = await agreements.create({ ...createContext, socioId, obligationId: target, kind: 'INSTALLMENT', terms: originalTerms, reason: 'Approved plan' })
  expect(replay.id).toBe(original.id)
  await expect(agreements.create({ ...createContext, requestFingerprint: 'b'.repeat(64), socioId, obligationId: target, kind: 'INSTALLMENT', terms: originalTerms, reason: 'Approved plan' })).rejects.toMatchObject({ code: 'CONFLICT' })
  const revisionContext = context(`agreement-revise-${randomUUID()}`), revision = await agreements.reschedule({ ...revisionContext, agreementId: original.id, terms: revisionTerms, reason: 'Approved reschedule' })
  expect(revision.revisionOfAgreementId).toBe(original.id)
  expect(revision.obligationId).toBe(target)
  expect((await db.pool.query('SELECT terms,status,obligation_id,revision_number FROM tesoreria.dues_agreements WHERE id=$1', [original.id])).rows[0]).toMatchObject({ terms: originalTerms, status: 'SUPERSEDED', obligation_id: target, revision_number: 1 })
  expect(revision).toMatchObject({ revisionNumber: 2 })
  await expect(agreements.reschedule({ ...revisionContext, requestFingerprint: 'c'.repeat(64), agreementId: original.id, terms: revisionTerms, reason: 'Approved reschedule' })).rejects.toMatchObject({ code: 'CONFLICT' })
  await expect(db.pool.query('UPDATE tesoreria.dues_agreements SET terms=$1 WHERE id=$2', [{ installments: 99 }, original.id])).rejects.toMatchObject({ code: '55000' })
  await expect(db.pool.query('UPDATE tesoreria.dues_agreements SET status=$1 WHERE id=$2', ['SUPERSEDED', revision.id])).rejects.toMatchObject({ code: '23514' })
  const work = await new CommunityWorkService(db.db).create({ ...context(`work-${randomUUID()}`), socioId, obligationId: target, amountCents: 6_000, evidence: { approvalId: 'fixture' }, reason: 'Approved work' })
  expect(work.amountCents).toBe(6_000)
  await expect(new SettlementService(db.db).debt({ role: 'TESORERO', socioId })).resolves.toMatchObject({ totalCents: 0, obligations: [] })
  expect((await db.pool.query('SELECT count(*)::int AS count FROM tesoreria.caja_movimiento')).rows[0].count).toBe(beforeCash)
})

it('validates agreement ownership, outstanding debt, and preserves obligation history', async () => {
  const socioId = await member()
  const otherSocioId = await member()
  const target = await obligation(socioId, 10_000, period(2500, 9))
  const otherTarget = await obligation(otherSocioId, 10_000, period(2500, 10))
  const service = new AgreementService(db.db)
  await expect(
    service.create({
      ...context(`agreement-owner-${randomUUID()}`),
      socioId,
      obligationId: otherTarget,
      kind: 'INSTALLMENT',
      terms: terms(1_000, 1),
      reason: 'Wrong owner',
    }),
  ).rejects.toMatchObject({ code: 'CONFLICT' })
  await expect(
    service.create({
      ...context(`agreement-balance-${randomUUID()}`),
      socioId,
      obligationId: target,
      kind: 'INSTALLMENT',
      terms: terms(10_001, 1),
      reason: 'Too large',
    }),
  ).rejects.toMatchObject({ code: 'CONFLICT' })
  const agreement = await service.create({
    ...context(`agreement-valid-${randomUUID()}`),
    socioId,
    obligationId: target,
    kind: 'INSTALLMENT',
    terms: terms(10_000, 2),
    reason: 'Approved plan',
  })
  const beforeAllocations = (
    await db.pool.query(
      'SELECT count(*)::int AS count FROM tesoreria.dues_allocations WHERE obligation_id=$1',
      [target],
    )
  ).rows[0].count
  const revision = await service.reschedule({
    ...context(`agreement-revision-${randomUUID()}`),
    agreementId: agreement.id,
    terms: terms(10_000, 2),
    reason: 'Approved revision',
  })
  expect(revision.obligationId).toBe(target)
  expect(
    (
      await db.pool.query(
        'SELECT count(*)::int AS count FROM tesoreria.dues_allocations WHERE obligation_id=$1',
        [target],
      )
    ).rows[0].count,
  ).toBe(beforeAllocations)
  expect(
    (
      await db.pool.query(
        'SELECT count(*)::int AS count FROM tesoreria.dues_obligations WHERE id=$1',
        [target],
      )
    ).rows[0].count,
  ).toBe(1)
})

it('serializes concurrent rescheduling and deterministically rejects the loser', async () => {
  const socioId = await member()
  const target = await obligation(socioId, 12_000, period(2500, 11))
  const service = new AgreementService(db.db)
  const original = await service.create({
    ...context(`agreement-race-create-${randomUUID()}`),
    socioId,
    obligationId: target,
    kind: 'INSTALLMENT',
    terms: terms(12_000, 3),
    reason: 'Approved plan',
  })
  const outcomes = await Promise.allSettled([
    service.reschedule({
      ...context(`agreement-race-a-${randomUUID()}`),
      agreementId: original.id,
      terms: terms(12_000, 3),
      reason: 'First revision',
    }),
    service.reschedule({
      ...context(`agreement-race-b-${randomUUID()}`),
      agreementId: original.id,
      terms: terms(12_000, 3),
      reason: 'Second revision',
    }),
  ])
  expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
  expect(outcomes.filter((outcome) => outcome.status === 'rejected')[0]).toMatchObject({
    reason: { code: 'CONFLICT', statusCode: 409 },
  })
  expect(
    (
      await db.pool.query(
        'SELECT status,count(*)::int AS count FROM tesoreria.dues_agreements WHERE obligation_id=$1 GROUP BY status ORDER BY status',
        [target],
      )
    ).rows,
  ).toEqual(
    expect.arrayContaining([
      { status: 'ACTIVE', count: 1 },
      { status: 'SUPERSEDED', count: 1 },
    ]),
  )
})

it('serializes create and reschedule on one obligation without deadlocks', async () => {
  const socioId = await member()
  const target = await obligation(socioId, 12_000, period(2500, 12))
  const service = new AgreementService(db.db)
  const original = await service.create({
    ...context(`agreement-create-reschedule-${randomUUID()}`),
    socioId,
    obligationId: target,
    kind: 'INSTALLMENT',
    terms: terms(12_000, 3),
    reason: 'Approved plan',
  })
  const outcomes = await Promise.allSettled(
    Array.from({ length: 12 }, (_, index) =>
      index === 0
        ? service.reschedule({
            ...context(`agreement-create-reschedule-revision-${randomUUID()}`),
            agreementId: original.id,
            terms: terms(12_000, 3),
            reason: 'Approved revision',
          })
        : service.create({
            ...context(`agreement-create-reschedule-create-${randomUUID()}`),
            socioId,
            obligationId: target,
            kind: 'INSTALLMENT',
            terms: terms(1_000, 1),
            reason: 'Competing plan',
          }),
    ),
  )
  expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
  const rejected = outcomes.filter((outcome) => outcome.status === 'rejected')
  expect(rejected).toHaveLength(11)
  expect(
    rejected.every(
      ({ reason }) =>
        reason?.code === 'CONFLICT' && reason?.message !== 'Agreement changed concurrently',
    ),
  ).toBe(true)
  expect(
    (
      await db.pool.query(
        'SELECT count(*)::int AS count FROM tesoreria.dues_agreements WHERE obligation_id=$1 AND status=$2',
        [target, 'ACTIVE'],
      )
    ).rows[0].count,
  ).toBe(1)
})

it('rejects a matching CANCELLED successor when deferred supersession is forced', async () => {
  const socioId = await member()
  const target = await obligation(socioId, 12_000, period(2501, 1))
  const original = await new AgreementService(db.db).create({
    ...context(`agreement-cancelled-successor-parent-${randomUUID()}`),
    socioId,
    obligationId: target,
    kind: 'INSTALLMENT',
    terms: terms(12_000, 3),
    reason: 'Approved plan',
  })
  const client = await db.pool.connect()
  let failure: unknown
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO tesoreria.dues_agreements
        (id,socio_id,obligation_id,kind,status,revision_number,terms,reason,revision_of_agreement_id,revision_reason,operator_id,authorization_evidence,caller_key,request_fingerprint,agreement_date)
       SELECT $1,socio_id,obligation_id,kind,'CANCELLED',revision_number + 1,terms,reason,id,'Cancelled successor fixture',$2,'{}'::jsonb,$3,$4,agreement_date
       FROM tesoreria.dues_agreements
       WHERE id=$5`,
      [
        randomUUID(),
        operatorId,
        `agreement-cancelled-successor-${randomUUID()}`,
        'c'.repeat(64),
        original.id,
      ],
    )
    await client.query(`UPDATE tesoreria.dues_agreements SET status='SUPERSEDED' WHERE id=$1`, [
      original.id,
    ])
    await client.query('SET CONSTRAINTS tesoreria.dues_agreements_supersession_atomic IMMEDIATE')
    await client.query('COMMIT')
  } catch (error) {
    failure = error
    await client.query('ROLLBACK')
  } finally {
    client.release()
  }
  expect(failure).toMatchObject({
    code: '23514',
    constraint: 'dues_agreements_supersession_check',
  })
  await expect(
    db.pool.query('SELECT status FROM tesoreria.dues_agreements WHERE id=$1', [original.id]),
  ).resolves.toMatchObject({ rows: [{ status: 'ACTIVE' }] })
})

it('projects one native obligation under concurrent retries with legacy debit mapping', async () => {
  const socioId = await member(),
    target = await obligation(socioId, 12_500, period(2502, 1)),
    service = new CtacteProjectionService(db.db),
    requestFingerprint = randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64)
  const outcomes = await Promise.all([
    service.project({
      ...context(`projection-a-${randomUUID()}`),
      requestFingerprint,
      sourceType: 'OBLIGATION',
      sourceId: target,
    }),
    service.project({
      ...context(`projection-b-${randomUUID()}`),
      requestFingerprint,
      sourceType: 'OBLIGATION',
      sourceId: target,
    }),
  ])
  expect(outcomes.map(({ status }) => status).sort()).toEqual(['PROJECTED', 'REPLAYED'])
  await expect(
    db.pool.query(
      'SELECT tipo,debe,haber,count(*)::int AS count FROM tesoreria.ctacte WHERE legacy_id=$1 GROUP BY tipo,debe,haber',
      [`dues:ctacte:OBLIGATION:${target}`],
    ),
  ).resolves.toMatchObject({ rows: [{ tipo: 'DEBITO', debe: '125.00', haber: '0.00', count: 1 }] })
})

it('projects a positive monetary settlement as a legacy CREDITO', async () => {
  const socioId = await member(),
    sourceId = randomUUID(),
    requestFingerprint = randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64)
  await db.pool.query(
    `INSERT INTO tesoreria.dues_settlements (id,socio_id,kind,amount,currency,evidence,operator_id,authorization_evidence,caller_key,request_fingerprint) VALUES ($1,$2,'MONETARY',125.00,'ARS','{}',$3,'{}',$4,$5)`,
    [sourceId, socioId, operatorId, `credit-${sourceId}`, requestFingerprint],
  )
  const result = await new CtacteProjectionService(db.db).project({
    ...context(`project-credit-${sourceId}`),
    requestFingerprint,
    sourceType: 'SETTLEMENT',
    sourceId,
  })
  expect(result).toMatchObject({ status: 'PROJECTED', movementType: 'CREDITO' })
  await expect(
    db.pool.query('SELECT tipo,debe,haber FROM tesoreria.ctacte WHERE legacy_id=$1', [
      `dues:ctacte:SETTLEMENT:${sourceId}`,
    ]),
  ).resolves.toMatchObject({ rows: [{ tipo: 'CREDITO', debe: '0.00', haber: '125.00' }] })
})

it('persists redacted financial audit snapshots and reversal reasons', async () => {
  const socioId = await member()
  const target = await obligation(socioId, 4_000, period(2500, 7))
  const service = new SettlementService(db.db)
  const created = await service.create({
    ...context(),
    socioId,
    kind: 'MONETARY',
    amountCents: 4_000,
    currency: 'ARS',
    evidence: { rawInternalEvidence: 'secret' },
    allocations: [{ obligationId: target, amountCents: 4_000 }],
  })
  const reversed = await service.reverse({
    ...context(),
    settlementId: created.settlementId,
    allocationId: created.allocations[0]!.id,
    reason: 'Incorrect allocation',
  })
  const entityIds = [
    created.settlementId,
    created.allocations[0]!.id,
    reversed.settlementId,
    reversed.allocations[0]!.id,
  ]
  const rows = (
    await db.pool.query(
      'SELECT action, old_value, new_value, metadata FROM public.audit_events WHERE entity_id = ANY($1::text[]) ORDER BY created_at, id',
      [entityIds],
    )
  ).rows
  expect(rows.map((row) => row.action)).toEqual(
    expect.arrayContaining([
      AuditAction.DUES_SETTLEMENT_CREATED,
      AuditAction.DUES_ALLOCATION_CREATED,
      AuditAction.DUES_SETTLEMENT_REVERSED,
      AuditAction.DUES_ALLOCATION_COMPENSATED,
    ]),
  )
  const reversal = rows.find((row) => row.action === AuditAction.DUES_SETTLEMENT_REVERSED)
  expect(reversal).toMatchObject({
    new_value: { amountCents: 4_000 },
    metadata: { reason: 'Incorrect allocation' },
  })
  expect(JSON.stringify(rows)).not.toContain('rawInternalEvidence')
})
