import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { duesComponentKind, duesObligationKind, duesPriceKind } from './dues.ts'
// prettier-ignore
import { duesBenefitCombinability, duesBenefitKind, duesBenefitPercentageBasis } from './dues-benefits.ts'

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

function migrationSql() {
  return Promise.all(
    ['0049_dues_pricing_obligations.sql', '0050_dues_benefit_rules.sql'].map((file) =>
      readFile(join(root, 'drizzle', file), 'utf8'),
    ),
  ).then(([pricing, benefits]) =>
    `${pricing}\n${benefits}`
      .replace('CREATE SCHEMA IF NOT EXISTS tesoreria', `CREATE SCHEMA IF NOT EXISTS ${q}`)
      .replaceAll('tesoreria.', `${q}.`)
      .replaceAll('deportes.', `${q}.`)
      .replaceAll('socios.', `${q}.`)
      .replaceAll('public.operators', `${q}.operators`),
  )
}

async function seedObligation() {
  // prettier-ignore
  await pool.query(`WITH receipt AS (INSERT INTO ${q}.dues_generation_receipts (operator_id, caller_key, request_fingerprint, period_start, period_end, authorization_evidence) VALUES ($1, gen_random_uuid(), repeat('a', 64), DATE '2026-01-01', DATE '2026-02-01', '{}') RETURNING id), obligation AS (INSERT INTO ${q}.dues_obligations (socio_id, kind, period_start, period_end, amount, generation_receipt_id, snapshot, actor_id, authorization_evidence) SELECT $2, 'MONTHLY_DUES', DATE '2026-01-01', DATE '2026-02-01', 100.00, id, '{}', $1, '{}' FROM receipt RETURNING id) INSERT INTO ${q}.dues_obligation_components (obligation_id, kind, component_key, amount, calculation_inputs, eligibility_snapshot, price_snapshot) SELECT id, 'BASE', 'base', 100.00, '{}', '{}', '{}' FROM obligation`, [operatorId, socioId])
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
    const files = (await readdir(join(root, 'drizzle')))
      .filter((f) => /^\d{4}_.+\.sql$/.test(f))
      .sort()
    const journal = JSON.parse(
      await readFile(join(root, 'drizzle/meta/_journal.json'), 'utf8'),
    ) as { entries: { idx: number; tag: string }[] }
    expect(journal.entries.at(-1)).toMatchObject({
      idx: files.length - 1,
      tag: '0050_dues_benefit_rules',
    })
    expect(journal.entries.map((entry) => entry.tag)).toEqual(
      files.map((file) => file.slice(0, -4)),
    )
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
  it('enforces benefit variants, explicit targets, priority policy, and exclusive overlap', async () => { const insert = (kind: string, socio: string | null, family: string | null, amount: string | null, percentage: string | null, basis: string | null, combinability = 'COMBINABLE', group: string | null = null) => pool.query(`INSERT INTO ${q}.dues_benefit_rules (kind, socio_id, family_group_id, amount, percentage, currency, effective_from, effective_to, priority, combinability, exclusive_group, percentage_basis, reason, created_by, authorization_evidence) VALUES ($1,$2,$3,$4,$5,$6,DATE '2026-01-01',DATE '2026-04-01',10,$7,$8,$9,'approved',$10,'{"source":"test"}')`, [kind, socio, family, amount, percentage, amount ? 'ARS' : null, combinability, group, basis, operatorId]); await insert('FIXED_DISCOUNT', socioId, null, '10.00', null, null); await insert('PERCENT_DISCOUNT', null, randomUUID(), null, '25.00', 'REMAINING'); await insert('SCHOLARSHIP', socioId, randomUUID(), null, '50.00', 'GROSS'); await rejects(insert('FIXED_DISCOUNT', null, null, '10.00', null, null), '23514'); await rejects(insert('FIXED_DISCOUNT', socioId, null, null, '10.00', 'GROSS'), '23514'); await rejects(insert('PERCENT_DISCOUNT', socioId, null, null, '10.00', null), '23514'); await rejects(insert('PERCENT_DISCOUNT', socioId, null, null, '101.00', 'GROSS'), '23514'); await insert('FIXED_DISCOUNT', socioId, null, '5.00', null, null); await insert('FIXED_DISCOUNT', socioId, null, '5.00', null, null, 'EXCLUSIVE', 'same'); await rejects(insert('PERCENT_DISCOUNT', socioId, null, null, '10.00', 'GROSS', 'EXCLUSIVE', 'same'), '23P01'); await rejects(insert('FIXED_DISCOUNT', socioId, null, '5.00', null, null, 'EXCLUSIVE'), '23514') })

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
      `TRUNCATE ${q}.dues_obligation_components, ${q}.dues_obligations, ${q}.dues_generation_receipts`,
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
})
