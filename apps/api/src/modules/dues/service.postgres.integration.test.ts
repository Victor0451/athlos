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
  db = createDb({ connectionString: url, poolMax: 1 })
  operatorId = randomUUID()
  await db.pool.query(`CREATE SCHEMA IF NOT EXISTS socios; CREATE SCHEMA IF NOT EXISTS deportes; CREATE TABLE IF NOT EXISTS public.operators (id uuid PRIMARY KEY, username text UNIQUE NOT NULL, password_hash text NOT NULL, role char(1) NOT NULL); CREATE TABLE IF NOT EXISTS socios.socios (id uuid PRIMARY KEY, numero_socio text NOT NULL, nombre text NOT NULL, apellido text NOT NULL, dni text NOT NULL, fecha_alta date NOT NULL, estado text NOT NULL); CREATE TABLE IF NOT EXISTS deportes.disciplinas (id uuid PRIMARY KEY, codigo text UNIQUE NOT NULL, nombre text NOT NULL); CREATE TABLE IF NOT EXISTS deportes.ejercicios (id uuid PRIMARY KEY, anio integer NOT NULL, descripcion text NOT NULL, fecha_inicio date NOT NULL, fecha_fin date NOT NULL); CREATE TABLE IF NOT EXISTS deportes.inscripciones (id uuid PRIMARY KEY, socio_id uuid NOT NULL REFERENCES socios.socios, disciplina_id uuid NOT NULL REFERENCES deportes.disciplinas, ejercicio_id uuid NOT NULL REFERENCES deportes.ejercicios, estado text NOT NULL, fecha_alta date NOT NULL, fecha_baja date)`)
  // prettier-ignore
  const migrations = await Promise.all(['0049_dues_pricing_obligations.sql', '0050_dues_benefit_rules.sql'].map((file) => readFile(join(import.meta.dirname, '../../../../../packages/db/drizzle', file), 'utf8')))
  await db.pool.query(migrations.join('\n'))
  // prettier-ignore
  await db.pool.query('ALTER TABLE tesoreria.dues_obligation_components DROP CONSTRAINT IF EXISTS dues_obligation_components_benefit_check')
  await db.pool.query(`CREATE TABLE IF NOT EXISTS public.audit_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), operator_id uuid, action text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL, old_value jsonb, new_value jsonb, source_ip text, metadata jsonb, idempotency_key text, created_at timestamptz NOT NULL DEFAULT now()); CREATE UNIQUE INDEX IF NOT EXISTS service_audit_key ON public.audit_events (idempotency_key) WHERE idempotency_key IS NOT NULL; CREATE TABLE IF NOT EXISTS tesoreria.ctacte (id uuid PRIMARY KEY DEFAULT gen_random_uuid())`)
  await db.pool.query(`INSERT INTO public.operators (id, username, password_hash, role) VALUES ($1, $2, 'fixture', 'A')`, [operatorId, `dues-service-${operatorId}`])
  await db.pool.query(`INSERT INTO deportes.ejercicios (id, anio, descripcion, fecha_inicio, fecha_fin) VALUES ($1, 2500, 'Fixture', DATE '2400-01-01', DATE '2900-01-01')`, [exerciseId])
})
afterAll(async () => db?.pool.end())

// prettier-ignore
describe('dues services', () => {
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
    const failingRepository = { ...repository, insertObligation: async () => { throw new Error('persistence failed') } }
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
})
