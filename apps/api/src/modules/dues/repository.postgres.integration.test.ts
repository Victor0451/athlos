import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createDb } from '@athlos/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  claimReceipt,
  createPrice,
  finalizeReceipt,
  findObligation,
  insertObligation,
  listEffectivePrices,
  listEligibleMembers,
  lockPeriod,
  revokePrice,
  type ObligationInput,
} from './repository.ts'
// prettier-ignore
import { createBenefitRule, createFamilyGroup, createFamilyMembership, listEffectiveBenefitRules, listFamilyMemberships, revokeBenefitRule, revokeFamilyMembership, resolveBenefitRuleCandidates, type BenefitInput } from './repository.ts'

const url = process.env.ATHLOS_TEST_DATABASE_URL
let winner: ReturnType<typeof createDb>
let follower: ReturnType<typeof createDb>
let operatorId: string
const exerciseId = randomUUID()
const period = (year: number, month: number) => ({
  start: `${year}-${String(month).padStart(2, '0')}-01`,
  end: month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`,
})
const randomPeriod = () =>
  period(2400 + Math.floor(Math.random() * 500), 1 + Math.floor(Math.random() * 12))
const waitFor = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
function gate() {
  let enter!: () => void
  let release!: () => void
  const entered = new Promise<void>((resolve) => (enter = resolve))
  const released = new Promise<void>((resolve) => (release = resolve))
  return { entered, release, wait: async () => (enter(), released) }
}
// prettier-ignore
async function member(db: ReturnType<typeof createDb>) { const id = randomUUID(); await db.pool.query(`INSERT INTO socios.socios (id, numero_socio, nombre, apellido, dni, fecha_alta, estado) VALUES ($1, $2, 'Repository', 'Fixture', $3, DATE '2024-01-01', 'activo')`, [id, `repo-${id}`, `dni-${id}`]); return id }
// prettier-ignore
async function discipline(db: ReturnType<typeof createDb>) { const id = randomUUID(); await db.pool.query(`INSERT INTO deportes.disciplinas (id, codigo, nombre) VALUES ($1, $2, 'Repository fixture')`, [id, `repo-${id}`]); return id }
// prettier-ignore
async function enrollment(db: ReturnType<typeof createDb>, socioId: string, disciplinaId: string, p: { start: string; end: string }, estado: string, fechaBaja: string | null = null) { await db.pool.query(`INSERT INTO deportes.inscripciones (id, socio_id, disciplina_id, ejercicio_id, estado, fecha_alta, fecha_baja) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [randomUUID(), socioId, disciplinaId, exerciseId, estado, p.start, fechaBaja]) }
// prettier-ignore
async function price(db: ReturnType<typeof createDb>, p: { start: string; end: string }, kind: 'BASE' | 'SPORT', disciplinaId: string | null, amount: string) { const result = await db.pool.query(`INSERT INTO tesoreria.dues_price_versions (kind, disciplina_id, amount, effective_from, effective_to, rule, created_by, authorization_evidence) VALUES ($1, $2, $3, $4, $5, 'FULL_MONTH', $6, '{"source":"test"}') RETURNING id`, [kind, disciplinaId, amount, p.start, p.end, operatorId]); return result.rows[0].id as string }
// prettier-ignore
const component = { kind: 'BASE' as const, componentKey: 'base', amountCents: 10_000, calculationInputs: { rule: 'FULL_MONTH' }, eligibilitySnapshot: { eligible: true }, priceSnapshot: { version: 'fixture' } }
// prettier-ignore
const obligation = (socioId: string, receiptId: string, p: { start: string; end: string }): ObligationInput => ({ socioId, periodStart: p.start, periodEnd: p.end, amountCents: 10_000, generationReceiptId: receiptId, actorId: operatorId, snapshot: { calculatorVersion: 'test-v1', inputs: { source: 'fixture' } }, authorizationEvidence: { role: 'ADMIN' }, components: [component] })
// prettier-ignore
const priceInput = (p: { start: string; end: string }, kind: 'BASE' | 'SPORT', disciplinaId: string | null = null) => ({ kind, disciplinaId, amountCents: 10_000, currency: 'ARS', effectiveFrom: p.start, effectiveTo: p.end, rule: 'FULL_MONTH' as const, createdBy: operatorId, authorizationEvidence: { source: 'test' } })
// prettier-ignore
const benefitInput = (p: { start: string; end: string }, overrides: Partial<BenefitInput> = {}): BenefitInput => ({ kind: 'FIXED_DISCOUNT', socioId: randomUUID(), amountCents: 1_000, currency: 'ARS', effectiveFrom: p.start, effectiveTo: p.end, priority: 20, combinability: 'COMBINABLE', reason: 'Approved rule', createdBy: operatorId, authorizationEvidence: { ticket: 'BEN-1' }, ...overrides })

beforeAll(async () => {
  if (!url) throw new Error('ATHLOS_TEST_DATABASE_URL is required')
  winner = createDb({ connectionString: url, poolMax: 1 })
  follower = createDb({ connectionString: url, poolMax: 1 })
  operatorId = randomUUID()
  await winner.pool.query(
    `CREATE SCHEMA IF NOT EXISTS socios; CREATE SCHEMA IF NOT EXISTS deportes; CREATE TABLE IF NOT EXISTS public.operators (id uuid PRIMARY KEY, username text UNIQUE NOT NULL, password_hash text NOT NULL, role char(1) NOT NULL); CREATE TABLE IF NOT EXISTS socios.socios (id uuid PRIMARY KEY, numero_socio text NOT NULL, nombre text NOT NULL, apellido text NOT NULL, dni text NOT NULL, fecha_alta date NOT NULL, estado text NOT NULL); CREATE TABLE IF NOT EXISTS deportes.disciplinas (id uuid PRIMARY KEY, codigo text UNIQUE NOT NULL, nombre text NOT NULL); CREATE TABLE IF NOT EXISTS deportes.ejercicios (id uuid PRIMARY KEY, anio integer NOT NULL, descripcion text NOT NULL, fecha_inicio date NOT NULL, fecha_fin date NOT NULL); CREATE TABLE IF NOT EXISTS deportes.inscripciones (id uuid PRIMARY KEY, socio_id uuid NOT NULL REFERENCES socios.socios, disciplina_id uuid NOT NULL REFERENCES deportes.disciplinas, ejercicio_id uuid NOT NULL REFERENCES deportes.ejercicios, estado text NOT NULL, fecha_alta date NOT NULL, fecha_baja date)`,
  )
  const migration = await Promise.all(
    [
      '0049_dues_pricing_obligations.sql',
      '0050_dues_benefit_rules.sql',
      '0051_dues_family_groups.sql',
    ].map((file) =>
      readFile(join(import.meta.dirname, '../../../../../packages/db/drizzle', file), 'utf8'),
    ),
  )
  await winner.pool.query(migration.join('\n'))
  await winner.pool.query(
    `CREATE TABLE IF NOT EXISTS tesoreria.ctacte (id uuid PRIMARY KEY DEFAULT gen_random_uuid())`,
  )
  await winner.pool.query(
    `INSERT INTO public.operators (id, username, password_hash, role) VALUES ($1, $2, 'fixture', 'A')`,
    [operatorId, `dues-repository-${operatorId}`],
  )
  await winner.pool.query(
    `INSERT INTO deportes.ejercicios (id, anio, descripcion, fecha_inicio, fecha_fin) VALUES ($1, 2400, 'Fixture', DATE '2400-01-01', DATE '2900-01-01')`,
    [exerciseId],
  )
})
afterAll(async () => Promise.all([winner?.pool.end(), follower?.pool.end()]))

describe('dues repository', () => {
  it('replays a finalized fingerprint and conflicts on a changed fingerprint', async () => {
    const p = randomPeriod()
    const input = {
      operatorId,
      callerKey: `replay-${randomUUID()}`,
      requestFingerprint: 'a'.repeat(64),
      periodStart: p.start,
      periodEnd: p.end,
      authorizationEvidence: { role: 'ADMIN' },
    }
    const claimed = await claimReceipt(winner.db, input)
    await finalizeReceipt(winner.db, claimed.receipt.id, { obligationIds: ['stable-id'] })
    await expect(claimReceipt(winner.db, input)).resolves.toMatchObject({
      status: 'replayed',
      result: { obligationIds: ['stable-id'] },
    })
    await expect(
      claimReceipt(winner.db, { ...input, requestFingerprint: 'b'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('lists active and dated-baja evidence, excluding pending rows, with effective prices', async () => {
    const p = randomPeriod()
    const socioId = await member(winner)
    const active = await discipline(winner)
    const baja = await discipline(winner)
    const pending = await discipline(winner)
    await enrollment(winner, socioId, active, p, 'activa')
    await enrollment(winner, socioId, baja, p, 'baja', `${p.start.slice(0, 8)}15`)
    await enrollment(winner, socioId, pending, p, 'pendiente')
    await price(winner, p, 'BASE', null, '100.00')
    const sportPriceId = await price(winner, p, 'SPORT', active, '25.00')
    const listed = (await listEligibleMembers(winner.db, p)).find(
      (item) => item.socioId === socioId,
    )
    expect(listed?.sports).toHaveLength(2)
    expect(listed?.sports.map((item) => item.estado).sort()).toEqual(['activa', 'baja'])
    expect(listed?.sports.find((item) => item.estado === 'baja')).toMatchObject({
      eligibleFrom: p.start,
      eligibleTo: `${p.start.slice(0, 8)}15`,
    })
    const prices = await listEffectivePrices(winner.db, p)
    expect(prices.base).toHaveLength(1)
    expect(prices.sports).toMatchObject([
      { versionId: sportPriceId, disciplinaId: active, amountCents: 2500 },
    ])
  })

  it('resolves the effective family group in eligibility and preserves dated memberships', async () => {
    const p = randomPeriod()
    const socioId = await member(winner)
    const familyGroupId = randomUUID()
    await createFamilyGroup(winner.db, {
      id: familyGroupId,
      reason: 'Approved eligibility group',
      createdBy: operatorId,
      authorizationEvidence: { ticket: 'FAM-1' },
    })
    const membership = await createFamilyMembership(winner.db, {
      familyGroupId,
      socioId,
      effectiveFrom: p.start,
      effectiveTo: p.end,
      reason: 'Approved eligibility membership',
      createdBy: operatorId,
      authorizationEvidence: { ticket: 'FAM-1' },
    })
    const listed = (await listEligibleMembers(winner.db, p)).find(
      (item) => item.socioId === socioId,
    )
    expect(listed).toMatchObject({ socioId, familyGroupId })
    await expect(listFamilyMemberships(winner.db, familyGroupId)).resolves.toMatchObject([
      { id: membership.id, familyGroupId, socioId, effectiveFrom: p.start, effectiveTo: p.end },
    ])
    await expect(
      revokeFamilyMembership(winner.db, {
        membershipId: membership.id,
        revokedBy: operatorId,
        revokeReason: 'Replaced',
      }),
    ).resolves.toMatchObject({ id: membership.id, revokedBy: operatorId })
    expect(
      (await listEligibleMembers(winner.db, p)).find((item) => item.socioId === socioId)
        ?.familyGroupId,
    ).toBeNull()
  })

  it('uses the period lock so different keys create one monthly obligation', async () => {
    const p = randomPeriod()
    const socioId = await member(winner)
    const run = (db: ReturnType<typeof createDb>['db'], key: string, hold = false) =>
      db.transaction(async (tx) => {
        const receipt = await claimReceipt(tx, {
          operatorId,
          callerKey: key,
          requestFingerprint: key.padEnd(64, '0'),
          periodStart: p.start,
          periodEnd: p.end,
          authorizationEvidence: {},
        })
        await lockPeriod(tx, p.start)
        if (hold) await blocker.wait()
        const existing = await findObligation(tx, socioId, p.start)
        const result =
          existing ?? (await insertObligation(tx, obligation(socioId, receipt.receipt.id, p)))
        await finalizeReceipt(tx, receipt.receipt.id, { obligationIds: [result.obligation.id] })
        return result.obligation.id
      })
    const blocker = gate()
    const first = run(winner.db, `race-a-${randomUUID()}`, true)
    await blocker.entered
    const second = run(follower.db, `race-b-${randomUUID()}`)
    await waitFor(25)
    blocker.release()
    const ids = await Promise.all([first, second])
    expect(new Set(ids).size).toBe(1)
    await expect(
      winner.pool.query(
        `SELECT count(*)::int AS count FROM tesoreria.dues_obligations WHERE socio_id = $1 AND period_start = $2`,
        [socioId, p.start],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] })
  })

  it('rolls back the receipt, obligation, and components atomically', async () => {
    const p = randomPeriod()
    const socioId = await member(winner)
    const key = `rollback-${randomUUID()}`
    await expect(
      winner.db.transaction(async (tx) => {
        const receipt = await claimReceipt(tx, {
          operatorId,
          callerKey: key,
          requestFingerprint: 'c'.repeat(64),
          periodStart: p.start,
          periodEnd: p.end,
          authorizationEvidence: {},
        })
        await insertObligation(tx, {
          ...obligation(socioId, receipt.receipt.id, p),
          components: [component, component],
        })
      }),
    ).rejects.toMatchObject({ code: '23505' })
    await expect(
      claimReceipt(winner.db, {
        operatorId,
        callerKey: key,
        requestFingerprint: 'c'.repeat(64),
        periodStart: p.start,
        periodEnd: p.end,
        authorizationEvidence: {},
      }),
    ).resolves.toMatchObject({ status: 'claimed' })
    await expect(
      winner.pool.query(
        `SELECT count(*)::int AS count FROM tesoreria.dues_obligations WHERE socio_id = $1`,
        [socioId],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] })
  })

  it('replays structured snapshots without ctacte projection and preserves immutable history', async () => {
    const p = randomPeriod()
    const socioId = await member(winner)
    const key = `immutable-${randomUUID()}`
    const before = await winner.pool.query(`SELECT count(*)::int AS count FROM tesoreria.ctacte`)
    const receipt = await claimReceipt(winner.db, {
      operatorId,
      callerKey: key,
      requestFingerprint: 'd'.repeat(64),
      periodStart: p.start,
      periodEnd: p.end,
      authorizationEvidence: {},
    })
    const created = await insertObligation(winner.db, obligation(socioId, receipt.receipt.id, p))
    await expect(findObligation(winner.db, socioId, p.start)).resolves.toMatchObject({
      obligation: { id: created.obligation.id, snapshot: { calculatorVersion: 'test-v1' } },
      components: [{ componentKey: 'base', calculationInputs: { rule: 'FULL_MONTH' } }],
    })
    await expect(
      winner.pool.query(`UPDATE tesoreria.dues_obligations SET amount = 1 WHERE id = $1`, [
        created.obligation.id,
      ]),
    ).rejects.toMatchObject({ code: '55000' })
    await expect(
      winner.pool.query(
        `DELETE FROM tesoreria.dues_obligation_components WHERE obligation_id = $1`,
        [created.obligation.id],
      ),
    ).rejects.toMatchObject({ code: '55000' })
    const after = await winner.pool.query(`SELECT count(*)::int AS count FROM tesoreria.ctacte`)
    expect(after.rows[0].count).toBe(before.rows[0].count)
  })

  it('creates authorized BASE and SPORT price versions with evidence', async () => {
    const p = randomPeriod()
    const disciplinaId = await discipline(winner)
    await expect(createPrice(winner.db, priceInput(p, 'BASE'))).resolves.toMatchObject({
      kind: 'BASE',
      disciplinaId: null,
      amountCents: 10_000,
      currency: 'ARS',
      effectiveFrom: p.start,
      effectiveTo: p.end,
      createdBy: operatorId,
      authorizationEvidence: { source: 'test' },
    })
    await expect(
      createPrice(winner.db, priceInput(p, 'SPORT', disciplinaId)),
    ).resolves.toMatchObject({
      kind: 'SPORT',
      disciplinaId,
      amountCents: 10_000,
    })
  })

  it('rejects overlapping active ranges globally for BASE and per discipline for SPORT', async () => {
    const p = randomPeriod()
    const first = await discipline(winner)
    const second = await discipline(winner)
    await createPrice(winner.db, priceInput(p, 'BASE'))
    await expect(createPrice(winner.db, priceInput(p, 'BASE'))).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    await createPrice(winner.db, priceInput(p, 'SPORT', first))
    await expect(createPrice(winner.db, priceInput(p, 'SPORT', first))).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    await expect(createPrice(winner.db, priceInput(p, 'SPORT', second))).resolves.toMatchObject({
      disciplinaId: second,
    })
  })

  it('revokes atomically, is idempotent, and frees the interval for replacement', async () => {
    const p = randomPeriod()
    const created = await createPrice(winner.db, priceInput(p, 'BASE'))
    const revocation = {
      priceVersionId: created.id,
      revokedBy: operatorId,
      revokeReason: 'Superseded',
    }
    const revoked = await revokePrice(winner.db, revocation)
    expect(revoked).toMatchObject({
      id: created.id,
      revokedBy: operatorId,
      revokeReason: 'Superseded',
    })
    expect(revoked.revokedAt).toBeTruthy()
    await expect(revokePrice(winner.db, revocation)).resolves.toMatchObject({
      id: created.id,
      revokedBy: operatorId,
      revokeReason: 'Superseded',
      revokedAt: revoked.revokedAt,
    })
    await expect(createPrice(winner.db, priceInput(p, 'BASE'))).resolves.toMatchObject({
      kind: 'BASE',
      effectiveFrom: p.start,
    })
  })

  it('reports an explicit not-found error when revoking an unknown price', async () => {
    const p = randomPeriod()
    const created = await createPrice(winner.db, priceInput(p, 'BASE'))
    await expect(
      revokePrice(winner.db, {
        priceVersionId: created.id,
        revokedBy: operatorId,
        revokeReason: ' ',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(
      revokePrice(winner.db, {
        priceVersionId: randomUUID(),
        revokedBy: operatorId,
        revokeReason: 'Missing',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  // prettier-ignore
  it('persists configurable rules, resolves member/family candidates by priority, and replaces after revoke', async () => { const p = randomPeriod(); const socioId = await member(winner); const familyGroupId = randomUUID(); await createFamilyGroup(winner.db, { id: familyGroupId, reason: 'Approved eligibility group', createdBy: operatorId, authorizationEvidence: { ticket: 'FAM-1' } }); const family = await createBenefitRule(winner.db, benefitInput(p, { familyGroupId, socioId: null, priority: 10 })); const memberRule = await createBenefitRule(winner.db, benefitInput(p, { socioId, priority: 30, combinability: 'EXCLUSIVE', exclusiveGroup: 'dues' })); expect(memberRule).toMatchObject({ socioId, amountCents: 1000, priority: 30, combinability: 'EXCLUSIVE', exclusiveGroup: 'dues', authorizationEvidence: { ticket: 'BEN-1' } }); await expect(listEffectiveBenefitRules(winner.db, p)).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: family.id }), expect.objectContaining({ id: memberRule.id })])); await expect(resolveBenefitRuleCandidates(winner.db, { socioId, familyGroupId, period: p })).resolves.toMatchObject([{ id: family.id }, { id: memberRule.id }]); const revoked = await revokeBenefitRule(winner.db, { benefitRuleId: memberRule.id, revokedBy: operatorId, revokeReason: 'Replaced by approved rule' }); expect(revoked).toMatchObject({ id: memberRule.id, revokedBy: operatorId, revokeReason: 'Replaced by approved rule' }); await expect(createBenefitRule(winner.db, benefitInput(p, { socioId, priority: 5, combinability: 'EXCLUSIVE', exclusiveGroup: 'dues' }))).resolves.toMatchObject({ socioId, priority: 5 }) })
})
