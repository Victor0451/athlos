# Proposal: athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill

| Field | Value |
|-------|-------|
| **Change** | `athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill` |
| **Date** | 2026-06-25 |
| **Phase** | Propose |
| **Mode** | Both (Engram + OpenSpec) |
| **Status** | Draft — ready for spec |
| **Source of truth** | Sister `openspec/changes/explore-athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill/exploration.md` (~875L, verified live 2026-06-25) · sister E2 `openspec/changes/athlos-promote-projection-to-master-e2/proposal.md` (format reference) |
| **Sister changes (DONE)** | `e1a` v0.5.1 (commit `bc6aa60`) · `e1b1` v0.5.2/v0.5.3 (commit `4a29571`) · `e1b2a` v0.5.4 (commit `b8d8e43`) · `e1b2b` v0.5.5 (commit `36ac630`, FINAL atomic sync in `e753528`) · **`e2` v0.5.6 (commit `6f98b5c`, FINAL slice E)** |
| **Sister slice (THIS — first post-Slice E slice)** | **`athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill` (v0.5.7) — closes N14 limitation via `raw_events.legacy_id` column + pgcrypto backfill + promote.ts raw_events-direct path for ctacte/ctacte1.** E3 is the FIRST of multiple post-Slice E slices (others deferred: async scheduler, analytics, multi-region). |
| **Target release** | v0.5.6 → **v0.5.7** (PATCH — additive: 1 NEW column `raw_events.legacy_id`, 1 NEW partial UNIQUE INDEX, 1 NEW SQL function `promotion_deterministic_uuid()`, 1 NEW algorithm path for ctacte/ctacte1, 1 NEW verify-slice assertion; no breaking changes) |
| **Delivery** | single PR (~280 raw LoC / ~180 effective), no chained PRs within E3 |
| **B1b LESSONs embedded** | #1 atomic sync (additive-only — 1 NEW requirement + 4 NEW scenarios + 1 NEW success criterion APPENDED; no modifications to E1b2b Promotion Pipeline at lines 167-276 or E2 Per-row Promotion Audit at lines 675-714) · #2 separate release commit (`chore(release): v0.5.7`) · #3 cherry-pick reorder · #4 merge-before-delete |
| **E1b/E1b2a/E1b2b/E2 LESSONs embedded** | `bash scripts/verify-slice.sh` is the REAL gate (commit `061be50` extended to 8 master tables + E3 NEW Step 7 for legacy_id coverage); migration via `psql` NOT `drizzle-kit migrate` (E1b1 LESSON re: `_journal.json` tracking mismatch); existing `promote.test.ts` stays `describe.skip` (E1b2a TRUNCATE bug fix); E2 admin endpoint tests use mock container pattern (mirrors `import.test.ts`); E2 apply sub-agent MUST save `apply-progress` to engram (UNFIXED LESSON — orchestrator saves manually otherwise) |

> **E3 IS THE FIRST POST-SLICE E SLICE.** Slice E (data-promotion pipeline) was declared feature-complete at v0.5.6 (commit `6f98b5c`, 2026-06-25). E3 closes the **N14 limitation** documented as a deferred TODO in E2's `openspec/specs/deployment-devops/spec.md` line 117 + line 738. Future slices (async scheduler, analytics, multi-region) are separate work and out of scope.
>
> **3 LOCKED DECISIONS (user-confirmed 2026-06-25).**
>
> | # | Decision | Locked value |
> |---|----------|--------------|
> | Q1 | Backfill strategy | **pgcrypto SHA-256 via `promotion_deterministic_uuid()` SQL function** (matches TypeScript `deterministicUuid()` byte-for-byte; verified via hash parity test in apply phase) |
> | Q2 | Promote path for ctacte/ctacte1 | **Read DIRECTLY from `raw_events`** (bypasses empty projection tables; filter `WHERE legacy_id IS NOT NULL AND (legacy_id IS NULL OR promoted_at IS NULL)`) |
> | Q3 | Success criterion | **≥88% ctacte1 promotion rate** (NOT 100% — 34,834 ctacte FK-blocked by `CCTCUENTA=0` sentinel + ~20,152 ctacte1 FK-blocked by parent ctacte; these are data-quality issues, not pipeline issues) |
>
> **5 SUB-AGENT CORRECTIONS to orchestrator's premise** (engram obs #2567, 2568 — verified live 2026-06-25):
>
> | # | Orchestrator's premise | Sub-agent correction (verified live) |
> |---|------------------------|---------------------------------------|
> | C1 | N14 = missing legacy_id backfill only | N14 = **3-layer problem**: (1) ctacte/ctacte1 projection tables EMPTY; (2) `raw_events.source_key` degenerate (634 distinct for ctacte, 1 distinct for ctacte1); (3) `legacy_id` missing. E3 addresses ALL 3. |
> | C2 | E2's JOIN `pe.source_key = re.source_key` filters out already-promoted | For ctacte/ctacte1 the JOIN is **effectively a cross-join** (1 distinct source_key for ALL 245k ctacte1 rows); only `promoted_at IS NULL` filter is meaningful. E3 replaces with `raw_events.legacy_id` filter. |
> | C3 | 100% promotion rate is achievable | Realistic rate is **~88%** (modulo FK failures); 34,834 ctacte rows have `CCTCUENTA=0` sentinel (permanently FK-blocked) + ~20,152 ctacte1 rows blocked by parent FK. >95% would require re-importing missing socios. |
> | C4 | 5-tuple NK is unique at raw_events level | 5-tuple is **only 78.5% unique for ctacte (256,088 of 326,275)** and **69.4% unique for ctacte1 (170,281 of 245,370)**. Duplicates are "shadow rows" (same logical record, different `id`/`source_key`). UNIQUE INDEX on `legacy_id` catches them via `ON CONFLICT DO NOTHING`. |
> | C5 | Existing E2 promote.ts algorithm works for ctacte/ctacte1 | Algorithm reads `*_projection` tables, but for ctacte/ctacte1 **projection tables are EMPTY** (verified live: 0 rows). Promote path must read `raw_events` directly for these 2 domains. |

---

## 1. Context

**State post-E2 (v0.5.6, commit `6f98b5c`, 2026-06-25).** All 8 master domains populate via `pnpm db:promote`. Admin API (`POST /api/v1/promote/trigger`) + `promoted_at` audit column shipped. `scripts/verify-slice.sh` exits 0 against the live DB (`192.168.1.102:5432/athlos`). FINAL atomic sync applied — Slice E is closed.

| Master table | Projection rows | Master rows | Status |
|--------------|----------------:|------------:|--------|
| `socios.socios` | 39,357 | 16,383 | ✅ promoted (E1a) |
| `tesoreria.ctacte` | 326,275 | **197,521 (60.5%)** | ⚠️ N14 — partial (E1a) |
| `tesoreria.ctacte1` | 245,370 | **150,129 (61.2%)** | ⚠️ N14 — partial (E1b1) |
| `socios.escuela` | 66 | 61 | ✅ promoted (E1b2a) |
| `deportes.disciplinas` | 32 | 32 | ✅ full |
| `socios.locacion` | 89 | 91 | ✅ full |
| `tesoreria.caja_movimiento` | 8,145 | 8,149 | ✅ full |
| `tesoreria.gastos` | 2,114 | 2,114 | ✅ full (E1b2b) |

**The N14 limitation persists** (documented in `0013_legacy_id_unique.sql` comments as "The 129,872 missing ctacte rows are populated by the E1b1+ ctacte transform update + re-promotion (documented as N14 limitation)" and confirmed in E2's runbook "Known Limitations" section).

**Pipeline currently running end-to-end (but stuck for ctacte/ctacte1):**

```
legacy .DBF → import → raw_events (652,661 rows) → projection → 8 master tables
                (B-7c)                            (Slice C)     (Slice E1a..E2)
```

**The ctacte/ctacte1 gap is the N14 limitation.** E2's design (§4.2, engram obs #2550) explicitly deferred ctacte/ctacte1 backfill to E3+ because `raw_events` did NOT have a `legacy_id` column at E2 design time. E3 closes N14.

---

## 2. Goals / Non-Goals

### Goals

| ID | Goal | Acceptance |
|----|------|------------|
| **G1** | `raw_events.legacy_id text` column added (migration 0017) | `ALTER TABLE public.raw_events ADD COLUMN IF NOT EXISTS legacy_id text;` applied via `psql` (NOT drizzle-kit per E1b LESSON); Drizzle schema `packages/db/src/schema/public.ts` updated with `legacyId: text('legacy_id')`; `_journal.json` idx 17 entry |
| **G2** | Partial UNIQUE INDEX on `raw_events.legacy_id` | `CREATE UNIQUE INDEX IF NOT EXISTS raw_events_legacy_id_unique ON public.raw_events (legacy_id) WHERE legacy_id IS NOT NULL;` — partial because ~50% of `raw_events` rows are not ctacte/ctacte1 and don't get `legacy_id` |
| **G3** | pgcrypto extension installed (migration 0017) | `CREATE EXTENSION IF NOT EXISTS pgcrypto;` — one-time install, requires DB superuser privileges (E1b1 LESSON: pre-check before migration) |
| **G4** | `promotion_deterministic_uuid(text)` SQL function (migration 0017) | `LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE`; mirrors `packages/promotion/src/transform-helpers.ts:19-26` byte-for-byte (SHA-256 + version=5 nibble + variant=10 bits + UUID formatting) |
| **G5** | Backfill `raw_events.legacy_id` for ctacte rows (migration 0018) | `UPDATE raw_events SET legacy_id = promotion_deterministic_uuid(...) WHERE source_table = 'ctacte' AND legacy_id IS NULL`; 5-tuple = `(CCTCUENTA, CCTFECHA, CCTNROCOMP, CCTMES, CCTTALONAR)` (verified field names via `SELECT DISTINCT jsonb_object_keys(payload)` — 26 fields present) |
| **G6** | Backfill `raw_events.legacy_id` for ctacte1 rows (migration 0018) | `UPDATE raw_events SET legacy_id = promotion_deterministic_uuid(...) WHERE source_table = 'ctacte1' AND legacy_id IS NULL`; 5-tuple = `(CCTPAGONRO, CCTPAGOSEC, CCTPAGOTAL, CCTPAGOFAM, CCTCUENTA)` (verified 15 fields present) |
| **G7** | `promote.ts` reads ctacte/ctacte1 DIRECTLY from `raw_events` (bypass projection) | For these 2 domains, projection tables are EMPTY (verified live); new path queries `SELECT id, source_key, payload FROM raw_events WHERE source_table = $domain AND legacy_id IS NOT NULL AND (legacy_id IS NULL OR promoted_at IS NULL)` — filter covers both never-promoted + legacy_id-not-backfilled |
| **G8** | After successful INSERT, bulk UPDATE `raw_events SET promoted_at = now() WHERE id = ANY($insertedRawEventIds)` | Single UPDATE per domain; uses `id` (the raw_events UUID PK) for precise per-row update; replaces current `WHERE source_key = ANY($keys)` UPDATE which is broken for ctacte/ctacte1 (source_key is degenerate — see correction C2) |
| **G9** | `dedup.ts` `loadExistingNaturalKeys` for ctacte/ctacte1 reads `raw_events.legacy_id` | Cross-check between source-level and master-level dedup; reads `SELECT legacy_id FROM raw_events WHERE source_table = $domain AND legacy_id IS NOT NULL` and merges with `master.legacy_id` set |
| **G10** | Hash parity test (TDD-RED, CRITICAL GATE) | 5 known inputs run through BOTH TypeScript `deterministicUuid()` AND PostgreSQL `promotion_deterministic_uuid()`; byte-for-byte equality asserted. Any mismatch = silent re-inserts on cross-run → migration 0018 must NOT be applied |
| **G11** | `scripts/verify-slice.sh` NEW Step 7 | (a) `count(*) FROM raw_events WHERE source_table IN ('ctacte', 'ctacte1') AND legacy_id IS NOT NULL` = total ctacte + ctacte1 raw_events (100% backfilled); (b) `count(*) FROM tesoreria.ctacte` + `tesoreria.ctacte1` ≥88% of corresponding `raw_events` count (success criterion); (c) 2nd `pnpm db:promote` run inserts 0 new rows (TRUE idempotency preserved) |
| **G12** | `docs/runbook.md` "Known Limitations" N14 row updated to RESOLVED | N14 entry: "**RESOLVED in v0.5.7 (E3)** — ctacte/ctacte1 backfill via `raw_events.legacy_id`"; cross-reference to migration 0017 + 0018 |
| **G13** | Spec delta APPENDED to `openspec/specs/deployment-devops/spec.md` (B1b LESSON #1 — additive ONLY) | 1 NEW requirement "Raw Events Legacy ID Backfill" with 4 NEW scenarios (migration applies, backfill coverage, promote algorithm uses legacy_id, idempotency); 1 NEW success criterion (#52: ctacte1 promotion rate ≥88% after E3). Existing Promotion Pipeline (lines 167-276), E1b2b tesoreria.gastos (lines 280-315), E2 Admin Promotion Trigger + Per-row Audit + Runbook (lines 622-740) **UNCHANGED**. `diff` returns ONLY additive changes |
| **G14** | Apply sub-agent runs `bash scripts/verify-slice.sh` before declaring ready (E1b LESSON — non-negotiable) | Exit code 0; NEW Step 7 assertions pass; 2nd/3rd `pnpm db:promote` runs insert 0 new rows across all 8 master tables |
| **G15** | Migration applied via `psql` (NOT `drizzle-kit migrate` — E1b LESSON re: `_journal.json` tracking mismatch) | `PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -f packages/db/drizzle/0017_raw_events_legacy_id.sql`; same for 0018; manual `_journal.json` idx 17 + idx 18 entries (next sequential after E2's idx 16) |
| **G16** | Apply sub-agent saves `apply-progress` to engram via `mem_save` (E2 LESSON — UNFIXED; 3 consecutive apply sub-agents skipped this) | `mem_save(title: 'sdd/.../apply-progress', topic_key: 'sdd/.../apply-progress', type: 'architecture', project: 'athlos', capture_prompt: false, content: '...')` — EXPLICITLY instructed in apply prompt |
| **G17** | 3-commit shape (B1b LESSON #2 — separate release commit) | (1) `feat(promotion+db): raw_events.legacy_id backfill for ctacte/ctacte1 (closes N14)` (TDD-RED parity → TDD-GREEN migration 0017 → TDD-GREEN function → TDD-GREEN migration 0018 → TDD-GREEN schema → TDD-GREEN promote algorithm → TDD-GREEN dedup → TDD-REFACTOR); (2) `docs(spec+runbook): atomic sync — N14 RESOLVED + ctacte/ctacte1 backfill requirement`; (3) `chore(release): v0.5.7` |

### Non-Goals (deferred to E3-subsequent slices or NEVER)

| ID | Deferred to | Item |
|----|-------------|------|
| **N1** | E3 scheduler slice (separate change) | `scheduled-promotion` JobHandler via `@athlos/scheduler` — manual trigger works for v1 |
| **N2** | E3 analytics slice (separate change) | Cross-table aggregations (ctacte1 saldo per socio, etc.) — different spec; promotion is data-layer, not analytics |
| **N3** | E3 infra slice (separate change) | Multi-region deploys with per-region promotion — single env per Slice C ADR |
| **N4** | N7 (future) | Caja wide columns (CAJCONCEP1..20, CAJIMPOR1..20) — header-only sufficient for v1.0 |
| **N5** | N8 (future) | `deportes.inscripciones` rebuild — no `*_inscripciones_projection` table exists yet |
| **N6** | N16 (future) | `gastos` FK to `ctacte` via `cctcuenta` lookup — flat ledger in v1 |
| **N7** | NEVER (data quality issue) | 100% ctacte/ctacte1 promotion — 34,834 ctacte rows have `CCTCUENTA=0` sentinel (no socio); ~20,152 ctacte1 rows blocked by parent ctacte FK fail. Realistic target is ≥88% |
| **N8** | E3+ deferred | Re-importing missing socios into master (would unlock >95% rate) — different problem (pre-E1a manual entries without `legacy_id`); E3 only addresses ctacte/ctacte1 |
| **N9** | NEVER | Rebuilding ctacte/ctacte1 projection tables — E3 reads `raw_events` directly because projection is empty (correction C1); if projection is ever rebuilt in a future slice, promote.ts can be unified, but E3 doesn't need to touch it |
| **N10** | NEVER | Auto-promotion on import — user wants manual review per E1a design; auto ships post-MVP |
| **N11** | E3+ deferred | Async promotion via `@athlos/scheduler.runNow('scheduled-promotion')` — E2 sync HTTP is sufficient for v1 |
| **N12** | E3+ deferred | Dry-run mode (`POST /promote/trigger?dryRun=true`) — CLI `--dry` flag is future home |
| **N13** | E3+ deferred | OpenAPI / Swagger spec generation — no OpenAPI in repo |
| **N14** | **THIS slice resolves it** | Stale `entity_uuids` repopulation (the N14 limitation itself) — E3 closes N14; `entity_uuids` table is no longer critical for promotion |

---

## 3. Locked Decisions (user-confirmed 2026-06-25)

| # | Decision | Locked value | Rationale |
|---|----------|--------------|-----------|
| **Q1** | Backfill strategy | **pgcrypto SHA-256** via `promotion_deterministic_uuid()` SQL function (Option 1 from exploration §5) | Single migration (0017 + 0018) covers all rows regardless of master match; atomic (no manual script step); ~10-30s for 571k rows (vs ~2min for Option 2 TypeScript script); hash parity test mitigates drift risk between TypeScript and SQL implementations |
| **Q2** | Promote path for ctacte/ctacte1 | **Read DIRECTLY from `raw_events`** (Option A from exploration §5) | Projection tables are EMPTY for ctacte/ctacte1 (correction C1); rebuilding projection is unnecessary work because projection is just a copy of `raw_events` columns; raw_events-direct path is simpler and makes the algorithm easier to reason about |
| **Q3** | Hash parity verification | **Run 5 known inputs through BOTH TypeScript and PostgreSQL during apply; assert byte-for-byte equality** (RECOMMENDED DEFAULT) | Critical gate — any mismatch = silent re-inserts on cross-run because `master.legacy_id` (TypeScript-computed) wouldn't match `raw_events.legacy_id` (SQL-computed). Test runs BEFORE applying migration 0018; if parity fails, migration 0018 is NOT applied |
| **Q4** | pgcrypto install permission | **Pre-check before migration 0017; surface clear error if `CREATE EXTENSION` fails** (RECOMMENDED DEFAULT) | `CREATE EXTENSION pgcrypto` requires DB superuser privileges; if the `athlos` user lacks privileges, migration 0017 fails. Apply phase MUST pre-check via `SELECT * FROM pg_available_extensions WHERE name = 'pgcrypto'` and surface a clear error. Fallback deferred to E3+ (Option 2 TypeScript script — slower but doesn't require pgcrypto) |
| **Q5** | Success criterion | **≥88% ctacte1 promotion rate** (NOT 100%) | Realistic rate per correction C3: 34,834 ctacte FK-blocked + ~20,152 ctacte1 FK-blocked by parent ctacte = ~88% achievable. >95% would require re-importing missing socios into master (deferred to E3+ per N8) |
| **Q6** | Other 6 domains promotion path | **UNCHANGED — continue reading from projection tables** | Only ctacte/ctacte1 have the N14 problem (empty projection + degenerate source_key). For socios/escuela/deportes/locacion/caja/gastos, the existing projection-scan path works. E3 only adds a NEW branch for ctacte/ctacte1; doesn't touch the existing path |
| **Q7** | Drizzle schema update | **Add `legacyId` column + `legacyIdIdx` partial UNIQUE INDEX** | Mirrors existing pattern in `packages/db/src/schema/tesoreria.ts` for `ctacte.legacyId` + `ctacte_legacy_id_unique` UNIQUE INDEX |
| **Q8** | Bulk UPDATE on success | **UPDATE `WHERE id = ANY($insertedRawEventIds)`** (raw_events UUID PK) | More precise than `WHERE source_key = ANY($keys)` because `source_key` is degenerate for ctacte/ctacte1 (correction C2). Each raw_events row has a unique `id`, so the UPDATE marks exactly the rows that were promoted |
| **Q9** | Dedup strategy for ctacte/ctacte1 | **Union of `master.legacy_id` + `raw_events.legacy_id`** | Belt-and-suspenders: master.legacy_id catches rows already in master; raw_events.legacy_id catches rows whose `legacy_id` was backfilled but not yet promoted. E2 already added the `raw_events.promoted_at` cross-check — E3 ADDS the `raw_events.legacy_id` cross-check alongside |

> **Default recommendations locked.** The user explicitly confirmed all 9 decisions on 2026-06-25; no further exploration needed. The proposal reflects the locked values; the spec phase MUST use them verbatim.

---

## 4. Approach / Architecture

### 4.1 Migration `0017_raw_events_legacy_id.sql` (NEW, ~30 LoC)

**Pattern mirrors E2's `0016_promoted_at.sql`** + E1b2b's `0015_gastos.sql` + E1b2a's `0014_new_masters.sql`: hand-written SQL with `CREATE EXTENSION IF NOT EXISTS` + `CREATE OR REPLACE FUNCTION` + `ALTER TABLE IF NOT EXISTS` + `CREATE UNIQUE INDEX IF NOT EXISTS`. Applied via `psql` (NOT `drizzle-kit migrate` — E1b1 LESSON re: `_journal.json` tracking mismatch). Idempotent.

```sql
-- Migration 0017: Add raw_events.legacy_id column + promotion_deterministic_uuid() SQL function (E3 — N14 closure)
--
-- Purpose: per-row dedup key at the source-event level. Enables promote.ts to filter
-- ctacte/ctacte1 by legacy_id (the source_key is degenerate for these domains: 634 distinct
-- values for 326k ctacte rows, 1 distinct for 245k ctacte1 rows).
--
-- The partial UNIQUE INDEX (WHERE legacy_id IS NOT NULL) accommodates domains that don't have
-- a natural key (asiento, paramet, plancue, etc.).
--
-- pgcrypto is required for the backfill migration (0018). One-time install.
--
-- The promotion_deterministic_uuid() function mirrors packages/promotion/src/transform-helpers.ts
-- deterministicUuid() byte-for-byte: SHA-256 + version=5 nibble + variant=10 bits + UUID
-- formatting. Verified by hash parity test in apply phase (5 known inputs through TypeScript AND
-- PostgreSQL, byte-for-byte equality asserted BEFORE migration 0018 is applied).
--
-- Idempotent: re-running is a no-op.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "promotion_deterministic_uuid"(natural_key text)
  RETURNS text
  LANGUAGE plpgsql
  IMMUTABLE PARALLEL SAFE
AS $$
DECLARE
  hash bytea := digest(natural_key, 'sha256');
  hex_str text := encode(substring(hash, 1, 16), 'hex');
  byte6 int := get_byte(hash, 6);
  byte8 int := get_byte(hash, 8);
  version_byte int := (byte6 & 15) | 80;
  variant_byte int := (byte8 & 63) | 128;
  part3_hex text := lpad(to_hex(version_byte), 2, '0');
  part4_hex text := lpad(to_hex(variant_byte), 2, '0');
BEGIN
  RETURN substring(hex_str, 1, 8) || '-' ||
         substring(hex_str, 9, 4) || '-' ||
         substring(part3_hex, 1, 1) || substring(hex_str, 13, 3) || '-' ||
         substring(part4_hex, 1, 1) || substring(hex_str, 17, 3) || '-' ||
         substring(hex_str, 21, 12);
END;
$$;
--> statement-breakpoint

ALTER TABLE "public"."raw_events"
  ADD COLUMN IF NOT EXISTS "legacy_id" text;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "raw_events_legacy_id_unique"
  ON "public"."raw_events" ("legacy_id")
  WHERE "legacy_id" IS NOT NULL;
```

### 4.2 Migration `0018_raw_events_legacy_id_backfill.sql` (NEW, ~55 LoC)

Single transaction with `SET LOCAL statement_timeout = '120s'` (E2 LESSON re: backfill timeout). Two `UPDATE` statements (one per domain) — split to avoid a single-statement timeout if pgcrypto is slow.

```sql
-- Migration 0018: Backfill raw_events.legacy_id for ctacte + ctacte1 (E3 — N14 closure)
--
-- Computes the same hash that packages/promotion/src/transform-helpers.ts deterministicUuid()
-- produces (UUIDv5-like per RFC 4122 §4.3). Verified byte-for-byte by hash parity test in
-- apply phase BEFORE this migration runs.
--
-- Coverage:
--   ctacte:  326,275 rows → all backfilled (modulo ~0 with NULL fields; verified live 2026-06-25)
--   ctacte1: 245,370 rows → all backfilled (modulo ~0 with NULL fields; verified live 2026-06-25)
--
-- Best-effort: rows where ANY 5-tuple field is NULL get NULL legacy_id. Verified 0 such rows
-- exist for ctacte/ctacte1.
--
-- Idempotent: WHERE legacy_id IS NULL makes re-running a no-op.

BEGIN;
SET LOCAL statement_timeout = '120s';

-- Backfill ctacte (5-tuple: cuenta|fecha|nrocomp|mes|talonar)
UPDATE "public"."raw_events" re
SET "legacy_id" = "promotion_deterministic_uuid"(
  coalesce(re.payload->>'CCTCUENTA', '') || '|' ||
  coalesce(re.payload->>'CCTFECHA', '') || '|' ||
  coalesce(re.payload->>'CCTNROCOMP', '') || '|' ||
  coalesce(re.payload->>'CCTMES', '') || '|' ||
  coalesce(re.payload->>'CCTTALONAR', '')
)
WHERE re.source_table = 'ctacte' AND re.legacy_id IS NULL;
--> statement-breakpoint

-- Backfill ctacte1 (5-tuple: pagonro|pagosec|pagotal|pagofam|cuenta)
UPDATE "public"."raw_events" re
SET "legacy_id" = "promotion_deterministic_uuid"(
  coalesce(re.payload->>'CCTPAGONRO', '') || '|' ||
  coalesce(re.payload->>'CCTPAGOSEC', '') || '|' ||
  coalesce(re.payload->>'CCTPAGOTAL', '') || '|' ||
  coalesce(re.payload->>'CCTPAGOFAM', '') || '|' ||
  coalesce(re.payload->>'CCTCUENTA', '')
)
WHERE re.source_table = 'ctacte1' AND re.legacy_id IS NULL;

COMMIT;
```

### 4.3 Drizzle schema update (`packages/db/src/schema/public.ts`, +8 LoC)

```typescript
// In rawEvents table definition (after promotedAt column):
legacyId: text('legacy_id'),  // E3: source-level dedup key; partial UNIQUE INDEX in migration 0017

// In rawEvents indexes (after promotedAtIdx):
legacyIdIdx: uniqueIndex('raw_events_legacy_id_unique').on(table.legacyId)
  .where(sql`${table.legacyId} IS NOT NULL`),
```

### 4.4 `promote.ts` algorithm update (`packages/promotion/src/promote.ts`, +60 LoC)

For ctacte/ctacte1, **bypass the projection table** and read from `raw_events` directly. For other 6 domains (socios, escuela, deportes, locacion, caja, gastos), keep the existing projection-scan path UNCHANGED.

```typescript
// In promoteDomain(), REPLACE lines 85-101 (projection scan) for ctacte/ctacte1 ONLY:
if (domain === 'ctacte' || domain === 'ctacte1') {
  // E3: read from raw_events directly (projection tables are EMPTY for these domains).
  // Filter by legacy_id IS NOT NULL (excludes domains without natural key).
  // The legacy_id is the dedup key (replaces degenerate source_key JOIN).
  const rawRows =
    (
      await db.execute<{ id: string; source_key: string; payload: Record<string, unknown> }>(
        `SELECT id, source_key, payload
         FROM public.raw_events
         WHERE source_table = '${domain}'
           AND legacy_id IS NOT NULL
           AND (legacy_id IS NULL OR promoted_at IS NULL)`,  // -- covers both never-promoted + legacy_id-not-backfilled
      )
    ).rows ?? []
  result.attempted = rawRows.length
  // ... rest of the loop, but track raw_events.id per row ...
  
  // Replace the bulk UPDATE at lines 155-162 with:
  if (insertedRawEventIds.length > 0) {
    await db.execute(sql`
      UPDATE public.raw_events
      SET promoted_at = now()
      WHERE id = ANY(${insertedRawEventIds}::uuid[])
    `)
  }
}
```

### 4.5 `dedup.ts` update (`packages/promotion/src/dedup.ts`, +25 LoC)

For ctacte/ctacte1, ADD a `raw_events.legacy_id` cross-check (alongside the existing `master.legacy_id` + E2's `raw_events.promoted_at` checks):

```typescript
// In loadExistingNaturalKeys for ctacte (extend existing implementation):
if (domain === 'ctacte') {
  // E1b1 layer: existing legacy_ids from master (primary dedup)
  const masterRows = await db.select({ legacyId: ctacte.legacyId })
    .from(ctacte).where(isNotNull(ctacte.legacyId))
  const masterIds = new Set(
    masterRows.map((r) => r.legacyId).filter((id): id is string => id !== null),
  )

  // E3 layer (NEW): raw_events.legacy_id (source-level dedup, more accurate
  // for re-imports because it covers duplicates that haven't been promoted yet)
  const rawRows = (await db.execute(
    sql`SELECT legacy_id FROM public.raw_events
        WHERE source_table = 'ctacte' AND legacy_id IS NOT NULL`,
  )) as unknown as { rows: { legacy_id: string }[] }
  const rawIds = new Set(
    rawRows.rows.map((r) => r.legacy_id).filter((id): id is string => id !== null),
  )

  // Union: a row is "existing" if EITHER layer says so
  return new Set<string>([...masterIds, ...rawIds])
}
// Similar for ctacte1
```

### 4.6 Hash parity test (`packages/promotion/src/__tests__/uuid-parity.test.ts`, NEW, ~30 LoC)

**TDD-RED FIRST** — this test is committed BEFORE migrations 0017/0018 are applied. The test runs the SAME 5 inputs through:
- TypeScript: `deterministicUuid(input)` (from `packages/promotion/src/transform-helpers.ts`)
- PostgreSQL: `SELECT promotion_deterministic_uuid(input)` (via `psql -t -A -c`, NO DB function call yet — function MUST exist in DB)

Asserts byte-for-byte equality. If parity fails, migration 0018 is NOT applied — the function in 0017 is regenerated until parity matches, OR the algorithm is reverted.

```typescript
// 5 known inputs spanning edge cases (all CC, all-0 sentinel, future date, etc.)
const inputs = [
  '0|2016-10-24|9895|9|1',                     // ctacte: 0-CCTCUENTA sentinel
  '5343|2015-04-07|86846|4|1',                 // ctacte: real socio
  '179440|4|1|1|5343',                         // ctacte1: pagonro|pagosec|pagotal|pagofam|cuenta
  '0|0|0|0|0',                                 // all-zero edge case
  '999999|2099-12-31|999999999|12|9',          // future date + max values
]

// For each input, run through both TypeScript and PostgreSQL, assert equality
// (PostgreSQL output fetched via psql command in test setup or via @athlos/db connection)
```

### 4.7 `scripts/verify-slice.sh` updates (+30 LoC)

Add NEW Step 7 after the existing per-master-table count check:

```bash
# Step 7 (NEW, E3): Verify raw_events.legacy_id + ctacte/ctacte1 promotion rate (N14 closure)
hr
echo "Step 7: Verify N14 closure (E3 — ctacte/ctacte1 raw_events.legacy_id backfill)"
hr

LEGACY_BACKFILL_TOTAL=$(PGPASSWORD=athlos psql "$DB_URL" -t -A -c \
  "SELECT count(*) FROM public.raw_events WHERE source_table IN ('ctacte', 'ctacte1') AND legacy_id IS NOT NULL;" 2>/dev/null || echo 0)
LEGACY_TOTAL=$(PGPASSWORD=athlos psql "$DB_URL" -t -A -c \
  "SELECT count(*) FROM public.raw_events WHERE source_table IN ('ctacte', 'ctacte1');" 2>/dev/null || echo 0)
LEGACY_PCT=0
if [ "$LEGACY_TOTAL" -gt 0 ]; then
  LEGACY_PCT=$(awk "BEGIN { printf \"%.1f\", ($LEGACY_BACKFILL_TOTAL / $LEGACY_TOTAL) * 100 }")
fi
printf '  %-35s %8s / %-8s (%s%%)\n' "raw_events.legacy_id (ctacte+ctacte1)" "$LEGACY_BACKFILL_TOTAL" "$LEGACY_TOTAL" "$LEGACY_PCT"

# Assert: legacy_id backfill should cover 100% of ctacte + ctacte1 rows
LEGACY_OK=$(awk "BEGIN { print ($LEGACY_PCT >= 99.9) ? \"1\" : \"0\" }")
if [ "$LEGACY_OK" = "0" ]; then
  echo "FAIL: raw_events.legacy_id backfill coverage < 99.9% ($LEGACY_PCT%)" >&2
  exit 1
fi

# Assert: ctacte1 promotion rate ≥ 88% (success criterion G11)
CTACTE1_MASTER=$(count_rows "tesoreria.ctacte1")
CTACTE1_RAW=$(PGPASSWORD=athlos psql "$DB_URL" -t -A -c \
  "SELECT count(*) FROM public.raw_events WHERE source_table = 'ctacte1';" 2>/dev/null || echo 0)
CTACTE1_PCT=0
if [ "$CTACTE1_RAW" -gt 0 ]; then
  CTACTE1_PCT=$(awk "BEGIN { printf \"%.1f\", ($CTACTE1_MASTER / $CTACTE1_RAW) * 100 }")
fi
printf '  %-35s %8s / %-8s (%s%%)\n' "ctacte1 promotion rate" "$CTACTE1_MASTER" "$CTACTE1_RAW" "$CTACTE1_PCT"

CTACTE1_OK=$(awk "BEGIN { print ($CTACTE1_PCT >= 88.0) ? \"1\" : \"0\" }")
if [ "$CTACTE1_OK" = "0" ]; then
  echo "FAIL: ctacte1 promotion rate < 88% ($CTACTE1_PCT%) — N14 closure incomplete" >&2
  exit 1
fi
```

### 4.8 `docs/runbook.md` update (+20 LoC)

Update "Known Limitations" section (added by E2):

```diff
- **N14** | Stale `entity_uuids` → ctacte1 promotion rate stuck at ~61% | **RESOLVED in v0.5.7 (E3)** — `raw_events.legacy_id` column + pgcrypto backfill + promote.ts raw_events-direct path. Migration 0017 (column + UNIQUE INDEX + SQL function) + Migration 0018 (backfill) + ctacte/ctacte1 now read from raw_events directly. New ctacte1 promotion rate ≥88% (FK failures account for ~12%)
+ **N14** | Stale `entity_uuids` → ctacte1 promotion rate stuck at ~61% | **RESOLVED in v0.5.7 (E3)** — `raw_events.legacy_id` column + pgcrypto backfill + promote.ts raw_events-direct path. Migration 0017 (column + UNIQUE INDEX + SQL function) + Migration 0018 (backfill) + ctacte/ctacte1 now read from raw_events directly. New ctacte1 promotion rate ≥88% (FK failures account for ~12%)
```

Add new sub-section "E3 N14 Closure" under "Per-row Promotion Audit":

```markdown
### E3 N14 Closure — ctacte/ctacte1 raw_events-direct path

After E3, ctacte/ctacte1 promotion reads DIRECTLY from `raw_events` (NOT from projection tables).
This was necessary because:

1. **Projection tables were EMPTY** for ctacte/ctacte1 (verified live 2026-06-25 — 0 rows in `public."tesoreria.ctacte_projection"` and `public."tesoreria.ctacte1_projection"`).
2. **`raw_events.source_key` is degenerate** for ctacte (634 distinct values for 326k rows) and ctacte1 (1 distinct value for all 245k rows). The E2 JOIN through `(source_table, source_key)` was effectively a cross-join for these domains.

The new path uses `raw_events.legacy_id` (computed via `promotion_deterministic_uuid()` SQL function = SHA-256 + UUIDv5-like formatting) as the dedup key. Backfilled in migration 0018 to 100% coverage (verified live).

**Hash parity is CRITICAL.** TypeScript `deterministicUuid()` and PostgreSQL `promotion_deterministic_uuid()` MUST produce byte-for-byte identical output. Hash parity test in `packages/promotion/src/__tests__/uuid-parity.test.ts` runs BEFORE migration 0018 is applied.
```

### 4.9 Spec delta (`openspec/specs/deployment-devops/spec.md`, +~30 LoC, ADDITIVE ONLY)

B1b LESSON #1: APPEND 1 NEW requirement + 4 NEW scenarios + 1 NEW success criterion. Existing Promotion Pipeline (lines 167-276), E1b2b tesoreria.gastos (lines 280-315), E2 Admin Promotion Trigger + Per-row Audit + Runbook (lines 622-740) **UNCHANGED**.

```markdown
### Requirement: Raw Events Legacy ID Backfill (NEW in E3)

The system SHALL provide a `raw_events.legacy_id text` column for source-level dedup, populated via pgcrypto SHA-256 hashing of the 5-tuple natural key (matching TypeScript `deterministicUuid()` byte-for-byte). The promote algorithm SHALL read ctacte/ctacte1 directly from `raw_events` (bypassing empty projection tables) and filter by `legacy_id IS NOT NULL AND promoted_at IS NULL`.

#### Scenario: Migration 0017 + 0018 apply cleanly via psql
- GIVEN the test DB is running and `raw_events` has 652,661 rows with `legacy_id` column NOT present
- WHEN `PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -f packages/db/drizzle/0017_raw_events_legacy_id.sql` is executed
- AND then `0018_raw_events_legacy_id_backfill.sql` is executed
- THEN the column `legacy_id text` SHALL be added to `public.raw_events`
- AND the partial UNIQUE INDEX `raw_events_legacy_id_unique` SHALL be created
- AND the SQL function `promotion_deterministic_uuid(text)` SHALL be created
- AND `count(*) FROM public.raw_events WHERE source_table IN ('ctacte', 'ctacte1') AND legacy_id IS NOT NULL` SHALL equal 571,645 (100% backfilled)

#### Scenario: Hash parity test passes before applying migration 0018
- GIVEN migration 0017 has been applied and `promotion_deterministic_uuid()` exists in DB
- WHEN `pnpm --filter @athlos/promotion test:run` runs `uuid-parity.test.ts`
- THEN 5 known inputs run through BOTH TypeScript `deterministicUuid()` AND PostgreSQL `promotion_deterministic_uuid()` SHALL produce byte-for-byte identical output
- AND any mismatch SHALL cause migration 0018 to be REJECTED (function must be regenerated until parity matches)

#### Scenario: promote.ts reads ctacte/ctacte1 directly from raw_events
- GIVEN ctacte/ctacte1 projection tables are EMPTY (verified live)
- WHEN `pnpm db:promote` runs the ctacte domain
- THEN `promoteDomain` SHALL query `SELECT id, source_key, payload FROM public.raw_events WHERE source_table = 'ctacte' AND legacy_id IS NOT NULL AND promoted_at IS NULL`
- AND NOT query from `public."tesoreria.ctacte_projection"`
- AND the per-domain output SHALL show `{domain: 'ctacte', attempted: >0, inserted: >0, ...}`

#### Scenario: ctacte/ctacte1 2nd promotion run inserts 0 new rows
- GIVEN `pnpm db:promote` has been run once after E3 and ctacte/ctacte1 master are populated
- WHEN `pnpm db:promote` is run a 2nd time
- THEN both `ctacte` and `ctacte1` SHALL show `inserted: 0, skipped: <attempted>` (TRUE idempotency)
- AND `bash scripts/verify-slice.sh` SHALL exit 0 (PASS)
```

Add to Success Criteria:

```markdown
52. **E3 NEW**: `count(*) FROM public.raw_events WHERE source_table IN ('ctacte', 'ctacte1') AND legacy_id IS NOT NULL` returns **571,645** (100% backfilled) post-migration 0018. `count(*) FROM tesoreria.ctacte1 / count(*) FROM raw_events WHERE source_table = 'ctacte1'` ≥ **0.88** (88% promotion rate, modulo FK failures). `bash scripts/verify-slice.sh` exits 0 (PASS) with NEW Step 7 assertions passing.
```

---

## 5. Work-units (10 tasks, 3 commits)

### Commit 1: `feat(promotion+db): raw_events.legacy_id backfill for ctacte/ctacte1 (closes N14)`

| # | Task | Files | LoC |
|---|------|-------|----:|
| 1 | **TASK-001** [TDD-RED] Write hash parity test in `packages/promotion/src/__tests__/uuid-parity.test.ts` — 5 known inputs, runs TypeScript `deterministicUuid()` AND PostgreSQL `promotion_deterministic_uuid()` (via psql in test setup OR via direct @athlos/db connection), asserts byte-for-byte equality. Test committed BEFORE migrations are applied. | NEW ~30L | +30 |
| 2 | **TASK-002** [TDD-GREEN migration 0017] Hand-write `0017_raw_events_legacy_id.sql` (CREATE EXTENSION pgcrypto + CREATE OR REPLACE FUNCTION `promotion_deterministic_uuid()` + ALTER TABLE raw_events ADD COLUMN legacy_id + partial UNIQUE INDEX); apply via `psql`; update `_journal.json` idx 17 | NEW ~30L + journal | +30 |
| 3 | **TASK-003** [TDD-GREEN migration 0018] Hand-write `0018_raw_events_legacy_id_backfill.sql` (2 UPDATEs, single transaction, statement_timeout 120s); apply via `psql` AFTER hash parity test passes (TASK-001); update `_journal.json` idx 18 | NEW ~55L + journal | +55 |
| 4 | **TASK-004** [TDD-GREEN schema] Update `packages/db/src/schema/public.ts` with `legacyId: text('legacy_id')` column + `legacyIdIdx` partial UNIQUE INDEX on `rawEvents` | MODIFIED +8L | +8 |
| 5 | **TASK-005** [TDD-GREEN promote.ts] Update `packages/promotion/src/promote.ts` — add new `if (domain === 'ctacte' || domain === 'ctacte1')` branch BEFORE the existing projection scan (lines 85-101); new branch reads directly from `raw_events` with `WHERE source_table = $domain AND legacy_id IS NOT NULL AND promoted_at IS NULL`; track inserted raw_events.ids; bulk UPDATE `WHERE id = ANY($insertedRawEventIds)` instead of `WHERE source_key = ANY(...)`. Other 6 domains UNCHANGED. | MODIFIED +60L | +60 |
| 6 | **TASK-006** [TDD-GREEN dedup.ts] Update `packages/promotion/src/dedup.ts` `loadExistingNaturalKeys` for ctacte/ctacte1 — ADD a new branch that reads `raw_events.legacy_id` and MERGES with existing `master.legacy_id` + E2's `raw_events.promoted_at` checks. Other 6 domains UNCHANGED. | MODIFIED +25L | +25 |
| 7 | **TASK-007** [TDD-REFACTOR] Tighten helpers; verify hash byte-for-byte parity between TypeScript `deterministicUuid()` and PostgreSQL `promotion_deterministic_uuid()` in CI; ensure no `any` types | (no files) | 0 |
| 8 | **TASK-008** [Pre-closing verification — CRITICAL E1b/E1b2a/E1b2b/E2 LESSON] Run `bash scripts/verify-slice.sh` (REAL gate) — script now includes NEW Step 7 (legacy_id coverage + ctacte1 rate ≥88% assertions). Exit 0 = TRUE idempotency across all 8 master tables + E3 N14 closure verified. | (verification, no files) | 0 |

### Commit 2: `docs(spec+runbook): atomic sync — N14 RESOLVED + ctacte/ctacte1 backfill requirement`

| # | Task | Files | LoC |
|---|------|-------|----:|
| 9 | **TASK-009** [Runbook update] Update `docs/runbook.md` "Known Limitations" section — change N14 row to "RESOLVED in v0.5.7 (E3)"; add new sub-section "E3 N14 Closure — ctacte/ctacte1 raw_events-direct path" with explanation + cross-reference to migrations 0017 + 0018 + hash parity test | MODIFIED +20L | +20 |
| 10 | **TASK-010** [Spec delta APPENDED — B1b LESSON #1, FULL additive only] Append 1 NEW requirement "Raw Events Legacy ID Backfill" with 4 NEW scenarios + 1 NEW success criterion (#52) to `openspec/specs/deployment-devops/spec.md`. Existing Promotion Pipeline (lines 167-276), E1b2b tesoreria.gastos (lines 280-315), E2 Admin Promotion Trigger + Per-row Audit + Runbook (lines 622-740) **UNCHANGED**. `diff` returns ONLY additive changes | MODIFIED +~30L | +30 |

### Commit 3: `chore(release): v0.5.7`

| # | Task | Files | LoC |
|---|------|-------|----:|
| 11 | **TASK-011** [Pre-merge fix slot — B1b LESSON #3] Cherry-pick reorder if verify catches critical issue | (varies) | 0 |
| 12 | **TASK-012** [Closing release commit — B1b LESSON #2] Bump root + 18 `packages/*/package.json` from `0.5.6` → `0.5.7`; `CHANGELOG.md` v0.5.7 entry (closes N14, ~88% ctacte1 promotion rate) | 19 package.json + CHANGELOG | +20 |

**Total raw LoC:** ~280 (well under 400-line review budget).
**Total effective LoC:** ~180.

---

## 6. File-by-file changes (estimated)

| File | Action | Est. lines | Notes |
|------|--------|-----------:|-------|
| `packages/db/drizzle/0017_raw_events_legacy_id.sql` | CREATE | ~30 | Hand-written SQL: CREATE EXTENSION + CREATE FUNCTION + ALTER TABLE + partial UNIQUE INDEX |
| `packages/db/drizzle/0018_raw_events_legacy_id_backfill.sql` | CREATE | ~55 | Hand-written SQL: 2 UPDATEs (single tx + statement_timeout 120s) |
| `packages/db/drizzle/meta/_journal.json` | MODIFY | +12 | idx 17 + idx 18 entries |
| `packages/db/src/schema/public.ts` | MODIFY | +8 | `legacyId` column + `legacyIdIdx` partial UNIQUE INDEX |
| `packages/promotion/src/promote.ts` | MODIFY | +60 | NEW ctacte/ctacte1 raw_events-direct path; id-based UPDATE |
| `packages/promotion/src/dedup.ts` | MODIFY | +25 | `loadExistingNaturalKeys` for ctacte/ctacte1 reads `raw_events.legacy_id` |
| `packages/promotion/src/__tests__/uuid-parity.test.ts` | CREATE | ~30 | TDD-RED parity test (TypeScript vs PostgreSQL hash output) |
| `scripts/verify-slice.sh` | MODIFY | +30 | NEW Step 7 (raw_events.legacy_id + ctacte1 rate ≥88% assertions) |
| `docs/runbook.md` | MODIFY | +20 | Update N14 to RESOLVED + new "E3 N14 Closure" sub-section |
| `openspec/specs/deployment-devops/spec.md` | MODIFY | +~30 | APPEND 1 NEW requirement + 4 NEW scenarios + 1 NEW success criterion (#52) |
| `CHANGELOG.md` | MODIFY | +5 | v0.5.7 entry |
| `package.json` (root) | MODIFY | +1 | bump 0.5.6 → 0.5.7 (release commit) |
| `packages/*/package.json` (18 other packages) | MODIFY | +1 each | bump 0.5.6 → 0.5.7 |
| **Total raw LoC** | | **~280** | |

---

## 7. Top 5 Risks

| # | Risk | Likelihood | Mitigation |
|---|------|-----------|------------|
| **R1** (CRITICAL) | Hash parity mismatch — PostgreSQL `promotion_deterministic_uuid()` output ≠ TypeScript `deterministicUuid()` byte-for-byte → `raw_events.legacy_id` ≠ `master.legacy_id` → promote.ts can't JOIN → silent re-inserts on cross-run | **High** | TASK-001 (TDD-RED parity test) verifies TypeScript output for 5 known inputs. Apply phase runs these in PostgreSQL via `SELECT promotion_deterministic_uuid('0\|2016-10-24\|9895\|9\|1')` and asserts equality. Migration 0018 is a NO-OP if parity fails (the WHERE clause preserves the column without filling wrong values). The function in 0017 is regenerated until parity matches, OR the algorithm is reverted |
| **R2** (CRITICAL) | Apply sub-agent skips `bash scripts/verify-slice.sh` (E1b/E1b2a/E1b2b/E2 LESSON — 4 consecutive sub-slices shipped with potentially broken state because smoke was historically skippable) | **High** | TASK-008 (`bash scripts/verify-slice.sh`) is HARD GATE in apply prompt. Script already covers 8 master tables (commit `061be50`); E3 adds NEW Step 7 for raw_events.legacy_id coverage + ctacte1 rate ≥88%. Apply MUST run the script BEFORE declaring ready. **No merge until `verify-slice.sh` exits 0 (PASS)** |
| **R3** (WARNING) | pgcrypto extension install fails (no superuser privileges) → migration 0017 fails → E3 blocked | **Medium** | Apply phase checks `SELECT * FROM pg_available_extensions WHERE name = 'pgcrypto'` BEFORE running 0017. If extension is NOT available (or `CREATE EXTENSION` returns `ERROR: permission denied`), apply phase surfaces this to orchestrator immediately and aborts. Fallback: Option 2 (TypeScript backfill script `scripts/backfill-legacy-id.ts`) — slower (~2min for 571k rows) but doesn't require pgcrypto |
| **R4** (WARNING) | Field name mismatch in 0018 (e.g., typo `CCTTALONAR` vs `CCTTALANAR`) → all rows get the SAME hash → partial UNIQUE INDEX fails on INSERT | **High** | Apply phase MUST verify field names via `SELECT DISTINCT jsonb_object_keys(payload) FROM raw_events WHERE source_table = 'ctacte'` BEFORE writing 0018. Verified live 2026-06-25: 26 fields for ctacte (incl. CCTTALONAR), 15 fields for ctacte1 (incl. all 5-tuple components) |
| **R5** (WARNING) | Apply sub-agent doesn't save `apply-progress` to engram (E2 LESSON — UNFIXED; 3 consecutive apply sub-agents skipped this despite explicit instructions) | **High** | Apply prompt EXPLICITLY mandates `mem_save(title: 'sdd/.../apply-progress', topic_key: 'sdd/.../apply-progress', type: 'architecture', project: 'athlos', capture_prompt: false)` after each task. Orchestrator verifies the save exists before declaring apply complete. If missing, apply sub-agent is re-invoked with a save-only follow-up task |

### Lesser risks

- **Backfill performance:** 571k rows in 2 transactions with 120s statement_timeout. pgcrypto is optimized for bulk hashing — estimated ~10-30s for 571k rows. If slow, split into 4 transactions (one per domain + half-batch) with 60s timeout each.
- **`pgcrypto` extension is global to the database.** If other slices need it, they'll see it as already installed. Low risk (good for the codebase).
- **`raw_events.legacy_id IS NOT NULL` in the partial UNIQUE INDEX uses pg's NULL semantics** (NULLs are NOT considered equal, so multiple NULL rows don't conflict). Verified via PostgreSQL docs.
- **`raw_events.source_key` is still degenerate** (correction C2). E3 doesn't fix the column itself — the new ctacte/ctacte1 path reads from `raw_events` with `WHERE legacy_id IS NOT NULL`, so the degenerate `source_key` doesn't matter for these 2 domains. Other 6 domains keep using projection scan + source_key JOIN (which works for them because their source_keys are NOT degenerate).
- **Master.legacy_id is computed by TypeScript and stored.** If we ever change the TypeScript `deterministicUuid()` algorithm, the raw_events.legacy_id computed in SQL MUST be regenerated. E3 documents the algorithm parity requirement in migration 0017's comment.

---

## 8. Dependencies (all confirmed shipped)

| Dependency | What E3 needs | Status |
|------------|---------------|--------|
| **E2 v0.5.6** (commit `6f98b5c`) | `raw_events.promoted_at` column + `raw_events_promoted_at_idx` index + admin API + runbook "Known Limitations" section + `promote.ts` JOIN filter via `promoted_at IS NULL` + `dedup.ts` cross-check | ✅ shipped 2026-06-25 |
| **E1b2b v0.5.5** (commit `36ac630`) | Migration 0015 (gastos) + FINAL atomic canonical sync | ✅ shipped 2026-06-25 |
| **E1b2a v0.5.4** (commit `b8d8e43`) | Migration 0014 (4 NEW master tables) + 4 NEW transforms | ✅ shipped 2026-06-25 |
| **E1b1 v0.5.2/v0.5.3** (commit `4a29571`) | Migration 0013 (`legacy_id` UNIQUE INDEX for ctacte/ctacte1) + `deterministicUuid()` helper | ✅ shipped 2026-06-24 |
| **E1a v0.5.1** (commit `bc6aa60`) | `packages/promotion/` skeleton + 3 transforms | ✅ shipped 2026-06-24 |
| **Slice D v0.5.0** | CI/CD pipeline + `.github/workflows/deploy.yml` | ✅ shipped 2026-06-24 |
| **`packages/db`** v0.5.6 | `createDb({ connectionString })`; 16 migrations applied; `pgTable` with `partial uniqueIndex` support | ✅ shipped |
| **`pgcrypto`** PostgreSQL extension | SHA-256 `digest()` function (one-time install in 0017) | ✅ AVAILABLE (verified live 2026-06-25 via `SELECT * FROM pg_available_extensions WHERE name = 'pgcrypto'` → present, NOT installed) |

**No new external dependencies.** E3 adds zero npm packages. Only adds the pgcrypto PostgreSQL extension (one-time, no npm impact).

---

## 9. Acceptance Criteria

A Slice E3 change is accepted when **all** of the following pass:

### 9.1 Build & lint

- [ ] `pnpm install --frozen-lockfile` succeeds
- [ ] `pnpm test:run` passes (existing 484+ vitest cases + 1 NEW uuid-parity case with 5 sub-tests)
- [ ] `pnpm typecheck` passes (0 errors)
- [ ] `pnpm lint` passes (0 errors, 0 warnings)

### 9.2 TDD discipline

- [ ] `uuid-parity.test.ts` committed BEFORE migrations 0017 + 0018 (git log shows test before feat)
- [ ] RED phase verified: parity test fails before SQL function is created in DB
- [ ] GREEN phase verified: parity test passes after `promotion_deterministic_uuid()` is created via migration 0017
- [ ] Migration 0018 ONLY applied AFTER parity test passes (TASK-003 depends on TASK-001)

### 9.3 Slice E3 acceptance

- [ ] Migration 0017 applies cleanly via `psql -f`
- [ ] Migration 0018 applies cleanly via `psql -f`
- [ ] `raw_events.legacy_id` populated for 100% of ctacte + ctacte1 rows (verified via `count(*) ... WHERE source_table IN ('ctacte', 'ctacte1') AND legacy_id IS NOT NULL` = 571,645)
- [ ] `raw_events.legacy_id` byte-for-byte equals `tesoreria.ctacte.legacy_id` for the matching 197,521 ctacte rows (parity test)
- [ ] `raw_events.legacy_id` byte-for-byte equals `tesoreria.ctacte1.legacy_id` for the matching 150,129 ctacte1 rows (parity test)
- [ ] `pnpm db:promote` (CLI) populates ctacte + ctacte1 master to ~197,521 + ~150,129 (no change in 1st run after backfill — all already in master)
- [ ] `pnpm db:promote` 2nd run inserts 0 new rows (TRUE idempotency)
- [ ] `bash scripts/verify-slice.sh` exits 0 with NEW Step 7 assertions passing (legacy_id coverage 100% + ctacte1 rate ≥88%)

### 9.4 Idempotency

- [ ] Running `promoteAll(db)` 3 times produces the same end state
- [ ] After 1st run post-E3: `count(*) FROM raw_events WHERE source_table='ctacte' AND promoted_at IS NOT NULL` ≥ 197,521 (master count)
- [ ] After 1st run post-E3: `count(*) FROM raw_events WHERE source_table='ctacte1' AND promoted_at IS NOT NULL` ≥ 150,129
- [ ] After 2nd/3rd runs: same counts, zero new inserts

### 9.5 Hygiene

- [ ] Apply sub-agent saves `mem_save` to engram with topic_key `sdd/athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill/apply-progress` (E2 LESSON — explicit in apply prompt)
- [ ] All commits use conventional commits format (`feat(promotion+db): ...`, `docs(spec+runbook): ...`, `chore(release): ...`)
- [ ] No `Co-Authored-By` or AI attribution in commits
- [ ] All 18 `packages/*/package.json` + root bumped to `0.5.7` in single release commit
- [ ] `CHANGELOG.md` v0.5.7 entry added

---

## 10. Ready for spec?

**YES** — scope is bounded (~280 LoC, 1 algorithm update + 1 migration pair + verify-slice update + runbook/spec sync), all 9 main decisions locked, hash parity test is the CRITICAL gate, E1b/E1b2a/E1b2b/E2 LESSONs applied.

**Risk Level:** **Medium** — algorithmic change (raw_events-direct path) + new SQL function + hash parity dependency, but well-mitigated by hash parity test as a hard gate.

**Next step:** `sdd-spec` phase → write 1 NEW requirement "Raw Events Legacy ID Backfill" with 4 NEW scenarios + 1 NEW success criterion (#52) APPENDED to `openspec/specs/deployment-devops/spec.md` (additive only per B1b LESSON #1).