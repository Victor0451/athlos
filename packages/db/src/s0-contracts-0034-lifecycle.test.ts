import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * `s0-contracts-0034-lifecycle.test.ts` — tasks 1.1 → 1.5.
 *
 * 1.1/1.2 RED+GREEN — six delta specs conform to Given/When/Then + RFC 2119.
 * 1.3 RED    — without 0034 the PARTIAL UNIQUE INDEX cannot be inferred
 *              by bare ON CONFLICT (PostgreSQL raises SQLSTATE 42P10 — defect 0034 corrects).
 * 1.4 GREEN  — full chain applies on disposable PostgreSQL; both expected
 *              FULL UNIQUE INDEXes lack a WHERE predicate; ON CONFLICT now infers.
 * 1.5 REFACTOR — every scenario is Given/When/Then (enforced above).
 *
 * Required env: ATHLOS_TEST_DATABASE_URL (disposable PostgreSQL only).
 * Without it the DB-backed describe blocks SKIP and only the contract validator runs.
 */

const databaseUrl = process.env['ATHLOS_TEST_DATABASE_URL']
const SKIP_DB = !databaseUrl
const repoRoot = join(import.meta.dirname, '..', '..', '..')
const specsRoot = join(
  repoRoot,
  'openspec/changes/athlos-ctacte-security-reliability-remediation/specs',
)
const drizzleDir = join(repoRoot, 'packages/db/drizzle')
const artifactsDir = join(repoRoot, 'artifacts')
const evidencePath = join(artifactsDir, '0034-lifecycle.txt')
const specDeltaEvidencePath = join(artifactsDir, 's0-spec-deltas.txt')

const CAPABILITIES = [
  'api-design',
  'audit-logger',
  'auth-login',
  'database-migrations',
  'monitoring-observability',
  'socio-attachments',
] as const
const RFC2119 = [
  'MUST',
  'MUST NOT',
  'SHALL',
  'SHALL NOT',
  'REQUIRED',
  'SHOULD',
  'SHOULD NOT',
  'MAY',
]

function validate(capability: string) {
  const file = join(specsRoot, capability, 'spec.md')
  if (!statSync(file, { throwIfNoEntry: false })?.isFile()) {
    return { capability, ok: false, requirements: 0, scenarios: 0, errors: ['missing file'] }
  }
  const text = readFileSync(file, 'utf8')
  const reqs = text.match(/^### Requirement: /gm) ?? []
  const scens = text.match(/^#### Scenario: /gm) ?? []
  const errors: string[] = []
  if (reqs.length === 0) errors.push('NO_REQUIREMENT')
  if (scens.length === 0) errors.push('NO_SCENARIO')
  const re = /^#### Scenario: (.+)$([\s\S]*?)(?=^#### Scenario: |\n## |\n### Requirement: |\Z)/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const body = m[2] ?? ''
    const gw = /^\s*-?\s*GIVEN\b/im.test(body)
    const ww = /^\s*-?\s*WHEN\b/im.test(body)
    const tw = /^\s*-?\s*THEN\b/im.test(body)
    const rfc = RFC2119.some((kw) => new RegExp(`\\b${kw.replace(' ', '\\s+')}\\b`).test(body))
    if (!(gw && ww && tw && rfc)) errors.push(`BAD_SCENARIO "${(m[1] ?? '').trim()}"`)
  }
  return {
    capability,
    ok: errors.length === 0,
    requirements: reqs.length,
    scenarios: scens.length,
    errors,
  }
}

function writeArtifact(file: string, lines: string[]) {
  mkdirSync(artifactsDir, { recursive: true })
  writeFileSync(file, lines.join('\n') + '\n', 'utf8')
}

// ─── 1.1 / 1.2 / 1.5 — six delta specs conform to Given/When/Then ───────────

describe('S0 contracts: six delta specs conform to Given/When/Then + RFC 2119', () => {
  const reports = CAPABILITIES.map(validate)
  writeArtifact(specDeltaEvidencePath, [
    '# s0-spec-deltas evidence',
    '# athlos-ctacte-security-reliability-remediation',
    `# captured_at: ${new Date().toISOString()}`,
    '',
    ...reports.map(
      (r) =>
        `- ${r.capability}: ${r.ok ? 'OK' : 'FAIL'} req=${r.requirements} scen=${r.scenarios}${
          r.errors.length ? ' ' + r.errors.join('; ') : ''
        }`,
    ),
    '',
    `# summary: ${reports.filter((r) => r.ok).length}/${reports.length} valid`,
  ])
  for (const r of reports) {
    it(`${r.capability}: shape = OK`, () => {
      expect(r.ok).toBe(true)
      expect(r.errors).toEqual([])
      expect(r.requirements).toBeGreaterThan(0)
      expect(r.scenarios).toBeGreaterThan(0)
    })
  }
})

// ─── 1.3 / 1.4 — 0031 → 0032 → 0033 → 0034 lifecycle ───────────────────────

let pool: Pool | undefined

beforeAll(async () => {
  if (SKIP_DB) return
  pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 })
  await pool.query('SELECT 1')
})

afterAll(async () => {
  await pool?.end()
})

async function apply(file: string) {
  if (!pool) throw new Error('pool not initialized')
  await pool.query(readFileSync(join(drizzleDir, file), 'utf8'))
}

async function reset() {
  if (!pool) throw new Error('pool not initialized')
  await pool.query('DROP SCHEMA IF EXISTS tesoreria CASCADE')
  await pool.query('DROP SCHEMA IF EXISTS socios CASCADE')
  await pool.query('CREATE SCHEMA IF NOT EXISTS tesoreria')
  await pool.query('CREATE SCHEMA IF NOT EXISTS socios')
  await pool.query('CREATE TABLE socios.socios (id uuid PRIMARY KEY DEFAULT gen_random_uuid())')
  await pool.query('CREATE TABLE tesoreria.ctacte (id uuid PRIMARY KEY DEFAULT gen_random_uuid())')
  await pool.query(`
    CREATE TABLE socios.socio_attachments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      socio_id uuid NOT NULL REFERENCES socios.socios(id)
    )
  `)
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto')
}

describe.skipIf(SKIP_DB)('0034 lifecycle — RED proof (without 0034: ON CONFLICT fails)', () => {
  it('partial unique index from 0031 cannot be inferred by bare ON CONFLICT', async () => {
    await reset()
    await apply('0031_ctacte_movement_notes.sql')
    await apply('0032_ctacte_payment_idempotency.sql')
    await apply('0033_ctacte_comprobante_retries.sql')
    let err: { code?: string; message?: string } | undefined
    try {
      if (!pool) throw new Error('pool not initialized')
      await pool.query(
        `INSERT INTO socios.ctacte_movement_notes
           (ctacte_movement_id, body, author_operator_id, idempotency_key)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          '00000000-0000-0000-0000-000000000001',
          'red body',
          '00000000-0000-0000-0000-000000000002',
          'k-red',
        ],
      )
    } catch (e) {
      err = e as { code?: string; message?: string }
    }
    expect(err?.code ?? '').toMatch(/42P10|0A000/)
    expect(err?.message ?? '').toMatch(/there is no unique or exclusion constraint matching/i)
  })
})

describe.skipIf(SKIP_DB)('0034 lifecycle — GREEN proof (full chain + evidence)', () => {
  it('applies 0031 → 0032 → 0033 → 0034 and writes the pg_indexes evidence', async () => {
    await reset()
    await apply('0031_ctacte_movement_notes.sql')
    await apply('0032_ctacte_payment_idempotency.sql')
    await apply('0033_ctacte_comprobante_retries.sql')
    await apply('0034_ctacte_movement_notes_idempotency_key_full_unique.sql')
    if (!pool) throw new Error('pool not initialized')
    const idx = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
       WHERE indexname IN (
         'ctacte_idempotency_key_unique',
         'ctacte_movement_notes_idempotency_key_unique'
       )`,
    )
    expect(idx.rows.length).toBe(2)
    for (const r of idx.rows) {
      const def = r.indexdef.toLowerCase()
      expect(def).toContain('unique')
      expect(def).not.toMatch(/\bwhere\b/)
    }
    // Capture pg_indexes snapshot + ON CONFLICT inference evidence.
    const rows = await pool.query<{ s: string; t: string; i: string; d: string }>(
      `SELECT schemaname AS s, tablename AS t, indexname AS i, indexdef AS d FROM pg_indexes
       WHERE schemaname IN ('socios','tesoreria')
         AND (tablename IN ('ctacte','ctacte_movement_notes','ctacte_comprobante_retries')
              OR indexname IN ('ctacte_idempotency_key_unique',
                                'ctacte_movement_notes_idempotency_key_unique'))
       ORDER BY schemaname, tablename, indexname`,
    )
    const parent = await pool.query<{ id: string }>(
      `INSERT INTO tesoreria.ctacte DEFAULT VALUES RETURNING id`,
    )
    const parentId = parent.rows[0]?.id ?? '00000000-0000-0000-0000-000000000000'
    const r1 = await pool.query(
      `INSERT INTO socios.ctacte_movement_notes
        (ctacte_movement_id, body, author_operator_id, idempotency_key)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [parentId, 'first', '00000000-0000-0000-0000-000000000099', 'evidence-key'],
    )
    const r2 = await pool.query(
      `INSERT INTO socios.ctacte_movement_notes
        (ctacte_movement_id, body, author_operator_id, idempotency_key)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [parentId, 'dup', '00000000-0000-0000-0000-000000000098', 'evidence-key'],
    )
    const inferenceOk = r1.rowCount === 1 && r2.rowCount === 0
    writeArtifact(evidencePath, [
      '# 0034-lifecycle evidence',
      '# athlos-ctacte-security-reliability-remediation / S0 / PR1',
      `# captured_at: ${new Date().toISOString()}`,
      '# assertions:',
      '#   0031 → 0032 → 0033 → 0034 applied in order on a disposable PostgreSQL',
      '#   two FULL UNIQUE INDEXes (no WHERE predicate) expected',
      '',
      'schemaname | tablename | indexname | indexdef',
      '--- | --- | --- | ---',
      ...rows.rows.map((r) => `${r.s} | ${r.t} | ${r.i} | ${r.d}`),
      '',
      `# ON CONFLICT (idempotency_key) inference: first=${r1.rowCount} dup=${r2.rowCount} -> ${
        inferenceOk ? 'PASS' : 'FAIL'
      }`,
      '',
    ])
    expect(inferenceOk).toBe(true)
    expect(rows.rows.length).toBeGreaterThan(0)
  })
})
