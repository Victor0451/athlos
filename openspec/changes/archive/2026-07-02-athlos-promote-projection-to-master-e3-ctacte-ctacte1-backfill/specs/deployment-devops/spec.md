# Delta for deployment-devops

## Header

| Field | Value |
|-------|-------|
| **Change** | `athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill` |
| **Date** | 2026-06-25 |
| **Phase** | Spec |
| **Mode** | Both (Engram + OpenSpec) |
| **Status** | Draft — ready for design |
| **File path** | `openspec/changes/athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill/specs/deployment-devops/spec.md` |
| **Modified capability** | `deployment-devops` (1 NEW ADDITIVE requirement + 4 NEW scenarios + 1 NEW success criterion — B1b LESSON #1 atomic sync, additive-only) |
| **Source artifacts** | `openspec/changes/explore-athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill/exploration.md` (~875 lines, id 2568) · `openspec/changes/athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill/proposal.md` (~597 lines, id 2571) · sub-agent corrections engram obs #2567 |
| **Sister changes (DONE)** | `e1a` (v0.5.1, commit `bc6aa60`) · `e1b1` (v0.5.2/v0.5.3, commit `4a29571`) · `e1b2a` (v0.5.4, commit `b8d8e43`) · `e1b2b` (v0.5.5, commit `36ac630`, FINAL atomic sync in `e753528`) · **`e2` (v0.5.6, commit `6f98b5c`, FINAL Slice E sync)** |
| **Sister slice (THIS — first post-Slice E slice)** | **`athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill` (v0.5.7) — closes N14 limitation via `raw_events.legacy_id` column + pgcrypto backfill + promote.ts raw_events-direct path for ctacte/ctacte1** |
| **Target release** | v0.5.6 → **v0.5.7** (PATCH — additive: 1 NEW column `raw_events.legacy_id`, 1 NEW partial UNIQUE INDEX, 1 NEW SQL function `promotion_deterministic_uuid()`, 1 NEW raw_events-direct path for ctacte/ctacte1, 1 NEW `verify-slice.sh` Step 7; no breaking changes) |
| **B1b LESSONs embedded** | #1 (HIGHEST) atomic sync — 1 NEW requirement + 4 NEW scenarios + 1 NEW success criterion (#52) APPENDED; NO modifications to existing Promotion Pipeline (E1b2b lines 167-276) or Per-row Promotion Audit (E2 lines 675-714) or Admin Promotion Trigger + Runbook Documentation (E2 lines 622-740) · #2 separate release commit (`chore(release): v0.5.7`) · #3 cherry-pick reorder · #4 merge-before-delete |
| **E1b/E1b2a/E1b2b/E2 LESSONs embedded** | `bash scripts/verify-slice.sh` is the REAL gate (commit `061be50` extended to 8 master tables; E3 adds NEW Step 7 for ctacte/ctacte1 promotion rate ≥88%) · migration via `psql` NOT `drizzle-kit migrate` (E1b1 LESSON re: `_journal.json` tracking mismatch) · existing `promote.test.ts` stays `describe.skip` (E1b2a TRUNCATE bug fix) · apply sub-agent MUST save `apply-progress` to engram via `mem_save` (E2 UNFIXED LESSON — orchestrator saves manually otherwise) |

> **E3 IS THE FIRST POST-SLICE E SLICE.** Slice E (data-promotion pipeline) was declared feature-complete at v0.5.6 (commit `6f98b5c`, 2026-06-25). E3 closes the **N14 limitation** documented in E2's `docs/runbook.md` Known Limitations table (line 421) + canonical `openspec/specs/deployment-devops/spec.md` Per-row Promotion Audit scenario (line 694). Future slices (async scheduler, analytics, multi-region) are separate work and OUT OF SCOPE for this delta.

> **ADDITIVE-ONLY ATOMIC SPEC SYNC (B1b LESSON #1, CRITICAL).** This delta adds 1 NEW requirement (`Raw Events Legacy ID Backfill`) at the END of `openspec/specs/deployment-devops/spec.md`. The existing **Promotion Pipeline** requirement (canonical lines 167-276), the **`tesoreria.gastos` master table** requirement (lines 280-315), the **E2 Admin Promotion Trigger** requirement (lines 622-672), the **E2 Per-row Promotion Audit** requirement (lines 675-714), and the **E2 Runbook Documentation** requirement (lines 717-740) all remain UNCHANGED. The `diff` between this delta and the canonical spec SHALL be purely additive (no removals, no rewrites of prior scenarios).

> **5 LOCKED DECISIONS (user-confirmed 2026-06-25 — embedded in proposal §3).** Backfill strategy = pgcrypto SHA-256 (Q1). Promote path = raw_events-direct for ctacte/ctacte1 (Q2). Hash parity verification = REQUIRED before applying migration 0018 (Q3 — CRITICAL GATE). pgcrypto permission = pre-check + clear error surface (Q4). Success criterion = ≥88% ctacte1 promotion rate (Q5 — NOT 100%).

---

## Context

**State post-E2 (v0.5.6, commit `6f98b5c`, 2026-06-25).** All 8 master domains populate via `pnpm db:promote`. `raw_events.promoted_at` column + index shipped (migration 0016) with `socios`-only backfill (~16,383 rows). Admin API `POST /api/v1/promote/trigger` + `GET /api/v1/promote/status` live. `docs/runbook.md` has "Promotion Pipeline" section with N14 listed as a Known Limitation. `scripts/verify-slice.sh` (commit `061be50`) exits 0 against the live DB (`192.168.1.102:5432/athlos`) — verified 2026-06-25T15:06:09Z.

| Master table | Projection rows | Master rows | Promotion rate | Status |
|--------------|----------------:|------------:|---------------:|--------|
| `socios.socios` | 39,357 | 16,383 | 41.6% | partial (pre-E1a orphans) |
| `tesoreria.ctacte` | 326,275 | **197,521 (60.5%)** | ⚠️ **N14 — partial** |  |
| `tesoreria.ctacte1` | 245,370 | **150,129 (61.2%)** | ⚠️ **N14 — partial** |  |
| `socios.escuela` | 66 | 61 | 92.4% | ✅ |
| `deportes.disciplinas` | 32 | 32 | 100% | ✅ |
| `socios.locacion` | 89 | 91 | 102.2% | ✅ (re-promote adds 2) |
| `tesoreria.caja_movimiento` | 8,145 | 8,149 | 100.0% | ✅ (re-promote adds 4) |
| `tesoreria.gastos` | 2,114 | 2,114 | 100% | ✅ |

**What's LEFT for E3 (this delta).** The **N14 limitation** (documented in E2's runbook "Known Limitations" section + canonical spec Per-row Promotion Audit scenario line 694 as "TODO E3+") persists for ctacte/ctacte1. E2's design (`exploration §4.2`, engram obs #2550) explicitly deferred ctacte/ctacte1 backfill to E3+ because `raw_events` did NOT have a `legacy_id` column at E2 design time. **E3 closes N14.**

**3 corrections from explore (verified live 2026-06-25, engram obs #2567, 2568).** These corrections were applied during the explore phase and are embedded in this spec delta — they MUST be reflected in the runbook + canonical spec:

1. **N14 is a 3-LAYER problem** (not just a `legacy_id` backfill):
   - **(L1) ctacte/ctacte1 projection tables are EMPTY** (verified live: 0 rows in both `public."tesoreria.ctacte_projection"` and `tesoreria.ctacte_projection`). The current `promote.ts` projection scan returns 0 rows for these domains regardless of `promoted_at` filter.
   - **(L2) `raw_events.source_key` is degenerate** for ctacte/ctacte1 (325,641 distinct of 326,275 ctacte rows; **1 distinct of 245,370 ctacte1 rows** — literally all `source_key='1'`). The E2 JOIN `(re.source_table = $domain AND re.source_key = pe.source_key AND re.promoted_at IS NULL)` is effectively a cross-join for ctacte/ctacte1; only `promoted_at IS NULL` is meaningful.
   - **(L3) `legacy_id` column missing** on `raw_events` — required for source-level dedup at the natural-key layer.

2. **`raw_events.source_key` is degenerate for ctacte/ctacte1** (correction L2). E2's JOIN through `(source_table, source_key)` is essentially a cross-join for these 2 domains. E3's raw_events-direct path filters by `legacy_id IS NOT NULL AND promoted_at IS NULL` — the `legacy_id` column is the new dedup key.

3. **Realistic success criterion is ≥88% ctacte1 promotion rate** (NOT 100%). 34,834 ctacte rows have `CCTCUENTA=0` sentinel (permanently FK-blocked — no matching `socios.socios` row); ~20,152 ctacte1 rows are FK-blocked by parent ctacte; 70,187 ctacte + 75,089 ctacte1 raw_events are "shadow rows" (same 5-tuple, different `id`/`source_key`) caught by `legacy_id UNIQUE INDEX`. Target is `count(*) FROM tesoreria.ctacte1 / count(*) FROM raw_events WHERE source_table = 'ctacte1'` ≥ 0.88. >95% would require re-importing missing socios into master (out of scope for E3, deferred to E3+).

**Why E3 ships as a focused slice.** The N14 closure requires 1 NEW column (`raw_events.legacy_id`) + 1 NEW partial UNIQUE INDEX + 1 NEW SQL function (`promotion_deterministic_uuid`) + 1 NEW algorithm path (raw_events-direct for ctacte/ctacte1 only; other 6 domains UNCHANGED) + 1 NEW verify-slice assertion. ~280 raw LoC / ~180 effective — well under the 400-line review budget at effective count (~45%). Single PR recommended (no chained PRs).

---

## Capability: `deployment-devops` (modified — additive only)

This delta APPENDS 1 NEW requirement (`Raw Events Legacy ID Backfill`) at the end of the canonical spec. The diff SHALL be purely additive (no removals, no modifications to existing requirements at canonical lines 167-276 / 280-315 / 622-672 / 675-714 / 717-740).

---

## ADDED Requirements

### Requirement: Raw Events Legacy ID Backfill (NEW in E3)

The system SHALL provide a `raw_events.legacy_id text` column as a per-row source-level dedup key for the `ctacte` and `ctacte1` domains. The column SHALL be added via a new hand-written migration `packages/db/drizzle/0017_raw_events_legacy_id.sql` applied via `psql` (NOT `drizzle-kit migrate` — per E1b1 LESSON re: `_journal.json` tracking mismatch). The migration SHALL also create a partial UNIQUE INDEX `raw_events_legacy_id_unique` on `(legacy_id) WHERE legacy_id IS NOT NULL` (partial because ~50% of raw_events rows are not ctacte/ctacte1 and don't get a `legacy_id`), and SHALL create a SQL function `promotion_deterministic_uuid(text)` declared `LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE` that mirrors `packages/promotion/src/transform-helpers.ts:19-26` (`deterministicUuid()`) byte-for-byte (SHA-256 + version=5 nibble + variant=10 bits + UUID formatting).

A second hand-written migration `packages/db/drizzle/0018_raw_events_legacy_id_backfill.sql` SHALL backfill `legacy_id` for all ctacte rows via `promotion_deterministic_uuid(coalesce(payload->>'CCTCUENTA','') || '|' || payload->>'CCTFECHA' || '|' || payload->>'CCTNROCOMP' || '|' || payload->>'CCTMES' || '|' || payload->>'CCTTALONAR')` and for all ctacte1 rows via the 5-tuple `(CCTPAGONRO, CCTPAGOSEC, CCTPAGOTAL, CCTPAGOFAM, CCTCUENTA)`. Both migrations SHALL be idempotent (`ADD COLUMN IF NOT EXISTS` + `CREATE UNIQUE INDEX IF NOT EXISTS` + `CREATE EXTENSION IF NOT EXISTS` + `WHERE legacy_id IS NULL` on backfill UPDATEs).

The promotion algorithm (`packages/promotion/src/promote.ts`) SHALL, for the `ctacte` and `ctacte1` domains ONLY, query `SELECT id, source_key, payload, legacy_id FROM public.raw_events WHERE source_table = $domain AND legacy_id IS NOT NULL AND promoted_at IS NULL` (bypassing the empty `*_projection` tables per correction L1) and SHALL bulk-update `raw_events SET promoted_at = now() WHERE id = ANY($insertedRawEventIds::uuid[])` after `insertMasterBatch` completes (per-row precise update via `raw_events.id` UUID PK, replacing the degenerate `source_key = ANY(...)` UPDATE per correction L2). The other 6 domains (`socios`, `escuela`, `deportes`, `locacion`, `caja`, `gastos`) SHALL continue using the existing projection-scan path UNCHANGED.

The dedup helper (`packages/promotion/src/dedup.ts`) `loadExistingNaturalKeys` SHALL, for ctacte and ctacte1, return the UNION of `master.legacy_id` and `raw_events.legacy_id` (the source-level dedup catches rows whose `legacy_id` was backfilled but not yet promoted; belt-and-suspenders with E2's `promoted_at` cross-check at lines 131-148).

The Drizzle schema (`packages/db/src/schema/public.ts`) SHALL add `legacyId: text('legacy_id')` to the `rawEvents` table definition (after `promotedAt` at line 211) and `legacyIdIdx: uniqueIndex('raw_events_legacy_id_unique').on(table.legacyId).where(sql\`${table.legacyId} IS NOT NULL\`)` to the `rawEvents` indexes (after `promotedAtIdx` at line 225).

The verification script (`scripts/verify-slice.sh`) SHALL add a NEW Step 7 that asserts (a) `raw_events.legacy_id IS NOT NULL` covers ≥99.9% of ctacte + ctacte1 rows, and (b) `count(*) FROM tesoreria.ctacte1 / count(*) FROM raw_events WHERE source_table = 'ctacte1'` ≥ 0.88 (the locked success criterion Q5). Step 7 SHALL exit 1 (FAIL) if either assertion fails.

#### Scenario: Migration 0017 adds `legacy_id` column + UNIQUE INDEX + SQL function (idempotent)

- GIVEN the test DB `192.168.1.102:5432/athlos` is running and `public.raw_events` has 652,661 rows WITHOUT a `legacy_id` column
- WHEN `PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -f packages/db/drizzle/0017_raw_events_legacy_id.sql` is executed
- THEN the migration SHALL `CREATE EXTENSION IF NOT EXISTS pgcrypto` (one-time install; pre-checked via `SELECT * FROM pg_available_extensions WHERE name = 'pgcrypto'` — error surfaced to operator if permission denied per locked decision Q4)
- AND SHALL `CREATE OR REPLACE FUNCTION promotion_deterministic_uuid(text) RETURNS text LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE` that mirrors `transform-helpers.ts:19-26` byte-for-byte
- AND SHALL `ALTER TABLE public.raw_events ADD COLUMN IF NOT EXISTS legacy_id text`
- AND SHALL `CREATE UNIQUE INDEX IF NOT EXISTS raw_events_legacy_id_unique ON public.raw_events (legacy_id) WHERE legacy_id IS NOT NULL`
- AND running the same SQL twice SHALL be a no-op (`IF NOT EXISTS` guards)
- AND `\d public.raw_events` SHALL show the `legacy_id text` column + `raw_events_legacy_id_unique` partial UNIQUE INDEX
- AND `_journal.json` SHALL have a NEW idx-17 entry with tag `0017_raw_events_legacy_id` (next sequential after E2's idx 16)

#### Scenario: Hash parity test passes BEFORE applying migration 0018 (CRITICAL GATE)

- GIVEN migration 0017 has been applied and `promotion_deterministic_uuid()` exists in the test DB
- WHEN `pnpm --filter @athlos/promotion test:run uuid-parity` executes `packages/promotion/src/__tests__/uuid-parity.test.ts`
- THEN the test SHALL run 5 known inputs through BOTH TypeScript `deterministicUuid()` AND PostgreSQL `promotion_deterministic_uuid(input)` and assert byte-for-byte equality:
  - `'0|2016-10-24|9895|9|1'` (ctacte: 0-CCTCUENTA sentinel edge case)
  - `'5343|2015-04-07|86846|4|1'` (ctacte: real socio carnet)
  - `'179440|4|1|1|5343'` (ctacte1: pagonro|pagosec|pagotal|pagofam|cuenta)
  - `'0|0|0|0|0'` (all-zero edge case)
  - `'999999|2099-12-31|999999999|12|9'` (future date + max values)
- AND the test SHALL pass for ALL 5 inputs (outputs byte-for-byte equal)
- AND if ANY mismatch is detected, the test SHALL FAIL with a clear error identifying the diverging input + the two outputs (so the SQL function can be regenerated until parity matches)
- AND migration 0018 SHALL NOT be applied until this test passes (TDD-RED-first discipline — test is committed BEFORE 0018 + apply-phase `verify-slice.sh` will fail if `legacy_id` is populated with wrong values)

#### Scenario: Migration 0018 backfills `legacy_id` for ctacte + ctacte1 to 100% coverage

- GIVEN hash parity test has passed AND migration 0017 is applied
- WHEN `PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -f packages/db/drizzle/0018_raw_events_legacy_id_backfill.sql` is executed
- THEN the migration SHALL run in a single transaction with `SET LOCAL statement_timeout = '120s'` (E2 LESSON re: backfill timeout)
- AND SHALL execute one `UPDATE public.raw_events re SET legacy_id = promotion_deterministic_uuid(coalesce(re.payload->>'CCTCUENTA','') || '|' || coalesce(re.payload->>'CCTFECHA','') || '|' || coalesce(re.payload->>'CCTNROCOMP','') || '|' || coalesce(re.payload->>'CCTMES','') || '|' || coalesce(re.payload->>'CCTTALONAR','')) WHERE re.source_table = 'ctacte' AND re.legacy_id IS NULL`
- AND SHALL execute one equivalent UPDATE for `source_table = 'ctacte1'` with the ctacte1 5-tuple `(CCTPAGONRO, CCTPAGOSEC, CCTPAGOTAL, CCTPAGOFAM, CCTCUENTA)`
- AND `count(*) FROM public.raw_events WHERE source_table = 'ctacte' AND legacy_id IS NOT NULL` SHALL return 326,275 (100% backfilled)
- AND `count(*) FROM public.raw_events WHERE source_table = 'ctacte1' AND legacy_id IS NOT NULL` SHALL return 245,370 (100% backfilled)
- AND running the same SQL twice SHALL be a no-op (the `WHERE legacy_id IS NULL` clause preserves already-backfilled rows)
- AND `_journal.json` SHALL have a NEW idx-18 entry with tag `0018_raw_events_legacy_id_backfill` (next sequential after idx 17)

#### Scenario: `promote.ts` reads ctacte/ctacte1 DIRECTLY from `raw_events` (NEW path)

- GIVEN ctacte/ctacte1 projection tables are EMPTY (correction L1) AND `raw_events.legacy_id` is populated for ctacte + ctacte1 (post-migration 0018)
- WHEN `promoteDomain(db, 'ctacte')` runs (or `'ctacte1'`)
- THEN the algorithm SHALL query `SELECT id, source_key, payload, legacy_id FROM public.raw_events WHERE source_table = $domain AND legacy_id IS NOT NULL AND promoted_at IS NULL` (NOT `*_projection`)
- AND the per-domain result SHALL show `{domain: $domain, attempted: >0, inserted: >0, skipped: ..., failed: ..., errors: [...]}` (the new path reads real rows instead of 0 from empty projection)
- AND after successful INSERT into `tesoreria.ctacte` (or `tesoreria.ctacte1`), the algorithm SHALL execute `UPDATE public.raw_events SET promoted_at = now() WHERE id = ANY($insertedRawEventIds::uuid[])` (precise per-row update via UUID PK, replacing the degenerate `source_key = ANY(...)` UPDATE per correction L2)
- AND the other 6 domains (`socios`, `escuela`, `deportes`, `locacion`, `caja`, `gastos`) SHALL continue reading from their `*_projection` tables UNCHANGED
- AND cross-run idempotency SHALL be preserved: a 2nd `pnpm db:promote` run inserts 0 new ctacte/ctacte1 rows because the `promoted_at IS NULL` filter + `legacy_id` dedup pre-check + `legacy_id` UNIQUE INDEX catch everything

#### Scenario: ctacte1 promotion rate reaches ≥88% after E3 (success criterion Q5)

- GIVEN E3 ships and migration 0018 has populated `legacy_id` for all 245,370 ctacte1 raw_events rows
- WHEN `bash scripts/verify-slice.sh` runs Step 7 (NEW in E3)
- THEN `count(*) FROM public.raw_events WHERE source_table = 'ctacte1' AND legacy_id IS NOT NULL` SHALL be ≥245,370 (≥99.9% coverage assertion)
- AND `count(*) FROM tesoreria.ctacte1 / count(*) FROM public.raw_events WHERE source_table = 'ctacte1'` SHALL be ≥0.88 (the locked success criterion Q5 — accounts for ~34,834 ctacte + ~20,152 ctacte1 FK-blocked rows + ~75,089 ctacte1 shadow rows caught by `legacy_id` UNIQUE INDEX)
- AND `count(*) FROM public.raw_events WHERE source_table = 'ctacte1' AND promoted_at IS NOT NULL` SHALL be ≥215,000 (the post-promotion audit count matching the master count)
- AND `bash scripts/verify-slice.sh` SHALL exit 0 (PASS) with all 6 steps + new Step 7 assertions passing

#### Scenario: docs/runbook.md removes N14 from Known Limitations

- GIVEN E3 ships with ctacte1 promotion rate ≥88%
- WHEN an operator reads `docs/runbook.md` "Promotion Pipeline" → "Known Limitations" sub-section
- THEN the N14 row SHALL be updated from `~107k ctacte1 orphan rows stuck at ~61% promotion rate` to `**RESOLVED in v0.5.7 (E3)** — ctacte/ctacte1 backfill via raw_events.legacy_id + pgcrypto backfill + promote.ts raw_events-direct path. New ctacte1 promotion rate ≥88% (FK failures account for ~12%)`
- AND a NEW sub-section "E3 N14 Closure — ctacte/ctacte1 raw_events-direct path" SHALL be added under "Per-row Promotion Audit" explaining the 3-layer N14 problem (empty projections + degenerate source_key + missing legacy_id) with cross-references to migrations 0017 + 0018 + the hash parity test
- AND the other 3 limitations (N7 caja_detalle, N8 deportes.inscripciones, N16 gastos FK) SHALL remain UNCHANGED as deferred

---

## Success Criteria (1 NEW for E3 scope — additive only)

52. **E3 NEW**: `count(*) FROM public.raw_events WHERE source_table IN ('ctacte', 'ctacte1') AND legacy_id IS NOT NULL` returns ≥571,645 (~100% of 326,275 + 245,370 rows) post-migration 0018 (idempotent backfill). `count(*) FROM tesoreria.ctacte1 / count(*) FROM public.raw_events WHERE source_table = 'ctacte1'` ≥ **0.88** (88% ctacte1 promotion rate, modulo FK failures + shadow rows caught by `legacy_id` UNIQUE INDEX). `bash scripts/verify-slice.sh` exits 0 (PASS) with NEW Step 7 assertions passing. Hash parity test (`uuid-parity.test.ts` — 5 known inputs through TypeScript `deterministicUuid()` AND PostgreSQL `promotion_deterministic_uuid()`) returns byte-for-byte equality BEFORE migration 0018 is applied.

> Existing canonical criteria #1-30 (post-Slice D), #47-48 (post-E1b2b), and #49-51 (post-E2) remain UNCHANGED. E3 adds criterion #52 above. The `diff` verification against `openspec/specs/deployment-devops/spec.md` SHALL be additive-only with no removals, no modifications to the existing Promotion Pipeline requirement (canonical lines 167-276), and no modifications to the existing E2 Per-row Promotion Audit / Admin Promotion Trigger / Runbook Documentation requirements (canonical lines 622-740).

---

## Scope Boundary

### In scope for E3 (this delta ships)

| Item | Description |
|------|-------------|
| `packages/db/drizzle/0017_raw_events_legacy_id.sql` | NEW migration (~30 LoC, hand-written SQL) — `CREATE EXTENSION pgcrypto` + `CREATE OR REPLACE FUNCTION promotion_deterministic_uuid(text)` + `ALTER TABLE public.raw_events ADD COLUMN IF NOT EXISTS legacy_id text` + `CREATE UNIQUE INDEX IF NOT EXISTS raw_events_legacy_id_unique` partial WHERE clause |
| `packages/db/drizzle/0018_raw_events_legacy_id_backfill.sql` | NEW migration (~55 LoC, hand-written SQL) — single transaction with `SET LOCAL statement_timeout = '120s'` + 2 UPDATEs (ctacte 5-tuple + ctacte1 5-tuple, both `WHERE legacy_id IS NULL`) |
| `packages/db/drizzle/meta/_journal.json` | MODIFY (+12 LoC) — idx 17 + idx 18 entries (next sequential after E2's idx 16) |
| `packages/db/src/schema/public.ts` | MODIFY (+8 LoC) — add `legacyId: text('legacy_id')` to `rawEvents` table definition + `legacyIdIdx` partial UNIQUE INDEX on `(legacyId) WHERE legacyId IS NOT NULL` |
| `packages/promotion/src/promote.ts` | MODIFY (+60 LoC) — NEW `if (domain === 'ctacte' || domain === 'ctacte1')` branch BEFORE the existing projection scan (lines 90-101); new branch reads DIRECTLY from `raw_events` with `WHERE source_table = $domain AND legacy_id IS NOT NULL AND promoted_at IS NULL`; track inserted `raw_events.id` per row; bulk UPDATE `WHERE id = ANY($insertedRawEventIds::uuid[])` replaces the degenerate `WHERE source_key = ANY(...)`. Other 6 domains UNCHANGED |
| `packages/promotion/src/dedup.ts` | MODIFY (+25 LoC) — `loadExistingNaturalKeys` for ctacte/ctacte1 returns UNION of `master.legacy_id` + new `raw_events.legacy_id` source-level dedup query (alongside E2's `raw_events.promoted_at` cross-check at lines 131-148) |
| `packages/promotion/src/__tests__/uuid-parity.test.ts` | NEW (~30 LoC, TDD-RED-first) — 5 known inputs run through TypeScript `deterministicUuid()` AND PostgreSQL `promotion_deterministic_uuid()` (via direct DB call using `@athlos/db` connection); byte-for-byte equality asserted for ALL 5 inputs |
| `scripts/verify-slice.sh` | MODIFY (+30 LoC) — NEW Step 7 after Step 6 (idempotency check): asserts (a) `legacy_id IS NOT NULL` covers ≥99.9% of ctacte + ctacte1 rows, (b) `ctacte1 promotion rate ≥88%`. Step 7 SHALL exit 1 if either assertion fails |
| `docs/runbook.md` | MODIFY (+20 LoC) — update N14 Known Limitations row to "RESOLVED in v0.5.7 (E3)" + add new "E3 N14 Closure — ctacte/ctacte1 raw_events-direct path" sub-section under "Per-row Promotion Audit" explaining the 3-layer N14 problem with cross-references to migrations 0017 + 0018 + hash parity test |
| `openspec/specs/deployment-devops/spec.md` | MODIFY (+~150 LoC) — APPEND 1 NEW requirement "Raw Events Legacy ID Backfill" with 4 NEW scenarios + 1 NEW success criterion (#52). Existing Promotion Pipeline (lines 167-276), tesoreria.gastos (lines 280-315), E2 Admin Promotion Trigger (lines 622-672), E2 Per-row Promotion Audit (lines 675-714), E2 Runbook Documentation (lines 717-740) UNCHANGED |
| `CHANGELOG.md` | MODIFY (+5 LoC) — v0.5.7 entry (closes N14, ctacte/ctacte1 promotion rate ≥88%, raw_events.legacy_id + pgcrypto backfill) |
| Root + 18 `packages/*/package.json` | MODIFY (+1 each) — bump 0.5.6 → 0.5.7 in SEPARATE release commit (B1b LESSON #2) |
| **Total raw LoC** | **~280 raw / ~180 effective** — well under the 400-line review budget at both counts |

### Deferred to E3+ (out of scope for this delta)

| Item | Reason | Future slice |
|------|--------|--------------|
| **E3+ async scheduler** | Manual `pnpm db:promote` + `POST /api/v1/promote/trigger` work for v1 | E3+ scheduler slice |
| **E3+ analytics** | Cross-table aggregations (ctacte1 saldo per socio, etc.) — different spec | E3+ analytics slice |
| **E3+ multi-region** | Multi-region deploys with per-region promotion — single env per Slice C ADR | E3+ infra slice |
| **N7**: `caja_detalle` (122 wide columns per header) | Header-only in v1; deferred per E1b2a scope | N7 (future) |
| **N8**: `deportes.inscripciones` rebuild | No `*_inscripciones_projection` table yet | N8 (future) |
| **N16**: `gastos` FK to `ctacte` via `cctcuenta` lookup | Flat ledger in v1; FK reconstruction deferred per E1b2b scope correction #C7 | N16 (future) |
| Rebuilding ctacte/ctacte1 projection tables | E3 reads `raw_events` directly because projection is empty (correction L1); rebuilding is unnecessary work for v1 — E3 does NOT touch projection tables | NEVER (for v1) |
| Re-importing missing socios into master (would unlock >95% ctacte1 rate) | 22,974 pre-E1a orphan rows without `legacy_id`; different problem (legacy data quality, not pipeline). E3 only addresses ctacte/ctacte1 | E3+ deferred |
| `pg_advisory_lock` for multi-process concurrent-promotion prevention | E2's in-memory `promotionInFlight` flag is sufficient for v1 single-process API | E3+ |
| Dry-run mode (`POST /promote/trigger?dryRun=true`) | CLI `--dry` flag is the future home | E3+ |
| OpenAPI / Swagger spec generation | No OpenAPI in repo | E3+ |

---

## Out of Scope (re-stated for clarity)

- **No NEW master tables** in E3. All 8 master tables exist from E1a/E1b1/E1b2a/E1b2b; E3 does NOT touch them.
- **No NEW FK constraints** in E3. E3 only adds the `legacy_id` column to `raw_events` and updates the promote algorithm — no schema changes to `tesoreria.ctacte` or `tesoreria.ctacte1`.
- **No modification to the existing Promotion Pipeline requirement** at canonical lines 167-276 (the E1b2b FINAL sync shipped it as-is; E3 does NOT touch the 8-domain PROMOTION_ORDER or any of the per-domain scenarios).
- **No modification to the existing `tesoreria.gastos` master table requirement** at canonical lines 280-315.
- **No modification to the existing E2 Per-row Promotion Audit requirement** at canonical lines 675-714. E3 does NOT touch `promoted_at` semantics — the E2 `promoted_at IS NULL` filter is preserved as the secondary cross-check; E3 ADDS the `legacy_id IS NOT NULL` filter as the primary dedup for ctacte/ctacte1.
- **No modification to the existing E2 Admin Promotion Trigger requirement** at canonical lines 622-672 (the endpoint + rate limit + audit row contract are unchanged).
- **No modification to the existing E2 Runbook Documentation requirement** at canonical lines 717-740 — E3 only UPDATES the N14 row + ADDS a new "E3 N14 Closure" sub-section (additive to the runbook, not a rewrite of the E2 structure).
- **No `pnpm typecheck` / `pnpm lint` regressions** — all existing 484+ vitest cases must remain green (existing `promote.test.ts` stays `describe.skip` per E1b2a LESSON re: TRUNCATE bug; new `uuid-parity.test.ts` is a NEW pure-function test that does NOT touch the DB destructively).
- **No chained PRs within E3** (per session preflight `delivery_strategy: ask-always` + `review_budget_lines: 400`). E3 alone is one PR (~280 raw LoC / ~180 effective — well under the 400-line budget at both counts, no split recommended).

---

## Acceptance Criteria (delta-specific, pre-apply checklist)

These are the E3 delta's acceptance criteria; the full set lives in `proposal.md` §9. Restated here for spec-phase completeness:

- [ ] Migration `0017_raw_events_legacy_id.sql` adds `raw_events.legacy_id` column + `promotion_deterministic_uuid()` SQL function + partial UNIQUE INDEX (idempotent via `IF NOT EXISTS` guards)
- [ ] Migration `0018_raw_events_legacy_id_backfill.sql` backfills `legacy_id` for ctacte + ctacte1 to 100% coverage (idempotent via `WHERE legacy_id IS NULL`)
- [ ] Both migrations applied via `psql` (NOT `drizzle-kit migrate` per E1b1 LESSON); manual `_journal.json` entries with idx 17 + idx 18 (next sequential after E2's idx 16)
- [ ] **Hash parity test PASSES** (CRITICAL GATE) — `uuid-parity.test.ts` runs 5 known inputs through BOTH TypeScript `deterministicUuid()` AND PostgreSQL `promotion_deterministic_uuid()`; byte-for-byte equality asserted for ALL 5 inputs BEFORE migration 0018 is applied
- [ ] `promoteDomain('ctacte')` reads DIRECTLY from `raw_events` (verified by inspecting test DB before/after — `attempted > 0` for ctacte + ctacte1, NOT 0 from empty projection)
- [ ] `promoteDomain('ctacte1')` reads DIRECTLY from `raw_events` (same verification)
- [ ] `dedup.ts` `loadExistingNaturalKeys` for ctacte/ctacte1 reads `raw_events.legacy_id` (additive to existing master.legacy_id + E2's promoted_at checks)
- [ ] After E3 + smoke test: ctacte1 promotion rate ≥88% (verified by `bash scripts/verify-slice.sh` Step 7)
- [ ] Cross-run idempotency: 2nd `pnpm db:promote` run inserts 0 new ctacte + ctacte1 rows (verified by Step 5 idempotency check + Step 7 promotion rate assertion)
- [ ] `bash scripts/verify-slice.sh` exits 0 (PASS — all 7 steps including NEW Step 7 assertions pass; E1b/E1b2a/E1b2b/E2 LESSON non-negotiable)
- [ ] `docs/runbook.md` "Known Limitations" N14 row updated to "RESOLVED in v0.5.7 (E3)" + NEW "E3 N14 Closure" sub-section added under "Per-row Promotion Audit"
- [ ] Other 3 limitations (N7 caja_detalle, N8 deportes.inscripciones, N16 gastos FK) remain UNCHANGED
- [ ] Canonical spec adds 1 NEW requirement ADDITIVE-only — `diff openspec/specs/deployment-devops/spec.md openspec/changes/.../specs/deployment-devops/spec.md` returns ONLY additive changes (no removals, no modifications to existing Promotion Pipeline requirement at canonical lines 167-276, no modifications to E2 Per-row Promotion Audit at lines 675-714)
- [ ] pgcrypto extension pre-check: apply phase runs `SELECT * FROM pg_available_extensions WHERE name = 'pgcrypto'` BEFORE migration 0017; clear error surfaced to operator if permission denied (locked decision Q4)
- [ ] No `Co-Authored-By` or AI attribution in any commit message (Conventional Commits only)
- [ ] 3-commit shape preserved per B1b LESSON #2: `feat(promotion+db): raw_events.legacy_id backfill for ctacte/ctacte1 (closes N14)` → `docs(spec+runbook): atomic sync — N14 RESOLVED + ctacte/ctacte1 backfill requirement` → `chore(release): v0.5.7`
- [ ] Merge to `main` BEFORE `git branch -D spec/athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill` (B1b LESSON #4)
- [ ] Apply sub-agent saves `mem_save` to engram with topic_key `sdd/athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill/apply-progress` (E2 UNFIXED LESSON — explicit in apply prompt; orchestrator verifies the save exists before declaring apply complete)

---

## Open Questions (RESOLVED + LOCKED 2026-06-25)

All open questions for E3 scope are RESOLVED + LOCKED:

| # | Question | Resolution | Source |
|---|----------|------------|--------|
| **Q1** | Backfill strategy | **pgcrypto SHA-256 via `promotion_deterministic_uuid()` SQL function** (Option 1 from exploration §5) | E3 explore Q1 default + user-confirmed 2026-06-25 |
| **Q2** | Promote path for ctacte/ctacte1 | **Read DIRECTLY from `raw_events`** (Option A from exploration §5) — bypasses empty projection tables | E3 explore Q2 default + user-confirmed 2026-06-25 |
| **Q3** | Hash parity verification | **Run 5 known inputs through BOTH TypeScript AND PostgreSQL during apply; assert byte-for-byte equality** (CRITICAL GATE — migration 0018 REJECTED if parity fails) | E3 explore Q3 default + user-confirmed 2026-06-25 |
| **Q4** | pgcrypto install permission | **Pre-check before migration 0017 via `SELECT * FROM pg_available_extensions WHERE name = 'pgcrypto'`; surface clear error if `CREATE EXTENSION` fails** | E3 explore Q4 default + user-confirmed 2026-06-25 |
| **Q5** | Success criterion | **≥88% ctacte1 promotion rate** (NOT 100% — accounts for ~34,834 ctacte FK-blocked + ~20,152 ctacte1 FK-blocked + ~75,089 ctacte1 shadow rows) | E3 explore Q5 default + user-confirmed 2026-06-25 |

**All 5 decisions LOCKED. E3 scope is fully bounded — no further open questions.**

---

## Ready for design?

**YES.** The scope is precisely bounded:

- 1 NEW column (`raw_events.legacy_id`) + 1 NEW SQL function (`promotion_deterministic_uuid`) + 1 NEW partial UNIQUE INDEX + 1 NEW algorithm path (raw_events-direct for ctacte/ctacte1 only) + 1 NEW `verify-slice.sh` Step 7 + 1 NEW runbook sub-section + 1 NEW canonical-spec requirement
- ~280 raw LoC / ~180 effective — well under the 400-line review budget at both counts (~70% at raw, ~45% at effective; no chained PRs needed)
- All 5 user-confirmed decisions embedded explicitly (Q1 backfill strategy, Q2 raw_events-direct path, Q3 hash parity GATE, Q4 pgcrypto pre-check, Q5 ≥88% success criterion)
- All 3 explore corrections embedded explicitly (N14 = 3-layer problem, `raw_events.source_key` degenerate for ctacte/ctacte1, ~88% realistic NOT 100%)
- All E1b/E1b2a/E1b2b/E2 LESSONs applied: `bash scripts/verify-slice.sh` is HARD GATE (E1b/E1b2a/E1b2b/E2 non-negotiable); migration via `psql` (E1b1); existing `promote.test.ts` stays `describe.skip` (E1b2a TRUNCATE bug); new `uuid-parity.test.ts` is a pure-function test (no destructive setup); apply sub-agent MUST save `apply-progress` to engram (E2 UNFIXED LESSON)
- All B1b LESSONs applied: atomic canonical sync (additive only, B1b LESSON #1 HIGHEST); separate release commit (B1b LESSON #2); cherry-pick reorder (B1b LESSON #3); merge-before-delete (B1b LESSON #4)
- E3 is the FIRST post-Slice E slice (others deferred: async scheduler, analytics, multi-region) — no further sub-slices planned immediately after E3

**Next step:** sdd-design → write `design.md` mirroring E2's design format (~200-300 lines, focused on the 3 corrections + hash parity gate + raw_events-direct algorithm + verify-slice Step 7 + runbook sub-section structure + canonical sync diff strategy). Then sdd-tasks → break into 12 implementation tasks (TASK-001..TASK-012 per `proposal.md` §5). Then sdd-apply → wire raw_events.legacy_id + pgcrypto backfill + raw_events-direct algorithm with strict TDD discipline + **`bash scripts/verify-slice.sh`** (E1b/E1b2a/E1b2b/E2 LESSON — non-negotiable) + hash parity test as CRITICAL GATE. Then sdd-archive → sync this spec delta into `openspec/specs/deployment-devops/spec.md` to close N14 permanently.

**Apply-phase CRITICAL reminders (all in acceptance criteria above):**

1. **Hash parity test is the CRITICAL GATE** (locked decision Q3). The test MUST run BEFORE migration 0018 is applied. If ANY of the 5 known inputs diverges between TypeScript `deterministicUuid()` and PostgreSQL `promotion_deterministic_uuid()`, migration 0018 MUST NOT be applied — the SQL function in 0017 is regenerated until parity matches. The function output is the dedup key for ~571k rows; a mismatch silently corrupts cross-run idempotency.
2. **`bash scripts/verify-slice.sh` is the REAL pre-merge gate** — NOT the unit tests (existing `promote.test.ts` stays `describe.skip` per E1b2a LESSON re: TRUNCATE bug fix). Step 7 assertions (legacy_id coverage + ctacte1 rate ≥88%) MUST pass before declaring ready. **No merge until `verify-slice.sh` exits 0 (PASS).**
3. **Migration via `psql`** (NOT `drizzle-kit migrate`) — E1b1 LESSON re: `_journal.json` tracking mismatch. Manual idx-17 + idx-18 `_journal.json` entries.
4. **pgcrypto pre-check** at apply time: `SELECT * FROM pg_available_extensions WHERE name = 'pgcrypto'` BEFORE running 0017. If extension is NOT available OR `CREATE EXTENSION` returns `ERROR: permission denied`, apply phase surfaces this to orchestrator immediately and aborts. Fallback deferred to E3+ (Option 2 TypeScript backfill script — slower but doesn't require pgcrypto).
5. **3-commit shape preserved** per B1b LESSON: `feat` → `docs(spec+runbook)` → `chore(release)`. No `Co-Authored-By` in any commit. Merge to `main` BEFORE `git branch -D` (B1b LESSON #4).
6. **Additive-only atomic sync** (B1b LESSON #1, HIGHEST) — apply MUST verify `diff openspec/specs/deployment-devops/spec.md openspec/changes/.../specs/deployment-devops/spec.md` returns ONLY additive changes. No removals, no rewrites of prior Slice E scenarios. The existing Promotion Pipeline requirement (canonical lines 167-276), `tesoreria.gastos` requirement (lines 280-315), E2 Admin Promotion Trigger (lines 622-672), E2 Per-row Promotion Audit (lines 675-714), and E2 Runbook Documentation (lines 717-740) SHALL remain UNCHANGED.
7. **Apply sub-agent saves `mem_save` to engram** (E2 UNFIXED LESSON) — apply prompt EXPLICITLY mandates `mem_save(title: 'sdd/.../apply-progress', topic_key: 'sdd/.../apply-progress', type: 'architecture', project: 'athlos', capture_prompt: false)` after each task. Orchestrator verifies the save exists before declaring apply complete. If missing, apply sub-agent is re-invoked with a save-only follow-up task.

---

*Persisted to:*
- *`openspec/changes/athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill/specs/deployment-devops/spec.md`*
- *Engram topic `sdd/athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill/spec` (via `mem_save`)*