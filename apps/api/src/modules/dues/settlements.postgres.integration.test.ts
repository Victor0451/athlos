import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createDb } from '@athlos/db'
import { AuditAction } from '@athlos/audit'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { insertObligation, claimReceipt, type ObligationInput } from './repository.ts'
import { SettlementService } from './settlements.ts'
import type { AuditContext } from './service.ts'

const url = process.env.ATHLOS_TEST_DATABASE_URL
let db: ReturnType<typeof createDb>
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

beforeAll(async () => {
  if (!url) throw new Error('ATHLOS_TEST_DATABASE_URL is required')
  db = createDb({ connectionString: url, poolMax: 8 })
  operatorId = randomUUID()
  await db.pool.query(
    `CREATE SCHEMA IF NOT EXISTS socios; CREATE SCHEMA IF NOT EXISTS deportes; CREATE TABLE IF NOT EXISTS public.operators (id uuid PRIMARY KEY,username text UNIQUE NOT NULL,password_hash text NOT NULL,role char(1) NOT NULL); CREATE TABLE IF NOT EXISTS socios.socios (id uuid PRIMARY KEY,numero_socio text NOT NULL,nombre text NOT NULL,apellido text NOT NULL,dni text NOT NULL,fecha_alta date NOT NULL,estado text NOT NULL); CREATE TABLE IF NOT EXISTS deportes.disciplinas (id uuid PRIMARY KEY,codigo text UNIQUE NOT NULL,nombre text NOT NULL); CREATE TABLE IF NOT EXISTS deportes.ejercicios (id uuid PRIMARY KEY,anio integer NOT NULL,descripcion text NOT NULL,fecha_inicio date NOT NULL,fecha_fin date NOT NULL); CREATE TABLE IF NOT EXISTS deportes.inscripciones (id uuid PRIMARY KEY,socio_id uuid NOT NULL REFERENCES socios.socios,disciplina_id uuid NOT NULL REFERENCES deportes.disciplinas,ejercicio_id uuid NOT NULL REFERENCES deportes.ejercicios,estado text NOT NULL,fecha_alta date NOT NULL,fecha_baja date)`,
  )
  await db.pool.query(
    `INSERT INTO public.operators (id,username,password_hash,role) VALUES ($1,$2,'fixture','A') ON CONFLICT DO NOTHING`,
    [operatorId, `settlement-${operatorId}`],
  )
  const files = [
    '0049_dues_pricing_obligations.sql',
    '0050_dues_benefit_rules.sql',
    '0051_dues_family_groups.sql',
    '0052_dues_settlements.sql',
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
    `CREATE TABLE IF NOT EXISTS public.audit_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),operator_id uuid,action text NOT NULL,entity_type text NOT NULL,entity_id text NOT NULL,old_value jsonb,new_value jsonb,source_ip text,metadata jsonb,idempotency_key text,created_at timestamptz NOT NULL DEFAULT now()); CREATE UNIQUE INDEX IF NOT EXISTS settlement_audit_key ON public.audit_events (idempotency_key) WHERE idempotency_key IS NOT NULL; CREATE TABLE IF NOT EXISTS tesoreria.caja_movimiento (id uuid PRIMARY KEY DEFAULT gen_random_uuid())`,
  )
})
afterAll(async () => db?.pool.end())

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
