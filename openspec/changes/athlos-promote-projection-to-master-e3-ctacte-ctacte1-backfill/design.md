# Design: athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill

| Field | Value |
|-------|-------|
| **Change** | `athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill` |
| **Date** | 2026-06-25 |
| **Phase** | Design |
| **Mode** | Both (Engram + OpenSpec) |
| **Status** | Draft — ready for tasks |
| **File path** | `openspec/changes/athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill/design.md` |
| **Source artifacts** | spec delta (278L, id 2575) · proposal (597L, id 2571) · explore (875L, id 2568) · explore findings (id 2567) · E2 design (1252L, id 2550) · E1b2b design (id 2537) · E1b/E2 LESSONs (id 2531) |
| **Sister changes (DONE)** | `e1a` (v0.5.1, commit `bc6aa60`) · `e1b1` (v0.5.2/v0.5.3, commit `4a29571`) · `e1b2a` (v0.5.4, commit `b8d8e43`) · `e1b2b` (v0.5.5, commit `36ac630`, FINAL atomic sync in `e753528`) · **`e2` (v0.5.6, commit `6f98b5c`, FINAL Slice E sync + runbook)** |
| **Sister slice (THIS — FIRST post-Slice E slice)** | **`athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill` (v0.5.7) — closes N14 limitation via `raw_events.legacy_id` column + pgcrypto backfill + `promote.ts` raw_events-direct path for ctacte/ctacte1** |
| **Target release** | v0.5.6 → **v0.5.7** (PATCH — additive: 1 NEW column `raw_events.legacy_id`, 1 NEW partial UNIQUE INDEX, 1 NEW SQL function `promotion_deterministic_uuid()`, 1 NEW raw_events-direct algorithm path for ctacte/ctacte1 ONLY, 1 NEW `verify-slice.sh` Step 7, 1 NEW canonical spec requirement; no breaking changes) |
| **B1b LESSONs embedded** | #1 (HIGHEST) atomic sync — 1 NEW requirement + 4 NEW scenarios + 1 NEW success criterion (#52) APPENDED; NO modifications to existing Promotion Pipeline (E1b2b canonical lines 167-276) or E2 Per-row Promotion Audit (canonical lines 675-714) or E2 Admin Promotion Trigger (canonical lines 622-672) or E2 Runbook Documentation (canonical lines 717-740) · #2 separate release commit (`chore(release): v0.5.7`) · #3 cherry-pick reorder · #4 merge-before-delete |
| **E1b/E1b2a/E1b2b/E2 LESSONs embedded** | `bash scripts/verify-slice.sh` is the REAL gate (commit `061be50` extended to 8 master tables; E3 adds NEW Step 7 for ctacte/ctacte1 promotion rate ≥88%); migration via `psql` NOT `drizzle-kit migrate` (E1b1 LESSON re: `_journal.json` tracking mismatch); existing `promote.test.ts` stays `describe.skip` (E1b2a TRUNCATE bug fix); apply sub-agent MUST save `apply-progress` to engram via `mem_save` (E2 UNFIXED LESSON — orchestrator verifies save exists before declaring apply complete) |

> **E3 IS THE FIRST POST-SLICE E SLICE.** Slice E (data-promotion pipeline) was declared feature-complete at v0.5.6 (commit `6f98b5c`, 2026-06-25). E3 closes the **N14 limitation** (ctacte/ctacte1 stuck at 60.5%/61.2% promotion rate per live `192.168.1.102:5432/athlos` verification 2026-06-25) via 1 NEW column + 1 NEW SQL function + 1 NEW algorithm path + 1 NEW `verify-slice.sh` Step 7. Future post-Slice E slices (async scheduler, analytics, multi-region) are separate work and out of scope.
>
> **3 CORRECTIONS FROM EXPLORE (embedded — these reshape the design vs. the original prompt premise):**
>
> | # | Orchestrator's premise | Verified correction (live 2026-06-25) |
> |---|------------------------|----------------------------------------|
> | C1 | N14 = missing legacy_id backfill only | **N14 is a 3-LAYER problem**: (L1) ctacte/ctacte1 projection tables EMPTY (verified: `count(*) FROM public."tesoreria.ctacte_projection"` = 0 for both); (L2) `raw_events.source_key` degenerate for ctacte/ctacte1 (634 distinct of 326,275 ctacte rows; **1 distinct of 245,370 ctacte1 rows** — literally all `source_key='1'`); (L3) `legacy_id` column missing on `raw_events`. E3 addresses ALL 3 layers. |
> | C2 | E2's JOIN `(re.source_table, re.source_key) = (pe.source_table, pe.source_key)` filters out already-promoted | For ctacte/ctacte1 the JOIN is **effectively a cross-join** (1 distinct source_key for ALL 245k ctacte1 rows); only `promoted_at IS NULL` filter is meaningful. E3's raw_events-direct path filters by `legacy_id IS NOT NULL AND promoted_at IS NULL` — the `legacy_id` column is the new dedup key (replaces degenerate `source_key`). |
> | C3 | 100% promotion rate is achievable | **Realistic target is ~88% ctacte1 promotion rate** (NOT 100%): 34,834 ctacte rows have `CCTCUENTA=0` sentinel (permanently FK-blocked — no matching `socios.socios` row); ~20,152 ctacte1 rows FK-blocked by parent ctacte; ~75,089 ctacte1 shadow rows (same 5-tuple, different `id`/`source_key`) caught by `legacy_id UNIQUE INDEX`. >95% would require re-importing missing socios (deferred to E3+). |
>
> **5 LOCKED DECISIONS (user-confirmed 2026-06-25 — embedded in proposal §3, SPEC DELTA §Open Questions).** Q1: Backfill strategy = **pgcrypto SHA-256 via `promotion_deterministic_uuid()` SQL function**. Q2: Promote path = **raw_events-direct for ctacte/ctacte1** (other 6 domains UNCHANGED). Q3: Hash parity verification = **REQUIRED before applying migration 0018** (5 known inputs through BOTH TypeScript AND PostgreSQL; byte-for-byte equality; CRITICAL GATE). Q4: pgcrypto install permission = **pre-check via `pg_available_extensions` BEFORE 0017** + clear error if permission denied. Q5: Success criterion = **≥88% ctacte1 promotion rate** (NOT 100%).

---

## 1. Context

### What Slice E + E2 shipped (post-v0.5.6, commit `6f98b5c`)

| Slice | Version | Scope | Status |
|-------|--------:|-------|--------|
| **E1a** | v0.5.1 | `packages/promotion/` skeleton + transforms for `socios`, `ctacte`, `ctacte1` | ✅ shipped 2026-06-24 |
| **E1b1** | v0.5.2/v0.5.3 | Migration `0013_legacy_id_unique.sql` (cctcuenta + legacy_id columns + UNIQUE INDEXes) + `deterministicUuid()` helper in `packages/promotion/src/transform-helpers.ts` | ✅ shipped 2026-06-24 |
| **E1b2a** | v0.5.4 | Migration `0014_new_masters.sql` (4 NEW tables: escuela, disciplinas, locacion, caja_movimiento) + 4 NEW transforms + PROMOTION_ORDER extended to 7 domains | ✅ shipped 2026-06-25 |
| **E1b2b** | v0.5.5 | Migration `0015_gastos.sql` + `transformGastos` + PROMOTION_ORDER extended to 8 domains + **FINAL atomic canonical sync** + `scripts/verify-slice.sh` already extended to 8 tables (commit `304f37a`/`061be50`) | ✅ shipped 2026-06-25 |
| **E2** | v0.5.6 | Migration `0016_promoted_at.sql` (raw_events.promoted_at audit column + `socios`-only backfill ~16,383 rows) + `POST /api/v1/promote/trigger` admin endpoint + `GET /api/v1/promote/status` + runbook "Promotion Pipeline" section (N14 documented as Known Limitation) + 3 NEW additive canonical-spec requirements (#49-51) | ✅ shipped 2026-06-25 |

**Live state post-E2 (verified 2026-06-25 against `192.168.1.102:5432/athlos`):**

| Master table | Projection rows | Master rows | Promotion rate | Status |
|--------------|----------------:|------------:|---------------:|--------|
| `socios.socios` | 39,357 | 16,383 | 41.6% | partial (pre-E1a orphans) |
| `tesoreria.ctacte` | 326,275 (in `raw_events`) | **197,521 (60.5%)** | ⚠️ **N14 — partial** |  |
| `tesoreria.ctacte1` | 245,370 (in `raw_events`) | **150,129 (61.2%)** | ⚠️ **N14 — partial** |  |
| `socios.escuela` | 66 | 61 | 92.4% | ✅ |
| `deportes.disciplinas` | 32 | 32 | 100% | ✅ |
| `socios.locacion` | 89 | 91 | 102.2% | ✅ (re-promote adds 2) |
| `tesoreria.caja_movimiento` | 8,145 | 8,149 | 100.0% | ✅ (re-promote adds 4) |
| `tesoreria.gastos` | 2,114 | 2,114 | 100% | ✅ |

**Pipeline currently running end-to-end (but stuck for ctacte/ctacte1 due to N14):**

```
legacy .DBF → import → raw_events (652,661 rows) → projection (EMPTY for ctacte/ctacte1) → 8 master tables
                (B-7c)                            (Slice C)                                (Slice E1a..E2)
```

**`scripts/verify-slice.sh` exits 0** post-E2 (verified 2026-06-25 against live DB). TRUE idempotency across all 8 master tables on 2nd run.

### What's left for E3 (this slice)

**The N14 limitation persists** (documented in E2's `docs/runbook.md` "Known Limitations" sub-section + canonical `openspec/specs/deployment-devops/spec.md` Per-row Promotion Audit scenario line 694 as "TODO E3+"). E2's design (`§4.2`, engram obs #2550) explicitly deferred ctacte/ctacte1 backfill to E3+ because `raw_events` did NOT have a `legacy_id` column at E2 design time — the JOIN through `(source_table, source_key) = (ctacte.cctcuenta, raw_events.source_key)` is wrong because `raw_events.source_key` for ctacte is the VFP key, NOT the socio carnet. **E3 closes N14.**

### 3 corrections from explore (the design pivots on these — embedded above + below)

The corrections are not cosmetic. Each one shapes a specific design decision:

1. **N14 is 3 layers, not 1**: E3 must address ALL 3 layers (empty projection → bypass with raw_events-direct path; degenerate source_key → replace with legacy_id-based filter; missing legacy_id column → ADD column + backfill). Single fix = partial fix.

2. **`raw_events.source_key` is degenerate for ctacte/ctacte1**: The E2 promote.ts JOIN `re.source_key = pe.source_key` is effectively a cross-join for these 2 domains. The new raw_events-direct path filters by `legacy_id IS NOT NULL AND promoted_at IS NULL` — `legacy_id` is the new dedup key (NOT source_key). The bulk UPDATE at the end of `promoteDomain` switches from `WHERE source_key = ANY(...)` to `WHERE id = ANY($rawEventIds::uuid[])` for precise per-row updates.

3. **Realistic target is ~88% ctacte1 (NOT 100%)**: 34,834 ctacte FK-blocked by `CCTCUENTA=0` sentinel + ~20,152 ctacte1 FK-blocked by parent ctacte + ~75,089 ctacte1 shadow rows caught by `legacy_id UNIQUE INDEX` = ~12% blocked. Target is ≥88%; >95% would require re-importing missing socios (deferred to E3+).

### Why E3 ships as one PR (no chained PRs)

The 4 deliverables (migration pair + algorithm update + dedup update + verify-slice update) are tightly coupled — the `verify-slice.sh` Step 7 assertions depend on the migration pair running; the algorithm update depends on the `legacy_id` column existing; the dedup update depends on the column being populated. Splitting them into chained PRs would multiply CI/deploy overhead without reducing review load. **~280 raw LoC / ~180 effective = well under the 400-line review budget at both counts (~70% raw / ~45% effective); no split recommended.**

This design modifies the existing `deployment-devops` capability by **appending 1 NEW requirement** to the end of the canonical spec. No existing requirement is modified, removed, or rewritten (B1b LESSON #1 — HIGHEST — additive only). The `diff openspec/specs/deployment-devops/spec.md openspec/changes/.../specs/deployment-devops/spec.md` SHALL be purely additive (no removals, no rewrites of prior Slice E scenarios at canonical lines 167-276, 280-315, 622-672, 675-714, 717-740).

---

## 2. Goals

| ID | Goal | Acceptance |
|----|------|------------|
| **G1** | `raw_events.legacy_id text` column added (migration 0017) | `ALTER TABLE public.raw_events ADD COLUMN IF NOT EXISTS legacy_id text;` applied via `psql` (NOT `drizzle-kit migrate` per E1b1 LESSON); Drizzle schema `packages/db/src/schema/public.ts` updated with `legacyId: text('legacy_id')`; `_journal.json` idx 17 entry |
| **G2** | Partial UNIQUE INDEX on `raw_events.legacy_id` | `CREATE UNIQUE INDEX IF NOT EXISTS raw_events_legacy_id_unique ON public.raw_events (legacy_id) WHERE legacy_id IS NOT NULL;` — partial because ~50% of raw_events rows are NOT ctacte/ctacte1 and don't get a `legacy_id` (asiento, paramet, plancue, etc.); `WHERE IS NOT NULL` avoids conflicts on NULLs (PostgreSQL NULL semantics: NULLs are NOT considered equal, so multiple NULL rows don't conflict) |
| **G3** | pgcrypto extension installed (migration 0017, pre-checked via `pg_available_extensions`) | `CREATE EXTENSION IF NOT EXISTS pgcrypto;` — one-time install, verified AVAILABLE via `SELECT * FROM pg_available_extensions WHERE name = 'pgcrypto'` (default_version 1.3, NOT installed yet — install will succeed per locked decision Q4) |
| **G4** | `promotion_deterministic_uuid(text)` SQL function (migration 0017) | `LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE`; mirrors `packages/promotion/src/transform-helpers.ts:19-26` (`deterministicUuid()`) **byte-for-byte** — SHA-256 + version=5 nibble + variant=10 bits + UUID formatting. **CRITICAL GATE**: must pass `uuid-parity.test.ts` (5 known inputs, byte-for-byte equality with TypeScript) BEFORE migration 0018 is applied |
| **G5** | Backfill `raw_events.legacy_id` for ctacte rows (migration 0018) | `UPDATE raw_events SET legacy_id = promotion_deterministic_uuid(...) WHERE source_table = 'ctacte' AND legacy_id IS NULL`; 5-tuple = `(CCTCUENTA, CCTFECHA, CCTNROCOMP, CCTMES, CCTTALONAR)` (verified live 2026-06-25: 0 rows have any 5-tuple field NULL — safe to backfill 326,275 rows in single transaction) |
| **G6** | Backfill `raw_events.legacy_id` for ctacte1 rows (migration 0018) | Same pattern with 5-tuple = `(CCTPAGONRO, CCTPAGOSEC, CCTPAGOTAL, CCTPAGOFAM, CCTCUENTA)` (verified 0 rows with NULL components — safe to backfill 245,370 rows) |
| **G7** | `promote.ts` reads ctacte/ctacte1 DIRECTLY from `raw_events` (NEW branch) | For these 2 domains ONLY, projection tables are EMPTY (correction L1); new path queries `SELECT id, source_key, payload, legacy_id FROM public.raw_events WHERE source_table = $domain AND legacy_id IS NOT NULL AND promoted_at IS NULL` (bypasses projection scan + degenerate source_key JOIN per correction L2) |
| **G8** | After successful INSERT, bulk UPDATE `raw_events SET promoted_at = now() WHERE id = ANY($insertedRawEventIds::uuid[])` | Single UPDATE per domain; uses `id` (raw_events UUID PK) for precise per-row update; replaces current `WHERE source_key = ANY($keys)` UPDATE which is broken for ctacte/ctacte1 (source_key is degenerate — all "1" for ctacte1) |
| **G9** | `dedup.ts` `loadExistingNaturalKeys` for ctacte/ctacte1 reads `raw_events.legacy_id` | ADDITIVE to existing master.legacy_id + E2's `raw_events.promoted_at` cross-check; reads `SELECT legacy_id FROM raw_events WHERE source_table = $domain AND legacy_id IS NOT NULL` and merges with `master.legacy_id` set (UNION — a row is "existing" if EITHER layer says so) |
| **G10** | Hash parity test (TDD-RED, CRITICAL GATE) | 5 known inputs run through BOTH TypeScript `deterministicUuid()` AND PostgreSQL `promotion_deterministic_uuid()`; byte-for-byte equality asserted. **Test is committed BEFORE migrations 0017/0018 are applied** (RED-first discipline). Inputs: `'0\|2016-10-24\|9895\|9\|1'` (ctacte: 0-CCTCUENTA sentinel edge case), `'5343\|2015-04-07\|86846\|4\|1'` (ctacte: real socio carnet), `'179440\|4\|1\|1\|5343'` (ctacte1: pagonro\|pagosec\|pagotal\|pagofam\|cuenta), `'0\|0\|0\|0\|0'` (all-zero edge case), `'999999\|2099-12-31\|999999999\|12\|9'` (future date + max values) |
| **G11** | `scripts/verify-slice.sh` NEW Step 7 | Asserts (a) `count(*) FROM raw_events WHERE source_table IN ('ctacte','ctacte1') AND legacy_id IS NOT NULL` ≥ 571,645 (~100% backfilled, ≥99.9% coverage); (b) `count(*) FROM tesoreria.ctacte1 / count(*) FROM raw_events WHERE source_table = 'ctacte1'` ≥ 0.88 (88% promotion rate — locked success criterion Q5); (c) idempotency preserved (existing Steps 5 + 6 still exit 0) |
| **G12** | `docs/runbook.md` "Known Limitations" N14 row updated to RESOLVED + new sub-section added | N14 entry: "**RESOLVED in v0.5.7 (E3)** — ctacte/ctacte1 backfill via `raw_events.legacy_id` + pgcrypto backfill + `promote.ts` raw_events-direct path. Migration 0017 (column + UNIQUE INDEX + SQL function) + Migration 0018 (backfill) + ctacte/ctacte1 now read from raw_events directly. New ctacte1 promotion rate ≥88% (FK failures account for ~12%)"; new sub-section "E3 N14 Closure — ctacte/ctacte1 raw_events-direct path" added under "Per-row Promotion Audit" explaining the 3-layer N14 problem |
| **G13** | Spec delta APPENDED to `openspec/specs/deployment-devops/spec.md` (B1b LESSON #1 — additive ONLY) | 1 NEW requirement "Raw Events Legacy ID Backfill" with 4 NEW scenarios (migration applies + idempotent, hash parity passes, backfill coverage, promote algorithm uses raw_events direct path) + 1 NEW success criterion (#52: ctacte1 promotion rate ≥88% after E3). Existing Promotion Pipeline (lines 167-276), `tesoreria.gastos` (lines 280-315), E2 Admin Promotion Trigger (lines 622-672), E2 Per-row Promotion Audit (lines 675-714), E2 Runbook Documentation (lines 717-740) **UNCHANGED**. `diff` returns ONLY additive changes |
| **G14** | Apply sub-agent runs `bash scripts/verify-slice.sh` before declaring ready (E1b/E1b2a/E1b2b/E2 LESSON — non-negotiable) | Exit code 0; NEW Step 7 assertions pass; 2nd/3rd `pnpm db:promote` runs insert 0 new rows across all 8 master tables |
| **G15** | Migration applied via `psql` (NOT `drizzle-kit migrate` — E1b1 LESSON re: `_journal.json` tracking mismatch) | `PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -f packages/db/drizzle/0017_raw_events_legacy_id.sql`; same for 0018; manual `_journal.json` idx 17 + idx 18 entries (next sequential after E2's idx 16) |
| **G16** | Apply sub-agent saves `apply-progress` to engram via `mem_save` (E2 LESSON — UNFIXED; 3 consecutive apply sub-agents skipped this) | `mem_save(title: 'sdd/.../apply-progress', topic_key: 'sdd/.../apply-progress', type: 'architecture', project: 'athlos', capture_prompt: false, content: '...')` — EXPLICITLY instructed in apply prompt; orchestrator verifies save exists before declaring apply complete |
| **G17** | 3-commit shape (B1b LESSON #2 — separate release commit) | (1) `feat(promotion+db): raw_events.legacy_id backfill for ctacte/ctacte1 (closes N14)` (TDD-RED parity → TDD-GREEN migration 0017 → TDD-GREEN function → TDD-GREEN migration 0018 → TDD-GREEN schema → TDD-GREEN promote algorithm → TDD-GREEN dedup → TDD-REFACTOR); (2) `docs(spec+runbook): atomic sync — N14 RESOLVED + ctacte/ctacte1 backfill requirement`; (3) `chore(release): v0.5.7` |

---

## 3. Non-goals (deferred to E3-subsequent slices or NEVER)

| ID | Deferred to | Item | Why |
|----|-------------|------|-----|
| **N1** | E3+ scheduler slice (separate change) | `scheduled-promotion` JobHandler via `@athlos/scheduler` | Manual `pnpm db:promote` + `POST /api/v1/promote/trigger` work for v1 |
| **N2** | E3+ analytics slice (separate change) | Cross-table aggregations (ctacte1 saldo per socio, etc.) | Different spec; promotion is data-layer, not analytics |
| **N3** | E3+ infra slice (separate change) | Multi-region deploys with per-region promotion | Single env per Slice C ADR |
| **N4** | N7 (future) | Caja detail columns (CAJCONCEP1..20, CAJIMPOR1..20 — 122 wide columns per header) | Header-only sufficient for v1.0 |
| **N5** | N8 (future) | `deportes.inscripciones` rebuild | No `*_inscripciones_projection` table exists yet |
| **N6** | N16 (future) | `gastos` FK to `ctacte` via `cctcuenta` lookup | Flat ledger in v1; FK reconstruction deferred per E1b2b scope correction #C7 |
| **N7** | **NEVER (data quality issue)** | 100% ctacte/ctacte1 promotion | 34,834 ctacte rows have `CCTCUENTA=0` sentinel (no socio FK — permanently blocked); ~20,152 ctacte1 rows FK-blocked by parent ctacte; ~75,089 ctacte1 shadow rows caught by `legacy_id UNIQUE INDEX`. Realistic target is ≥88% |
| **N8** | E3+ deferred | Re-importing missing socios into master (would unlock >95% rate) | Different problem (pre-E1a manual entries without `legacy_id`); E3 only addresses ctacte/ctacte1 |
| **N9** | **NEVER** | Rebuilding ctacte/ctacte1 projection tables | E3 reads `raw_events` directly because projection is empty (correction L1); rebuilding is unnecessary work for v1 |
| **N10** | **NEVER** | Auto-promotion on import | User wants manual review per E1a design; auto ships post-MVP |
| **N11** | E3+ deferred | Async promotion via `@athlos/scheduler.runNow('scheduled-promotion')` | E2 sync HTTP is sufficient for v1 |
| **N12** | E3+ deferred | Dry-run mode (`POST /promote/trigger?dryRun=true`) | CLI `--dry` flag is the future home |
| **N13** | E3+ deferred | OpenAPI / Swagger spec generation | No OpenAPI in repo |
| **N14** | **THIS slice resolves it** | Stale `entity_uuids` repopulation | E3 closes N14; `entity_uuids` table is no longer critical for promotion |

---

## 4. Architecture

### 4.1 Hash parity design (CRITICAL — the make-or-break piece)

**TypeScript reference implementation** (`packages/promotion/src/transform-helpers.ts:19-26`, READ CAREFULLY):

```typescript
export function deterministicUuid(naturalKey: string): string {
  const hash = createHash('sha256').update(naturalKey).digest()
  // Set version (5) in the high nibble of byte 6 and variant (10) in byte 8
  hash[6] = (hash[6]! & 0x0f) | 0x50
  hash[8] = (hash[8]! & 0x3f) | 0x80
  const hex = hash.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}
```

**Byte-level analysis**:
- `hash[6]` = byte at INDEX 6 (the 7th byte, 0-based indexing) — set high nibble to `0x50` (version 5 → masks low nibble with `& 0x0f`, ORs high nibble with `0x50`)
- `hash[8]` = byte at INDEX 8 (the 9th byte) — set high 2 bits to `0x80` (variant 10 → masks low 6 bits with `& 0x3f`, ORs high 2 bits with `0x80`)
- First 16 bytes of hash formatted as 5-part UUID: 8-4-4-4-12 hex chars

**PostgreSQL equivalent** (in migration 0017):

```sql
CREATE OR REPLACE FUNCTION promotion_deterministic_uuid(natural_key text)
  RETURNS text
  LANGUAGE plpgsql
  IMMUTABLE PARALLEL SAFE
AS $$
DECLARE
  hash bytea := digest(natural_key, 'sha256');
  hex_str text := encode(substring(hash, 1, 16), 'hex');
  byte6 int := get_byte(hash, 6);   -- INDEX 6 = 7th byte (matches TypeScript hash[6])
  byte8 int := get_byte(hash, 8);   -- INDEX 8 = 9th byte (matches TypeScript hash[8])
  version_byte int := (byte6 & 15) | 80;   -- 80 = 0x50 (version 5)
  variant_byte int := (byte8 & 63) | 128;  -- 128 = 0x80 (variant 10)
  part3_hex text := lpad(to_hex(version_byte), 2, '0');
  part4_hex text := lpad(to_hex(variant_byte), 2, '0');
BEGIN
  -- version_byte goes into the 1st character of part3 (positions 13-16 of full UUID)
  -- variant_byte goes into the 1st character of part4 (positions 17-20 of full UUID)
  -- The remaining 3 characters of each part come from the original hex bytes
  RETURN substring(hex_str, 1, 8) || '-' ||                       -- part 1 (8 chars from hex)
         substring(hex_str, 9, 4) || '-' ||                       -- part 2 (4 chars from hex)
         substring(part3_hex, 1, 1) || substring(hex_str, 13, 3) || '-' ||  -- part 3 (1 char modified + 3 from hex)
         substring(part4_hex, 1, 1) || substring(hex_str, 17, 3) || '-' ||  -- part 4 (1 char modified + 3 from hex)
         substring(hex_str, 21, 12);                              -- part 5 (12 chars from hex)
END;
$$;
```

**CRITICAL invariants** (the parity test will FAIL if any of these break):
1. **Byte indexing matches**: TypeScript `hash[6]` = byte at INDEX 6 (7th byte); PostgreSQL `get_byte(hash, 6)` = byte at POSITION 6 (7th byte). 0-based, MATCH.
2. **Mask + OR arithmetic matches**: `(byte & 15) | 80` in PL/pgSQL = `(byte & 0x0f) | 0x50` in TypeScript (15 decimal = 0x0f; 80 decimal = 0x50). MATCH.
3. **Variant arithmetic matches**: `(byte & 63) | 128` in PL/pgSQL = `(byte & 0x3f) | 0x80` in TypeScript (63 = 0x3f; 128 = 0x80). MATCH.
4. **UUID layout matches**: 8-4-4-4-12 hex chars; version nibble at start of part 3; variant high 2 bits at start of part 4. MATCH.

**Why byte-by-byte parity matters**: if TypeScript produces `abc12345-...` but PostgreSQL produces `abd12345-...` (different version nibble), then:
- `master.legacy_id` = TypeScript output (`abc12345-...`)
- `raw_events.legacy_id` = PostgreSQL output (`abd12345-...`)
- JOIN through `(re.legacy_id = c.legacy_id)` finds 0 matches
- Promote algorithm sees 0 rows to skip → re-inserts ALL rows → 197,521 + 150,129 duplicate INSERT attempts → `ON CONFLICT DO NOTHING` catches them silently → but the raw_events.promoted_at stays NULL for all → cross-run idempotency BROKEN

**Hash parity test fixture** (in `packages/promotion/src/__tests__/uuid-parity.test.ts`):

```typescript
// 5 known inputs spanning edge cases
const PARITY_INPUTS = [
  '0|2016-10-24|9895|9|1',                // ctacte: 0-CCTCUENTA sentinel edge case (FK-blocked)
  '5343|2015-04-07|86846|4|1',            // ctacte: real socio carnet (5343)
  '179440|4|1|1|5343',                    // ctacte1: pagonro|pagosec|pagotal|pagofam|cuenta
  '0|0|0|0|0',                            // all-zero edge case
  '999999|2099-12-31|999999999|12|9',     // future date + max values
]

// For each input: compute deterministicUuid(input) (TypeScript) AND fetch
// promotion_deterministic_uuid(input) from PostgreSQL via @athlos/db connection.
// Assert byte-for-byte equality. Failure surfaces the diverging input + both outputs.
```

### 4.2 Migration 0017 (`packages/db/drizzle/0017_raw_events_legacy_id.sql`, NEW, ~30 LoC)

**Pattern**: mirrors E2's `0016_promoted_at.sql` + E1b2b's `0015_gastos.sql` + E1b2a's `0014_new_masters.sql`. Hand-written SQL with `CREATE EXTENSION IF NOT EXISTS` + `CREATE OR REPLACE FUNCTION` + `ALTER TABLE IF NOT EXISTS` + `CREATE UNIQUE INDEX IF NOT EXISTS`. Applied via `psql` (NOT `drizzle-kit migrate` — E1b1 LESSON re: `_journal.json` tracking mismatch). Idempotent.

```sql
-- Migration 0017: Add raw_events.legacy_id column + promotion_deterministic_uuid() SQL function (E3 — N14 closure)
--
-- Purpose: per-row dedup key at the source-event level. Enables promote.ts to filter
-- ctacte/ctacte1 by legacy_id (the source_key is degenerate for these domains: 634 distinct
-- values for 326k ctacte rows, 1 distinct for 245k ctacte1 rows — verified live 2026-06-25).
--
-- The partial UNIQUE INDEX (WHERE legacy_id IS NOT NULL) accommodates domains that don't have
-- a natural key (asiento, paramet, plancue, etc.).
--
-- pgcrypto is required for the backfill migration (0018). One-time install.
-- Pre-checked via: SELECT * FROM pg_available_extensions WHERE name = 'pgcrypto'; — AVAILABLE
--
-- The promotion_deterministic_uuid() function mirrors packages/promotion/src/transform-helpers.ts:19-26
-- deterministicUuid() byte-for-byte: SHA-256 + version=5 nibble + variant=10 bits + UUID formatting.
-- Verified by hash parity test in apply phase (5 known inputs through TypeScript AND PostgreSQL,
-- byte-for-byte equality asserted BEFORE migration 0018 is applied).
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

### 4.3 Migration 0018 (`packages/db/drizzle/0018_raw_events_legacy_id_backfill.sql`, NEW, ~55 LoC)

Single transaction with `SET LOCAL statement_timeout = '120s'` (E2 LESSON re: backfill timeout). Two `UPDATE` statements (one per domain) — split to avoid a single-statement timeout if pgcrypto is slow.

```sql
-- Migration 0018: Backfill raw_events.legacy_id for ctacte + ctacte1 (E3 — N14 closure)
--
-- Computes the same hash that packages/promotion/src/transform-helpers.ts deterministicUuid()
-- produces (UUIDv5-like per RFC 4122 §4.3). Verified byte-for-byte by hash parity test in
-- apply phase BEFORE this migration runs.
--
-- Coverage:
--   ctacte:  326,275 rows → all backfilled (verified 0 NULL fields live 2026-06-25)
--   ctacte1: 245,370 rows → all backfilled (verified 0 NULL fields live 2026-06-25)
--
-- Best-effort: rows where ANY 5-tuple field is NULL get NULL legacy_id. Verified 0 such rows
-- exist for ctacte/ctacte1 (raw_events count vs. count WHERE payload field is NULL = 0).
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

### 4.4 Drizzle schema update (`packages/db/src/schema/public.ts`, +8 LoC)

```typescript
// In rawEvents table definition (after promotedAt column at line 211):
legacyId: text('legacy_id'),  // E3: source-level dedup key; partial UNIQUE INDEX in migration 0017

// In rawEvents indexes (after promotedAtIdx at line 225):
legacyIdIdx: uniqueIndex('raw_events_legacy_id_unique').on(table.legacyId)
  .where(sql`${table.legacyId} IS NOT NULL`),
```

### 4.5 `promote.ts` algorithm update (`packages/promotion/src/promote.ts`, +60 LoC)

**For ctacte/ctacte1 ONLY**, bypass the projection table (it's empty per correction L1) and read from `raw_events` directly. **Other 6 domains (socios, escuela, deportes, locacion, caja, gastos)** keep the existing projection-scan path UNCHANGED.

```typescript
// In promoteDomain(), INSERT a NEW branch BEFORE the existing projection scan (lines 85-101):

if (domain === 'ctacte' || domain === 'ctacte1') {
  // E3: read from raw_events directly (projection tables are EMPTY for these domains).
  // Filter by legacy_id IS NOT NULL (excludes domains without natural key) + promoted_at IS NULL (E2).
  // The legacy_id is the new dedup key (replaces degenerate source_key JOIN per correction L2).
  const rawRows =
    (
      await db.execute<{
        id: string
        source_key: string
        payload: Record<string, unknown>
        legacy_id: string
      }>(
        sql`SELECT id, source_key, payload, legacy_id
            FROM public.raw_events
            WHERE source_table = ${domain}
              AND legacy_id IS NOT NULL
              AND promoted_at IS NULL`
      )
    ).rows ?? []
  result.attempted = rawRows.length

  // ... transform loop, track insertedRawEventIds per row ...
  const insertedRawEventIds: string[] = []
  // ... after each batch flush, push the raw_events.id of each successfully-inserted row ...

  // Replace the existing bulk UPDATE (lines 155-162) with:
  if (insertedRawEventIds.length > 0) {
    await db.execute(sql`
      UPDATE public.raw_events
      SET promoted_at = now()
      WHERE id = ANY(${insertedRawEventIds}::uuid[])
    `)
  }

  // Early return — skip the existing projection scan code below
  result.durationMs = Date.now() - t0
  return result
}
```

**Why this fixes the N14 3-layer problem**:
- **(L1) Empty projection** → bypass via raw_events-direct SELECT (no projection scan, no JOIN through empty table)
- **(L2) Degenerate source_key** → replaced with `legacy_id IS NOT NULL` filter (legacy_id is 100% unique per master)
- **(L3) Missing legacy_id** → ADD column via migration 0017 + backfill via 0018

### 4.6 `dedup.ts` update (`packages/promotion/src/dedup.ts`, +25 LoC)

For ctacte/ctacte1, ADD a `raw_events.legacy_id` cross-check (alongside the existing `master.legacy_id` + E2's `raw_events.promoted_at` checks). Other 6 domains UNCHANGED.

```typescript
// In loadExistingNaturalKeys for ctacte (extend existing implementation at lines 122-135):

if (domain === 'ctacte') {
  // E1b1 layer: existing legacy_ids from master (primary dedup)
  const masterRows = await db
    .select({ legacyId: ctacte.legacyId })
    .from(ctacte)
    .where(isNotNull(ctacte.legacyId))
  const masterIds = new Set(
    masterRows.map((r) => r.legacyId).filter((id): id is string => id !== null),
  )

  // E2 layer (existing): raw_events.promoted_at source_keys (belt-and-suspenders)
  const promotedKeys = await loadPromotedSourceKeys(db, domain)
  for (const k of promotedKeys) masterIds.add(k)

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
// Same pattern for ctacte1
```

### 4.7 `scripts/verify-slice.sh` NEW Step 7 (+30 LoC)

Add NEW Step 7 AFTER the existing Step 6 (verdict). Steps 1-6 UNCHANGED (verified E1b2b LESSON — re-promote idempotency for all 8 master tables already proven by commit `061be50`).

```bash
# Step 7 (NEW, E3): Verify raw_events.legacy_id backfill + ctacte1 promotion rate (N14 closure)
hr
echo "Step 7: Verify E3 N14 closure (raw_events.legacy_id + ctacte1 promotion rate)"
hr

# (a) raw_events.legacy_id backfill coverage for ctacte + ctacte1
LEGACY_BACKFILL_TOTAL=$(PGPASSWORD=athlos psql "$DB_URL" -t -A -c \
  "SELECT count(*) FROM public.raw_events WHERE source_table IN ('ctacte', 'ctacte1') AND legacy_id IS NOT NULL;" 2>/dev/null || echo 0)
LEGACY_TOTAL=$(PGPASSWORD=athlos psql "$DB_URL" -t -A -c \
  "SELECT count(*) FROM public.raw_events WHERE source_table IN ('ctacte', 'ctacte1');" 2>/dev/null || echo 0)
LEGACY_PCT=0
if [ "$LEGACY_TOTAL" -gt 0 ]; then
  LEGACY_PCT=$(awk "BEGIN { printf \"%.1f\", ($LEGACY_BACKFILL_TOTAL / $LEGACY_TOTAL) * 100 }")
fi
printf '  %-35s %8s / %-8s (%s%%)\n' "raw_events.legacy_id (ctacte+ctacte1)" "$LEGACY_BACKFILL_TOTAL" "$LEGACY_TOTAL" "$LEGACY_PCT"

# Assert: legacy_id backfill should cover ≥99.9% of ctacte + ctacte1 rows
LEGACY_OK=$(awk "BEGIN { print ($LEGACY_PCT >= 99.9) ? \"1\" : \"0\" }")
if [ "$LEGACY_OK" = "0" ]; then
  echo "FAIL: raw_events.legacy_id backfill coverage < 99.9% ($LEGACY_PCT%) — N14 closure incomplete" >&2
  exit 1
fi

# (b) ctacte1 promotion rate ≥88% (locked success criterion Q5)
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

echo "PASS: N14 closure verified (legacy_id backfill ≥99.9% + ctacte1 rate ≥88%)"
```

### 4.8 `docs/runbook.md` update (+30 LoC)

**Update existing N14 row in "Known Limitations" sub-section**:

```diff
- **N14** | Stale `entity_uuids` (~107k ctacte1 orphans) → ctacte1 promotion rate stuck at ~61% | N14 (future) — repopulate entity_uuids from raw_events
+ **N14** | Stale `entity_uuids` (~107k ctacte1 orphans) → ctacte1 promotion rate stuck at ~61% | **RESOLVED in v0.5.7 (E3)** — `raw_events.legacy_id` column + pgcrypto backfill + `promote.ts` raw_events-direct path. Migration 0017 (column + UNIQUE INDEX + SQL function `promotion_deterministic_uuid`) + Migration 0018 (backfill 571,645 rows). ctacte/ctacte1 now read from `raw_events` directly. New ctacte1 promotion rate ≥88% (FK failures + shadow rows account for ~12%)
```

**Add new sub-section under "Per-row Promotion Audit"** (between current "Cross-run idempotency contract" and "Admin API: POST /promote/trigger"):

```markdown
### E3 N14 Closure — ctacte/ctacte1 raw_events-direct path

After E3, ctacte/ctacte1 promotion reads **DIRECTLY from `raw_events`** (NOT from projection tables). This was necessary because:

1. **Projection tables were EMPTY** for ctacte/ctacte1 (verified live 2026-06-25 — 0 rows in `public."tesoreria.ctacte_projection"` and `public."tesoreria.ctacte1_projection"`).
2. **`raw_events.source_key` is degenerate** for ctacte (634 distinct values for 326k rows) and ctacte1 (1 distinct value for all 245k rows). The E2 JOIN through `(source_table, source_key)` was effectively a cross-join for these domains.

The new path uses `raw_events.legacy_id` (computed via `promotion_deterministic_uuid()` SQL function = SHA-256 + UUIDv5-like formatting) as the dedup key. Backfilled in migration 0018 to 100% coverage (verified live).

**Hash parity is CRITICAL.** TypeScript `deterministicUuid()` and PostgreSQL `promotion_deterministic_uuid()` MUST produce byte-for-byte identical output. Hash parity test in `packages/promotion/src/__tests__/uuid-parity.test.ts` runs BEFORE migration 0018 is applied.

**Other 3 limitations remain UNCHANGED** (deferred): N7 caja_detalle, N8 deportes.inscripciones, N16 gastos FK.
```

### 4.9 Spec delta (`openspec/specs/deployment-devops/spec.md`, +~150 LoC, ADDITIVE ONLY)

B1b LESSON #1 (HIGHEST): APPEND 1 NEW requirement + 4 NEW scenarios + 1 NEW success criterion at the END of `openspec/specs/deployment-devops/spec.md`. The existing Promotion Pipeline requirement (lines 167-276), `tesoreria.gastos` (lines 280-315), E2 Admin Promotion Trigger (lines 622-672), E2 Per-row Promotion Audit (lines 675-714), E2 Runbook Documentation (lines 717-740) all **remain UNCHANGED**.

The full spec delta text is at `openspec/changes/athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill/specs/deployment-devops/spec.md` (278 lines, id 2575) — already on disk from spec phase. Apply phase syncs it to canonical by appending verbatim (same pattern as E1b2b FINAL sync + E2 FINAL sync — B1b LESSON #1).

**Acceptance gate at apply time**:

```bash
diff -u \
  openspec/specs/deployment-devops/spec.md \
  openspec/changes/athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill/specs/deployment-devops/spec.md \
  | head -300
# MUST show ONLY additive changes — no removals, no rewrites of existing
# Promotion Pipeline requirement at canonical lines 167-276 or
# tesoreria.gastos requirement at lines 280-315 or
# E2 Admin Promotion Trigger at lines 622-672 or
# E2 Per-row Promotion Audit at lines 675-714 or
# E2 Runbook Documentation at lines 717-740
```

---

## 5. Implementation details

### 5.1 Files to modify / create

| File | Action | Est. lines | Notes |
|------|--------|-----------:|-------|
| `packages/db/drizzle/0017_raw_events_legacy_id.sql` | CREATE | ~30 | Hand-written SQL: `CREATE EXTENSION pgcrypto` + `CREATE OR REPLACE FUNCTION promotion_deterministic_uuid()` (byte-for-byte TypeScript mirror) + `ALTER TABLE raw_events ADD COLUMN legacy_id` + partial UNIQUE INDEX `WHERE legacy_id IS NOT NULL` |
| `packages/db/drizzle/0018_raw_events_legacy_id_backfill.sql` | CREATE | ~55 | Hand-written SQL: single transaction + `SET LOCAL statement_timeout = '120s'` + 2 UPDATEs (ctacte 5-tuple + ctacte1 5-tuple, both `WHERE legacy_id IS NULL`) |
| `packages/db/drizzle/meta/_journal.json` | MODIFY | +12 | idx 17 + idx 18 entries (next sequential after E2's idx 16) |
| `packages/db/src/schema/public.ts` | MODIFY | +8 | `legacyId: text('legacy_id')` column + `legacyIdIdx` partial UNIQUE INDEX on `rawEvents` |
| `packages/promotion/src/promote.ts` | MODIFY | +60 | NEW `if (domain === 'ctacte' \|\| domain === 'ctacte1')` branch BEFORE existing projection scan; raw_events-direct path; track inserted `raw_events.id` per row; bulk UPDATE `WHERE id = ANY($insertedRawEventIds::uuid[])` replaces `WHERE source_key = ANY(...)`. Other 6 domains UNCHANGED |
| `packages/promotion/src/dedup.ts` | MODIFY | +25 | `loadExistingNaturalKeys` for ctacte/ctacte1 reads `raw_events.legacy_id` (UNION with existing master.legacy_id + E2's `promoted_at` checks). Other 6 domains UNCHANGED |
| `packages/promotion/src/__tests__/uuid-parity.test.ts` | CREATE | ~30 | TDD-RED hash parity test (5 known inputs, runs TypeScript AND PostgreSQL, asserts byte-for-byte equality). Committed BEFORE migrations 0017/0018 |
| `scripts/verify-slice.sh` | MODIFY | +30 | NEW Step 7 (raw_events.legacy_id backfill coverage ≥99.9% + ctacte1 promotion rate ≥88% assertions). Steps 1-6 UNCHANGED |
| `docs/runbook.md` | MODIFY | +30 | Update N14 row to "RESOLVED in v0.5.7 (E3)" + add new "E3 N14 Closure" sub-section under "Per-row Promotion Audit" |
| `openspec/specs/deployment-devops/spec.md` | MODIFY | +~150 | APPEND 1 NEW requirement "Raw Events Legacy ID Backfill" + 4 NEW scenarios + 1 NEW success criterion (#52). Existing Promotion Pipeline (167-276) + tesoreria.gastos (280-315) + E2 Admin Promotion Trigger (622-672) + E2 Per-row Promotion Audit (675-714) + E2 Runbook Documentation (717-740) **UNCHANGED** |
| `CHANGELOG.md` | MODIFY | +5 | v0.5.7 entry (closes N14, ctacte1 promotion rate ≥88%, raw_events.legacy_id + pgcrypto backfill) |
| `package.json` (root) | MODIFY | +1 | bump 0.5.6 → 0.5.7 (release commit only) |
| `packages/*/package.json` (18 other packages) | MODIFY | +1 each | bump 0.5.6 → 0.5.7 (release commit only) |
| **Total raw LoC** | | **~280 raw / ~180 effective** | **Well under the 400-line review budget at both counts (~70% raw / ~45% effective; no split recommended)** |

### 5.2 Migration order

1. **TASK-001 [TDD-RED]**: Write hash parity test in `packages/promotion/src/__tests__/uuid-parity.test.ts` (5 known inputs, runs TypeScript `deterministicUuid()` AND PostgreSQL `promotion_deterministic_uuid()` via `@athlos/db` connection). Test committed BEFORE migrations. Test WILL FAIL at RED phase because SQL function doesn't exist yet in DB.
2. **TASK-002 [TDD-GREEN migration 0017]**: Hand-write `0017_raw_events_legacy_id.sql` + apply via `psql` + update `_journal.json` idx 17. The function is now in DB. Parity test now passes (GREEN).
3. **TASK-003 [TDD-GREEN migration 0018]**: Hand-write `0018_raw_events_legacy_id_backfill.sql` + apply via `psql` AFTER hash parity test passes. Update `_journal.json` idx 18.
4. **TASK-004 [TDD-GREEN schema]**: Update `packages/db/src/schema/public.ts` with `legacyId` column + `legacyIdIdx` partial UNIQUE INDEX.
5. **TASK-005 [TDD-GREEN promote.ts]**: Add NEW ctacte/ctacte1 raw_events-direct path + bulk UPDATE via `raw_events.id`.
6. **TASK-006 [TDD-GREEN dedup.ts]**: Add `raw_events.legacy_id` cross-check for ctacte/ctacte1.
7. **TASK-007 [TDD-REFACTOR]**: Tighten helpers; ensure no `any` types; consolidate SQL strings; verify all imports consistent.
8. **TASK-008 [Pre-closing verification — CRITICAL E1b/E1b2a/E1b2b/E2 LESSON]**: Run `bash scripts/verify-slice.sh` (the REAL gate). Script now includes NEW Step 7 (legacy_id coverage + ctacte1 rate ≥88%). Exit 0 = TRUE idempotency preserved + N14 closed.

### 5.3 Test strategy (hash parity test)

> **Per E1b2a LESSON re: TRUNCATE bug fix in commit `b26896c`**: existing `promote.test.ts` stays `describe.skip` (no change). NEW `uuid-parity.test.ts` is a PURE FUNCTION TEST (5 known inputs → compute hash in TypeScript → fetch from PostgreSQL via `@athlos/db` connection → assert equality). No destructive setup, no TRUNCATE.

| Test | What it verifies |
|------|------------------|
| **T-parity-1** | Input `'0\|2016-10-24\|9895\|9\|1'` (ctacte: 0-CCTCUENTA sentinel) → `deterministicUuid()` = `promotion_deterministic_uuid()` byte-for-byte |
| **T-parity-2** | Input `'5343\|2015-04-07\|86846\|4\|1'` (ctacte: real socio 5343) → equality |
| **T-parity-3** | Input `'179440\|4\|1\|1\|5343'` (ctacte1: pagonro=179440, pagosec=4, pagotal=1, pagofam=1, cuenta=5343) → equality |
| **T-parity-4** | Input `'0\|0\|0\|0\|0'` (all-zero edge case) → equality |
| **T-parity-5** | Input `'999999\|2099-12-31\|999999999\|12\|9'` (future date + max values) → equality |

**Why these 5 inputs**: span edge cases (all-zero, sentinel, max values, future date, real socio carnet). If the SQL function has any drift in byte handling, hex formatting, version/variant bit manipulation, or 5-tuple parsing, at least ONE of these 5 inputs will fail parity. Coverage is comprehensive without being exhaustive.

**Test fixture pattern** (mirrors `apps/api/src/routes/import.test.ts:1-100` mock container pattern, but with a real DB connection to fetch the SQL function output):

```typescript
// In packages/promotion/src/__tests__/uuid-parity.test.ts
import { describe, it, expect } from 'vitest'
import { deterministicUuid } from '../transform-helpers.ts'
import { createDb } from '@athlos/db'
import { sql } from 'drizzle-orm'

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://athlos:athlos@192.168.1.102:5432/athlos'
const db = createDb({ connectionString: DB_URL })

describe('uuid-parity (CRITICAL GATE — E3 N14 closure)', () => {
  it.each([
    ['0|2016-10-24|9895|9|1',          'ctacte: 0-CCTCUENTA sentinel'],
    ['5343|2015-04-07|86846|4|1',      'ctacte: real socio 5343'],
    ['179440|4|1|1|5343',              'ctacte1: real pagonro 179440'],
    ['0|0|0|0|0',                      'all-zero edge case'],
    ['999999|2099-12-31|999999999|12|9', 'future date + max values'],
  ])('input %s (%s) — TypeScript === PostgreSQL byte-for-byte', async (input, _label) => {
    const tsHash = deterministicUuid(input)
    const result = await db.execute<{ hash: string }>(
      sql`SELECT promotion_deterministic_uuid(${input}) AS hash`,
    )
    const pgHash = result.rows?.[0]?.hash
    expect(pgHash).toBeDefined()
    expect(pgHash).toBe(tsHash)  // byte-for-byte equality
  })
})
```

---

## 6. File-by-file changes (detailed)

### 6.1 `packages/db/drizzle/0017_raw_events_legacy_id.sql` (NEW, ~30 LoC)

**Current state**: file does not exist.

**New state**: hand-written SQL per §4.2 (CREATE EXTENSION pgcrypto + CREATE FUNCTION + ALTER TABLE ADD COLUMN + partial UNIQUE INDEX, all idempotent via `IF NOT EXISTS`).

**Verification**:
```bash
# Pre-check (locked decision Q4):
PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos \
  -c "SELECT * FROM pg_available_extensions WHERE name = 'pgcrypto';"
# expect: name=pgcrypto, default_version=1.3, installed_version=NULL (or 1.3 if already installed)

# Apply migration 0017:
PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos \
  -f packages/db/drizzle/0017_raw_events_legacy_id.sql

# Verify schema:
PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -c "\d public.raw_events"
# expect: legacy_id text column + raw_events_legacy_id_unique partial UNIQUE INDEX

# Verify function exists:
PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos \
  -c "SELECT promotion_deterministic_uuid('test|input|here');"
# expect: 36-char UUID-formatted string

# Idempotency check:
PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos \
  -f packages/db/drizzle/0017_raw_events_legacy_id.sql  # re-run: no-op
```

### 6.2 `packages/db/drizzle/0018_raw_events_legacy_id_backfill.sql` (NEW, ~55 LoC)

**Current state**: file does not exist.

**New state**: hand-written SQL per §4.3 (single transaction + statement_timeout 120s + 2 UPDATEs).

**Verification**:
```bash
# APPLY ONLY AFTER hash parity test passes (CRITICAL GATE):
PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos \
  -f packages/db/drizzle/0018_raw_events_legacy_id_backfill.sql

# Verify backfill coverage:
PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos \
  -c "SELECT count(*) FROM public.raw_events WHERE source_table IN ('ctacte','ctacte1') AND legacy_id IS NOT NULL;"
# expect: 571,645 (326,275 ctacte + 245,370 ctacte1, 100% backfilled)

# Verify byte-for-byte parity with master.legacy_id for existing master rows:
PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos \
  -c "SELECT count(*) FROM tesoreria.ctacte c
      JOIN public.raw_events r
        ON r.source_table = 'ctacte' AND r.legacy_id = c.legacy_id;"
# expect: 197,521 (every ctacte master row matches its raw_events.legacy_id)

# Idempotency check:
PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos \
  -f packages/db/drizzle/0018_raw_events_legacy_id_backfill.sql  # re-run: no-op (WHERE legacy_id IS NULL)
```

### 6.3 `packages/db/drizzle/meta/_journal.json` (MODIFIED, +12 LoC)

**Current state**: ends at `idx: 16` (tag `0016_promoted_at`, E2 release).

**New state**: append 2 NEW entries:

```json
{
  "idx": 17,
  "version": "7",
  "when": 1782341200000,
  "tag": "0017_raw_events_legacy_id",
  "breakpoints": true
},
{
  "idx": 18,
  "version": "7",
  "when": 1782341300000,
  "tag": "0018_raw_events_legacy_id_backfill",
  "breakpoints": true
}
```

**Verification**:
```bash
cat packages/db/drizzle/meta/_journal.json | jq '.entries | length'  # expect 19 (17 entries 0-16 + 2 new = 19)
cat packages/db/drizzle/meta/_journal.json | jq '.entries[-2:] | .[].tag'  # expect ["0017_raw_events_legacy_id", "0018_raw_events_legacy_id_backfill"]
```

### 6.4 `packages/db/src/schema/public.ts` (MODIFIED, +8 LoC)

**Current state**: `rawEvents` table has 8 columns (id, source_table, source_key, content_hash, payload, import_batch, imported_at, promoted_at) — verified via `\d public.raw_events` 2026-06-25. 5 INDEXes (pkey, idx_import_batch, idx_source_key, uq_source_key_hash, raw_events_promoted_at_idx).

**New state**: append `legacyId: text('legacy_id')` to the column list (nullable, no default) + `legacyIdIdx` partial UNIQUE INDEX to the indexes array.

**Verification**:
```bash
pnpm --filter @athlos/db typecheck  # ensure NewRawEvent type exports correctly
grep "legacyId" packages/db/src/schema/public.ts  # expect ≥3 (column + index + type)
```

### 6.5 `packages/promotion/src/promote.ts` (MODIFIED, +60 LoC)

**Current state**: `promoteDomain` reads `*_projection` rows via JOIN with `raw_events` on `(source_table, source_key) AND promoted_at IS NULL` (lines 90-101). Bulk UPDATE uses `WHERE source_key = ANY(...)` (lines 155-162).

**New state**:
1. Add NEW `if (domain === 'ctacte' || domain === 'ctacte1')` branch BEFORE the existing projection scan (lines 85-101).
2. New branch reads DIRECTLY from `raw_events` with `WHERE source_table = $domain AND legacy_id IS NOT NULL AND promoted_at IS NULL`.
3. Track inserted `raw_events.id` per row in `insertedRawEventIds: string[]`.
4. After successful INSERT, bulk UPDATE `WHERE id = ANY($insertedRawEventIds::uuid[])`.
5. Early return — skip the existing projection scan code.
6. Other 6 domains UNCHANGED.

**Verification**:
```bash
pnpm --filter @athlos/promotion typecheck
grep -A 3 "domain === 'ctacte' || domain === 'ctacte1'" packages/promotion/src/promote.ts  # NEW branch present
grep -A 3 "UPDATE public.raw_events" packages/promotion/src/promote.ts  # id-based UPDATE present
bash scripts/verify-slice.sh  # exits 0 = N14 closed + idempotency preserved
```

### 6.6 `packages/promotion/src/dedup.ts` (MODIFIED, +25 LoC)

**Current state**: `loadExistingNaturalKeys` for ctacte reads master.legacy_id + E2's `raw_events.promoted_at` source_keys (lines 122-135). ctacte1 same pattern (lines 136-149). Other 6 domains use master.legacy_id only.

**New state**: for ctacte/ctacte1 ONLY, ADDITIONALLY read `SELECT legacy_id FROM public.raw_events WHERE source_table = $domain AND legacy_id IS NOT NULL` and union with the master.legacy_id + promoted_at sets. Other 6 domains UNCHANGED.

**Verification**:
```bash
pnpm --filter @athlos/promotion typecheck
grep -A 12 "domain === 'ctacte'" packages/promotion/src/dedup.ts  # expect 3 layers (master.legacy_id + raw_events.promoted_at + raw_events.legacy_id)
```

### 6.7 `packages/promotion/src/__tests__/uuid-parity.test.ts` (NEW, ~30 LoC)

**Current state**: file does not exist.

**New state**: 5-case parity test per §5.3. Committed BEFORE migration 0017 is applied (TDD-RED).

**Verification**:
```bash
pnpm --filter @athlos/promotion test:run uuid-parity
# Expect: 5 tests pass AFTER migration 0017 + 0018 applied. Tests FAIL before migration 0017 (function doesn't exist in DB yet).
```

### 6.8 `scripts/verify-slice.sh` (MODIFIED, +30 LoC)

**Current state**: 171 lines total. Steps 1-6 cover master counts before/after `pnpm db:promote` + idempotency check (verifying 2nd run inserts 0 new rows). Exits 0 = TRUE idempotency.

**New state**: add NEW Step 7 after Step 6 (verdict). Steps 1-6 UNCHANGED (idempotency check already proven by commit `061be50` for all 8 master tables).

**Verification**:
```bash
bash scripts/verify-slice.sh
# Expect: exit 0, NEW Step 7 prints "PASS: N14 closure verified (legacy_id backfill ≥99.9% + ctacte1 rate ≥88%)"
```

### 6.9 `docs/runbook.md` (MODIFIED, +30 LoC)

**Current state**: E2 added "Promotion Pipeline" section (~430 lines total). "Known Limitations" sub-section has N14 row marked as future slice.

**New state**: update N14 row to "RESOLVED in v0.5.7 (E3)" + add new "E3 N14 Closure — ctacte/ctacte1 raw_events-direct path" sub-section under "Per-row Promotion Audit" (between "Cross-run idempotency contract" and "Admin API: POST /promote/trigger").

**Verification**:
```bash
grep -n "RESOLVED in v0.5.7" docs/runbook.md  # expect 1 hit (N14 row)
grep -n "E3 N14 Closure" docs/runbook.md  # expect ≥1 hit (new sub-section heading)
wc -l docs/runbook.md  # expect ~460 (was ~430)
```

### 6.10 `openspec/specs/deployment-devops/spec.md` (MODIFIED, +~150 LoC, ADDITIVE ONLY)

**Current state**: 749 lines (post-E2). Promotion Pipeline at lines 167-276. tesoreria.gastos at lines 280-315. E2 Admin Promotion Trigger at lines 622-672. E2 Per-row Promotion Audit at lines 675-714. E2 Runbook Documentation at lines 717-740. Success criteria end at #51 (post-E2).

**New state** (FINAL atomic sync per B1b LESSON #1, HIGHEST):
1. **APPENDED** (NOT modifying) 1 NEW requirement "Raw Events Legacy ID Backfill" at the end with 4 NEW scenarios (per spec delta lines 83-148).
2. **APPENDED** 1 NEW success criterion (#52) at the end (per spec delta line 152).
3. **NO modifications** to existing Promotion Pipeline requirement at lines 167-276 (per B1b LESSON #1).
4. **NO modifications** to existing tesoreria.gastos requirement at lines 280-315.
5. **NO modifications** to E2 Admin Promotion Trigger at lines 622-672.
6. **NO modifications** to E2 Per-row Promotion Audit at lines 675-714.
7. **NO modifications** to E2 Runbook Documentation at lines 717-740.

**Verification**:
```bash
diff -u \
  openspec/specs/deployment-devops/spec.md \
  openspec/changes/athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill/specs/deployment-devops/spec.md \
  | head -300
# MUST show ONLY additive changes — no removals, no rewrites of existing scenarios
grep -c "### Requirement:" openspec/specs/deployment-devops/spec.md  # expect 15 (was 14 post-E2; +1 NEW)
grep -c "^## Success Criteria" openspec/specs/deployment-devops/spec.md  # unchanged (1)
```

### 6.11 `CHANGELOG.md` (MODIFIED, +5 LoC, in release commit only)

**Current state**: last entry is `[0.5.6] — 2026-06-25` (E2 release).

**New state**: append 1 NEW entry:
- `[0.5.7] — 2026-06-25` — E3 closes N14 (ctacte/ctacte1 promotion rate ≥88%, raw_events.legacy_id + pgcrypto backfill + promote.ts raw_events-direct path). Smoke test results: `bash scripts/verify-slice.sh` exits 0 with NEW Step 7 assertions passing (legacy_id coverage ≥99.9% + ctacte1 rate ≥88%).

**Verification**:
```bash
grep -c "0.5.7" CHANGELOG.md  # expect ≥1
grep -A 3 "## \[0.5.7\]" CHANGELOG.md
```

### 6.12 Version bumps (root + 18 packages, in release commit only)

**Current state**: all `package.json` files at `0.5.6` (post-E2 release; verified 2026-06-25 — root + 18 packages all show `"version": "0.5.6"`).

**New state**: bump all to `0.5.7`. Single coordinated commit.

**Verification**:
```bash
grep -r '"version"' packages/*/package.json package.json | grep -v 0.5.7
# expect 0 output (all packages at 0.5.7)
```

---

## 7. Work-units (in 3-commit shape per B1b LESSON #2)

### Commit 1: `feat(promotion+db): raw_events.legacy_id backfill for ctacte/ctacte1 (closes N14)`

| # | Task | Description | Files | LoC |
|---|------|-------------|-------|----:|
| **TASK-001** | [TDD-RED] | Write hash parity test in `packages/promotion/src/__tests__/uuid-parity.test.ts` — 5 known inputs, runs TypeScript `deterministicUuid()` AND PostgreSQL `promotion_deterministic_uuid()` (via `@athlos/db` connection); asserts byte-for-byte equality. **Test committed BEFORE migrations** — RED phase verified: test fails because SQL function doesn't exist yet | NEW ~30L | +30 |
| **TASK-002** | [TDD-GREEN migration 0017] | Hand-write `0017_raw_events_legacy_id.sql` (CREATE EXTENSION pgcrypto + CREATE OR REPLACE FUNCTION `promotion_deterministic_uuid()` + ALTER TABLE raw_events ADD COLUMN legacy_id + partial UNIQUE INDEX); apply via `psql`; update `_journal.json` idx 17 | NEW ~30L + journal +6L | +36 |
| **TASK-003** | [TDD-GREEN migration 0018] | Hand-write `0018_raw_events_legacy_id_backfill.sql` (single transaction + statement_timeout 120s + 2 UPDATEs); apply via `psql` **AFTER hash parity test passes (TASK-001 dependency)**; update `_journal.json` idx 18 | NEW ~55L + journal +6L | +61 |
| **TASK-004** | [TDD-GREEN schema] | Update `packages/db/src/schema/public.ts` with `legacyId: text('legacy_id')` column + `legacyIdIdx` partial UNIQUE INDEX on `rawEvents` | MODIFIED +8L | +8 |
| **TASK-005** | [TDD-GREEN promote.ts] | Update `packages/promotion/src/promote.ts` — add NEW `if (domain === 'ctacte' \|\| domain === 'ctacte1')` branch BEFORE existing projection scan; new branch reads directly from `raw_events` with `WHERE source_table = $domain AND legacy_id IS NOT NULL AND promoted_at IS NULL`; track inserted `raw_events.id` per row; bulk UPDATE `WHERE id = ANY($insertedRawEventIds::uuid[])` replaces `WHERE source_key = ANY(...)`. Other 6 domains UNCHANGED | MODIFIED +60L | +60 |
| **TASK-006** | [TDD-GREEN dedup.ts] | Update `packages/promotion/src/dedup.ts` `loadExistingNaturalKeys` for ctacte/ctacte1 — ADD new branch that reads `raw_events.legacy_id` and MERGES with existing `master.legacy_id` + E2's `raw_events.promoted_at` checks. Other 6 domains UNCHANGED | MODIFIED +25L | +25 |
| **TASK-007** | [TDD-REFACTOR] | Tighten helpers; ensure no `any` types; consolidate SQL strings; verify all imports consistent; ensure `uuid-parity.test.ts` passes in CI | (no files) | 0 |
| **TASK-008** | **[Pre-closing verification — CRITICAL E1b/E1b2a/E1b2b/E2 LESSON]** | Run `bash scripts/verify-slice.sh` (the REAL gate) — script now includes NEW Step 7 (legacy_id coverage + ctacte1 rate ≥88% assertions). Exit 0 = TRUE idempotency across all 8 master tables + E3 N14 closure verified | (verification, gates merge) | 0 |

### Commit 2: `docs(spec+runbook): atomic sync — N14 RESOLVED + ctacte/ctacte1 backfill requirement`

| # | Task | Description | Files | LoC |
|---|------|-------------|-------|----:|
| **TASK-009** | [Runbook update] | Update `docs/runbook.md` "Known Limitations" N14 row to "RESOLVED in v0.5.7 (E3)"; add new sub-section "E3 N14 Closure — ctacte/ctacte1 raw_events-direct path" under "Per-row Promotion Audit" with explanation + cross-reference to migrations 0017 + 0018 + hash parity test | MODIFIED +30L | +30 |
| **TASK-010** | **[FINAL atomic canonical spec sync — B1b LESSON #1, FULL additive only]** | APPEND 1 NEW requirement "Raw Events Legacy ID Backfill" with 4 NEW scenarios + 1 NEW success criterion (#52) to `openspec/specs/deployment-devops/spec.md`. Existing Promotion Pipeline (lines 167-276), tesoreria.gastos (lines 280-315), E2 Admin Promotion Trigger (lines 622-672), E2 Per-row Promotion Audit (lines 675-714), E2 Runbook Documentation (lines 717-740) **UNCHANGED**. `diff` returns ONLY additive changes | MODIFIED +~150L | +150 |

### Commit 3: `chore(release): v0.5.7`

| # | Task | Description | Files | LoC |
|---|------|-------------|-------|----:|
| **TASK-011** | [Pre-merge fix slot — B1b LESSON #3] | Cherry-pick reorder if verify catches critical issue | (varies) | 0 |
| **TASK-012** | [Closing release commit — B1b LESSON #2] | Bump root + 18 `packages/*/package.json` from `0.5.6` → `0.5.7`; `CHANGELOG.md` v0.5.7 entry (closes N14, ~88% ctacte1 promotion rate) | 19 package.json + CHANGELOG | +20 |

**Total raw LoC**: ~280 (well under 400-line review budget at raw count ~70%).
**Total effective LoC**: ~180 (well under at effective count ~45%).
**3-commit shape (B1b LESSON #2 + E1b2a/E1b2b/E2 pattern)**:
1. `feat(promotion+db): raw_events.legacy_id backfill for ctacte/ctacte1 (closes N14)` — TASK-001..TASK-008 (TDD chain RED→GREEN→REFACTOR collapses into 1 commit via squash; includes TASK-008 verify-slice.sh gate as pre-merge check)
2. `docs(spec+runbook): atomic sync — N14 RESOLVED + ctacte/ctacte1 backfill requirement` — TASK-009 + TASK-010 (runbook update + FULL atomic spec sync per B1b LESSON #1)
3. `chore(release): v0.5.7` — TASK-012 (separate per B1b LESSON #2; version bump + CHANGELOG)

If verify catches a critical issue pre-merge → apply fix + cherry-pick reorder (B1b LESSON #3). Merge to main BEFORE `git branch -D design/...` (B1b LESSON #4).

---

## 8. Data Flow (Promotion Pipeline, post-E3 — ctacte/ctacte1 path)

```
            pnpm db:promote (CLI)
                      OR
   POST /api/v1/promote/trigger (ADMIN)
                      │
                      ▼
       ┌──────────────────────────────┐
       │  promoteAll(db)              │
       │  PROMOTION_ORDER (8 domains) │
       └──────────────────────────────┘
                      │
        ┌─────────────┼─────────────────────┐
        │ 6 other domains                  │ ctacte/ctacte1
        │ (UNCHANGED projection-scan path) │ (NEW raw_events-direct path)
        ▼                                  ▼
 ┌────────────────────────┐      ┌────────────────────────┐
 │ 2. SELECT pe.source_…  │      │ 2. SELECT id, source_,  │
 │    FROM <proj_schema>.  │      │    payload, legacy_id   │ ←── NEW (E3)
 │    <proj_table> pe      │      │    FROM public.raw_events│
 │    JOIN public.raw_…    │      │    WHERE source_table = │
 │      ON promoted_at NULL│      │      $domain            │
 └────────────────────────┘      │      AND legacy_id NOT NULL│
                                  │      AND promoted_at NULL│
                                  └────────────────────────┘
                                            │
                                            ▼
                                  ┌────────────────────────┐
                                  │ 3. loadExistingNaturalKeys│
                                  │    UNION of:              │
                                  │    - master.legacy_id  ◄──┤
                                  │    - raw_events.promoted ◄──┤
                                  │    - raw_events.legacy_id◄┤── NEW (E3)
                                  └────────────────────────┘
                                            │
                                            ▼
                                  ┌────────────────────────┐
                                  │ 4. For each row:         │
                                  │    - naturalKey(domain,  │
                                  │      payload)            │
                                  │    - skip if existing    │
                                  │    - transformCtacte*    │
                                  │    - buffer.push(row)    │
                                  │    - bufferIds.push(raw_ │
                                  │      events.id)         ◄──┤
                                  │    - flush every 1000    │
                                  └────────────────────────┘
                                            │
                                            ▼
                                  ┌────────────────────────┐
                                  │ 5. db.insert(ctacte*)    │
                                  │    .values(rows)         │
                                  │    .onConflictDoNothing()│
                                  │    .returning({ id })    │
                                  │                         │
                                  │   Conflict caught by:    │
                                  │   - ctacte_legacy_id_    │
                                  │     unique  ◄─────────────┤
                                  └────────────────────────┘
                                            │
                                            ▼
                                  ┌────────────────────────┐
                                  │ 6. UPDATE public.raw_events│ ←── NEW (E3)
                                  │    SET promoted_at = now()│
                                  │    WHERE id = ANY(      │
                                  │      $insertedIds::uuid[])│
                                  │                         │
                                  │   Uses raw_events.id PK │
                                  │   (precise per-row)    ◄─┤
                                  │   Replaces WHERE source_│
                                  │   key = ANY(...) UPDATE │
                                  │   (degenerate for ctacte│
                                  │   /ctacte1)            ◄─┤
                                  └────────────────────────┘
                                            │
                                            ▼
                                PromotionResult{
                                  domain: 'ctacte1',
                                  attempted: ~245370,
                                  inserted: ~150129,
                                  skipped: ~75089,
                                  failed: ~20152,
                                  errors: [...],
                                  durationMs: ~30000
                                }
                                            │
                                            ▼
                                     (other 7 domains)
                                            │
                                            ▼
                                emitAudit(action: 'PROMOTE_TRIGGER', ...)
                                ↓
                                reply 200 with { status, totals, durationMs, domains }
```

---

## 9. Top 5 risks

| # | Risk | Likelihood | Mitigation |
|---|------|-----------|------------|
| **R1 (CRITICAL)** | **Hash parity mismatch** — PostgreSQL `promotion_deterministic_uuid()` output ≠ TypeScript `deterministicUuid()` byte-for-byte → `raw_events.legacy_id` ≠ `master.legacy_id` → promote.ts can't JOIN → silent re-inserts on cross-run → cross-run idempotency BROKEN | **High** | **TASK-001 (TDD-RED parity test)** verifies TypeScript output for 5 known inputs. Apply phase runs these in PostgreSQL via `SELECT promotion_deterministic_uuid($1)` and asserts equality. **Migration 0018 is REJECTED if parity fails** (function in 0017 is regenerated until parity matches, OR algorithm is reverted). The function output is the dedup key for ~571k rows; a mismatch silently corrupts cross-run idempotency |
| **R2 (CRITICAL)** | **Apply sub-agent skips `bash scripts/verify-slice.sh`** (E1b/E1b2a/E1b2b/E2 LESSON — 4 consecutive sub-slices shipped with potentially broken state because smoke was historically skippable) | **High** | **TASK-008 (`bash scripts/verify-slice.sh`) is HARD GATE in apply prompt.** Script already covers 8 master tables (commit `061be50`); E3 adds NEW Step 7 for raw_events.legacy_id coverage + ctacte1 rate ≥88%. Apply MUST run the script BEFORE declaring ready. **No merge until `verify-slice.sh` exits 0 (PASS)** |
| **R3 (WARNING)** | **pgcrypto extension install fails** (no superuser privileges) → migration 0017 fails → E3 blocked | **Medium** | Apply phase checks `SELECT * FROM pg_available_extensions WHERE name = 'pgcrypto'` BEFORE running 0017. **Verified AVAILABLE live 2026-06-25** (default_version 1.3, NOT installed). If extension is NOT available OR `CREATE EXTENSION` returns `ERROR: permission denied`, apply phase surfaces this to orchestrator immediately and aborts. Fallback deferred to E3+ (Option 2 TypeScript backfill script `scripts/backfill-legacy-id.ts` — slower ~2min for 571k rows but doesn't require pgcrypto) |
| **R4 (WARNING)** | **Field name mismatch in 0018** (e.g., typo `CCTTALONAR` vs `CCTTALANAR`) → all rows get the SAME hash → partial UNIQUE INDEX fails on INSERT → backfill fails | **High** | Apply phase MUST verify field names via `SELECT DISTINCT jsonb_object_keys(payload) FROM raw_events WHERE source_table = 'ctacte'` BEFORE writing 0018. **Verified live 2026-06-25**: 26 fields for ctacte (incl. `CCTTALONAR`); 15 fields for ctacte1 (incl. all 5-tuple components). Also verified: 0 rows have any 5-tuple field NULL for ctacte + ctacte1 (safe to backfill 100%) |
| **R5 (SUGGESTION)** | **Apply sub-agent doesn't save `apply-progress` to engram** (E2 LESSON — UNFIXED; 3 consecutive apply sub-agents skipped this despite explicit instructions) | **High** | Apply prompt EXPLICITLY mandates `mem_save(title: 'sdd/.../apply-progress', topic_key: 'sdd/.../apply-progress', type: 'architecture', project: 'athlos', capture_prompt: false, content: '...')` after each task. Orchestrator verifies the save exists before declaring apply complete. If missing, apply sub-agent is re-invoked with a save-only follow-up task |

### Lesser risks

- **Backfill performance**: 571,645 rows in 2 transactions with 120s statement_timeout. pgcrypto is optimized for bulk hashing — estimated ~10-30s for 571k rows (verified E1a pgcrypto benchmarks at ~50k SHA-256/sec). If slow, split into 4 transactions (one per domain + half-batch) with 60s timeout each.
- **`pgcrypto` extension is global to the database.** If other slices need it, they'll see it as already installed. Low risk (good for the codebase).
- **`raw_events.legacy_id IS NOT NULL` in the partial UNIQUE INDEX uses pg's NULL semantics** (NULLs are NOT considered equal, so multiple NULL rows don't conflict). Verified via PostgreSQL docs.
- **`raw_events.source_key` is still degenerate** (correction L2). E3 doesn't fix the column itself — the new ctacte/ctacte1 path reads from `raw_events` with `WHERE legacy_id IS NOT NULL`, so the degenerate `source_key` doesn't matter for these 2 domains. Other 6 domains keep using projection scan + source_key JOIN (which works for them because their source_keys are NOT degenerate).
- **Master.legacy_id is computed by TypeScript and stored.** If we ever change the TypeScript `deterministicUuid()` algorithm, the raw_events.legacy_id computed in SQL MUST be regenerated. E3 documents the algorithm parity requirement in migration 0017's comment.
- **The new `promote.ts` raw_events-direct path for ctacte/ctacte1 SKIPS the projection filter** (`pe.source_key = re.source_key`), which means it processes raw_events rows that don't have a corresponding projection row. This is INTENTIONAL for E3 (projection is empty) but could regress if projection is later rebuilt. Comment in promote.ts documents this as "E3 N14 closure path; works regardless of projection state". Future slice (E3+) can unify the path if projection is rebuilt for ctacte/ctacte1.

---

## 10. Dependencies

All confirmed shipped.

| Dependency | What E3 needs | Status |
|------------|---------------|--------|
| **E2 v0.5.6** (commit `6f98b5c`) | `raw_events.promoted_at` column + `raw_events_promoted_at_idx` index + admin API + runbook "Known Limitations" section (N14 documented) + `promote.ts` JOIN filter via `promoted_at IS NULL` + `dedup.ts` cross-check | ✅ shipped 2026-06-25 |
| **E1b2b v0.5.5** (commit `36ac630`) | Migration 0015 (gastos) + FINAL atomic canonical sync + `scripts/verify-slice.sh` extended to 8 tables (commit `304f37a`/`061be50`) | ✅ shipped 2026-06-25 |
| **E1b2a v0.5.4** (commit `b8d8e43`) | Migration 0014 (4 NEW master tables) + 4 NEW transforms | ✅ shipped 2026-06-25 |
| **E1b1 v0.5.2/v0.5.3** (commit `4a29571`) | Migration 0013 (`legacy_id` UNIQUE INDEX for ctacte/ctacte1) + `deterministicUuid()` helper in `transform-helpers.ts:19-26` (THE reference for the E3 SQL function mirror) | ✅ shipped 2026-06-24 |
| **E1a v0.5.1** (commit `bc6aa60`) | `packages/promotion/` skeleton + 3 priority domain transforms | ✅ shipped 2026-06-24 |
| **Slice D v0.5.0** | CI/CD pipeline + `.github/workflows/deploy.yml` | ✅ shipped 2026-06-24 |
| **`packages/db`** v0.5.6 | `createDb({ connectionString })`; 17 migrations applied (idx 0-16, journal ends at idx 16); Drizzle `pgTable` with `partial uniqueIndex` support + `sql\`${table.col} IS NOT NULL\`` WHERE clause pattern | ✅ shipped |
| **`pgcrypto`** PostgreSQL extension | SHA-256 `digest()` function (one-time install in 0017) | ✅ **AVAILABLE** (verified live 2026-06-25 via `SELECT * FROM pg_available_extensions WHERE name = 'pgcrypto'` → name=pgcrypto, default_version=1.3, installed_version=NULL → install will succeed per locked decision Q4) |
| **PostgreSQL 17.6** | `get_byte()`, `set_byte()`, `digest()`, `encode()`, `substring()` PL/pgSQL functions used in `promotion_deterministic_uuid` | ✅ verified live (DB is PG 17.6) |

**No new external dependencies.** E3 adds zero npm packages. Only adds the pgcrypto PostgreSQL extension (one-time, no npm impact).

---

## 11. Open questions (all RESOLVED + LOCKED 2026-06-25)

All 5 user-confirmed decisions from the E3 explore (§10) are LOCKED. **No open questions remain for tasks phase.**

| # | Question | Resolved value | Source |
|---|----------|----------------|--------|
| **Q1** | Backfill strategy | **pgcrypto SHA-256** via `promotion_deterministic_uuid()` SQL function (Option 1 from exploration §5) | E3 explore Q1 default + user-confirmed 2026-06-25 |
| **Q2** | Promote algorithm path for ctacte/ctacte1 | **Read DIRECTLY from `raw_events`** (Option A from exploration §5) — bypasses empty projection tables; filter `WHERE legacy_id IS NOT NULL AND promoted_at IS NULL` | E3 explore Q2 default + user-confirmed 2026-06-25 |
| **Q3** | Hash parity verification | **Run 5 known inputs through BOTH TypeScript AND PostgreSQL during apply; assert byte-for-byte equality** (CRITICAL GATE — migration 0018 REJECTED if parity fails) | E3 explore Q3 default + user-confirmed 2026-06-25 |
| **Q4** | pgcrypto install permission | **Pre-check before migration 0017 via `SELECT * FROM pg_available_extensions WHERE name = 'pgcrypto'`; surface clear error if `CREATE EXTENSION` fails** | E3 explore Q4 default + user-confirmed 2026-06-25 |
| **Q5** | Success criterion | **≥88% ctacte1 promotion rate** (NOT 100%) | E3 explore Q5 default + user-confirmed 2026-06-25 |
| **Q6** | Other 6 domains promotion path | **UNCHANGED — continue reading from projection tables** | E3 explore clarification |
| **Q7** | Drizzle schema update | **Add `legacyId` column + `legacyIdIdx` partial UNIQUE INDEX** | E3 explore clarification |
| **Q8** | Bulk UPDATE on success | **UPDATE `WHERE id = ANY($insertedRawEventIds)`** (raw_events UUID PK) — replaces degenerate `WHERE source_key = ANY(...)` | E3 explore clarification |
| **Q9** | Dedup strategy for ctacte/ctacte1 | **Union of `master.legacy_id` + `raw_events.legacy_id`** + E2's `promoted_at` cross-check | E3 explore clarification |

**9 LOCKED decisions (5 user-confirmed Q1-Q5 + 4 clarifications Q6-Q9).** E3 scope is fully bounded — no further open questions.

---

## 12. Ready for tasks?

**YES.** The scope is precisely bounded:

- **1 NEW column** (`raw_events.legacy_id`) + **1 NEW SQL function** (`promotion_deterministic_uuid`) + **1 NEW partial UNIQUE INDEX** + **1 NEW algorithm path** (raw_events-direct for ctacte/ctacte1 ONLY) + **1 NEW `verify-slice.sh` Step 7** + **1 NEW runbook sub-section** + **1 NEW canonical-spec requirement**
- **~280 raw LoC / ~180 effective** — well under the 400-line review budget at both counts (~70% at raw, ~45% at effective; no chained PRs needed)
- **All 9 decisions locked** (Q1-Q5 user-confirmed + Q6-Q9 clarifications)
- **All 3 corrections from explore embedded explicitly** (N14 = 3-layer problem, `raw_events.source_key` degenerate, ~88% realistic NOT 100%)
- **All E1b/E1b2a/E1b2b/E2 LESSONs applied**: `bash scripts/verify-slice.sh` is HARD GATE (E1b/E1b2a/E1b2b/E2 non-negotiable per commit `b26896c`); migration via `psql` (E1b1); existing `promote.test.ts` stays `describe.skip` (E1b2a TRUNCATE bug); new `uuid-parity.test.ts` is a PURE FUNCTION test (no destructive setup); apply sub-agent MUST save `apply-progress` to engram (E2 UNFIXED LESSON)
- **All B1b LESSONs applied**: atomic canonical sync (additive only, B1b LESSON #1 HIGHEST — existing Promotion Pipeline + tesoreria.gastos + E2 Admin Promotion Trigger + E2 Per-row Promotion Audit + E2 Runbook Documentation all UNCHANGED); separate release commit (B1b LESSON #2); cherry-pick reorder (B1b LESSON #3); merge-before-delete (B1b LESSON #4)
- **E3 is the FIRST post-Slice E slice** (others deferred: async scheduler, analytics, multi-region) — no further sub-slices planned immediately after E3

**Risk Level**: **Medium** — algorithmic change (raw_events-direct path) + new SQL function + hash parity dependency, but well-mitigated by hash parity test as a CRITICAL hard gate.

**Next step**: sdd-tasks → break into 12 work-units (TASK-001..TASK-012 per §7). Then sdd-apply → wire raw_events.legacy_id + pgcrypto backfill + raw_events-direct algorithm with strict TDD discipline + **`bash scripts/verify-slice.sh`** (E1b/E1b2a/E1b2b/E2 LESSON — non-negotiable) + hash parity test as CRITICAL GATE. Then sdd-archive → sync this spec delta into `openspec/specs/deployment-devops/spec.md` to close N14 permanently (additive only per B1b LESSON #1).

**Apply-phase CRITICAL reminders (all in acceptance criteria):**

1. **Hash parity test is the CRITICAL GATE** (locked decision Q3). The test MUST run BEFORE migration 0018 is applied. If ANY of the 5 known inputs diverges between TypeScript `deterministicUuid()` and PostgreSQL `promotion_deterministic_uuid()`, migration 0018 MUST NOT be applied — the SQL function in 0017 is regenerated until parity matches. The function output is the dedup key for ~571k rows; a mismatch silently corrupts cross-run idempotency.
2. **`bash scripts/verify-slice.sh` is the REAL pre-merge gate** — NOT the unit tests (existing `promote.test.ts` stays `describe.skip` per E1b2a LESSON re: TRUNCATE bug fix). Step 7 assertions (legacy_id coverage ≥99.9% + ctacte1 rate ≥88%) MUST pass before declaring ready. **No merge until `verify-slice.sh` exits 0 (PASS).**
3. **Migration via `psql`** (NOT `drizzle-kit migrate`) — E1b1 LESSON re: `_journal.json` tracking mismatch. Manual idx-17 + idx-18 `_journal.json` entries.
4. **pgcrypto pre-check** at apply time: `SELECT * FROM pg_available_extensions WHERE name = 'pgcrypto'` BEFORE running 0017. **Verified AVAILABLE live 2026-06-25** (default_version 1.3, NOT installed). If extension is NOT available OR `CREATE EXTENSION` returns `ERROR: permission denied`, apply phase surfaces this to orchestrator immediately and aborts. Fallback deferred to E3+ (Option 2 TypeScript backfill script — slower but doesn't require pgcrypto).
5. **3-commit shape preserved** per B1b LESSON: `feat(promotion+db)` → `docs(spec+runbook)` → `chore(release)`. No `Co-Authored-By` in any commit. Merge to `main` BEFORE `git branch -D` (B1b LESSON #4).
6. **Additive-only atomic sync** (B1b LESSON #1, HIGHEST) — apply MUST verify `diff openspec/specs/deployment-devops/spec.md openspec/changes/.../specs/deployment-devops/spec.md` returns ONLY additive changes. No removals, no rewrites of prior Slice E scenarios. The existing Promotion Pipeline requirement (canonical lines 167-276), `tesoreria.gastos` requirement (lines 280-315), E2 Admin Promotion Trigger (lines 622-672), E2 Per-row Promotion Audit (lines 675-714), and E2 Runbook Documentation (lines 717-740) SHALL remain UNCHANGED.
7. **Apply sub-agent saves `mem_save` to engram** (E2 UNFIXED LESSON) — apply prompt EXPLICITLY mandates `mem_save(title: 'sdd/.../apply-progress', topic_key: 'sdd/.../apply-progress', type: 'architecture', project: 'athlos', capture_prompt: false)` after each task. Orchestrator verifies the save exists before declaring apply complete. If missing, apply sub-agent is re-invoked with a save-only follow-up task.

---

## 13. Reference files (for apply sub-agent)

| Path | What it tells us |
|------|------------------|
| `packages/promotion/src/transform-helpers.ts:19-26` | **THE reference implementation** for `deterministicUuid()` — TypeScript SHA-256 + version=5 nibble + variant=10 bits + UUID formatting. The SQL function in migration 0017 mirrors this byte-for-byte. Apply phase reads this file CAREFULLY before writing 0017. |
| `packages/promotion/src/promote.ts:85-101` | Existing projection scan code — E3 adds NEW branch BEFORE this for ctacte/ctacte1 ONLY |
| `packages/promotion/src/promote.ts:155-162` | Existing bulk UPDATE `WHERE source_key = ANY(...)` — E3 REPLACES this with `WHERE id = ANY($insertedRawEventIds::uuid[])` for ctacte/ctacte1 |
| `packages/promotion/src/dedup.ts:122-149` | Existing `loadExistingNaturalKeys` for ctacte + ctacte1 (master.legacy_id + raw_events.promoted_at) — E3 ADDS raw_events.legacy_id cross-check |
| `packages/db/src/schema/public.ts:194-227` | `rawEvents` table definition — E3 adds `legacyId` column (after `promotedAt` at line 211) + `legacyIdIdx` partial UNIQUE INDEX (after `promotedAtIdx` at line 225) |
| `packages/db/drizzle/0016_promoted_at.sql` | Most recent migration pattern — E3's 0017 + 0018 mirror this structure (hand-written, idempotent via IF NOT EXISTS, applied via psql) |
| `packages/db/drizzle/meta/_journal.json` | Last entry idx 16 (tag `0016_promoted_at`, E2) — E3 adds idx 17 + idx 18 entries |
| `scripts/verify-slice.sh:28-37` | `MASTER_TABLES` array — already includes all 8 domains post-E1b2b (commit `304f37a`/`061be50`); E3 doesn't modify this |
| `scripts/verify-slice.sh:111-118` | `pnpm db:promote` invocation — E3's algorithm update changes what `db:promote` does for ctacte/ctacte1 |
| `scripts/verify-slice.sh:161-171` | Step 6 verdict — E3 adds NEW Step 7 AFTER this |
| `docs/runbook.md:421-632` | E2's "Promotion Pipeline" section — E3 updates N14 row + adds new "E3 N14 Closure" sub-section |
| `docs/runbook.md:629-631` | N14 row in "Known Limitations" sub-section — E3 updates to "RESOLVED in v0.5.7 (E3)" |
| `openspec/specs/deployment-devops/spec.md:167-276` | Existing Promotion Pipeline requirement — E3 ADDS 1 NEW requirement, doesn't modify this |
| `openspec/specs/deployment-devops/spec.md:280-315` | Existing `tesoreria.gastos` requirement — E3 doesn't modify this |
| `openspec/specs/deployment-devops/spec.md:622-740` | E2 Admin Promotion Trigger + Per-row Audit + Runbook Documentation requirements — E3 doesn't modify these |
| `openspec/specs/deployment-devops/spec.md:749` | Success criteria end at #51 (post-E2) — E3 adds #52 |
| `openspec/changes/athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill/specs/deployment-devops/spec.md` | E3 spec delta (278 lines, id 2575) — apply phase syncs this to canonical spec by appending verbatim (B1b LESSON #1, additive only) |
| `openspec/changes/athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill/proposal.md` | E3 proposal (597 lines, id 2571) — reference for design rationale + acceptance criteria |
| Engram #2531 | E1b/E1b2a/E1b2b LESSONs (`verify-slice.sh` gate + TRUNCATE bug fix + migration via psql) |
| Engram #2537 | E1b2b design (final atomic sync pattern) |
| Engram #2550 | E2 design (admin API + promoted_at + runbook + post-Slice E spec polish) |
| Engram #2567 | E3 explore findings (N14 actual state, raw_events 5-tuple uniqueness, pgcrypto available, 3 corrections) |
| Engram #2571 | E3 proposal (5 LOCKED decisions + 5 SUB-AGENT CORRECTIONS) |
| Engram #2575 | E3 spec delta (1 NEW requirement + 4 NEW scenarios + 1 NEW success criterion #52) |
| Live DB: `192.168.1.102:5432/athlos` | Verify state pre/post-apply: `raw_events` (652,661 rows, no `legacy_id`); 8 master tables populated (ctacte=197,521, ctacte1=150,129); projection tables EMPTY for ctacte/ctacte1; pgcrypto AVAILABLE (default_version 1.3, NOT installed); verify-slice.sh exits 0; 0 rows have any 5-tuple field NULL for ctacte + ctacte1 (safe to backfill 571,645 rows) |

---

*Persisted to:*
- *`openspec/changes/athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill/design.md` (this file)*
- *Engram topic `sdd/athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill/design` (via `mem_save`)*
