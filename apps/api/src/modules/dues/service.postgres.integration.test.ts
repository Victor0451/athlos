import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createDb } from '@athlos/db'
import { AuditAction } from '@athlos/audit'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AssessmentService, PricingService, type AuditContext } from './service.ts'
import * as repository from './repository.ts'

const url = process.env.ATHLOS_TEST_DATABASE_URL
let db: ReturnType<typeof createDb>
let admin: ReturnType<typeof createDb> | undefined
let isolatedDatabaseName: string | undefined
let operatorId: string
const exerciseId = randomUUID()
// prettier-ignore
const period = (year = 2500 + Math.floor(Math.random() * 300), month = 1 + Math.floor(Math.random() * 12)) => ({
  start: `${year}-${String(month).padStart(2, '0')}-01`,
  end: month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`,
})
// prettier-ignore
const context = (): AuditContext => ({
  actorId: operatorId,
  role: 'ADMIN',
  permissions: ['dues:write'],
  sourceIp: '127.0.0.1',
  callerKey: randomUUID(),
  requestFingerprint: randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64),
  authorizationEvidence: { role: 'ADMIN', permission: 'dues:write' },
})
// prettier-ignore
async function member() {
  const id = randomUUID()
  await db.pool.query(`INSERT INTO socios.socios (id, numero_socio, nombre, apellido, dni, fecha_alta, estado) VALUES ($1, $2, 'Service', 'Fixture', $3, DATE '2024-01-01', 'activo')`, [id, `service-${id}`, `dni-${id}`])
  return id
}
// prettier-ignore
async function discipline() {
  const id = randomUUID()
  await db.pool.query(`INSERT INTO deportes.disciplinas (id, codigo, nombre) VALUES ($1, $2, 'Service fixture')`, [id, `service-${id}`])
  return id
}
// prettier-ignore
async function enroll(socioId: string, disciplinaId: string, p: { start: string }) {
  await db.pool.query(`INSERT INTO deportes.inscripciones (id, socio_id, disciplina_id, ejercicio_id, estado, fecha_alta) VALUES ($1, $2, $3, $4, 'activa', $5)`, [randomUUID(), socioId, disciplinaId, exerciseId, p.start])
}
// prettier-ignore
async function price(p: { start: string; end: string }, kind: 'BASE' | 'SPORT', disciplinaId: string | null, amountCents: number) {
  return repository.createPrice(db.db, { kind, disciplinaId, amountCents, currency: 'ARS', effectiveFrom: p.start, effectiveTo: p.end, rule: 'FULL_MONTH', createdBy: operatorId, authorizationEvidence: { source: 'fixture' } })
}

// prettier-ignore
beforeAll(async () => {
  if (!url) throw new Error('ATHLOS_TEST_DATABASE_URL is required')
  isolatedDatabaseName = `athlos_dues_service_${randomUUID().replaceAll('-', '')}`
  const adminUrl = new URL(url)
  adminUrl.pathname = '/postgres'
  const isolatedUrl = new URL(url)
  isolatedUrl.pathname = `/${isolatedDatabaseName}`
  admin = createDb({ connectionString: adminUrl.toString(), poolMax: 2 })
  await admin.pool.query(`CREATE DATABASE "${isolatedDatabaseName}"`)
  db = createDb({ connectionString: isolatedUrl.toString(), poolMax: 8 })
  operatorId = randomUUID()
  await db.pool.query(`CREATE SCHEMA IF NOT EXISTS socios; CREATE SCHEMA IF NOT EXISTS deportes; CREATE TABLE IF NOT EXISTS public.operators (id uuid PRIMARY KEY, username text UNIQUE NOT NULL, password_hash text NOT NULL, role char(1) NOT NULL); CREATE TABLE IF NOT EXISTS socios.socios (id uuid PRIMARY KEY, numero_socio text NOT NULL, nombre text NOT NULL, apellido text NOT NULL, dni text NOT NULL, fecha_alta date NOT NULL, estado text NOT NULL); CREATE TABLE IF NOT EXISTS deportes.disciplinas (id uuid PRIMARY KEY, codigo text UNIQUE NOT NULL, nombre text NOT NULL); CREATE TABLE IF NOT EXISTS deportes.ejercicios (id uuid PRIMARY KEY, anio integer NOT NULL, descripcion text NOT NULL, fecha_inicio date NOT NULL, fecha_fin date NOT NULL); CREATE TABLE IF NOT EXISTS deportes.inscripciones (id uuid PRIMARY KEY, socio_id uuid NOT NULL REFERENCES socios.socios, disciplina_id uuid NOT NULL REFERENCES deportes.disciplinas, ejercicio_id uuid NOT NULL REFERENCES deportes.ejercicios, estado text NOT NULL, fecha_alta date NOT NULL, fecha_baja date)`)
  // prettier-ignore
  const migrations = await Promise.all(['0049_dues_pricing_obligations.sql', '0050_dues_benefit_rules.sql', '0051_dues_family_groups.sql'].map((file) => readFile(join(import.meta.dirname, '../../../../../packages/db/drizzle', file), 'utf8')))
  await db.pool.query(migrations.join('\n'))
  // prettier-ignore
  await db.pool.query('ALTER TABLE tesoreria.dues_obligation_components DROP CONSTRAINT IF EXISTS dues_obligation_components_benefit_check')
  await db.pool.query(`CREATE TABLE IF NOT EXISTS public.audit_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), operator_id uuid, action text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL, old_value jsonb, new_value jsonb, source_ip text, metadata jsonb, idempotency_key text, created_at timestamptz NOT NULL DEFAULT now()); CREATE UNIQUE INDEX IF NOT EXISTS service_audit_key ON public.audit_events (idempotency_key) WHERE idempotency_key IS NOT NULL; CREATE TABLE IF NOT EXISTS tesoreria.ctacte (id uuid PRIMARY KEY DEFAULT gen_random_uuid())`)
  await db.pool.query(`INSERT INTO public.operators (id, username, password_hash, role) VALUES ($1, $2, 'fixture', 'A')`, [operatorId, `dues-service-${operatorId}`])
  await db.pool.query(`INSERT INTO deportes.ejercicios (id, anio, descripcion, fecha_inicio, fecha_fin) VALUES ($1, 2500, 'Fixture', DATE '2400-01-01', DATE '2900-01-01')`, [exerciseId])
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

// prettier-ignore
describe('dues services', () => {
  it('runs the assessment fixture in a disposable database', async () => {
    const currentDatabase = (await db.pool.query<{ name: string }>('SELECT current_database() AS name'))
      .rows[0]?.name
    const configuredDatabase = new URL(url!).pathname.slice(1)

    expect(currentDatabase).not.toBe(configuredDatabase)
  })

  it('audits authorized price actions and maps active overlap conflicts', async () => {
    const p = period()
    const service = new PricingService(db.db)
    const input = { ...context(), kind: 'BASE' as const, amountCents: 10_000, effectiveFrom: p.start, effectiveTo: p.end, rule: 'FULL_MONTH' as const }
    const created = await service.create(input)
    await expect(service.create({ ...input, callerKey: randomUUID() })).rejects.toMatchObject({ code: 'CONFLICT' })
    await service.revoke({ ...context(), priceVersionId: created.id, revokeReason: 'Correction' })
    const rows = await db.pool.query(`SELECT action FROM public.audit_events WHERE entity_id = $1 ORDER BY created_at`, [created.id])
    expect(rows.rows.map((row) => row.action)).toEqual([AuditAction.DUES_PRICE_CREATED, AuditAction.DUES_PRICE_REVOKED])
  })

  it('generates immutable evidence, replays exactly, and emits one period audit', async () => {
    const p = period()
    const socioId = await member()
    const disciplinaId = await discipline()
    await enroll(socioId, disciplinaId, p)
    await price(p, 'BASE', null, 10_000)
    await price(p, 'SPORT', disciplinaId, 2_500)
    const input = { ...context(), period: p }
    const beforeCtacte = (await db.pool.query(`SELECT count(*)::int AS count FROM tesoreria.ctacte`)).rows[0].count
    const service = new AssessmentService(db.db)
    const first = await service.generate(input)
    const replay = await service.generate(input)
    expect(replay).toEqual(first)
    const obligation = await db.pool.query(`SELECT id, amount, snapshot FROM tesoreria.dues_obligations WHERE socio_id = $1 AND period_start = $2`, [socioId, p.start])
    const components = await db.pool.query(`SELECT kind FROM tesoreria.dues_obligation_components WHERE obligation_id = $1 ORDER BY component_key`, [obligation.rows[0]?.id])
    const audits = await db.pool.query(`SELECT action FROM public.audit_events WHERE action = $1 AND entity_id = $2`, [AuditAction.DUES_PERIOD_GENERATED, p.start])
    const snapshot = obligation.rows[0].snapshot
    expect(obligation.rows).toHaveLength(1)
    expect(obligation.rows[0].amount).toBe('125.00')
    expect(components.rows.map((row) => row.kind)).toEqual(['BASE', 'SPORT'])
    expect(audits.rows).toHaveLength(1)
    expect(snapshot).toMatchObject({ calculatorVersion: 'dues-calculator-v1', rounding: 'nearest-cent-half-up', period: p, benefits: [], actorId: operatorId, role: 'ADMIN', permissions: ['dues:write'], sourceIp: '127.0.0.1', callerKey: input.callerKey, requestFingerprint: input.requestFingerprint, receiptFingerprint: input.requestFingerprint })
    expect(snapshot.enrollmentEvidence).toHaveLength(1)
    expect(snapshot.time).toMatch(/T/)
    expect(snapshot.rule).toHaveLength(2)
    expect(snapshot.inputs.base.price.versionId).toBeDefined()
    expect(snapshot.inputs.sports[0].price.versionId).toBeDefined()
    expect((await db.pool.query(`SELECT count(*)::int AS count FROM tesoreria.ctacte`)).rows[0].count).toBe(beforeCtacte)
  })

  it('rolls back receipt and obligation when audit or persistence fails', async () => {
    const p = period()
    const socioId = await member()
    const disciplinaId = await discipline()
    await enroll(socioId, disciplinaId, p)
    await price(p, 'BASE', null, 10_000)
    const failedAudit = new AssessmentService(db.db, { audit: async () => { throw new Error('audit failed') } })
    const auditInput = { ...context(), period: p }
    await expect(failedAudit.generate(auditInput)).rejects.toThrow('audit failed')
    expect((await db.pool.query(`SELECT count(*)::int AS count FROM tesoreria.dues_generation_receipts WHERE caller_key = $1`, [auditInput.callerKey])).rows[0].count).toBe(0)
    expect((await db.pool.query(`SELECT count(*)::int AS count FROM tesoreria.dues_obligations WHERE socio_id = $1 AND period_start = $2`, [socioId, p.start])).rows[0].count).toBe(0)
    const persistenceInput = { ...context(), period: p }
    const failingRepository = { ...repository, insertObligationInTransaction: async () => { throw new Error('persistence failed') } }
    const failedPersistence = new AssessmentService(db.db, { repository: failingRepository })
    await expect(failedPersistence.generate(persistenceInput)).rejects.toThrow('persistence failed')
    expect((await db.pool.query(`SELECT count(*)::int AS count FROM tesoreria.dues_generation_receipts WHERE caller_key = $1`, [persistenceInput.callerKey])).rows[0].count).toBe(0)
    expect((await db.pool.query(`SELECT count(*)::int AS count FROM tesoreria.dues_obligations WHERE socio_id = $1 AND period_start = $2`, [socioId, p.start])).rows[0].count).toBe(0)
  })

  // prettier-ignore
  it('applies configured benefits once and preserves the historical snapshot after revocation', async () => {
    const p = period(), socioId = await member()
    await price(p, 'BASE', null, 10_000)
    // prettier-ignore
    const fixed = await repository.createBenefitRule(db.db, { kind: 'FIXED_DISCOUNT', socioId, amountCents: 2_000, currency: 'ARS', effectiveFrom: p.start, effectiveTo: p.end, priority: 10, combinability: 'COMBINABLE', reason: 'Approved fixed benefit', createdBy: operatorId, authorizationEvidence: { ticket: 'BEN-1' } })
    // prettier-ignore
    const percentage = await repository.createBenefitRule(db.db, { kind: 'PERCENT_DISCOUNT', socioId, percentage: 50, percentageBasis: 'REMAINING', effectiveFrom: p.start, effectiveTo: p.end, priority: 20, combinability: 'COMBINABLE', reason: 'Approved percentage benefit', createdBy: operatorId, authorizationEvidence: { ticket: 'BEN-2' } })
    const service = new AssessmentService(db.db)
    const input = { ...context(), period: p }
    const first = await service.generate(input)
    await repository.revokeBenefitRule(db.db, { benefitRuleId: fixed.id, revokedBy: operatorId, revokeReason: 'Replaced' })
    await repository.revokeBenefitRule(db.db, { benefitRuleId: percentage.id, revokedBy: operatorId, revokeReason: 'Replaced' })
    // prettier-ignore
    const replay = await service.generate({ ...input, callerKey: randomUUID(), requestFingerprint: randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64) })
    const obligation = await db.pool.query(`SELECT id, amount, snapshot FROM tesoreria.dues_obligations WHERE socio_id = $1 AND period_start = $2`, [socioId, p.start])
    // prettier-ignore
    const components = await db.pool.query(`SELECT kind, amount FROM tesoreria.dues_obligation_components WHERE obligation_id = $1 ORDER BY component_key`, [obligation.rows[0].id])
    const audits = await db.pool.query(`SELECT action FROM public.audit_events WHERE action = $1 AND entity_id = ANY($2::text[])`, [AuditAction.DUES_BENEFIT_APPLIED, [fixed.id, percentage.id]])
    expect(replay.obligationIds).toEqual(first.obligationIds)
    // prettier-ignore
    expect(obligation.rows[0]).toMatchObject({ amount: '40.00', snapshot: { benefits: [{ id: fixed.id, priority: 10, appliedAmountCents: 2_000 }, { id: percentage.id, percentageBasis: 'REMAINING', appliedAmountCents: 4_000 }] } })
    expect(components.rows).toHaveLength(3)
    // prettier-ignore
    expect(components.rows).toEqual(expect.arrayContaining([{ kind: 'BASE', amount: '100.00' }, { kind: 'BENEFIT', amount: '-20.00' }, { kind: 'BENEFIT', amount: '-40.00' }]))
    expect(audits.rows).toHaveLength(2)
  })

  it('executes overlapping reviewed ranges causally and rolls back audit failure', async () => {
    const p = period(2500, 1), q = period(2500, 2), range = { start: p.start, end: q.end }, socioId = await member()
    await price(range, 'BASE', null, 10_000)
    const service = new AssessmentService(db.db, { now: () => new Date('2600-01-01T00:00:00Z') })
    const commands = [context(), context()].map((input) => ({ ...input, socioId, fromPeriod: '2500-01', throughPeriod: '2500-02' }))
    const previews = await Promise.all(commands.map((input) => service.preview(input)))
    const counts = async (keys: string[]) => Promise.all([
      db.pool.query(`SELECT count(*)::int AS count FROM tesoreria.dues_obligations WHERE socio_id = $1`, [socioId]),
      db.pool.query(`SELECT count(*)::int AS count FROM tesoreria.dues_generation_receipts WHERE caller_key = ANY($1)`, [keys]),
      db.pool.query(`SELECT count(*)::int AS count FROM public.audit_events WHERE metadata ->> 'callerKey' = ANY($1)`, [keys]),
      db.pool.query(`SELECT count(*)::int AS count FROM tesoreria.dues_obligation_components c JOIN tesoreria.dues_obligations o ON o.id = c.obligation_id WHERE o.socio_id = $1`, [socioId]),
    ]).then((rows) => rows.map((row) => row.rows[0]?.count))
    expect(await counts(commands.map(({ callerKey }) => callerKey))).toEqual([0, 0, 0, 0])
    const outcomes = await Promise.allSettled(commands.map((input, index) => service.executeRange({ ...input, previewFingerprint: previews[index]!.fingerprint })))
    const winnerIndex = outcomes.findIndex(({ status }) => status === 'fulfilled'), loserIndex = outcomes.findIndex(({ status }) => status === 'rejected')
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1); expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    const winner = outcomes[winnerIndex], loser = outcomes[loserIndex]
    if (winner?.status !== 'fulfilled' || loser?.status !== 'rejected') throw new Error('expected one committed range and one stale preview conflict')
    expect(winner.value).toMatchObject({ createdObligationIds: [expect.any(String), expect.any(String)], periods: ['2500-01', '2500-02'] })
    expect(winner.value.createdObligationIds).toHaveLength(2); expect(loser.reason).toMatchObject({ code: 'CONFLICT', message: 'Los datos de la evaluación cambiaron; generá una nueva vista previa' })
    expect(await counts(commands.map(({ callerKey }) => callerKey))).toEqual([2, 1, 1, 2])
    const winning = commands[winnerIndex]!, beforeReplay = await counts(commands.map(({ callerKey }) => callerKey))
    await expect(service.executeRange({ ...winning, previewFingerprint: previews[winnerIndex]!.fingerprint })).resolves.toEqual(winner.value)
    expect(await counts(commands.map(({ callerKey }) => callerKey))).toEqual(beforeReplay)
    const failedSocio = await member(), failed = { ...context(), socioId: failedSocio, fromPeriod: '2500-01', throughPeriod: '2500-02' }
    const failedPreview = await service.preview(failed)
    await expect(new AssessmentService(db.db, { audit: async () => { throw new Error('audit failed') }, now: () => new Date('2600-01-01T00:00:00Z') }).executeRange({ ...failed, previewFingerprint: failedPreview.fingerprint })).rejects.toThrow('audit failed')
    const rollback = await Promise.all([
      db.pool.query(`SELECT count(*)::int AS count FROM tesoreria.dues_obligations WHERE socio_id = $1`, [failedSocio]),
      db.pool.query(`SELECT count(*)::int AS count FROM tesoreria.dues_generation_receipts WHERE caller_key = $1`, [failed.callerKey]),
      db.pool.query(`SELECT count(*)::int AS count FROM public.audit_events WHERE metadata ->> 'callerKey' = $1`, [failed.callerKey]),
    ])
    expect(rollback.map((row) => row.rows[0]?.count)).toEqual([0, 0, 0])
  })

      it('applies a family-targeted benefit only through an effective membership', async () => {
    const p = period()
    const socioId = await member()
    const familyGroupId = randomUUID()
    await db.pool.query(`INSERT INTO tesoreria.dues_family_groups (id, reason, created_by, authorization_evidence) VALUES ($1, 'Approved eligibility group', $2, '{}')`, [familyGroupId, operatorId])
    await db.pool.query(`INSERT INTO tesoreria.dues_family_memberships (family_group_id, socio_id, effective_from, effective_to, reason, created_by, authorization_evidence) VALUES ($1, $2, $3, $4, 'Approved eligibility membership', $5, '{}')`, [familyGroupId, socioId, p.start, p.end, operatorId])
    await price(p, 'BASE', null, 10_000)
    const benefit = await repository.createBenefitRule(db.db, { kind: 'FIXED_DISCOUNT', socioId: null, familyGroupId, amountCents: 2_000, currency: 'ARS', effectiveFrom: p.start, effectiveTo: p.end, priority: 10, combinability: 'COMBINABLE', reason: 'Approved family benefit', createdBy: operatorId, authorizationEvidence: { ticket: 'FAM-2' } })
    expect((await repository.listEligibleMembers(db.db, p)).find((item) => item.socioId === socioId)).toMatchObject({ familyGroupId })
    await expect(repository.resolveBenefitRuleCandidates(db.db, { socioId, familyGroupId, period: p })).resolves.toMatchObject([{ id: benefit.id }])
    await new AssessmentService(db.db, { repository: { ...repository, resolveBenefitRuleCandidates: repository.resolveBenefitRuleCandidates } }).generate({ ...context(), period: p })
    const obligation = await db.pool.query(`SELECT amount, snapshot FROM tesoreria.dues_obligations WHERE socio_id = $1 AND period_start = $2`, [socioId, p.start])
    expect(obligation.rows).toHaveLength(1)
    expect(obligation.rows[0]).toMatchObject({ amount: '80.00', snapshot: { benefits: [expect.objectContaining({ id: benefit.id, familyGroupId })] } })
  })
})
