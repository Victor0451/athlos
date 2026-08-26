import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createDb } from '@athlos/db'
import { sql } from 'drizzle-orm'
import { AuditAction } from '@athlos/audit'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { insertObligation, claimReceipt, type ObligationInput } from './repository.ts'
import { insertAllocation, selectFullOutstanding } from './allocations.ts'
import { SettlementService } from './settlements.ts'
import { AgreementService } from './agreements.ts'
import { CommunityWorkService } from './community-work.ts'
import { CtacteProjectionService } from './ctacte-projection.ts'
import { CashDeskService } from './cash-desk.ts'
import type { AuditContext } from './service.ts'

const url = process.env.ATHLOS_TEST_DATABASE_URL
// The generated name must pass this allowlist before it is quoted as a PostgreSQL identifier.
const isolatedDatabaseNamePattern = /^athlos_dues_settlement_[0-9a-f]{32}$/
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
  snapshot: Record<string, unknown> = { source: 'fixture' },
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
    snapshot,
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
const payment = async (socioId: string, obligationIds: string[], key = randomUUID()) => {
  const shift = await new CashDeskService(db.db).open({
    ...context(key),
    deskId: `payment-${randomUUID()}`,
    openingTenders: {},
  })
  const selected = await selectFullOutstanding(db.db, { socioId, obligationIds })
  return new SettlementService(db.db).create({
    ...context(key),
    socioId,
    obligationIds,
    shiftId: shift.id,
    tender: 'CASH',
    selectionFingerprint: selected.fingerprint,
  })
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
  if (!isolatedDatabaseNamePattern.test(isolatedDatabaseName))
    throw new Error('unsafe disposable database name')
  const adminUrl = new URL(url)
  adminUrl.pathname = '/postgres'
  const isolatedUrl = new URL(url)
  isolatedUrl.pathname = `/${isolatedDatabaseName}`
  admin = createDb({ connectionString: adminUrl.toString(), poolMax: 2 })
  await admin.pool.query(['CREATE DATABASE "', isolatedDatabaseName, '"'].join(''))
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
  await db.pool.query(
    "CREATE SCHEMA IF NOT EXISTS tesoreria; CREATE TABLE IF NOT EXISTS tesoreria.gastos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tipo integer NOT NULL,tipo_cuenta integer NOT NULL,cuenta_principal text NOT NULL,cuenta_auxiliar integer,secuencia integer NOT NULL DEFAULT 0,comprobante text NOT NULL DEFAULT '',fecha date NOT NULL,concepto text,importe text NOT NULL,iva text NOT NULL DEFAULT '0.00',ingreso_bruto text,socio_id uuid,legacy_id text,anulado boolean NOT NULL DEFAULT false,anulado_at timestamptz,anulado_motivo text,created_at timestamptz NOT NULL DEFAULT now())",
  )
  const files = [
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
    await admin.pool.query(['DROP DATABASE IF EXISTS "', isolatedDatabaseName, '"'].join(''))
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
it('locks full balances, rejects stale or ineligible selections, and writes nothing itself',async()=>{const socioId=await member(),other=await member(),service=new SettlementService(db.db),first=await obligation(socioId,10_000,period(2510,1)),second=await obligation(socioId,2_000,period(2510,2)),paid=await obligation(socioId,1_000,period(2510,3)),restored=await obligation(socioId,1_000,period(2510,4)),foreign=await obligation(other,1_000,period(2510,5)),usd=await obligation(socioId,1_000,period(2510,6),{inputs:{currency:'USD'}}); await payment(socioId,[paid]); const restoredSettlement=await payment(socioId,[restored]); await service.reverse({...context(),settlementId:restoredSettlement.settlementId,allocationId:restoredSettlement.allocations[0]!.id,reason:'Fixture compensation'}); const reviewed=await selectFullOutstanding(db.db,{socioId,obligationIds:[second,first]}),settlementId=randomUUID(),count=async()=>(await db.pool.query<{obligations:number;allocations:number;settlements:number;audits:number}>(`SELECT (SELECT count(*)::int FROM tesoreria.dues_obligations) obligations,(SELECT count(*)::int FROM tesoreria.dues_allocations) allocations,(SELECT count(*)::int FROM tesoreria.dues_settlements) settlements,(SELECT count(*)::int FROM public.audit_events) audits`)).rows[0]!; await db.pool.query(`INSERT INTO tesoreria.dues_settlements (id,socio_id,kind,amount,currency,evidence,operator_id,authorization_evidence,caller_key,request_fingerprint) VALUES ($1,$2,'MONETARY',10.00,'ARS','{}',$3,'{}',$4,$5)`,[settlementId,socioId,operatorId,`selection-${settlementId}`,'a'.repeat(64)]); const before=await count(); let enter!:()=>void,release!:()=>void; const entered=new Promise<void>(resolve=>enter=resolve),released=new Promise<void>(resolve=>release=resolve),firstLock=db.db.transaction(async tx=>{const result=await selectFullOutstanding(tx,{socioId,obligationIds:[first,second]});enter();await released;return result}); await entered;let followerDone=false;const follower=db.db.transaction(async tx=>{const result=await selectFullOutstanding(tx,{socioId,obligationIds:[first,second]});followerDone=true;return result});await new Promise(resolve=>setTimeout(resolve,50));expect(followerDone).toBe(false);release();await expect(firstLock).resolves.toMatchObject({totalCents:12_000});await expect(follower).resolves.toMatchObject({totalCents:12_000});await db.db.transaction(async tx=>{await tx.execute(sql`INSERT INTO tesoreria.dues_allocations (settlement_id,obligation_id,kind,amount) VALUES (${settlementId},${first},'ALLOCATION',10.00)`)});const afterWriter=await count();expect(afterWriter).toEqual({...before,allocations:before.allocations+1});await expect(selectFullOutstanding(db.db,{socioId,obligationIds:[first,second],selectionFingerprint:reviewed.fingerprint})).rejects.toMatchObject({code:'CONFLICT'});await expect(selectFullOutstanding(db.db,{socioId,obligationIds:[first,second]})).resolves.toMatchObject({totalCents:11_000,allocations:[first,second].sort().map(obligationId=>({obligationId,amountCents:obligationId===first?9_000:2_000}))});await Promise.all([selectFullOutstanding(db.db,{socioId,obligationIds:[paid]}),selectFullOutstanding(db.db,{socioId,obligationIds:[foreign]}),selectFullOutstanding(db.db,{socioId,obligationIds:[first,usd]})].map(selection=>expect(selection).rejects.toMatchObject({code:'CONFLICT'})));expect(await count()).toEqual(afterWriter)})

// prettier-ignore
it('allocates only the explicitly selected obligation and reports aging',async()=>{const socioId=await member(),first=await obligation(socioId,10_000,period(2500,1)),second=await obligation(socioId,20_000,period(2500,2)),service=new SettlementService(db.db); await payment(socioId,[second]); await expect(service.debt({role:'TESORERO',socioId})).resolves.toMatchObject({totalCents:10_000,obligations:[{id:first,outstandingCents:10_000},{id:second,outstandingCents:0}]})})
// prettier-ignore
it('keeps non-cash settlement out of cash income and replays idempotently',async()=>{const socioId=await member(),target=await obligation(socioId,8_000,period(2500,3)),key=`noncash-${randomUUID()}`,beforeCash=(await db.pool.query('SELECT count(*)::int AS count FROM tesoreria.caja_movimiento')).rows[0].count,service=new SettlementService(db.db),input={...context(key),socioId,kind:'NON_CASH' as const,amountCents:8_000,currency:'ARS',evidence:{approval:'fixture'},reason:'Approved non-cash value',allocations:[{obligationId:target,amountCents:8_000}]}; const first=await service.create(input),replay=await service.create(input); expect(replay).toEqual(first); expect((await db.pool.query('SELECT count(*)::int AS count FROM tesoreria.dues_settlements WHERE caller_key=$1',[key])).rows[0].count).toBe(1); expect((await db.pool.query('SELECT count(*)::int AS count FROM tesoreria.dues_allocations WHERE settlement_id=$1',[first.settlementId])).rows[0].count).toBe(1); expect((await db.pool.query('SELECT count(*)::int AS count FROM tesoreria.caja_movimiento')).rows[0].count).toBe(beforeCash); await expect(db.pool.query('SELECT action FROM public.audit_events WHERE entity_id=$1',[first.settlementId])).resolves.toMatchObject({rows:[{action:AuditAction.DUES_SETTLEMENT_CREATED}]})})
// prettier-ignore
it('reverses by compensation without deleting the original allocation',async()=>{const socioId=await member(),target=await obligation(socioId,6_000,period(2500,4)),service=new SettlementService(db.db),created=await payment(socioId,[target]),reversed=await service.reverse({...context(),settlementId:created.settlementId,allocationId:created.allocations[0]!.id,reason:'Incorrect allocation'}); expect(reversed).toMatchObject({kind:'MONETARY',amountCents:6_000}); expect((await db.pool.query('SELECT count(*)::int AS count FROM tesoreria.dues_allocations WHERE obligation_id=$1',[target])).rows[0].count).toBe(2); await expect(service.debt({role:'TESORERO',socioId})).resolves.toMatchObject({totalCents:6_000,obligations:[{id:target,outstandingCents:6_000}]})})

// prettier-ignore
it('rolls back every reversal write when compensation persistence fails',async()=>{const socioId=await member(),first=await obligation(socioId,1_000,period(2512,1)),second=await obligation(socioId,2_000,period(2512,2)),created=await payment(socioId,[first,second]),count=()=>db.pool.query(`SELECT (SELECT count(*)::int FROM tesoreria.dues_settlements WHERE socio_id=$1) settlements,(SELECT count(*)::int FROM tesoreria.dues_allocations a JOIN tesoreria.dues_obligations o ON o.id=a.obligation_id WHERE o.socio_id=$1) allocations`,[socioId]);const before=await count();await expect(new SettlementService(db.db,{repository:{insertAllocation:async()=>{throw new Error('forced compensation failure')}}}).reverse({...context(),settlementId:created.settlementId,reason:'Rollback proof'})).rejects.toThrow('forced compensation failure');await expect(count()).resolves.toEqual(before)})

it('serializes different-key allocations for one obligation', async () => {
  const socioId = await member()
  const target = await obligation(socioId, 10_000, period(2500, 5))
  const service = new SettlementService(db.db)
  const outcomes = await Promise.allSettled(
    ['a', 'b'].map((key) => payment(socioId, [target], `allocation-${key}-${randomUUID()}`)),
  )
  expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
  expect(outcomes.filter((outcome) => outcome.status === 'rejected')[0]).toMatchObject({
    reason: { code: 'CONFLICT' },
  })
  await expect(service.debt({ role: 'TESORERO', socioId })).resolves.toMatchObject({
    totalCents: 0,
  })
})

// prettier-ignore
it('persists exactly the unique allocations selected across multiple obligations',async()=>{const socioId=await member(),first=await obligation(socioId,10_000,period(2501,1)),second=await obligation(socioId,12_000,period(2501,2)),created=await payment(socioId,[first,second]);expect(created.allocations.map(({obligationId,amountCents})=>({obligationId,amountCents}))).toEqual(expect.arrayContaining([{obligationId:first,amountCents:10_000},{obligationId:second,amountCents:12_000}]));const rows=(await db.pool.query('SELECT obligation_id,amount::text FROM tesoreria.dues_allocations WHERE settlement_id=$1',[created.settlementId])).rows;expect(rows).toHaveLength(2);expect(rows).toEqual(expect.arrayContaining([{obligation_id:first,amount:'100.00'},{obligation_id:second,amount:'120.00'}]))})

it('maps concurrent different-key duplicate reversals to one success and one conflict', async () => {
  const socioId = await member()
  const target = await obligation(socioId, 8_000, period(2500, 6))
  const service = new SettlementService(db.db)
  const created = await payment(socioId, [target])
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
  const originalTerms = terms(6_000), revisionTerms = terms(6_000, 4), agreements = new AgreementService(db.db), createContext = context(`agreement-create-${randomUUID()}`), original = (await agreements.create({ ...createContext, socioId, obligationId: target, kind: 'INSTALLMENT', terms: originalTerms, reason: 'Approved plan' })).agreement, replay = (await agreements.create({ ...createContext, socioId, obligationId: target, kind: 'INSTALLMENT', terms: originalTerms, reason: 'Approved plan' })).agreement
  expect(replay.id).toBe(original.id)
  await expect(agreements.create({ ...createContext, requestFingerprint: 'b'.repeat(64), socioId, obligationId: target, kind: 'INSTALLMENT', terms: originalTerms, reason: 'Approved plan' })).rejects.toMatchObject({ code: 'CONFLICT' })
  const revisionContext = context(`agreement-revise-${randomUUID()}`), revision = (await agreements.reschedule({ ...revisionContext, agreementId: original.id, terms: revisionTerms, reason: 'Approved reschedule' })).agreement
  expect(revision.revisionOfAgreementId).toBe(original.id)
  expect(revision.obligationId).toBe(target)
  expect((await db.pool.query('SELECT terms,status,obligation_id,revision_number FROM tesoreria.dues_agreements WHERE id=$1', [original.id])).rows[0]).toMatchObject({ terms: originalTerms, status: 'SUPERSEDED', obligation_id: target, revision_number: 1 })
  expect(revision).toMatchObject({ revisionNumber: 2 })
  await expect(agreements.reschedule({ ...revisionContext, requestFingerprint: 'c'.repeat(64), agreementId: original.id, terms: revisionTerms, reason: 'Approved reschedule' })).rejects.toMatchObject({ code: 'CONFLICT' })
  await expect(db.pool.query('UPDATE tesoreria.dues_agreements SET terms=$1 WHERE id=$2', [{ installments: 99 }, original.id])).rejects.toMatchObject({ code: '55000' })
  await expect(db.pool.query('UPDATE tesoreria.dues_agreements SET status=$1 WHERE id=$2', ['SUPERSEDED', revision.id])).rejects.toMatchObject({ code: '23514' })
  const work = await new CommunityWorkService(db.db).create({ ...context(`work-${randomUUID()}`), socioId, obligationId: target, amountCents: 6_000, evidence: { approvalId: 'fixture' }, reason: 'Approved work' })
  expect(work.amountCents).toBe(6_000)
  await expect(new SettlementService(db.db).debt({ role: 'TESORERO', socioId })).resolves.toMatchObject({ status: 'ready', totalCents: 0, obligations: [{ id: target, outstandingCents: 0, status: 'PAID', allocations: [{ kind: 'ALLOCATION', amountCents: 6_000, settlementKind: 'NON_CASH' }] }] })
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
  const agreement = (
    await service.create({
      ...context(`agreement-valid-${randomUUID()}`),
      socioId,
      obligationId: target,
      kind: 'INSTALLMENT',
      terms: terms(10_000, 2),
      reason: 'Approved plan',
    })
  ).agreement
  const beforeAllocations = (
    await db.pool.query(
      'SELECT count(*)::int AS count FROM tesoreria.dues_allocations WHERE obligation_id=$1',
      [target],
    )
  ).rows[0].count
  const revision = (
    await service.reschedule({
      ...context(`agreement-revision-${randomUUID()}`),
      agreementId: agreement.id,
      terms: terms(10_000, 2),
      reason: 'Approved revision',
    })
  ).agreement
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
  const original = (
    await service.create({
      ...context(`agreement-race-create-${randomUUID()}`),
      socioId,
      obligationId: target,
      kind: 'INSTALLMENT',
      terms: terms(12_000, 3),
      reason: 'Approved plan',
    })
  ).agreement
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
  const original = (
    await service.create({
      ...context(`agreement-create-reschedule-${randomUUID()}`),
      socioId,
      obligationId: target,
      kind: 'INSTALLMENT',
      terms: terms(12_000, 3),
      reason: 'Approved plan',
    })
  ).agreement
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
  const original = (
    await new AgreementService(db.db).create({
      ...context(`agreement-cancelled-successor-parent-${randomUUID()}`),
      socioId,
      obligationId: target,
      kind: 'INSTALLMENT',
      terms: terms(12_000, 3),
      reason: 'Approved plan',
    })
  ).agreement
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

it('persists negotiated narrative terms without allocation and validates agreement-linked work ownership', async () => {
  const socioId = await member()
  const otherSocioId = await member()
  const target = await obligation(socioId, 8_000, period(2503, 1))
  const otherTarget = await obligation(otherSocioId, 8_000, period(2503, 2))
  const terms = { narrative: 'El socio realizará una acción acordada.' }
  const agreement = await db.pool.query(
    `INSERT INTO tesoreria.dues_agreements
          (socio_id, obligation_id, kind, terms_version, terms, reason, operator_id, caller_key, request_fingerprint)
         VALUES ($1, $2, 'NEGOTIATED', 1, $3::jsonb, 'Negotiated fixture', $4, $5, repeat('n', 64))
         RETURNING id, kind, terms_version, terms`,
    [socioId, target, JSON.stringify(terms), operatorId, `api-negotiated-${randomUUID()}`],
  )
  expect(agreement.rows[0]).toMatchObject({
    kind: 'NEGOTIATED',
    terms_version: 1,
    terms,
  })
  await expect(
    db.pool.query(
      `SELECT count(*)::int AS count FROM tesoreria.dues_allocations WHERE obligation_id = $1`,
      [target],
    ),
  ).resolves.toMatchObject({ rows: [{ count: 0 }] })
  await expect(
    db.pool.query(
      `INSERT INTO tesoreria.dues_agreements
            (socio_id, obligation_id, kind, terms_version, terms, reason, operator_id, caller_key, request_fingerprint)
           VALUES ($1, $2, 'NEGOTIATED', 1, $3::jsonb, 'Malformed fixture', $4, $5, repeat('m', 64))`,
      [
        socioId,
        await obligation(socioId, 8_000, period(2503, 3)),
        JSON.stringify({
          narrative: 'Bad commitment',
          commitments: [{ id: 'bad', title: 'Action' }],
        }),
        operatorId,
        `api-malformed-${randomUUID()}`,
      ],
    ),
  ).rejects.toMatchObject({ code: '23514' })
  const otherAgreement = await db.pool.query(
    `INSERT INTO tesoreria.dues_agreements
          (socio_id, obligation_id, kind, terms_version, terms, reason, operator_id, caller_key, request_fingerprint)
         VALUES ($1, $2, 'NEGOTIATED', 1, $3::jsonb, 'Other negotiated fixture', $4, $5, repeat('o', 64))
         RETURNING id`,
    [
      otherSocioId,
      otherTarget,
      JSON.stringify({ narrative: 'Otro acuerdo.' }),
      operatorId,
      `api-other-negotiated-${randomUUID()}`,
    ],
  )
  const settlement = await db.pool.query(
    `INSERT INTO tesoreria.dues_settlements
          (socio_id, kind, amount, operator_id, caller_key, request_fingerprint)
         VALUES ($1, 'NON_CASH', 10.00, $2, $3, repeat('p', 64)) RETURNING id`,
    [socioId, operatorId, `api-work-${randomUUID()}`],
  )
  await expect(
    db.pool.query(
      `INSERT INTO tesoreria.dues_community_work
            (socio_id, obligation_id, settlement_id, amount, evidence, approval_reason, operator_id, caller_key, request_fingerprint, agreement_id)
           VALUES ($1, $2, $3, 10.00, '{}'::jsonb, 'Approved work', $4, $5, repeat('q', 64), $6)`,
      [
        socioId,
        target,
        settlement.rows[0].id,
        operatorId,
        `api-work-row-${randomUUID()}`,
        agreement.rows[0].id,
      ],
    ),
  ).resolves.toMatchObject({ rowCount: 1 })
  const crossSettlement = await db.pool.query(
    `INSERT INTO tesoreria.dues_settlements
          (socio_id, kind, amount, operator_id, caller_key, request_fingerprint)
         VALUES ($1, 'NON_CASH', 10.00, $2, $3, repeat('r', 64)) RETURNING id`,
    [socioId, operatorId, `api-cross-work-${randomUUID()}`],
  )
  await expect(
    db.pool.query(
      `INSERT INTO tesoreria.dues_community_work
            (socio_id, obligation_id, settlement_id, amount, evidence, approval_reason, operator_id, caller_key, request_fingerprint, agreement_id)
           VALUES ($1, $2, $3, 10.00, '{}'::jsonb, 'Cross-owner work', $4, $5, repeat('s', 64), $6)`,
      [
        socioId,
        target,
        crossSettlement.rows[0].id,
        operatorId,
        `api-cross-work-row-${randomUUID()}`,
        otherAgreement.rows[0].id,
      ],
    ),
  ).rejects.toMatchObject({ code: '23514' })
})

it('persists redacted financial audit snapshots and reversal reasons', async () => {
  const socioId = await member()
  const target = await obligation(socioId, 4_000, period(2500, 7))
  const service = new SettlementService(db.db)
  const created = await payment(socioId, [target])
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

it('projects one reversal expense, audits it once, and rolls every reversal row back on audit failure', async () => {
  const socioId = await member()
  const target = await obligation(socioId, 4_000, period(2513, 1))
  const created = await payment(socioId, [target])
  const input = {
    ...context(),
    settlementId: created.settlementId,
    reason: 'Reversal fixture',
  }
  const count = () =>
    db.pool.query(
      `SELECT (SELECT count(*)::int FROM tesoreria.dues_settlements WHERE socio_id=$1) settlements,(SELECT count(*)::int FROM tesoreria.dues_allocations a JOIN tesoreria.dues_obligations o ON o.id=a.obligation_id WHERE o.socio_id=$1) allocations,(SELECT count(*)::int FROM tesoreria.dues_cash_tenders t JOIN tesoreria.dues_settlements s ON s.id=t.source_id WHERE s.socio_id=$1) tenders,(SELECT count(*)::int FROM public.audit_events) audits`,
      [socioId],
    )
  const reversed = await new SettlementService(db.db).reverse(input)
  const beforeReplay = await count()
  await expect(new SettlementService(db.db).reverse(input)).resolves.toEqual(reversed)
  await expect(count()).resolves.toEqual(beforeReplay)
  await expect(
    db.pool.query(
      `SELECT direction,tender,amount::text FROM tesoreria.dues_cash_tenders WHERE source_id=$1`,
      [reversed.settlementId],
    ),
  ).resolves.toMatchObject({
    rows: [{ direction: 'EXPENSE', tender: 'CASH', amount: '40.00' }],
  })
  await expect(
    db.pool.query(`SELECT action FROM public.audit_events WHERE entity_id=ANY($1::text[])`, [
      [reversed.settlementId, reversed.allocations[0]!.id],
    ]),
  ).resolves.toMatchObject({
    rows: expect.arrayContaining([
      { action: AuditAction.DUES_SETTLEMENT_REVERSED },
      { action: AuditAction.DUES_ALLOCATION_COMPENSATED },
    ]),
  })
  const retryTarget = await obligation(socioId, 1_000, period(2513, 2))
  const retry = await payment(socioId, [retryTarget])
  const before = await count()
  await expect(
    new SettlementService(db.db, {
      audit: async () => {
        throw new Error('forced reversal audit failure')
      },
    }).reverse({ ...context(), settlementId: retry.settlementId, reason: 'Rollback fixture' }),
  ).rejects.toThrow('forced reversal audit failure')
  await expect(count()).resolves.toEqual(before)
  const noCashTarget = await obligation(socioId, 500, period(2513, 3))
  const noCashSettlement = randomUUID()
  await db.pool.query(
    `INSERT INTO tesoreria.dues_settlements (id,socio_id,kind,amount,currency,evidence,operator_id,authorization_evidence,caller_key,request_fingerprint) VALUES ($1,$2,'MONETARY',5.00,'ARS','{}',$3,'{}',$4,$5)`,
    [noCashSettlement, socioId, operatorId, `no-cash-${noCashSettlement}`, 'a'.repeat(64)],
  )
  await insertAllocation(db.db, {
    settlementId: noCashSettlement,
    socioId,
    obligationId: noCashTarget,
    amountCents: 500,
  })
  const beforeCashFailure = await count()
  await expect(
    new SettlementService(db.db).reverse({
      ...context(),
      settlementId: noCashSettlement,
      reason: 'Cash failure fixture',
    }),
  ).rejects.toMatchObject({ code: 'CONFLICT' })
  await expect(count()).resolves.toEqual(beforeCashFailure)
})

it('permits only correlated settlement reversal expenses in the cash policy', async () => {
  const socioId = await member()
  const target = await obligation(socioId, 1_000, period(2513, 4))
  const paid = await payment(socioId, [target])
  const reversed = await new SettlementService(db.db).reverse({
    ...context(),
    settlementId: paid.settlementId,
    reason: 'Policy fixture',
  })
  const source = reversed.settlementId
  const shift = (
    await db.pool.query(
      `SELECT shift_id FROM tesoreria.dues_cash_tenders WHERE source_id=$1 AND direction='INCOME'`,
      [paid.settlementId],
    )
  ).rows[0]!.shift_id
  const insert = (id: string, amount: string, tender: string, settlementId = source) =>
    db.pool.query(
      `INSERT INTO tesoreria.dues_cash_tenders (id,shift_id,direction,tender,amount,source_type,source_id,operator_id,caller_key,request_fingerprint) VALUES ($1,$2,'EXPENSE',$3,$4,'SETTLEMENT',$5,$6,$7,repeat('a',64))`,
      [id, shift, tender, amount, settlementId, operatorId, `policy-${id}`],
    )
  await expect(insert(randomUUID(), '10.01', 'CASH')).rejects.toMatchObject({ code: '55000' })
  await expect(insert(randomUUID(), '10.00', 'DEBIT')).rejects.toMatchObject({ code: '55000' })
  await expect(insert(randomUUID(), '10.00', 'CASH', paid.settlementId)).rejects.toMatchObject({
    code: '55000',
  })
  const unlinked = randomUUID()
  await db.pool.query(
    `INSERT INTO tesoreria.dues_settlements (id,socio_id,kind,amount,currency,evidence,operator_id,authorization_evidence,caller_key,request_fingerprint) VALUES ($1,$2,'MONETARY',10.00,'ARS','{}',$3,'{}',$4,$5)`,
    [unlinked, socioId, operatorId, `unlinked-${unlinked}`, 'a'.repeat(64)],
  )
  await expect(insert(randomUUID(), '10.00', 'CASH', unlinked)).rejects.toMatchObject({
    code: '55000',
  })
})

// prettier-ignore
it('creates and revises negotiated agreements without moving debt or allocations', async () => {
  const socioId = await member(), target = await obligation(socioId, 9_000, period(2504, 1)), service = new AgreementService(db.db), negotiated = { narrative: 'El socio regularizará la deuda en cuotas conversadas.', commitments: [{ id: randomUUID(), title: 'Primera entrega', amountCents: 9_000, dueDate: '2099-02-01' }] }, createContext = context(`negotiated-create-${randomUUID()}`)
  const created = await service.create({ ...createContext, socioId, obligationId: target, kind: 'NEGOTIATED', termsVersion: 1, terms: negotiated, reason: 'Acuerdo conversado' })
  expect(created).toMatchObject({ outcome: 'created', agreement: expect.objectContaining({ kind: 'NEGOTIATED', revisionNumber: 1, termsVersion: 1 }) })
  const replay = await service.create({ ...createContext, socioId, obligationId: target, kind: 'NEGOTIATED', termsVersion: 1, terms: negotiated, reason: 'Acuerdo conversado' })
  expect(replay).toMatchObject({ outcome: 'replayed', agreement: expect.objectContaining({ id: created.agreement.id }) })
  await expect(service.create({ ...createContext, requestFingerprint: 'd'.repeat(64), socioId, obligationId: target, kind: 'NEGOTIATED', termsVersion: 1, terms: negotiated, reason: 'Acuerdo conversado' })).rejects.toMatchObject({ code: 'CONFLICT' })
  await expect(service.create({ ...context(`negotiated-competing-${randomUUID()}`), socioId, obligationId: target, kind: 'NEGOTIATED', termsVersion: 1, terms: { narrative: 'Otro acuerdo distinto.' }, reason: 'Competing plan' })).rejects.toMatchObject({ code: 'CONFLICT' })
  expect((await db.pool.query('SELECT count(*)::int AS count FROM tesoreria.dues_agreements WHERE obligation_id=$1', [target])).rows[0].count).toBe(1)
  await expect(db.pool.query('SELECT action FROM public.audit_events WHERE entity_id=$1', [created.agreement.id])).resolves.toMatchObject({ rows: [{ action: AuditAction.DUES_AGREEMENT_CREATED }] })
  const reviseContext = context(`negotiated-revise-${randomUUID()}`), revisedTerms = { narrative: 'Actualización del acuerdo conversado.' }
  const revised = await service.revise({ ...reviseContext, agreementId: created.agreement.id, terms: revisedTerms, reason: 'Renegociación' })
  expect(revised).toMatchObject({ outcome: 'created', agreement: expect.objectContaining({ revisionNumber: 2, revisionOfAgreementId: created.agreement.id, obligationId: target }) })
  const reviseReplay = await service.revise({ ...reviseContext, agreementId: created.agreement.id, terms: revisedTerms, reason: 'Renegociación' })
  expect(reviseReplay).toMatchObject({ outcome: 'replayed', agreement: expect.objectContaining({ id: revised.agreement.id }) })
  await expect(service.revise({ ...context(`negotiated-stale-${randomUUID()}`), agreementId: created.agreement.id, terms: revisedTerms, reason: 'Stale revision' })).rejects.toMatchObject({ code: 'CONFLICT' })
  expect((await db.pool.query('SELECT terms,status,revision_number FROM tesoreria.dues_agreements WHERE id=$1', [created.agreement.id])).rows[0]).toMatchObject({ terms: negotiated, status: 'SUPERSEDED', revision_number: 1 })
  expect((await db.pool.query('SELECT count(*)::int AS count FROM tesoreria.dues_agreements WHERE obligation_id=$1 AND status=$2', [target, 'ACTIVE'])).rows[0].count).toBe(1)
  await expect(new SettlementService(db.db).debt({ role: 'TESORERO', socioId })).resolves.toMatchObject({ totalCents: 9_000, obligations: [{ id: target, outstandingCents: 9_000 }] })
  expect((await db.pool.query('SELECT count(*)::int AS count FROM tesoreria.dues_allocations WHERE obligation_id=$1', [target])).rows[0].count).toBe(0)
  expect((await db.pool.query('SELECT count(*)::int AS count FROM tesoreria.dues_settlements WHERE socio_id=$1', [socioId])).rows[0].count).toBe(0)
})

// prettier-ignore
it('rejects cross-representation revisions and serializes negotiated revision races', async () => {
  const socioId = await member(), target = await obligation(socioId, 7_000, period(2504, 2)), legacyTarget = await obligation(socioId, 7_000, period(2504, 3)), service = new AgreementService(db.db)
  const negotiated = await service.create({ ...context(`negotiated-cross-${randomUUID()}`), socioId, obligationId: target, kind: 'NEGOTIATED', termsVersion: 1, terms: { narrative: 'Acuerdo base para renegociar.' }, reason: 'Base agreement' })
  const legacy = await service.create({ ...context(`legacy-cross-${randomUUID()}`), socioId, obligationId: legacyTarget, kind: 'INSTALLMENT', terms: terms(7_000, 2), reason: 'Approved plan' })
  await expect(service.reschedule({ ...context(`cross-legacy-${randomUUID()}`), agreementId: negotiated.agreement.id, terms: terms(7_000, 2), reason: 'Legacy over negotiated' })).rejects.toMatchObject({ code: 'CONFLICT' })
  await expect(service.revise({ ...context(`cross-negotiated-${randomUUID()}`), agreementId: legacy.agreement.id, terms: { narrative: 'Intento abierto sobre plan monetario.' }, reason: 'Negotiated over legacy' })).rejects.toMatchObject({ code: 'CONFLICT' })
  const outcomes = await Promise.allSettled([service.revise({ ...context(`negotiated-race-a-${randomUUID()}`), agreementId: negotiated.agreement.id, terms: { narrative: 'Revisión A.' }, reason: 'Race A' }), service.revise({ ...context(`negotiated-race-b-${randomUUID()}`), agreementId: negotiated.agreement.id, terms: { narrative: 'Revisión B.' }, reason: 'Race B' })])
  expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
  expect(outcomes.filter((outcome) => outcome.status === 'rejected')[0]).toMatchObject({ reason: { code: 'CONFLICT', statusCode: 409 } })
  expect((await db.pool.query('SELECT status,count(*)::int AS count FROM tesoreria.dues_agreements WHERE obligation_id=$1 GROUP BY status ORDER BY status', [target])).rows).toEqual(expect.arrayContaining([{ status: 'ACTIVE', count: 1 }, { status: 'SUPERSEDED', count: 1 }]))
  expect((await db.pool.query('SELECT count(*)::int AS count FROM tesoreria.dues_allocations WHERE obligation_id=ANY($1::uuid[])', [[target, legacyTarget]])).rows[0].count).toBe(0)
})

it('commits each tender and rolls settlement allocation and tender rows back after audit failure', async () => {
  const service = new SettlementService(db.db)
  for (const tender of ['CASH', 'DEBIT', 'CREDIT', 'TRANSFER'] as const) {
    const socioId = await member(),
      target = await obligation(socioId, 1250, period(2511, 1))
    const shift = await new CashDeskService(db.db).open({
      ...context(`payment-${tender}`),
      deskId: `payment-${randomUUID()}`,
      openingTenders: {},
    })
    const selected = await selectFullOutstanding(db.db, { socioId, obligationIds: [target] })
    const input = {
      ...context(`payment-${tender}`),
      socioId,
      obligationIds: [target],
      shiftId: shift.id,
      tender,
      selectionFingerprint: selected.fingerprint,
    }
    const created = await service.create(input)
    expect(
      (
        await db.pool.query(
          'SELECT tender,source_type FROM tesoreria.dues_cash_tenders WHERE source_id=$1',
          [created.settlementId],
        )
      ).rows,
    ).toEqual([{ tender, source_type: 'SETTLEMENT' }])
    expect(await service.create(input)).toEqual(created)
    await expect(
      service.create({ ...input, requestFingerprint: 'f'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  }
  const socioId = await member(),
    target = await obligation(socioId, 100, period(2511, 2))
  const shift = await new CashDeskService(db.db).open({
    ...context(),
    deskId: `payment-${randomUUID()}`,
    openingTenders: {},
  })
  const selected = await selectFullOutstanding(db.db, { socioId, obligationIds: [target] })
  const count = () =>
    db.pool.query(
      `SELECT (SELECT count(*)::int FROM tesoreria.dues_settlements WHERE socio_id=$1) settlements,(SELECT count(*)::int FROM tesoreria.dues_allocations a JOIN tesoreria.dues_obligations o ON o.id=a.obligation_id WHERE o.socio_id=$1) allocations,(SELECT count(*)::int FROM tesoreria.dues_cash_tenders t JOIN tesoreria.dues_settlements s ON s.id=t.source_id WHERE s.socio_id=$1) tenders`,
      [socioId],
    )
  const before = await count()
  await expect(
    new SettlementService(db.db, {
      audit: async () => {
        throw new Error('forced audit failure')
      },
    }).create({
      ...context(),
      socioId,
      obligationIds: [target],
      shiftId: shift.id,
      tender: 'CASH',
      selectionFingerprint: selected.fingerprint,
    }),
  ).rejects.toThrow('forced audit failure')
  await expect(count()).resolves.toEqual(before)
})
