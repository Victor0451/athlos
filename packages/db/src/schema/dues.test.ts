import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { duesComponentKind, duesObligationKind, duesPriceKind } from './dues.ts'
// prettier-ignore
import { duesBenefitCombinability, duesBenefitKind, duesBenefitPercentageBasis } from './dues-benefits.ts'
import { duesFamilyGroups, duesFamilyMemberships } from './dues-family-groups.ts'
import { duesAllocationKind, duesSettlementKind } from './dues-settlements.ts'
import {
  duesAgreementKind,
  duesAgreementStatus,
  duesAgreements,
  duesCommunityWork,
} from './dues-agreements.ts'

const url = process.env.ATHLOS_TEST_DATABASE_URL
const schema = `dues_${randomUUID().replaceAll('-', '')}`
const q = `"${schema}"`
const root = join(import.meta.dirname, '..', '..')
let pool: Pool
let operatorId: string
let socioId: string
let disciplineId: string
const rejects = (query: Promise<unknown>, code: string) =>
  expect(query).rejects.toMatchObject({ code })

const membershipInsert = `INSERT INTO ${q}.dues_family_memberships (family_group_id, socio_id, effective_from, effective_to, reason, created_by, authorization_evidence) VALUES ($1, $2, $3, $4, 'Approved eligibility membership', $5, '{}') RETURNING id`

async function insertSocio() {
  const id = randomUUID()
  await pool.query(`INSERT INTO ${q}.socios (id) VALUES ($1)`, [id])
  return id
}

async function insertFamilyGroup() {
  const id = randomUUID()
  await pool.query(
    `INSERT INTO ${q}.dues_family_groups (id, reason, created_by, authorization_evidence) VALUES ($1, 'Approved eligibility group', $2, '{}')`,
    [id, operatorId],
  )
  return id
}

function insertMembership(groupId: string, memberId: string, from: string, to: string | null) {
  return pool.query(membershipInsert, [groupId, memberId, from, to, operatorId])
}

function migrationSql() {
  return Promise.all(
    [
      '0049_dues_pricing_obligations.sql',
      '0050_dues_benefit_rules.sql',
      '0051_dues_family_groups.sql',
      '0052_dues_settlements.sql',
      '0053_dues_agreements_community_work.sql',
      '0058_dues_open_agreements.sql',
      '0060_dues_settlement_reversal_unique.sql',
    ].map((file) => readFile(join(root, 'drizzle', file), 'utf8')),
  ).then(([pricing, benefits, familyGroups, settlements, agreements, openAgreements, reversal]) =>
    `${pricing}\n${benefits}\n${familyGroups}\n${settlements}\n${agreements}\n${openAgreements}\n${reversal}`
      .replace('CREATE SCHEMA IF NOT EXISTS tesoreria', `CREATE SCHEMA IF NOT EXISTS ${q}`)
      .replaceAll('tesoreria.', `${q}.`)
      .replaceAll('deportes.', `${q}.`)
      .replaceAll('socios.', `${q}.`)
      .replaceAll('public.operators', `${q}.operators`),
  )
}

let seedObligationCount = 0
async function seedObligation(memberId = socioId) {
  // Each seeded obligation needs a distinct monthly natural key (socio + period).
  const index = seedObligationCount++
  const start = new Date(Date.UTC(2026, index, 1)).toISOString().slice(0, 10)
  const end = new Date(Date.UTC(2026, index + 1, 1)).toISOString().slice(0, 10)
  // prettier-ignore
  await pool.query(`WITH receipt AS (INSERT INTO ${q}.dues_generation_receipts (operator_id, caller_key, request_fingerprint, period_start, period_end, authorization_evidence) VALUES ($1, gen_random_uuid(), repeat('a', 64), $3, $4, '{}') RETURNING id), obligation AS (INSERT INTO ${q}.dues_obligations (socio_id, kind, period_start, period_end, amount, generation_receipt_id, snapshot, actor_id, authorization_evidence) SELECT $2, 'MONTHLY_DUES', $3, $4, 100.00, id, '{}', $1, '{}' FROM receipt RETURNING id) INSERT INTO ${q}.dues_obligation_components (obligation_id, kind, component_key, amount, calculation_inputs, eligibility_snapshot, price_snapshot) SELECT id, 'BASE', 'base', 100.00, '{}', '{}', '{}' FROM obligation`, [operatorId, memberId, start, end])
  return (await pool.query(`SELECT id FROM ${q}.dues_obligations ORDER BY created_at DESC LIMIT 1`))
    .rows[0].id as string
}

beforeAll(async () => {
  if (!url) throw new Error('ATHLOS_TEST_DATABASE_URL is required')
  pool = new Pool({ connectionString: url, connectionTimeoutMillis: 5_000 })
  operatorId = randomUUID()
  socioId = randomUUID()
  disciplineId = randomUUID()
  // prettier-ignore
  await pool.query(`CREATE SCHEMA ${q}; CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE TABLE ${q}.operators (id uuid PRIMARY KEY); CREATE TABLE ${q}.socios (id uuid PRIMARY KEY); CREATE TABLE ${q}.disciplinas (id uuid PRIMARY KEY); CREATE TABLE ${q}.inscripciones (id uuid PRIMARY KEY); INSERT INTO ${q}.operators VALUES ('${operatorId}'); INSERT INTO ${q}.socios VALUES ('${socioId}'); INSERT INTO ${q}.disciplinas VALUES ('${disciplineId}')`)
  await pool.query(await migrationSql())
})
afterAll(async () => {
  if (pool) {
    await pool.query(`DROP SCHEMA IF EXISTS ${q} CASCADE`)
    await pool.end()
  }
})

describe('dues pricing and obligation schema', () => {
  it('exports enums and registers migration 0049 in order', async () => {
    expect(duesPriceKind.enumValues).toEqual(['BASE', 'SPORT'])
    expect(duesObligationKind.enumValues).toEqual(['MONTHLY_DUES', 'COMPENSATION'])
    expect(duesComponentKind.enumValues).toEqual(['BASE', 'SPORT', 'BENEFIT', 'ADJUSTMENT'])
    // prettier-ignore
    expect(duesBenefitKind.enumValues).toEqual(['FIXED_DISCOUNT', 'PERCENT_DISCOUNT', 'SCHOLARSHIP'])
    expect(duesBenefitCombinability.enumValues).toEqual(['COMBINABLE', 'EXCLUSIVE'])
    expect(duesBenefitPercentageBasis.enumValues).toEqual(['GROSS', 'REMAINING'])
    expect(duesFamilyGroups).toBeDefined()
    expect(duesFamilyMemberships).toBeDefined()
    expect(duesSettlementKind.enumValues).toEqual(['MONETARY', 'NON_CASH'])
    expect(duesAllocationKind.enumValues).toEqual(['ALLOCATION', 'COMPENSATION'])
    expect(duesAgreementKind.enumValues).toEqual(['SIMPLE', 'INSTALLMENT', 'NEGOTIATED'])
    expect(duesAgreementStatus.enumValues).toEqual([
      'ACTIVE',
      'FULFILLED',
      'CANCELLED',
      'SUPERSEDED',
    ])
    expect(duesAgreements).toBeDefined()
    expect(duesCommunityWork).toBeDefined()
    expect(duesAgreements.termsVersion.columnType).toBe('PgInteger')
    expect(duesCommunityWork.agreementId.columnType).toBe('PgUUID')
    expect(duesAgreements.requestFingerprint.columnType).toBe('PgChar')
    const files = (await readdir(join(root, 'drizzle')))
      .filter((f) => /^\d{4}_.+\.sql$/.test(f))
      .sort()
    const journal = JSON.parse(
      await readFile(join(root, 'drizzle/meta/_journal.json'), 'utf8'),
    ) as { entries: { idx: number; tag: string }[] }
    expect(journal.entries.at(-1)).toMatchObject({
      idx: files.length - 1,
      tag: '0061_dues_cash_settlement_reversal_expense',
    })
    expect(journal.entries.map((entry) => entry.tag)).toEqual(
      files.map((file) => file.slice(0, -4)),
    )
  })

  it('allows dated memberships but rejects overlapping active groups for one socio', async () => {
    const groupA = await insertFamilyGroup()
    const groupB = await insertFamilyGroup()
    await insertMembership(groupA, socioId, '2026-01-01', '2026-04-01')
    await expect(
      insertMembership(groupB, socioId, '2026-03-01', '2026-05-01'),
    ).rejects.toMatchObject({ code: '23P01' })
    await expect(insertMembership(groupB, socioId, '2026-04-01', null)).resolves.toBeTruthy()
  })

  it('rejects overlapping open-ended active memberships', async () => {
    const memberId = await insertSocio()
    const groupA = await insertFamilyGroup()
    const groupB = await insertFamilyGroup()
    await insertMembership(groupA, memberId, '2026-06-01', null)
    await expect(insertMembership(groupB, memberId, '2027-01-01', null)).rejects.toMatchObject({
      code: '23P01',
    })
  })

  it('permits adjacent half-open membership boundaries', async () => {
    const memberId = await insertSocio()
    const groupA = await insertFamilyGroup()
    const groupB = await insertFamilyGroup()
    await insertMembership(groupA, memberId, '2026-01-01', '2026-04-01')
    await expect(
      insertMembership(groupB, memberId, '2026-04-01', '2026-07-01'),
    ).resolves.toBeTruthy()
  })

  it('allows a new active interval after the prior membership is revoked', async () => {
    const memberId = await insertSocio()
    const groupA = await insertFamilyGroup()
    const groupB = await insertFamilyGroup()
    const first = await insertMembership(groupA, memberId, '2026-01-01', '2026-12-31')
    await pool.query(
      `UPDATE ${q}.dues_family_memberships SET revoked_at = now(), revoked_by = $1, revoke_reason = 'Eligibility corrected' WHERE id = $2`,
      [operatorId, first.rows[0].id],
    )
    await expect(
      insertMembership(groupB, memberId, '2026-06-01', '2027-01-01'),
    ).resolves.toBeTruthy()
  })

  it('rejects concurrent overlapping active membership inserts', async () => {
    const memberId = await insertSocio()
    const groupA = await insertFamilyGroup()
    const groupB = await insertFamilyGroup()
    const firstClient = await pool.connect()
    const secondClient = await pool.connect()
    try {
      await firstClient.query('BEGIN')
      await secondClient.query('BEGIN')
      await firstClient.query(membershipInsert, [
        groupA,
        memberId,
        '2027-01-01',
        '2027-06-01',
        operatorId,
      ])
      const rejected = expect(
        secondClient.query(membershipInsert, [
          groupB,
          memberId,
          '2027-03-01',
          '2027-09-01',
          operatorId,
        ]),
      ).rejects.toMatchObject({ code: '23P01' })
      await new Promise((resolve) => setImmediate(resolve))
      await firstClient.query('COMMIT')
      await rejected
      await secondClient.query('ROLLBACK')
    } finally {
      firstClient.release()
      secondClient.release()
    }
  })

  it('rejects benefit rules that target a nonexistent family group', async () => {
    await expect(
      pool.query(
        `INSERT INTO ${q}.dues_benefit_rules (kind, socio_id, family_group_id, amount, currency, effective_from, effective_to, priority, combinability, reason, created_by, authorization_evidence) VALUES ('FIXED_DISCOUNT', NULL, $1, 10.00, 'ARS', DATE '2026-01-01', DATE '2026-04-01', 1, 'COMBINABLE', 'Approved family benefit', $2, '{}')`,
        [randomUUID(), operatorId],
      ),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('rejects invalid money/kind combinations and overlapping base or sport intervals', async () => {
    // prettier-ignore
    const insert = (kind: string, amount: string, discipline: string | null, from: string, to: string) => pool.query(`INSERT INTO ${q}.dues_price_versions (kind, disciplina_id, amount, effective_from, effective_to, rule, created_by, authorization_evidence) VALUES ($1, $2, $3, $4, $5, 'FULL_MONTH', $6, '{}')`, [kind, discipline, amount, from, to, operatorId])
    await rejects(insert('BASE', '-1.00', null, '2026-01-01', '2026-04-01'), '23514')
    await rejects(insert('BASE', '10.00', disciplineId, '2026-01-01', '2026-04-01'), '23514')
    await rejects(insert('SPORT', '10.00', null, '2026-01-01', '2026-04-01'), '23514')
    await insert('BASE', '20.00', null, '2026-01-01', '2026-04-01')
    await rejects(insert('BASE', '20.00', null, '2026-03-01', '2026-05-01'), '23P01')
    await insert('SPORT', '10.00', disciplineId, '2026-01-01', '2026-04-01')
    await rejects(insert('SPORT', '10.00', disciplineId, '2026-03-01', '2026-05-01'), '23P01')
  })

  // prettier-ignore
  it('enforces benefit variants, explicit targets, priority policy, and exclusive overlap', async () => { const familyGroupId = await insertFamilyGroup(); const scholarshipGroupId = await insertFamilyGroup(); const insert = (kind: string, socio: string | null, family: string | null, amount: string | null, percentage: string | null, basis: string | null, combinability = 'COMBINABLE', group: string | null = null) => pool.query(`INSERT INTO ${q}.dues_benefit_rules (kind, socio_id, family_group_id, amount, percentage, currency, effective_from, effective_to, priority, combinability, exclusive_group, percentage_basis, reason, created_by, authorization_evidence) VALUES ($1,$2,$3,$4,$5,$6,DATE '2026-01-01',DATE '2026-04-01',10,$7,$8,$9,'approved',$10,'{"source":"test"}')`, [kind, socio, family, amount, percentage, amount ? 'ARS' : null, combinability, group, basis, operatorId]); await insert('FIXED_DISCOUNT', socioId, null, '10.00', null, null); await insert('PERCENT_DISCOUNT', null, familyGroupId, null, '25.00', 'REMAINING'); await insert('SCHOLARSHIP', socioId, scholarshipGroupId, null, '50.00', 'GROSS'); await rejects(insert('FIXED_DISCOUNT', null, null, '10.00', null, null), '23514'); await rejects(insert('FIXED_DISCOUNT', socioId, null, null, '10.00', 'GROSS'), '23514'); await rejects(insert('PERCENT_DISCOUNT', socioId, null, null, '10.00', null), '23514'); await rejects(insert('PERCENT_DISCOUNT', socioId, null, null, '101.00', 'GROSS'), '23514'); await insert('FIXED_DISCOUNT', socioId, null, '5.00', null, null); await insert('FIXED_DISCOUNT', socioId, null, '5.00', null, null, 'EXCLUSIVE', 'same'); await rejects(insert('PERCENT_DISCOUNT', socioId, null, null, '10.00', 'GROSS', 'EXCLUSIVE', 'same'), '23P01'); await rejects(insert('FIXED_DISCOUNT', socioId, null, '5.00', null, null, 'EXCLUSIVE'), '23514') })

  it('enforces receipt, monthly obligation, and component natural uniqueness', async () => {
    const key = randomUUID()
    await pool.query(
      `INSERT INTO ${q}.dues_generation_receipts (operator_id, caller_key, request_fingerprint, period_start, period_end, authorization_evidence) VALUES ($1, $2, repeat('b', 64), DATE '2026-02-01', DATE '2026-03-01', '{}')`,
      [operatorId, key],
    )
    await rejects(
      pool.query(
        `INSERT INTO ${q}.dues_generation_receipts (operator_id, caller_key, request_fingerprint, period_start, period_end, authorization_evidence) VALUES ($1, $2, repeat('c', 64), DATE '2026-02-01', DATE '2026-03-01', '{}')`,
        [operatorId, key],
      ),
      '23505',
    )
    const obligationId = await seedObligation()
    await rejects(
      pool.query(
        `INSERT INTO ${q}.dues_obligations (socio_id, kind, period_start, period_end, amount, generation_receipt_id, snapshot, actor_id, authorization_evidence) SELECT socio_id, kind, period_start, period_end, amount, generation_receipt_id, snapshot, actor_id, authorization_evidence FROM ${q}.dues_obligations WHERE id = $1`,
        [obligationId],
      ),
      '23505',
    )
    await rejects(
      pool.query(
        `INSERT INTO ${q}.dues_obligation_components (obligation_id, kind, component_key, amount, calculation_inputs, eligibility_snapshot, price_snapshot) VALUES ($1, 'BASE', 'base', 100.00, '{}', '{}', '{}')`,
        [obligationId],
      ),
      '23505',
    )
  })

  it('rejects updates and deletes for obligations and components', async () => {
    await pool.query(
      `TRUNCATE ${q}.dues_agreements, ${q}.dues_community_work, ${q}.dues_allocations, ${q}.dues_settlements, ${q}.dues_obligation_components, ${q}.dues_obligations, ${q}.dues_generation_receipts`,
    )
    const obligationId = await seedObligation()
    await rejects(
      pool.query(
        `UPDATE ${q}.dues_obligation_components SET amount = 101 WHERE obligation_id = $1`,
        [obligationId],
      ),
      '55000',
    )
    await rejects(
      pool.query(`UPDATE ${q}.dues_obligations SET amount = 101 WHERE id = $1`, [obligationId]),
      '55000',
    )
    await rejects(
      pool.query(`DELETE FROM ${q}.dues_obligation_components WHERE obligation_id = $1`, [
        obligationId,
      ]),
      '55000',
    )
    await rejects(
      pool.query(`DELETE FROM ${q}.dues_obligations WHERE id = $1`, [obligationId]),
      '55000',
    )
  })

  it('rejects invalid direct compensation references and over-allocation', async () => {
    await pool.query(
      `TRUNCATE ${q}.dues_agreements, ${q}.dues_community_work, ${q}.dues_allocations, ${q}.dues_settlements, ${q}.dues_obligation_components, ${q}.dues_obligations, ${q}.dues_generation_receipts`,
    )
    const obligationId = await seedObligation()
    const otherMemberId = await insertSocio()
    const otherObligationId = await seedObligation(otherMemberId)
    const settlement = await pool.query(
      `INSERT INTO ${q}.dues_settlements (socio_id, kind, amount, operator_id, caller_key, request_fingerprint) VALUES ($1, 'MONETARY', 100.00, $2, gen_random_uuid()::text, repeat('d', 64)) RETURNING id`,
      [socioId, operatorId],
    )
    const secondSettlement = await pool.query(
      `INSERT INTO ${q}.dues_settlements (socio_id, kind, amount, operator_id, caller_key, request_fingerprint) VALUES ($1, 'MONETARY', 100.00, $2, gen_random_uuid()::text, repeat('f', 64)) RETURNING id`,
      [socioId, operatorId],
    )
    const allocation = await pool.query(
      `INSERT INTO ${q}.dues_allocations (settlement_id, obligation_id, kind, amount) VALUES ($1, $2, 'ALLOCATION', 50.00) RETURNING id`,
      [settlement.rows[0].id, obligationId],
    )
    await expect(
      pool.query(
        `INSERT INTO ${q}.dues_allocations (settlement_id, obligation_id, kind, amount) VALUES ($1, $2, 'ALLOCATION', 60.00)`,
        [secondSettlement.rows[0].id, obligationId],
      ),
    ).rejects.toMatchObject({ code: '23514' })
    const reversalSettlement = await pool.query(
      `INSERT INTO ${q}.dues_settlements (socio_id, kind, amount, reversal_of_settlement_id, reason, operator_id, caller_key, request_fingerprint) VALUES ($1, 'MONETARY', 100.00, $2, 'Fixture reversal', $3, gen_random_uuid()::text, repeat('r', 64)) RETURNING id`,
      [socioId, settlement.rows[0].id, operatorId],
    )
    await expect(
      pool.query(
        `INSERT INTO ${q}.dues_allocations (settlement_id, obligation_id, kind, amount, compensates_allocation_id, reason) VALUES ($1, $2, 'COMPENSATION', 50.00, $3, 'Wrong obligation')`,
        [settlement.rows[0].id, otherObligationId, allocation.rows[0].id],
      ),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      pool.query(
        `INSERT INTO ${q}.dues_allocations (settlement_id, obligation_id, kind, amount, compensates_allocation_id, reason) VALUES ($1, $2, 'COMPENSATION', 50.00, $3, 'Wrong obligation')`,
        [reversalSettlement.rows[0].id, obligationId, allocation.rows[0].id],
      ),
    ).resolves.toBeTruthy()
    await expect(
      pool.query(
        `INSERT INTO ${q}.dues_allocations (settlement_id, obligation_id, kind, amount, compensates_allocation_id, reason) VALUES ($1, $2, 'COMPENSATION', 50.00, $3, 'Duplicate')`,
        [reversalSettlement.rows[0].id, obligationId, allocation.rows[0].id],
      ),
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('nets compensation rows so restored debt can be reallocated without permitting over-allocation', async () => {
    await pool.query(
      `TRUNCATE ${q}.dues_agreements, ${q}.dues_community_work, ${q}.dues_allocations, ${q}.dues_settlements, ${q}.dues_obligation_components, ${q}.dues_obligations, ${q}.dues_generation_receipts`,
    )
    const obligationId = await seedObligation()
    const settlement = async (amount: string, suffix: string) =>
      (
        await pool.query(
          `INSERT INTO ${q}.dues_settlements (socio_id, kind, amount, operator_id, caller_key, request_fingerprint) VALUES ($1, 'MONETARY', $2, $3, gen_random_uuid()::text, repeat($4, 64)) RETURNING id`,
          [socioId, amount, operatorId, suffix],
        )
      ).rows[0].id as string

    const originalSettlementId = await settlement('60.00', 'g')
    const original = await pool.query(
      `INSERT INTO ${q}.dues_allocations (settlement_id, obligation_id, kind, amount) VALUES ($1, $2, 'ALLOCATION', 60.00) RETURNING id`,
      [originalSettlementId, obligationId],
    )
    const reversalSettlementId = (
      await pool.query(
        `INSERT INTO ${q}.dues_settlements (socio_id, kind, amount, reversal_of_settlement_id, reason, operator_id, caller_key, request_fingerprint) VALUES ($1, 'MONETARY', 60.00, $2, 'Corrected allocation', $3, gen_random_uuid()::text, repeat('h', 64)) RETURNING id`,
        [socioId, originalSettlementId, operatorId],
      )
    ).rows[0].id as string
    await pool.query(
      `INSERT INTO ${q}.dues_allocations (settlement_id, obligation_id, kind, amount, compensates_allocation_id, reason) VALUES ($1, $2, 'COMPENSATION', 60.00, $3, 'Corrected allocation')`,
      [reversalSettlementId, obligationId, original.rows[0].id],
    )

    const restoredSettlementId = await settlement('60.00', 'i')
    await expect(
      pool.query(
        `INSERT INTO ${q}.dues_allocations (settlement_id, obligation_id, kind, amount) VALUES ($1, $2, 'ALLOCATION', 60.00)`,
        [restoredSettlementId, obligationId],
      ),
    ).resolves.toBeTruthy()

    const excessSettlementId = await settlement('41.00', 'j')
    await expect(
      pool.query(
        `INSERT INTO ${q}.dues_allocations (settlement_id, obligation_id, kind, amount) VALUES ($1, $2, 'ALLOCATION', 41.00)`,
        [excessSettlementId, obligationId],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('links one reversal settlement to its original allocations', async () => {
    await pool.query(
      `TRUNCATE ${q}.dues_agreements, ${q}.dues_community_work, ${q}.dues_allocations, ${q}.dues_settlements, ${q}.dues_obligation_components, ${q}.dues_obligations, ${q}.dues_generation_receipts`,
    )
    const obligationId = await seedObligation()
    const insertSettlement = (amount: string, key: string, reversalOfSettlementId?: string) =>
      pool.query(
        `INSERT INTO ${q}.dues_settlements (socio_id, kind, amount, reversal_of_settlement_id, reason, operator_id, caller_key, request_fingerprint) VALUES ($1, 'MONETARY', $2, $3::uuid, CASE WHEN $3::uuid IS NULL THEN NULL ELSE 'Corrected payment' END, $4, $5, repeat('r', 64)) RETURNING id`,
        [socioId, amount, reversalOfSettlementId ?? null, operatorId, key],
      )
    const original = await insertSettlement('40.00', 'reversal-original')
    const allocation = await pool.query(
      `INSERT INTO ${q}.dues_allocations (settlement_id, obligation_id, kind, amount) VALUES ($1, $2, 'ALLOCATION', 40.00) RETURNING id`,
      [original.rows[0].id, obligationId],
    )
    const unrelated = await insertSettlement('60.00', 'reversal-unrelated')
    await pool.query(
      `INSERT INTO ${q}.dues_allocations (settlement_id, obligation_id, kind, amount) VALUES ($1, $2, 'ALLOCATION', 60.00)`,
      [unrelated.rows[0].id, obligationId],
    )
    const invalid = await insertSettlement('40.00', 'reversal-invalid', unrelated.rows[0].id)
    await rejects(
      pool.query(
        `INSERT INTO ${q}.dues_allocations (settlement_id, obligation_id, kind, amount, compensates_allocation_id, reason) VALUES ($1, $2, 'COMPENSATION', 40.00, $3, 'Corrected payment')`,
        [invalid.rows[0].id, obligationId, allocation.rows[0].id],
      ),
      '23514',
    )
    const reversal = await insertSettlement('40.00', 'reversal-valid', original.rows[0].id)
    await expect(
      pool.query(
        `INSERT INTO ${q}.dues_allocations (settlement_id, obligation_id, kind, amount, compensates_allocation_id, reason) VALUES ($1, $2, 'COMPENSATION', 40.00, $3, 'Corrected payment')`,
        [reversal.rows[0].id, obligationId, allocation.rows[0].id],
      ),
    ).resolves.toBeTruthy()
    await rejects(insertSettlement('40.00', 'reversal-duplicate', original.rows[0].id), '23505')
  })

  it('rejects updates and deletes for settlement history', async () => {
    await pool.query(
      `TRUNCATE ${q}.dues_agreements, ${q}.dues_community_work, ${q}.dues_allocations, ${q}.dues_settlements, ${q}.dues_obligation_components, ${q}.dues_obligations, ${q}.dues_generation_receipts`,
    )
    const settlement = await pool.query(
      `INSERT INTO ${q}.dues_settlements (socio_id, kind, amount, operator_id, caller_key, request_fingerprint) VALUES ($1, 'MONETARY', 10.00, $2, gen_random_uuid()::text, repeat('e', 64)) RETURNING id`,
      [socioId, operatorId],
    )
    const obligationId = await seedObligation()
    const allocation = await pool.query(
      `INSERT INTO ${q}.dues_allocations (settlement_id, obligation_id, kind, amount) VALUES ($1, $2, 'ALLOCATION', 10.00) RETURNING id`,
      [settlement.rows[0].id, obligationId],
    )
    await rejects(
      pool.query(`UPDATE ${q}.dues_settlements SET amount = 11 WHERE id = $1`, [
        settlement.rows[0].id,
      ]),
      '55000',
    )
    await rejects(
      pool.query(`DELETE FROM ${q}.dues_allocations WHERE id = $1`, [allocation.rows[0].id]),
      '55000',
    )
  })
})

describe('versioned negotiated agreements', () => {
  const insertAgreement = (input: {
    socioId: string
    obligationId: string
    kind?: string
    termsVersion?: number
    terms: Record<string, unknown>
    callerKey?: string
  }) =>
    pool.query(
      `INSERT INTO ${q}.dues_agreements
            (socio_id, obligation_id, kind, terms_version, terms, reason, operator_id, caller_key, request_fingerprint)
           VALUES ($1, $2, $3, $4, $5::jsonb, 'Approved agreement fixture', $6, $7, repeat('z', 64))
           RETURNING id, kind, terms_version, terms`,
      [
        input.socioId,
        input.obligationId,
        input.kind ?? 'NEGOTIATED',
        input.termsVersion ?? 1,
        JSON.stringify(input.terms),
        operatorId,
        input.callerKey ?? randomUUID(),
      ],
    )

  it('reads legacy plans and accepts narrative-only negotiated terms without allocations', async () => {
    const simpleObligation = await seedObligation()
    const installmentObligation = await seedObligation()
    const negotiatedObligation = await seedObligation()
    await insertAgreement({
      socioId,
      obligationId: simpleObligation,
      kind: 'SIMPLE',
      termsVersion: 0,
      terms: {
        amountCents: 10_000,
        installments: [{ amountCents: 10_000, dueDate: '2099-01-01' }],
      },
      callerKey: 'legacy-simple',
    })
    await insertAgreement({
      socioId,
      obligationId: installmentObligation,
      kind: 'INSTALLMENT',
      termsVersion: 0,
      terms: {
        amountCents: 10_000,
        installments: [
          { amountCents: 5_000, dueDate: '2099-01-01' },
          { amountCents: 5_000, dueDate: '2099-02-01' },
        ],
      },
      callerKey: 'legacy-installment',
    })
    const negotiated = await insertAgreement({
      socioId,
      obligationId: negotiatedObligation,
      terms: { narrative: 'El socio colaborará con tareas acordadas.' },
      callerKey: 'negotiated-narrative-only',
    })

    await expect(
      pool.query(
        `SELECT kind, terms_version, terms FROM ${q}.dues_agreements ORDER BY created_at, id`,
      ),
    ).resolves.toMatchObject({
      rows: expect.arrayContaining([
        expect.objectContaining({ kind: 'SIMPLE', terms_version: 0 }),
        expect.objectContaining({ kind: 'INSTALLMENT', terms_version: 0 }),
        expect.objectContaining({
          kind: 'NEGOTIATED',
          terms_version: 1,
          terms: { narrative: 'El socio colaborará con tareas acordadas.' },
        }),
      ]),
    })
    await expect(
      pool.query(
        `SELECT count(*)::int AS count FROM ${q}.dues_allocations WHERE obligation_id = $1`,
        [negotiatedObligation],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] })
    expect(negotiated.rows[0]).toMatchObject({ kind: 'NEGOTIATED', terms_version: 1 })
    await expect(
      pool.query(`UPDATE ${q}.dues_agreements SET terms_version = 2 WHERE obligation_id = $1`, [
        negotiatedObligation,
      ]),
    ).rejects.toMatchObject({ code: '55000' })
  })

  it('accepts zero and the maximum number of bounded commitments with optional evidence', async () => {
    const obligationId = await seedObligation()
    await expect(
      insertAgreement({
        socioId,
        obligationId,
        callerKey: 'negotiated-max-commitments',
        terms: {
          narrative: 'Compromiso con estructuras opcionales.',
          commitments: Array.from({ length: 50 }, (_, index) => ({
            id: randomUUID(),
            title: `Compromiso ${index}`,
            description: 'Detalle acotado',
            dueDate: '2099-01-01',
            amountCents: 100,
            evidence: { note: 'Evidencia acotada', references: [`ref-${index}`], metadata: {} },
          })),
          evidence: { note: 'Acta de la conversación', references: ['meeting-1'], metadata: {} },
        },
      }),
    ).resolves.toMatchObject({ rowCount: 1 })
  })

  it('rejects unsupported representations and malformed bounded negotiated terms', async () => {
    const cases = [
      { kind: 'NEGOTIATED', termsVersion: 2, terms: { narrative: 'Unsupported version' } },
      { kind: 'SIMPLE', termsVersion: 1, terms: { narrative: 'Wrong discriminator' } },
      { kind: 'NEGOTIATED', termsVersion: 1, terms: { narrative: '   ' } },
      {
        kind: 'NEGOTIATED',
        termsVersion: 1,
        terms: {
          narrative: 'Too many commitments',
          commitments: Array.from({ length: 51 }, (_, index) => ({
            id: randomUUID(),
            title: `Commitment ${index}`,
          })),
        },
      },
      {
        kind: 'NEGOTIATED',
        termsVersion: 1,
        terms: {
          narrative: 'Malformed commitment',
          commitments: [{ id: 'not-a-uuid', title: 'Action', dueDate: '2026-02-31' }],
        },
      },
      {
        kind: 'NEGOTIATED',
        termsVersion: 1,
        terms: {
          narrative: 'Malformed amount',
          commitments: [{ id: randomUUID(), title: 'Action', amountCents: 0 }],
        },
      },
      {
        kind: 'NEGOTIATED',
        termsVersion: 1,
        terms: { narrative: 'Malformed evidence', evidence: { note: 'x'.repeat(2001) } },
      },
    ]
    for (const [index, input] of cases.entries()) {
      const obligationId = await seedObligation()
      await expect(
        insertAgreement({ ...input, socioId, obligationId, callerKey: `invalid-${index}` }),
      ).rejects.toMatchObject({ code: '23514' })
    }
  })

  it('requires community work agreement linkage to preserve socio and obligation ownership', async () => {
    const otherSocioId = await insertSocio()
    const target = await seedObligation()
    const otherTarget = await seedObligation(otherSocioId)
    const agreement = await insertAgreement({
      socioId,
      obligationId: target,
      terms: { narrative: 'Trabajo comunitario aprobado.' },
      callerKey: 'community-work-agreement',
    })
    const otherAgreement = await insertAgreement({
      socioId: otherSocioId,
      obligationId: otherTarget,
      terms: { narrative: 'Otro acuerdo aprobado.' },
      callerKey: 'other-community-work-agreement',
    })
    const settlement = await pool.query(
      `INSERT INTO ${q}.dues_settlements
            (socio_id, kind, amount, operator_id, caller_key, request_fingerprint)
           VALUES ($1, 'NON_CASH', 100.00, $2, $3, repeat('w', 64)) RETURNING id`,
      [socioId, operatorId, 'community-work-link'],
    )
    const workValues = [
      randomUUID(),
      socioId,
      target,
      settlement.rows[0].id,
      JSON.stringify({ approval: 'fixture' }),
      operatorId,
      'community-work-link',
      agreement.rows[0].id,
    ]
    await expect(
      pool.query(
        `INSERT INTO ${q}.dues_community_work
              (id, socio_id, obligation_id, settlement_id, amount, evidence, approval_reason, operator_id, caller_key, request_fingerprint, agreement_id)
             VALUES ($1, $2, $3, $4, 100.00, $5::jsonb, 'Approved work', $6, $7, repeat('x', 64), $8)`,
        workValues,
      ),
    ).resolves.toBeTruthy()
    await expect(
      pool.query(
        `INSERT INTO ${q}.dues_community_work
              (socio_id, obligation_id, settlement_id, amount, evidence, approval_reason, operator_id, caller_key, request_fingerprint, agreement_id)
             VALUES ($1, $2, $3, 100.00, '{}'::jsonb, 'Cross-owner work', $4, $5, repeat('y', 64), $6)`,
        [
          socioId,
          target,
          settlement.rows[0].id,
          operatorId,
          'cross-owner-work',
          otherAgreement.rows[0].id,
        ],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })
})
