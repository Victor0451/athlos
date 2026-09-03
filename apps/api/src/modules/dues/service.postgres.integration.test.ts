import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createDb } from '@athlos/db'
import { AuditAction } from '@athlos/audit'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { AssessmentService, PricingService, type AuditContext } from './service.ts'
import * as repository from './repository.ts'

const url = process.env.ATHLOS_TEST_DATABASE_URL
let db: ReturnType<typeof createDb>
let admin: ReturnType<typeof createDb> | undefined
let isolatedDatabaseName: string | undefined
let operatorId: string
const exerciseId = randomUUID()
const fixtureMemberIds: string[] = []
const fixturePriceIds: string[] = []
const fixtureCallerKeys: string[] = []
let nextFixtureYear = 2401
// prettier-ignore
const period = (year = nextFixtureYear++, month = 1) => ({
  start: `${year}-${String(month).padStart(2, '0')}-01`,
  end: month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`,
})
// prettier-ignore
const context = (): AuditContext => {
  const callerKey = randomUUID()
  fixtureCallerKeys.push(callerKey)
  return {
    actorId: operatorId,
    role: 'ADMIN',
    permissions: ['dues:write'],
    sourceIp: '127.0.0.1',
    callerKey,
    requestFingerprint: randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64),
    authorizationEvidence: { role: 'ADMIN', permission: 'dues:write' },
  }
}
// prettier-ignore
async function member() {
  const id = randomUUID()
  await db.pool.query(`INSERT INTO socios.socios (id, numero_socio, nombre, apellido, dni, fecha_alta, estado) VALUES ($1, $2, 'Service', 'Fixture', $3, DATE '2024-01-01', 'activo')`, [id, `service-${id}`, `dni-${id}`])
  fixtureMemberIds.push(id)
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
  const created = await repository.createPrice(db.db, { kind, disciplinaId, amountCents, currency: 'ARS', effectiveFrom: p.start, effectiveTo: p.end, rule: 'FULL_MONTH', createdBy: operatorId, authorizationEvidence: { source: 'fixture' } })
  fixturePriceIds.push(created.id)
  return created
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
afterEach(async () => {
  if (fixtureMemberIds.length)
    await db.pool.query(`UPDATE socios.socios SET estado = 'inactivo' WHERE id = ANY($1::uuid[])`, [
      fixtureMemberIds,
    ])
  if (fixturePriceIds.length)
    await db.pool.query(
      `UPDATE tesoreria.dues_price_versions SET revoked_at = now(), revoked_by = $1, revoke_reason = 'Fixture cleanup' WHERE id = ANY($2::uuid[]) AND revoked_at IS NULL`,
      [operatorId, fixturePriceIds],
    )
  if (fixtureCallerKeys.length)
    await db.pool.query(
      `DELETE FROM public.audit_events WHERE metadata ->> 'callerKey' = ANY($1::text[])`,
      [fixtureCallerKeys],
    )
  fixtureMemberIds.length = 0
  fixturePriceIds.length = 0
  fixtureCallerKeys.length = 0
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
    fixturePriceIds.push(created.id)
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
    const plan = await service.planGeneration({ role: input.role, period: input.period })
    const command = { ...input, planFingerprint: plan.fingerprint }
    const first = await service.generate(command)
    const replay = await service.generate(command)
    expect(replay).toEqual(first)
    const obligation = await db.pool.query(`SELECT id, amount, snapshot FROM tesoreria.dues_obligations WHERE socio_id = $1 AND period_start = $2`, [socioId, p.start])
    const components = await db.pool.query(`SELECT kind, disciplina_id FROM tesoreria.dues_obligation_components WHERE obligation_id = $1 ORDER BY component_key`, [obligation.rows[0]?.id])
    const audits = await db.pool.query(`SELECT action FROM public.audit_events WHERE action = $1 AND entity_id = $2`, [AuditAction.DUES_PERIOD_GENERATED, p.start])
    const snapshot = obligation.rows[0].snapshot
    expect(obligation.rows).toHaveLength(1)
    expect(obligation.rows[0].amount).toBe('125.00')
    expect(components.rows).toEqual([
      { kind: 'BASE', disciplina_id: null },
      { kind: 'SPORT', disciplina_id: disciplinaId },
    ])
    expect(audits.rows).toHaveLength(1)
    expect(snapshot).toMatchObject({
      payload: {
        calculatorVersion: 'generation-plan-v1',
        rounding: 'HALF_UP',
        assessment: { period: p, currency: 'ARS', input: { grossCents: 12_500, componentCount: 2 } },
        member: { id: socioId, enrollments: [expect.objectContaining({ disciplineId: disciplinaId })] },
        sourcePrices: [
          expect.objectContaining({ kind: 'BASE', disciplineId: null }),
          expect.objectContaining({ kind: 'SPORT', disciplineId: disciplinaId }),
        ],
        appliedBenefits: [],
      },
      evidence: {
        actor: { id: operatorId, role: 'ADMIN', permissions: ['dues:write'] },
        request: { callerKey: input.callerKey, fingerprint: input.requestFingerprint },
        receiptFingerprint: input.requestFingerprint,
        generatedAt: expect.stringMatching(/T/),
      },
    })
    expect((await db.pool.query(`SELECT count(*)::int AS count FROM tesoreria.ctacte`)).rows[0].count).toBe(beforeCtacte)
  })

  it('rolls back receipt and obligation when audit or persistence fails', async () => {
    const p = period()
    const socioId = await member()
    const disciplinaId = await discipline()
    await enroll(socioId, disciplinaId, p)
    await price(p, 'BASE', null, 10_000)
    await price(p, 'SPORT', disciplinaId, 2_500)
    const failedAudit = new AssessmentService(db.db, { audit: async () => { throw new Error('audit failed') } })
    const auditInput = { ...context(), period: p }
    const auditPlan = await failedAudit.planGeneration({ role: auditInput.role, period: auditInput.period })
    await expect(failedAudit.generate({ ...auditInput, planFingerprint: auditPlan.fingerprint })).rejects.toThrow('audit failed')
    expect((await db.pool.query(`SELECT count(*)::int AS count FROM tesoreria.dues_generation_receipts WHERE caller_key = $1`, [auditInput.callerKey])).rows[0].count).toBe(0)
    expect((await db.pool.query(`SELECT count(*)::int AS count FROM tesoreria.dues_obligations WHERE socio_id = $1 AND period_start = $2`, [socioId, p.start])).rows[0].count).toBe(0)
    const persistenceInput = { ...context(), period: p }
    const failingRepository = { ...repository, insertObligationInTransaction: async () => { throw new Error('persistence failed') } }
    const failedPersistence = new AssessmentService(db.db, { repository: failingRepository })
    const persistencePlan = await failedPersistence.planGeneration({ role: persistenceInput.role, period: persistenceInput.period })
    await expect(failedPersistence.generate({ ...persistenceInput, planFingerprint: persistencePlan.fingerprint })).rejects.toThrow('persistence failed')
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
    const initialPlan = await service.planGeneration({ role: input.role, period: input.period })
    const command = { ...input, planFingerprint: initialPlan.fingerprint }
    const first = await service.generate(command)
    const replay = await service.generate(command)
    await repository.revokeBenefitRule(db.db, { benefitRuleId: fixed.id, revokedBy: operatorId, revokeReason: 'Replaced' })
    await repository.revokeBenefitRule(db.db, { benefitRuleId: percentage.id, revokedBy: operatorId, revokeReason: 'Replaced' })
    const changedContext = context()
    const changedInput = {
      ...input,
      callerKey: changedContext.callerKey,
      requestFingerprint: changedContext.requestFingerprint,
    }
    const changedPlan = await service.planGeneration({ role: changedInput.role, period: changedInput.period })
    const afterRevocation = await service.generate({ ...changedInput, planFingerprint: changedPlan.fingerprint })
    const obligation = await db.pool.query(`SELECT id, amount, snapshot FROM tesoreria.dues_obligations WHERE socio_id = $1 AND period_start = $2`, [socioId, p.start])
    // prettier-ignore
    const components = await db.pool.query(`SELECT kind, amount FROM tesoreria.dues_obligation_components WHERE obligation_id = $1 ORDER BY component_key`, [obligation.rows[0].id])
    const audits = await db.pool.query(`SELECT action FROM public.audit_events WHERE action = $1 AND entity_id = ANY($2::text[])`, [AuditAction.DUES_BENEFIT_APPLIED, [fixed.id, percentage.id]])
    expect(first).toEqual({ period: p, generatedObligationCount: 1, retainedExistingCount: 0, reviewCount: 0, generatedTotalCents: 4_000 })
    expect(replay).toEqual(first)
    expect(afterRevocation).toEqual({ period: p, generatedObligationCount: 0, retainedExistingCount: 1, reviewCount: 1, generatedTotalCents: 0 })
    // prettier-ignore
    expect(obligation.rows[0]).toMatchObject({
      amount: '40.00',
      snapshot: {
        payload: {
          calculatorVersion: 'generation-plan-v1',
          rounding: 'HALF_UP',
          assessment: { period: p },
          member: { id: socioId, enrollments: [] },
          sourcePrices: [expect.objectContaining({ kind: 'BASE', disciplineId: null })],
          appliedBenefits: [
            expect.objectContaining({
              id: fixed.id,
              appliedAmountCents: 2_000,
              ruleSnapshot: expect.objectContaining({ priority: 10, authorizationEvidence: { ticket: 'BEN-1' } }),
              sourceSnapshot: { benefitId: fixed.id, authorizationEvidence: { ticket: 'BEN-1' } },
            }),
            expect.objectContaining({
              id: percentage.id,
              appliedAmountCents: 4_000,
              ruleSnapshot: expect.objectContaining({ percentageBasis: 'REMAINING', authorizationEvidence: { ticket: 'BEN-2' } }),
              sourceSnapshot: { benefitId: percentage.id, authorizationEvidence: { ticket: 'BEN-2' } },
            }),
          ],
        },
        evidence: expect.objectContaining({
          actor: { id: operatorId, role: 'ADMIN', permissions: ['dues:write'] },
          request: { callerKey: input.callerKey, fingerprint: input.requestFingerprint },
          receiptFingerprint: input.requestFingerprint,
          generatedAt: expect.stringMatching(/T/),
        }),
      },
    })
    expect(components.rows).toHaveLength(3)
    // prettier-ignore
    expect(components.rows).toEqual(expect.arrayContaining([{ kind: 'BASE', amount: '100.00' }, { kind: 'BENEFIT', amount: '-20.00' }, { kind: 'BENEFIT', amount: '-40.00' }]))
    expect(audits.rows).toHaveLength(2)
  })

  it('executes overlapping reviewed ranges causally and rolls back audit failure', async () => {
    const p = period(2450, 1), q = period(2450, 2), range = { start: p.start, end: q.end }, socioId = await member()
    await price(range, 'BASE', null, 10_000)
    const service = new AssessmentService(db.db, { now: () => new Date('2600-01-01T00:00:00Z') })
    const commands = [context(), context()].map((input) => ({ ...input, socioId, fromPeriod: '2450-01', throughPeriod: '2450-02' }))
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
    expect(winner.value).toMatchObject({ createdObligationIds: [expect.any(String), expect.any(String)], periods: ['2450-01', '2450-02'] })
    expect(winner.value.createdObligationIds).toHaveLength(2); expect(loser.reason).toMatchObject({ code: 'CONFLICT', message: 'Los datos de la evaluación cambiaron; generá una nueva vista previa' })
    expect(await counts(commands.map(({ callerKey }) => callerKey))).toEqual([2, 1, 1, 2])
    const winning = commands[winnerIndex]!, beforeReplay = await counts(commands.map(({ callerKey }) => callerKey))
    await expect(service.executeRange({ ...winning, previewFingerprint: previews[winnerIndex]!.fingerprint })).resolves.toEqual(winner.value)
    expect(await counts(commands.map(({ callerKey }) => callerKey))).toEqual(beforeReplay)
    const failedSocio = await member(), failed = { ...context(), socioId: failedSocio, fromPeriod: '2450-01', throughPeriod: '2450-02' }
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
    const service = new AssessmentService(db.db, { repository: { ...repository, resolveBenefitRuleCandidates: repository.resolveBenefitRuleCandidates } })
    const input = { ...context(), period: p }
    const plan = await service.planGeneration({ role: input.role, period: input.period })
    await service.generate({ ...input, planFingerprint: plan.fingerprint })
    const obligation = await db.pool.query(`SELECT amount, snapshot FROM tesoreria.dues_obligations WHERE socio_id = $1 AND period_start = $2`, [socioId, p.start])
    expect(obligation.rows).toHaveLength(1)
    expect(obligation.rows[0]).toMatchObject({
      amount: '80.00',
      snapshot: {
        payload: {
          calculatorVersion: 'generation-plan-v1',
          rounding: 'HALF_UP',
          assessment: { period: p },
          member: { id: socioId, enrollments: [] },
          sourcePrices: [expect.objectContaining({ kind: 'BASE', disciplineId: null })],
          appliedBenefits: [
            expect.objectContaining({
              id: benefit.id,
              ruleSnapshot: expect.objectContaining({ familyGroupId }),
              sourceSnapshot: { benefitId: benefit.id, authorizationEvidence: { ticket: 'FAM-2' } },
            }),
          ],
        },
        evidence: expect.objectContaining({
          actor: { id: operatorId, role: 'ADMIN', permissions: ['dues:write'] },
          request: { callerKey: input.callerKey, fingerprint: input.requestFingerprint },
          receiptFingerprint: input.requestFingerprint,
          generatedAt: expect.stringMatching(/T/),
        }),
      },
    })
  })
})
