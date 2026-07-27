import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ensurePgcrypto } from './pgcrypto.ts'

/**
 * `s0-contracts-0034-lifecycle.test.ts` — tasks 1.1 → 1.5.
 *
 * 1.1/1.2 RED+GREEN — six delta specs conform to Given/When/Then + RFC 2119.
 * 1.3 RED    — without 0034 the PARTIAL UNIQUE INDEX cannot be inferred
 *              by bare ON CONFLICT (PostgreSQL raises SQLSTATE 42P10 —
 *              the defect 0034 corrects).
 * 1.4 GREEN  — full chain applies on disposable PostgreSQL; both expected
 *              FULL UNIQUE INDEXes lack a WHERE predicate; ON CONFLICT
 *              now infers.
 * 1.5 REFACTOR — every scenario is Given/When/Then (enforced above).
 *
 * REL-001 (v3 corrective) — committed frozen artifacts under `artifacts/`
 *              are validated structurally by this test (read-only), and
 *              any runtime-generated evidence output is written to a
 *              temporary directory (never to the tracked `artifacts/`).
 *              Enforced by file-level `beforeAll`/`afterAll` invariant.
 *
 * Required env: ATHLOS_TEST_DATABASE_URL (disposable PostgreSQL only).
 * Without it the DB-backed describe blocks SKIP and only the contract
 * validator runs (so static review of contract shape still passes).
 */

const databaseUrl = process.env['ATHLOS_TEST_DATABASE_URL']
const SKIP_DB = !databaseUrl
const repoRoot = join(import.meta.dirname, '..', '..', '..')
const specsRoot = join(
  repoRoot,
  'openspec',
  'changes',
  'athlos-ctacte-security-reliability-remediation',
  'specs',
)
const drizzleDir = join(repoRoot, 'packages', 'db', 'drizzle')
const artifactsDir = join(repoRoot, 'artifacts')
const evidencePath = join(artifactsDir, '0034-lifecycle.txt')
const specDeltaEvidencePath = join(artifactsDir, 's0-spec-deltas.txt')
const changeRoot = join(
  repoRoot,
  'openspec',
  'changes',
  'athlos-ctacte-security-reliability-remediation',
)

/**
 * Read a committed frozen S0 artifact. Throws if the file is missing —
 * committed artifacts are part of the contract under test, so an absent
 * file is a failure (not a recoverable condition).
 */
function readCommittedArtifact(file: string): string {
  const stat = statSync(file, { throwIfNoEntry: false })
  if (!stat?.isFile()) {
    throw new Error(`Committed frozen artifact missing: ${file}`)
  }
  return readFileSync(file, 'utf8')
}

/**
 * REL-001 invariant: the committed artifacts under `artifacts/` are a
 * frozen receipt. They MUST NOT be overwritten by any describe block in
 * this file. We capture their content at suite start and assert the
 * content (and mtime) is unchanged at suite end. Runtime-generated
 * evidence output is written to a temporary directory instead.
 */
let committedSpecDeltaAtStart: { content: string; mtimeMs: number } | undefined
let committedEvidenceAtStart: { content: string; mtimeMs: number } | undefined

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

function validateRolloutEvidence(migrations: string[], integrityEvidence: boolean) {
  return migrations.join('→') === '0031→0032→0033→0034' && integrityEvidence
}

// ─── 1.1 / 1.2 / 1.5 — six delta specs conform to Given/When/Then ───────────

describe('S0 contracts: six delta specs conform to Given/When/Then + RFC 2119', () => {
  const reports = CAPABILITIES.map(validate)
  // REL-001: do NOT call writeArtifact(specDeltaEvidencePath, …) here. The
  // committed artifact under `artifacts/` is a frozen receipt; mutating it
  // from inside the test invalidates the receipt and makes the
  // self-validation below a no-op. The committed file is validated
  // structurally by the REL-001 describe block instead.
  for (const r of reports) {
    it(`${r.capability}: shape = OK`, () => {
      expect(r.ok).toBe(true)
      expect(r.errors).toEqual([])
      expect(r.requirements).toBeGreaterThan(0)
      expect(r.scenarios).toBeGreaterThan(0)
    })
  }

  it('source file does not embed wall-clock mutations', () => {
    expect(readFileSync(import.meta.filename, 'utf8')).not.toContain(
      'new ' + 'Date().toISOString()',
    )
  })
})

// ─── Frozen contract corrections ─────────────────────────────────────────────

describe('S0 corrected contracts', () => {
  it('uses RENDER_TIMEOUT consistently and defines testable operator telemetry', () => {
    const design = readFileSync(join(changeRoot, 'design.md'), 'utf8')
    const api = readFileSync(join(specsRoot, 'api-design', 'spec.md'), 'utf8')
    const monitoring = readFileSync(join(specsRoot, 'monitoring-observability', 'spec.md'), 'utf8')
    const tasks = readFileSync(join(changeRoot, 'tasks.md'), 'utf8')

    expect([design, api, tasks].every((text) => text.includes('RENDER_TIMEOUT'))).toBe(true)
    expect(design).not.toContain('GATEWAY_TIMEOUT')
    expect(monitoring).toContain('ctacte_comprobante_render_timeout_total')
    expect(monitoring).toContain('error_code: "RENDER_TIMEOUT"')
    expect(tasks).toContain('ctacte_comprobante_render_timeout_total')
  })

  it('rejects incomplete 0034 rollout evidence before accepting the chain', () => {
    expect(validateRolloutEvidence(['0031', '0032', '0033'], true)).toBe(false)
    expect(validateRolloutEvidence(['0031', '0032', '0033', '0034'], false)).toBe(false)
    expect(validateRolloutEvidence(['0031', '0032', '0033', '0034'], true)).toBe(true)
  })
})

// ─── 1.3 / 1.4 — 0031 → 0032 → 0033 → 0034 lifecycle ───────────────────────

let pool: Pool | undefined

// REL-001: capture the committed frozen artifacts BEFORE any test runs.
// This is the baseline against which the afterAll invariant asserts no
// describe block has mutated the committed paths.
beforeAll(() => {
  const specStat = statSync(specDeltaEvidencePath, { throwIfNoEntry: false })
  if (specStat?.isFile()) {
    committedSpecDeltaAtStart = {
      content: readFileSync(specDeltaEvidencePath, 'utf8'),
      mtimeMs: specStat.mtimeMs,
    }
  }
  const evidenceStat = statSync(evidencePath, { throwIfNoEntry: false })
  if (evidenceStat?.isFile()) {
    committedEvidenceAtStart = {
      content: readFileSync(evidencePath, 'utf8'),
      mtimeMs: evidenceStat.mtimeMs,
    }
  }
})

beforeAll(async () => {
  if (SKIP_DB) return
  pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 })
  await pool.query('SELECT 1')
})

afterAll(async () => {
  await pool?.end()
})

// REL-001: enforce the frozen-receipt invariant. The committed artifacts
// must be byte-exact and mtime-unchanged after the entire suite runs.
// This catches any describe block that writes to `artifacts/` directly.
afterAll(() => {
  if (committedSpecDeltaAtStart) {
    const stat = statSync(specDeltaEvidencePath, { throwIfNoEntry: false })
    expect(stat?.isFile(), 'committed artifacts/s0-spec-deltas.txt must exist').toBe(true)
    const after = readCommittedArtifact(specDeltaEvidencePath)
    expect(after, 'committed artifacts/s0-spec-deltas.txt must not be overwritten by tests').toBe(
      committedSpecDeltaAtStart.content,
    )
    expect(stat?.mtimeMs, 'committed artifacts/s0-spec-deltas.txt mtime must be frozen').toBe(
      committedSpecDeltaAtStart.mtimeMs,
    )
  }
  if (committedEvidenceAtStart) {
    const stat = statSync(evidencePath, { throwIfNoEntry: false })
    expect(stat?.isFile(), 'committed artifacts/0034-lifecycle.txt must exist').toBe(true)
    const after = readCommittedArtifact(evidencePath)
    expect(after, 'committed artifacts/0034-lifecycle.txt must not be overwritten by tests').toBe(
      committedEvidenceAtStart.content,
    )
    expect(stat?.mtimeMs, 'committed artifacts/0034-lifecycle.txt mtime must be frozen').toBe(
      committedEvidenceAtStart.mtimeMs,
    )
  }
})

async function apply(file: string) {
  if (!pool) throw new Error('pool not initialized')
  await pool.query(readFileSync(join(drizzleDir, file), 'utf8'))
}

async function reset() {
  if (!pool) throw new Error('pool not initialized')
  // Deterministic PostgreSQL prerequisite: pgcrypto MUST be installed BEFORE
  // any CREATE TABLE that references gen_random_uuid(). On PostgreSQL ≥ 13
  // the function also lives in pg_catalog, but we keep the extension as the
  // authoritative source so the prerequisite is explicit and portable to
  // PostgreSQL < 13 disposable containers.
  await ensurePgcrypto(pool)
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

// ─── pgcrypto deterministic prerequisite — RED proof on fresh disposable PG ──
//
// Deterministic prerequisite: any SQL that references `gen_random_uuid()` MUST
// run after `CREATE EXTENSION pgcrypto` is executed. PostgreSQL ≥ 13 also
// exposes `gen_random_uuid()` in `pg_catalog`, so the bug is currently HIDDEN
// on PostgreSQL 17 — but the schema must remain explicit because:
//   (1) reviewers must see the prerequisite enforced, not implied, and
//   (2) disposable PG < 13 in CI/local would crash at table creation time.
//
// RED proof: capture every `pool.query` invocation during `reset()`, find
// the index of `CREATE EXTENSION pgcrypto` and the first `CREATE TABLE`
// whose DDL contains `gen_random_uuid`, and assert the extension index is
// strictly less. With the current reset() ordering (pgcrypto last), this
// assertion FAILS — proving the bug. After the GREEN fix (pgcrypto first),
// the same assertion PASSES.

describe.skipIf(SKIP_DB)('pgcrypto deterministic prerequisite — RED proof on fresh PG', () => {
  it('installs pgcrypto BEFORE any CREATE TABLE that references gen_random_uuid()', async () => {
    if (!pool) throw new Error('pool not initialized')
    // Simulate a truly fresh disposable PG: drop pgcrypto + all schemas.
    await pool.query('DROP SCHEMA IF EXISTS tesoreria CASCADE')
    await pool.query('DROP SCHEMA IF EXISTS socios CASCADE')
    await pool.query('DROP EXTENSION IF EXISTS pgcrypto CASCADE')

    // Spy on pool.query to capture every SQL string reset() emits.
    const executed: string[] = []
    const originalQuery = pool.query.bind(pool)
    type QueryArg = string | { text: string }
    const spy = (q: QueryArg) => {
      const text = typeof q === 'string' ? q : q.text
      executed.push(text)
      return originalQuery(q as never)
    }
    ;(pool as unknown as { query: typeof spy }).query = spy

    try {
      await reset()
    } finally {
      ;(pool as unknown as { query: typeof originalQuery }).query = originalQuery
    }

    const pgcryptoIdx = executed.findIndex((q) => /CREATE\s+EXTENSION[^;]*pgcrypto/i.test(q))
    const firstGenUuidTableIdx = executed.findIndex((q) =>
      /CREATE\s+TABLE[\s\S]*gen_random_uuid\(\)/i.test(q),
    )

    expect(pgcryptoIdx).toBeGreaterThanOrEqual(0)
    expect(firstGenUuidTableIdx).toBeGreaterThanOrEqual(0)
    expect(pgcryptoIdx).toBeLessThan(firstGenUuidTableIdx)
  })
})

describe.skipIf(SKIP_DB)('0034 lifecycle — GREEN proof (full chain + evidence)', () => {
  it('applies and asserts 0031 → 0032 → 0033 → 0034 twice with deterministic evidence', async () => {
    if (!pool) throw new Error('pool not initialized')
    const runs: Array<{
      rows: Array<{ s: string; t: string; i: string; d: string }>
      first: number | null
      duplicate: number | null
    }> = []

    for (let run = 1; run <= 2; run += 1) {
      await reset()
      await apply('0031_ctacte_movement_notes.sql')
      await apply('0032_ctacte_payment_idempotency.sql')
      await apply('0033_ctacte_comprobante_retries.sql')
      await apply('0034_ctacte_movement_notes_idempotency_key_full_unique.sql')
      const idx = await pool.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes
         WHERE indexname IN (
           'ctacte_idempotency_key_unique',
           'ctacte_movement_notes_idempotency_key_unique'
         )`,
      )
      expect(idx.rows).toHaveLength(2)
      for (const row of idx.rows) {
        expect(row.indexdef.toLowerCase()).toContain('unique')
        expect(row.indexdef.toLowerCase()).not.toMatch(/\bwhere\b/)
      }
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
      const first = await pool.query(
        `INSERT INTO socios.ctacte_movement_notes
          (ctacte_movement_id, body, author_operator_id, idempotency_key)
          VALUES ($1,$2,$3,$4)
          ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
        [parentId, 'first', '00000000-0000-0000-0000-000000000099', 'evidence-key'],
      )
      const duplicate = await pool.query(
        `INSERT INTO socios.ctacte_movement_notes
          (ctacte_movement_id, body, author_operator_id, idempotency_key)
          VALUES ($1,$2,$3,$4)
          ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
        [parentId, 'dup', '00000000-0000-0000-0000-000000000098', 'evidence-key'],
      )
      expect([first.rowCount, duplicate.rowCount]).toEqual([1, 0])
      runs.push({ rows: rows.rows, first: first.rowCount, duplicate: duplicate.rowCount })
    }

    expect(runs).toHaveLength(2)
    expect(runs.map((run) => [run.first, run.duplicate])).toEqual([
      [1, 0],
      [1, 0],
    ])
    const evidenceLines = [
      '# 0034-lifecycle evidence',
      '# athlos-ctacte-security-reliability-remediation / S0 / PR1',
      '# source: deterministic disposable PostgreSQL validation',
      '# assertions:',
      '#   0031 → 0032 → 0033 → 0034 applied in order twice',
      '#   two FULL UNIQUE INDEXes (no WHERE predicate) expected per run',
      '',
      'schemaname | tablename | indexname | indexdef',
      '--- | --- | --- | ---',
      ...runs[1]!.rows.map((row) => `${row.s} | ${row.t} | ${row.i} | ${row.d}`),
      '',
      '# run 1 ON CONFLICT inference: first=1 dup=0 -> PASS',
      '# run 2 ON CONFLICT inference: first=1 dup=0 -> PASS',
      '',
    ]
    // REL-001: runtime-generated evidence output goes to a temporary
    // directory (NOT to the tracked `artifacts/` path). The committed
    // `artifacts/0034-lifecycle.txt` is a frozen receipt validated
    // structurally by the REL-001 describe block.
    const tempDir = mkdtempSync(join(tmpdir(), 's0-pr1-0034-evidence-'))
    const tempEvidencePath = join(tempDir, '0034-lifecycle.runtime.txt')
    try {
      writeArtifact(tempEvidencePath, evidenceLines)
      expect(readFileSync(tempEvidencePath, 'utf8')).toBe(evidenceLines.join('\n') + '\n')
      expect(runs[1]!.rows.length).toBeGreaterThan(0)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

// ─── REL-001: committed frozen S0 evidence is structurally valid (read-only) ─
//
// The artifacts under `artifacts/` are a FROZEN RECEIPT. They were captured
// at the time of the v2 corrective batch and are checked into the v3
// lineage byte-exactly. These tests validate that the committed file is
// present, structurally complete, and consistent — WITHOUT modifying it.
// They are the contract that the receipt is real evidence, not a placeholder.

describe('REL-001: committed frozen S0 evidence is structurally valid (read-only)', () => {
  it('committed artifacts/s0-spec-deltas.txt is present and structurally valid', () => {
    const content = readCommittedArtifact(specDeltaEvidencePath)
    expect(content).toContain('# s0-spec-deltas evidence')
    expect(content).toContain('# athlos-ctacte-security-reliability-remediation')
    for (const cap of CAPABILITIES) {
      expect(content).toMatch(new RegExp(`- ${cap}: OK req=\\d+ scen=\\d+`))
    }
    expect(content).toMatch(/# summary: 6\/6 valid/)
  })

  it('committed artifacts/0034-lifecycle.txt is present and structurally valid', () => {
    const content = readCommittedArtifact(evidencePath)
    expect(content).toContain('# 0034-lifecycle evidence')
    expect(content).toContain('# athlos-ctacte-security-reliability-remediation / S0 / PR1')
    expect(content).toContain('ctacte_idempotency_key_unique')
    expect(content).toContain('ctacte_movement_notes_idempotency_key_unique')
    // design.md:54 — chain applied twice; both runs must show inference PASS.
    const passMarkers = content.match(/first=1 dup=0 -> PASS/g) ?? []
    expect(passMarkers.length).toBeGreaterThanOrEqual(2)
    // Both expected FULL UNIQUE INDEXes lack a WHERE predicate.
    const indexLines = content.split('\n').filter((l) => l.includes('CREATE UNIQUE INDEX'))
    expect(indexLines.length).toBeGreaterThanOrEqual(2)
    for (const line of indexLines) {
      expect(line.toLowerCase()).toContain('unique')
      expect(line.toLowerCase()).not.toMatch(/\bwhere\b/)
    }
  })
})
