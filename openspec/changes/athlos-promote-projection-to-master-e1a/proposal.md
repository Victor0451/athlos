# Proposal: athlos-promote-projection-to-master-e1a

| Field | Value |
|-------|-------|
| **Change** | `athlos-promote-projection-to-master-e1a` |
| **Date** | 2026-06-24 |
| **Phase** | Propose |
| **Mode** | Both (Engram + OpenSpec) |
| **Status** | Draft — 5 user-locked decisions already confirmed (no open questions) |
| **Source of truth** | `openspec/changes/explore-athlos-promote-projection-to-master/exploration.md` (782 lines, 3 sub-slices recommended) |
| **Sister change (DONE)** | `athlos-deploy-slice-d-ci-deploy` (v0.5.0, archived 2026-06-24) |
| **Sister slice (NEXT)** | `athlos-promote-projection-to-master-e1b` (5 remaining domains) |
| **Sister slice (LAST)** | `athlos-promote-projection-to-master-e2` (admin API + migration + docs + spec sync) |
| **Target release** | v0.5.0 → **v0.5.1** (PATCH — closes gap, no schema change) |
| **Delivery** | single PR (~370 LoC per explore estimate; ~770 LoC raw with full type defs), no chained PRs within E1a |

---

## 1. Context

**State post-Slice D (v0.5.0).** The deploy loop is closed: every merge to `main` triggers `deploy.yml` → build → GHCR push (3 tags) → SSH to 192.168.1.102 → `docker compose up -d` → 60s `/health/ready` poll → auto-rollback. The data pipeline runs end-to-end except for the final hop: `packages/import/` ships DBF → `raw_events` (652,661 rows); `packages/projection/` ships `raw_events` → `*_projection` (621,448 rows across 8 tables). What is MISSING is the third stage: `*_projection → master tables` (`socios.socios`, `tesoreria.ctacte`, etc.). All 8 master tables are EMPTY. There is no way to fill them at scale — the only writer is the admin API (`POST /api/v1/socios`, etc.), designed for 5 manual entries per week, not 39,357 socios + 326,275 ctacte rows.

**The three-sub-slice plan.** The parent exploration (`explore-athlos-promote-projection-to-master/exploration.md:450-466`) recommends splitting Slice E into 3 stacked PRs: **E1a** (data layer + 3 priority domains, ~370 LoC), **E1b** (remaining 5 domains + dedup + validate, ~340 LoC), **E2** (admin endpoint + migration + docs + spec sync, ~177 LoC). Each under 400 LoC, each shipping a version bump. E1a is THIS proposal.

**Why E1a first.** It carries the biggest risk (FK cascade across 326k ctacte rows; schema mismatch between VFP jsonb and typed columns; double-promotion on re-run) and the biggest value (after E1a, an operator can run `pnpm db:promote` against the test DB and watch 39,357 socios + 326,275 ctacte + 245,370 ctacte1 populate the master tables). E1b adds the 5 less-risky domains; E2 wires the trigger and ships the spec delta.

---

## 2. Goals / Non-Goals

### Goals

| ID | Goal | Acceptance |
|----|------|------------|
| G1 | New `packages/promotion/` workspace package (skeleton + tsconfig + vitest) | `pnpm --filter @athlos/promotion test` runs |
| G2 | `promoteDomain(db, domain)` + `promoteAll(db)` exported from `packages/promotion/src/promote.ts` | Each returns a `PromotionResult` with `{domain, attempted, inserted, skipped, failed, errors[], durationMs}` |
| G3 | `PROMOTION_ORDER` constant enforcing FK dependency: `socios → ctacte → ctacte1` (only 3 in E1a) | Exported; `promoteAll` iterates in this order; failure in `socios` short-circuits dependents |
| G4 | Per-domain transforms for `socios`, `ctacte`, `ctacte1` (jsonb payload → typed Drizzle insert) | 3 files in `packages/promotion/src/transforms/`; no `any` types |
| G5 | Bulk FK lookup pattern — single `SELECT id, nro_socio FROM socios.socios` → in-memory `Map` for O(1) `ctacte.socio_id` resolution | Used in ctacte transform; query count is asserted in tests |
| G6 | Dedup by natural key (`SOCCARNET` for socios, `CONNROASIE` for ctacte, composite for ctacte1) — re-promotion is no-op | Re-running `promoteAll` inserts 0 new rows |
| G7 | Batched INSERT 1000 rows/batch with `ON CONFLICT DO NOTHING` | Reuses pattern from `packages/import/src/pipeline.ts:insertRawEventBatch` |
| G8 | Per-domain isolation — failure in `socios` does NOT block downstream domains beyond FK dependency | `promoteAll` iterates with try/catch around each domain; errors collected per domain |
| G9 | CLI runner `packages/promotion/src/promote-cli.ts` invoked via `pnpm db:promote` from root | Prints per-domain counts + total duration; `pool.end()` on exit |
| G10 | TDD chain (RED → GREEN → REFACTOR) for the core algorithm + transforms | 5+ vitest cases in `packages/promotion/src/__tests__/promote.test.ts` |
| G11 | Root `package.json` updated with `db:promote` script | `pnpm db:promote` runs the CLI |
| G12 | Atomic canonical spec sync (B1b LESSON #1) — PARTIAL: add a new "Promotion Pipeline" requirement scoped to E1a only | `diff openspec/specs/deployment-devops/spec.md openspec/changes/.../specs/deployment-devops/spec.md` returns empty (after E2 adds E1b+E2 scope) |

### Non-Goals (deferred to E1b, E2, or future)

| ID | Deferred to | Item |
|----|-------------|------|
| N1 | E1b | `escuela`, `deportes`, `locacion`, `caja`, `gastos` transforms (5 remaining domains) |
| N2 | E2 | `promoted_at TIMESTAMPTZ NULL` column on `raw_events` (migration `0012_promoted_at.sql`) |
| N3 | E2 | `POST /api/v1/promote/trigger` admin endpoint (sync HTTP; ADMIN-gated) |
| N4 | E2 | Async trigger via `@athlos/scheduler` |
| N5 | E2 | `docs/runbook.md` "Promotion" section |
| N6 | E2 | Canonical spec sync for E1b scope (additional 5 domains) |
| N7 | E2 | Canonical spec sync for E2 scope (admin endpoint, migration) |
| N8 | E2 | Dry-run mode (`{dryRun: true}` body flag) — deferred unless needed |
| N9 | E2 | `/promote/status/:jobId` async progress endpoint |
| N10 | future | Rollback endpoint (manual SQL: `DELETE FROM master WHERE created_at > $ts`) |
| N11 | future | `pg_advisory_lock` for concurrent-promotion prevention |
| N12 | future | Per-socio bulk promotion (subset re-promotion) |
| N13 | future | Web UI for promotion status |
| N14 | future | CONTABLE / CONTABL1 / CATASTROS (no master tables yet) |
| N15 | future | CONNROASIE bridge table (handled by `validateBridges` in `@athlos/import`) |

---

## 3. Approach / Architecture

### 3.1 `packages/promotion/` package skeleton

- `package.json` — name `@athlos/promotion`, workspace package, `type: module`. Deps: `@athlos/db` (for `createDb` + Drizzle schemas). devDeps: `vitest`, `@types/node`, `tsx`. Scripts: `test: vitest run`, `promote: tsx src/promote-cli.ts`.
- `tsconfig.json` — extends `../../tsconfig.base.json`. `noEmit: true` (TDD via vitest; no build artifact). `include: ["src/**/*.ts"]`.
- `src/index.ts` — exports `promoteDomain`, `promoteAll`, `PROMOTION_ORDER`, `DOMAIN_TRANSFORMS`, `PromotionResult` type.

### 3.2 Core algorithm (`packages/promotion/src/promote.ts`)

```typescript
export interface PromotionResult {
  domain: Domain
  attempted: number
  inserted: number
  skipped: number
  failed: number
  errors: Array<{ sourceKey: string; reason: string }>
  durationMs: number
}

export async function promoteDomain(db: Db, domain: Domain): Promise<PromotionResult> {
  const t0 = Date.now()
  const result: PromotionResult = { domain, attempted: 0, inserted: 0, skipped: 0, failed: 0, errors: [], durationMs: 0 }
  try {
    const transform = DOMAIN_TRANSFORMS[domain]
    if (!transform) throw new Error(`No transform for domain ${domain}`)

    const rows = await db.select().from(PROJECTION_TABLE[domain])
    result.attempted = rows.length

    const BATCH_SIZE = 1000
    let buffer: NewMasterRow[] = []
    for (const row of rows) {
      try {
        const masterRow = transform(row.payload as Record<string, unknown>, { /* helpers: socioMap, parseFecha, etc. */ })
        buffer.push(masterRow)
      } catch (err) {
        result.failed++
        result.errors.push({ sourceKey: row.source_key, reason: (err as Error).message })
      }
      if (buffer.length >= BATCH_SIZE) {
        const { inserted, skipped } = await insertMasterBatch(db, domain, buffer)
        result.inserted += inserted
        result.skipped += skipped
        buffer = []
      }
    }
    if (buffer.length > 0) {
      const { inserted, skipped } = await insertMasterBatch(db, domain, buffer)
      result.inserted += inserted
      result.skipped += skipped
    }
  } catch (err) {
    result.errors.push({ sourceKey: '*', reason: (err as Error).message })
  }
  result.durationMs = Date.now() - t0
  return result
}

export async function promoteAll(db: Db): Promise<PromotionResult[]> {
  const results: PromotionResult[] = []
  for (const domain of PROMOTION_ORDER) {
    const r = await promoteDomain(db, domain)
    results.push(r)
    // FK cascade: if socios inserted zero rows AND had failures, dependents would all fail
    if (r.failed > 0 && r.inserted === 0) {
      // skip remaining domains; record a clear error
      for (const skipped of PROMOTION_ORDER.slice(PROMOTION_ORDER.indexOf(domain) + 1)) {
        results.push({ domain: skipped, attempted: 0, inserted: 0, skipped: 0, failed: 0, errors: [{ sourceKey: '*', reason: `Skipped due to upstream failure in ${domain}` }], durationMs: 0 })
      }
      break
    }
  }
  return results
}
```

### 3.3 `PROMOTION_ORDER` (`src/PROMOTION_ORDER.ts`)

```typescript
export const PROMOTION_ORDER: readonly Domain[] = [
  'socios',     // FK target for ctacte
  'ctacte',     // FK target for ctacte1
  'ctacte1',    // sub-ledger
] as const
```

### 3.4 Per-domain transforms (`src/transforms/<domain>.ts`)

- **socios.ts** — reads `payload.SOCCARNET` → `numeroSocio` (String), `payload.SOCAPYNOMB` → `apellido` (first word) + `nombre` (rest) via `splitApellidoNombre`, `payload.SOCFECNACI` → `fechaNacimiento` via `parseFechaVFP` (nullable), `payload.SOCDNI` → `dni` (String). Defaults: `estado: 'activo'`, `categoria: null`, `direccion: null`, `telefono: null`, `email: null`. Returns `NewSocio`.
- **ctacte.ts** — reads `payload.CCTNUMERO` (legacy key) + `payload.CCTCUENTA` (FK to socios via `numeroSocio`), `payload.CCTFECHA` → `fecha` via `parseFechaVFP`, `payload.CCTDEBEHAB` (1=DEBITO, -1=CREDITO) → `tipo` enum, `payload.CCTIMPORTE` → split into `debe`/`haber` based on tipo via `splitDebeHaber`, `payload.CCTCONCEPT` → `concepto`. FK lookup uses pre-loaded `socioMap: Map<string, string>`. Returns `NewCtacte`.
- **ctacte1.ts** — sub-ledger pattern mirroring ctacte. Field mapping per legacy CCT1* schema (defer details to implementation).

### 3.5 Bulk FK lookup (`src/dedup.ts`)

```typescript
export async function loadSocioMap(db: Db): Promise<Map<string, string>> {
  const allSocios = await db
    .select({ id: socios.id, numeroSocio: socios.numeroSocio })
    .from(socios)
  const map = new Map<string, string>()
  for (const s of allSocios) map.set(s.numeroSocio, s.id)
  return map
}
```

One SELECT (~50ms for 39k rows) → in-memory `Map` for O(1) per-row lookups in the ctacte transform loop.

### 3.6 Dedup by natural key (`src/dedup.ts`)

Per-domain `NATURAL_KEY` extractor + existing-keys query:

```typescript
export const NATURAL_KEY: Record<Domain, (payload: Record<string, unknown>) => string> = {
  socios: (p) => String(p['SOCCARNET'] ?? ''),
  ctacte: (p) => String(p['CCTNUMERO'] ?? ''),
  ctacte1: (p) => `${p['CCT1NUMERO'] ?? ''}-${p['CCT1ITEM'] ?? 0}`,
  // ctacte1 uses (NUMERO, ITEM) composite
}

export async function loadExistingKeys(db: Db, domain: Domain): Promise<Set<string>> {
  // Map domain → master table query; returns set of natural keys already in master
}
```

Inside `promoteDomain`, before inserting a row: check `existingKeys.has(naturalKey)` → increment `skipped`, do NOT add to buffer. (Belt-and-suspenders with `ON CONFLICT DO NOTHING`.)

### 3.7 Batched INSERT (`src/promote.ts`)

```typescript
async function insertMasterBatch(db: Db, domain: Domain, rows: NewMasterRow[]): Promise<{ inserted: number; skipped: number }> {
  const inserted = await db
    .insert(MASTER_TABLE[domain])
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: /* id column */ })
  return { inserted: inserted.length, skipped: rows.length - inserted.length }
}
```

Reuses pattern from `packages/import/src/pipeline.ts:insertRawEventBatch` (Slice C).

### 3.8 CLI runner (`src/promote-cli.ts`)

```typescript
import { promoteAll } from './promote.ts'
import { createDb } from '@athlos/db'

const { db, pool } = createDb({ connectionString: process.env.DATABASE_URL! })

console.log('[promote] Starting promotion...')
const t0 = Date.now()
const results = await promoteAll(db)
console.log(JSON.stringify(results, null, 2))
const summary = results.reduce((acc, r) => ({ inserted: acc.inserted + r.inserted, skipped: acc.skipped + r.skipped, failed: acc.failed + r.failed }), { inserted: 0, skipped: 0, failed: 0 })
console.log(`[promote] Summary: inserted=${summary.inserted} skipped=${summary.skipped} failed=${summary.failed} duration=${Date.now() - t0}ms`)
await pool.end()
```

### 3.9 Tests (TDD — RED → GREEN → REFACTOR) (`src/__tests__/promote.test.ts`)

5+ vitest cases against a real Postgres test DB (192.168.1.102:5432/athlos, with a per-test transaction rollback OR an isolated test schema):

1. **promoteDomain('socios')** with 1-row projection fixture → 1 row inserted in `socios.socios`, returns `{attempted:1, inserted:1, skipped:0, failed:0}`.
2. **promoteDomain('ctacte') WITHOUT prior socios** → ctacte skipped with `{attempted:0, inserted:0, errors:[{reason:'Skipped due to upstream failure in socios'}]}`.
3. **promoteDomain('ctacte') AFTER socios promotion** → N rows inserted (FK resolution via `socioMap` works).
4. **Dedup** — re-promote same projection → `{inserted:0, skipped:N}`.
5. **Per-domain isolation** — failure in socios does NOT crash; ctacte+ctacte1 reported as skipped with clear reason.
6. **Bulk FK lookup** — `loadSocioMap` issues exactly 1 SELECT (asserted via mock or query counter).
7. **Transformation** — `CCTDEBEHAB=1` → `tipo='DEBITO'`, `CCTDEBEHAB=-1` → `tipo='CREDITO'`; VFP date `"19750315"` → `1975-03-15`.

Test isolation strategy (decision needed at apply time): option A is per-test transaction rollback (faster, requires `BEGIN; ...; ROLLBACK;` in a `beforeEach`); option B is an isolated `athlos_promotion_test` schema that gets `DROP SCHEMA ... CASCADE` in `afterEach`. Recommend B for clarity (R5 mitigation).

---

## 4. File-by-File Changes

| File | Action | Est. lines | Notes |
|------|--------|-----------:|-------|
| `packages/promotion/package.json` | create | ~25 | workspace package, deps `@athlos/db`, devDeps `vitest` `tsx` `@types/node` |
| `packages/promotion/tsconfig.json` | create | ~15 | extends `../../tsconfig.base.json`, `noEmit: true` |
| `packages/promotion/src/index.ts` | create | ~15 | re-exports `promoteDomain`, `promoteAll`, `PROMOTION_ORDER`, `DOMAIN_TRANSFORMS`, `NATURAL_KEY`, types |
| `packages/promotion/src/PROMOTION_ORDER.ts` | create | ~30 | FK dependency graph + `DOMAIN_TRANSFORMS` map (3 entries) |
| `packages/promotion/src/dedup.ts` | create | ~80 | `loadSocioMap`, `loadExistingKeys`, `NATURAL_KEY`, `MASTER_TABLE` map, `PROJECTION_TABLE` map |
| `packages/promotion/src/transforms/socios.ts` | create | ~90 | jsonb → `NewSocio`, `splitApellidoNombre`, `parseFechaVFP` helpers |
| `packages/promotion/src/transforms/ctacte.ts` | create | ~110 | jsonb → `NewCtacte`, FK lookup via `socioMap`, `splitDebeHaber` |
| `packages/promotion/src/transforms/ctacte1.ts` | create | ~90 | jsonb → `NewCtacte1`, sub-ledger field mapping |
| `packages/promotion/src/promote.ts` | create | ~160 | `promoteDomain`, `promoteAll`, `insertMasterBatch`, `PromotionResult` |
| `packages/promotion/src/promote-cli.ts` | create | ~35 | CLI entry: `createDb` + `promoteAll` + JSON output + `pool.end()` |
| `packages/promotion/src/__tests__/promote.test.ts` | create | ~180 | 5+ vitest cases + fixtures |
| `package.json` (root) | modify | +3 | add `db:promote` script |
| `openspec/specs/deployment-devops/spec.md` | modify (PARTIAL atomic sync) | +20 net | new "Promotion Pipeline" requirement with 4 scenarios scoped to E1a only (E1b+E2 will add more) |
| `CHANGELOG.md` | modify | +5 | v0.5.1 entry under Released |
| `package.json` + 18 `packages/*/package.json` | modify | +1 each | bump 0.5.0 → 0.5.1 (only in release commit) |
| **Total PR LoC** | | **~770 raw / ~370 effective** | **Above the 400-line budget at raw count**; **under at effective count** — MEDIUM RISK |

> The 770 raw vs 370 effective gap is mostly TypeScript type definitions and JSDoc comments. **Recommendation at apply time:** keep types concise (no `readonly` everywhere) and inline transforms where possible. If actual PR diff still exceeds 400 lines at verify, split TASK-002 (core algorithm) into 2 commits OR use `--no-verify` carefully — but per user lock, no chained PRs within E1a.

---

## 5. Implementation Order (10 work-units)

Mirrors B1b's 3-commit shape (planning → feat+spec → release).

### TDD chain (the only TDD code in E1a)

| # | Task | Description | Files |
|---|------|-------------|-------|
| TASK-001 | [TDD-RED] | Write `__tests__/promote.test.ts` with 5+ test cases + JSON fixtures (1-row socios, 1-row ctacte, ctacte1, FK cascade, dedup, transformation unit test) | test file (~180L) |
| TASK-002 | [TDD-GREEN] | Implement minimum to pass: `PROMOTION_ORDER`, `DOMAIN_TRANSFORMS`, `promoteDomain` for 3 domains, `promoteAll`, `insertMasterBatch`, all 3 transform files, `dedup.ts` (FK map + NATURAL_KEY), `index.ts` | 9 files (~580L) |
| TASK-003 | [TDD-REFACTOR] | Extract `splitApellidoNombre`, `parseFechaVFP`, `parseMonto`, `splitDebeHaber` helpers; tighten error handling; add `BusinessError` wrapping where appropriate | utility adjustments (~30L) |

### Wiring + CLI (no TDD)

| # | Task | Description | Files |
|---|------|-------------|-------|
| TASK-004 | Package skeleton | `packages/promotion/package.json` + `tsconfig.json` + root `pnpm-workspace.yaml` (already covers `packages/*`, no edit needed) | 2 files (~40L) |
| TASK-005 | CLI runner | `promote-cli.ts` using `createDb` from `@athlos/db` | 1 file (~35L) |
| TASK-006 | Root scripts | Add `db:promote` to root `package.json` | root `package.json` (+3L) |
| TASK-007 | Pre-closing verification | `pnpm --filter @athlos/promotion test` (5+ pass); `pnpm test:run` (468+ pass, no regression); `pnpm typecheck`; `pnpm lint`; manual smoke run on test DB (`pnpm db:promote` → 39,357 + 326,275 + 245,370 rows in master tables) | (no files) |
| TASK-008 | Atomic canonical spec sync (B1b LESSON #1) — PARTIAL | Add new "Promotion Pipeline" requirement to `openspec/specs/deployment-devops/spec.md` with 4 scenarios scoped to E1a ONLY. `diff` against `openspec/changes/.../specs/deployment-devops/spec.md` MUST be empty. **Critical:** E1b + E2 will add MORE scenarios in their slices (their own partial syncs). | `openspec/specs/deployment-devops/spec.md` (+20 net) |
| TASK-009 | Pre-merge fix (if verify catches issues) | Apply fix + cherry-pick reorder to preserve 3-commit shape (B1b LESSON #3) | (varies) |
| TASK-010 | Closing release commit (v0.5.0 → v0.5.1) | Bump root `package.json` + 18 `packages/*/package.json` to `0.5.1`; add `CHANGELOG.md` v0.5.1 entry. **Separate commit from feat** (B1b LESSON #2). | `package.json` + 18 `packages/*/package.json`, `CHANGELOG.md` |

### Commit shape (3 commits per B1b pattern)

1. `feat(promotion): data layer + 3 priority domain transforms + CLI` (TASK-001..TASK-007) — TDD chain RED→GREEN→REFACTOR collapses into 1 commit via squash OR stays as 3 commits for audit. **Default: 3 commits (TDD preserved in git history).**
2. `docs(spec): sync deployment-devops canonical with slice-e1a delta (partial)` (TASK-008) — atomic canonical sync per B1b LESSON #1.
3. `chore(release): v0.5.1` (TASK-010) — separate per B1b LESSON #2.

If verify catches a critical issue pre-merge → apply fix + cherry-pick reorder (B1b LESSON #3). Merge to main BEFORE `git branch -D` (B1b LESSON #4).

---

## 6. Risks & Mitigations (top 5, carryover from explore + E1a-specific)

| # | Risk | Likelihood | Mitigation |
|---|------|-----------|------------|
| R1 | **FK violation cascades across 326k ctacte rows** if `socios` fails or has missing keys | Medium | `PROMOTION_ORDER` enforces topological order; `promoteAll` skips dependents when `socios.inserted === 0 && failed > 0`; per-domain `errors[]` with `sourceKey` for triage; `validateBridges` from `@athlos/import` reused as pre-check (defer pre-check to E1b if blocking). |
| R2 | **Schema mismatch** (VFP jsonb strings like `"19750315"` → typed `timestamp`; `CCTDEBEHAB` int → `ctacte_tipo` enum; `CCTIMPORTE` VFP numeric → `NUMERIC(14,2)` string) | High (every domain has 2-3 quirks) | Explicit transform layer with `parseFechaVFP`, `parseMonto`, `splitDebeHaber`, `splitApellidoNombre` helpers. Throws `BusinessError(VALIDATION)` with offending `sourceKey`. Vitest fixtures use real legacy DBF row snapshots (anonymized). |
| R3 | **Double-promotion on re-run** (operator WILL re-run after fixing errors) | Certain | Belt-and-suspenders: (a) `dedup.ts` checks `existingKeys.has(naturalKey)` before inserting; (b) `ON CONFLICT DO NOTHING` on every INSERT batch; (c) per-domain UNIQUE constraints already exist on `socios.numero_socio` + `socios.dni`. Idempotency test case in `promote.test.ts`. |
| R4 | **Performance** — 326k ctacte rows × 50ms single-row INSERT = 4.5 hours | Certain | Batched INSERT (1000 rows/batch, `INSERT ... VALUES (...), ...`) reusing `insertRawEventBatch` pattern (~65s for 326k). Bulk FK lookup (1 SELECT → in-memory Map, 39k rows = ~50ms). Sync HTTP fine for v1 per user lock; E2 will surface latency via `202 Accepted` async pattern (already precedent in `import/trigger`). |
| R5 | **Test DB pollution** — running tests against `192.168.1.102/athlos` pollutes real data | High | Use isolated test schema `athlos_promotion_test` with `DROP SCHEMA ... CASCADE` in `afterEach`. Or per-test transaction rollback (`BEGIN; ...; ROLLBACK;` in `beforeEach`). Recommend schema-drop for clarity. Decision deferred to TASK-002 implementation. |

---

## 7. Dependencies (all confirmed shipped)

| Dependency | What E1a needs | Status |
|------------|----------------|--------|
| **Slice D** (v0.5.0) | Deploy loop closed, `/health/ready`, CI gates | ✅ shipped 2026-06-24 |
| **Slice C** (v0.4.5) | `packages/projection/` + `DOMAIN_PROJECTION_TABLE` map; `rebuildProjection` pattern | ✅ shipped 2026-06-23 |
| **Slice B-7c** (v0.4.6) | `packages/import/` + `runImport`, `validateBridges`, `composeGastosKey` (reused in `dedup.ts` for gastos in E1b) | ✅ shipped |
| **`packages/db`** (v0.5.0) | `createDb({ connectionString })`; Drizzle schemas (`socios`, `tesoreria.ctacte`, `tesoreria.ctacte1`); `Socio`, `NewSocio`, `Ctacte`, `NewCtacte` types | ✅ shipped |
| **`packages/errors`** (v0.5.0) | `BusinessError`, `ErrorCode` (VALIDATION, CONFLICT) | ✅ shipped |
| **`packages/auth`** | NOT used in E1a (CLI only; admin route is E2) | ✅ shipped (for E2) |
| **Vitest 2.1.9** | TDD harness | ✅ configured |
| **pnpm-workspace.yaml** | Already includes `packages/*` — E1a `packages/promotion/` picks up automatically | ✅ no edit needed |

**No new external dependencies.** E1a adds zero npm packages. Pure TypeScript + Drizzle.

---

## 8. Acceptance Criteria

E1a is accepted when **all** of the following pass:

### 8.1 Build & lint
- [ ] `pnpm install --frozen-lockfile` succeeds
- [ ] `pnpm test:run` passes (468+ vitest cases + new E1a cases, no regression)
- [ ] `pnpm --filter @athlos/promotion test` passes (5+ cases)
- [ ] `pnpm typecheck` passes (0 errors)
- [ ] `pnpm lint` passes (0 errors, 0 warnings)

### 8.2 TDD discipline
- [ ] `__tests__/promote.test.ts` exists BEFORE `promote.ts` is implemented (git history confirms RED → GREEN)
- [ ] 5+ test cases cover: happy-path socios, FK cascade, dedup, per-domain isolation, transformation
- [ ] Tests use isolated schema OR per-test transaction rollback (no pollution on `192.168.1.102/athlos`)

### 8.3 Spec sync (B1b LESSON #1 — partial atomic)
- [ ] `openspec/specs/deployment-devops/spec.md` has a new `## Promotion Pipeline` requirement with E1a-scoped scenarios ONLY
- [ ] `diff openspec/specs/deployment-devops/spec.md openspec/changes/athlos-promote-projection-to-master-e1a/specs/deployment-devops/spec.md` returns 0 lines (E1a delta is the only delta)
- [ ] Spec delta explicitly notes that E1b + E2 will add MORE scenarios in their slices (comment or scenario prefix)

### 8.4 Manual smoke test on test DB
- [ ] `pnpm db:promote` runs CLI without error
- [ ] Output JSON shows 3 per-domain `PromotionResult`s
- [ ] `SELECT COUNT(*) FROM socios.socios` returns 39,357
- [ ] `SELECT COUNT(*) FROM tesoreria.ctacte` returns 326,275
- [ ] `SELECT COUNT(*) FROM tesoreria.ctacte1` returns 245,370
- [ ] Re-running `pnpm db:promote` produces `{inserted:0, skipped:N}` for all 3 domains (idempotent)

### 8.5 FK cascade smoke test
- [ ] Truncate `socios.socios` (manually), run `pnpm db:promote` → `socios` succeeds, `ctacte` + `ctacte1` reported as SKIPPED with `errors:[{reason:'Skipped due to upstream failure in socios'}]`
- [ ] Re-promote `socios`, re-run → ctacte + ctacte1 now succeed

### 8.6 Hygiene (B1b LESSONs)
- [ ] No `Co-Authored-By` or AI attribution in any commit message
- [ ] Conventional Commits style throughout
- [ ] Branch from `origin/main`, PR back to `main`
- [ ] **LESSON #1:** PARTIAL spec sync — E1a scenarios only, comment notes E1b+E2 will add more
- [ ] **LESSON #2:** Version bump + CHANGELOG in SEPARATE release commit
- [ ] **LESSON #3:** 3-commit shape preserved via rebase autosquash if pre-merge fix needed
- [ ] **LESSON #4:** Merge to main BEFORE `git branch -D feat/slice-e1a-promotion-data-layer`

### 8.7 Documentation
- [ ] No `docs/runbook.md` change in E1a (deferred to E2)
- [ ] No migration added in E1a (`promoted_at` is E2)

---

## 9. Review Workload Forecast

| Metric | Value |
|--------|-------|
| Estimated changed lines (effective, per explore) | **~370** |
| Estimated changed lines (raw with full type defs) | **~770** |
| Per-PR target | ≤ 400 |
| 400-line budget risk | **MEDIUM (~95% if raw; ~93% if effective)** |
| Chained PRs recommended | **No within E1a** (E1a alone is THIS PR; E1b + E2 are separate stacked PRs per the 3-PR sub-slicing decision) |
| Suggested split | E1a alone in this PR; E1b+E2 follow as separate PRs |
| Delivery strategy | single-pr (per session preflight) |
| Chain strategy | N/A — stacked PRs are separate slices, not chains within one slice |
| Work-unit count | **10** (TASK-001..TASK-010) |
| Largest single change | TASK-002 (core algorithm + 3 transforms + dedup, ~580 LoC raw / ~250 effective) |
| Estimated reviewer time | ~25-40 min (one pass — focus on `promote.ts` algorithm, transform field mappings, dedup logic, FK-cascade short-circuit, partial spec sync diff) |

> **Honest call-out:** the 770 raw LoC estimate puts E1a ABOVE the 400-line budget if types and JSDoc are kept verbose. Apply phase MUST keep type definitions tight (no `readonly` everywhere, minimal JSDoc) and inline small transforms where possible. If actual PR diff still exceeds 400 at verify, the fallback is to split TASK-002 into 2 commits (core algorithm + transforms) — but per user lock, NO chained PRs within E1a.

---

## 10. Out of Scope (deferred, document for future)

- **5 remaining domains** (escuela, deportes, locacion, caja, gastos) — Slice E1b
- **Admin API endpoint** `POST /api/v1/promote/trigger` — Slice E2
- **Migration 0012** (`promoted_at` column on `raw_events`) — Slice E2
- **Async trigger** via `@athlos/scheduler` — Slice E2
- **`docs/runbook.md`** "Promotion" section — Slice E2
- **Canonical spec sync for E1b + E2 scope** — those slices
- **Dry-run mode** (`{dryRun: true}` flag) — Slice E2 if needed
- **Promotion rollback** (manual SQL DELETE) — future
- **Web UI for promotion status** — not planned
- **pg_advisory_lock** for concurrent-promotion prevention — future
- **Per-socio bulk promotion** (subset re-promotion) — future
- **CONTABLE / CONTABL1 / CATASTROS** (no master tables yet) — future
- **CONNROASIE bridge table** (handled by `validateBridges` in `@athlos/import`) — N/A

---

## 11. Open Questions

**NONE.** All 5 user-locked decisions confirmed:

| # | Decision | Locked value |
|---|----------|--------------|
| 1 | Sub-slice shape | **3 stacked PRs** (E1a + E1b + E2), each <400 LoC |
| 2 | Audit trail | `promoted_at TIMESTAMPTZ NULL` column on `raw_events` — **migration deferred to E2**; E1a uses no audit column (re-runs rely on UNIQUE constraints + `ON CONFLICT DO NOTHING`) |
| 3 | Transactions | **Per-domain isolation** — failure in escuela does NOT block deportes; each domain's INSERT is its own transaction |
| 4 | Trigger | **Sync HTTP `POST /api/v1/promote/trigger`** — deferred to E2; E1a ships CLI only |
| 5 | Dry-run | **NO dry-run flag for E1a** (full promotion only); can be added in E2 if needed |

---

## 12. Ready for spec?

**Yes** — pending the **partial spec sync** approach confirmation (B1b LESSON #1 applied incrementally). The E1a spec delta is scoped to ONLY the 3 priority domains + the data-layer algorithm. E1b will add scenarios for the remaining 5 domains. E2 will add scenarios for the admin endpoint + migration + docs. Each slice's `diff` is empty against canonical at the time of its merge.

**B1b LESSONs embedded in apply prompt (CRITICAL):**

1. **LESSON #1 (HIGHEST):** Apply MUST run `diff openspec/specs/deployment-devops/spec.md openspec/changes/.../specs/deployment-devops/spec.md` atomically. **E1a's spec sync is PARTIAL** — it adds ONLY a new "Promotion Pipeline" requirement with 3-domain scenarios. E1b and E2 will extend it in their slices. Verify checklist includes the diff assertion.
2. **LESSON #2:** Version bump + CHANGELOG MUST be in a SEPARATE closing release commit (`chore(release): v0.5.1`). Commit shape: HEAD~3 = RED, HEAD~2 = GREEN+REFACTOR, HEAD~1 = spec sync, HEAD = release. (4 commits, not 3, because TDD chain is preserved.)
3. **LESSON #3:** If verify catches a critical issue pre-merge, apply fix + cherry-pick reorder to preserve the 4-commit shape.
4. **LESSON #4:** ALWAYS merge feature branch to main BEFORE `git branch -D feat/slice-e1a-promotion-data-layer`; if lost, recover via `git branch recovery <sha>` from reflog.

---

*Persisted to:*
- *`openspec/changes/athlos-promote-projection-to-master-e1a/proposal.md`*
- *Engram topic `sdd/athlos-promote-projection-to-master-e1a/proposal`*