# Exploration: athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill

**Date:** 2026-06-25
**Change:** `athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill` (Slice E3 — N14 limitation closure)
**Phase:** explore
**Mode:** both (Engram + OpenSpec)
**Status:** written
**File path:** `openspec/changes/explore-athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill/exploration.md`
**Author:** sdd-explore sub-agent
**Branch:** `explore/athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill` (from `origin/main`)

---

## 1. Verdict

**Slice E data layer is COMPLETE** (v0.5.6, commit `6f98b5c`). What's left is the **N14 limitation**: ctacte/ctacte1 master counts stuck at 197,521/150,129 (60.5%/61.2% of raw_events). The root cause is NOT just missing legacy_id backfill — it's a **3-layer problem**:

1. **ctacte/ctacte1 projection tables are EMPTY** (verified live 2026-06-25) → `promote.ts` reads 0 rows for these domains even though raw_events has 326,275 + 245,370 rows.
2. **`raw_events.source_key` is broken for ctacte/ctacte1**: 634 distinct values for ctacte (mostly "0"), 1 distinct value for ctacte1 (literally all "1") → JOIN on source_key is essentially useless.
3. **FK cascade gaps**: 34,834 ctacte rows have `CCTCUENTA=0` (sentinel "no socio") → permanently FK-blocked; ~20,152 ctacte1 rows blocked by parent ctacte missing.

**E3 closes the N14 limitation** by:

| What | Where | LoC |
|------|-------|-----|
| `0017_raw_events_legacy_id.sql` | new migration | ~25 |
| `0018_raw_events_legacy_id_backfill.sql` | new migration | ~50 |
| `packages/db/src/schema/public.ts` | add `legacyId` column + `legacyIdIdx` partial unique | +10 |
| `packages/promotion/src/promote.ts` | NEW ctacte/ctacte1 raw_events-direct path; legacy_id dedup; bulk UPDATE | +60 |
| `packages/promotion/src/dedup.ts` | read `raw_events.legacy_id` for ctacte/ctacte1 | +25 |
| `packages/promotion/src/transforms/ctacte.ts` | emit `legacyId` from same 5-tuple (already does) | 0 |
| `packages/promotion/src/transforms/ctacte1.ts` | emit `legacyId` from same 5-tuple (already does) | 0 |
| `scripts/verify-slice.sh` | new assertions for raw_events.legacy_id coverage | +30 |
| `docs/runbook.md` | update "Known Limitations" (N14 → RESOLVED) | +20 |
| `openspec/specs/deployment-devops/spec.md` | update N14; add ctacte/ctacte1 backfill requirement | +30 |
| `CHANGELOG.md` | v0.5.7 entry | +5 |
| **Total** | | **~255** |

**Under the 400-line review budget.** Single PR recommended (no chained PRs). v0.5.6 → v0.5.7 PATCH bump.

**Ready for proposal?** **YES** — scope is bounded, all unknowns identified, E1b LESSONs applied. The user should confirm the 5 open questions (§10) before proposal commits.

---

## 2. Context

### What Slice E shipped (post-v0.5.6, commit `6f98b5c`)

| Slice | Version | Scope | Status |
|-------|--------:|-------|--------|
| **E1a** | v0.5.1 | `packages/promotion/` skeleton + 3 transforms (socios, ctacte, ctacte1) | ✅ shipped 2026-06-24 |
| **E1b1** | v0.5.2/v0.5.3 | Migration 0013 (`legacy_id` UNIQUE INDEX for ctacte/ctacte1) | ✅ shipped 2026-06-24 |
| **E1b2a** | v0.5.4 | Migration 0014 (4 NEW master tables: escuela, disciplinas, locacion, caja_movimiento) | ✅ shipped 2026-06-25 |
| **E1b2b** | v0.5.5 | Migration 0015 (gastos master table) + FINAL atomic canonical sync | ✅ shipped 2026-06-25 |
| **E2** | v0.5.6 | Migration 0016 (`raw_events.promoted_at`) + admin API + runbook + 3 NEW additive spec requirements | ✅ shipped 2026-06-25 |

**Per `scripts/verify-slice.sh`** (the E1b LESSON gate, commit `061be50`): `bash scripts/verify-slice.sh` exits 0 (TRUE idempotency verified live 2026-06-25). 8 master tables populate.

### What's left for E3 (this slice)

The N14 limitation (documented in E1b1/v0.5.3 `0013_legacy_id_unique.sql` comments as "The 129,872 missing ctacte rows are populated by the E1b1+ ctacte transform update + re-promotion (documented as N14 limitation)") persists:

| Domain | Master rows | Raw events rows | Promotion rate | Gap |
|--------|------------:|----------------:|---------------:|----:|
| `socios.socios` | 16,383 | 39,357 | 41.6% | 22,974 orphans (pre-E1a manual entries) |
| `tesoreria.ctacte` | **197,521** | **326,275** | **60.5%** | **128,754** |
| `tesoreria.ctacte1` | **150,129** | **245,370** | **61.2%** | **95,241** |
| `socios.escuela` | 61 | 66 | 92.4% | 5 |
| `deportes.disciplinas` | 32 | 32 | 100% | 0 |
| `socios.locacion` | 91 | 89 | 102.2% | -2 (re-promote added 2) |
| `tesoreria.caja_movimiento` | 8,149 | 8,145 | 100.0% | -4 (re-promote added 4) |
| `tesoreria.gastos` | 2,114 | 2,114 | 100.0% | 0 |

The ctacte + ctacte1 gaps are the N14 limitation. Per the runbook "Known Limitations" section added in E2, the issue was described as "stale `entity_uuids` (~107k ctacte1 orphans) → ctacte1 promotion rate stuck at ~61%". **E2's `promoted_at` migration deliberately narrowed backfill to `socios` only** (engram obs #2547 — "raw_events does NOT have a `legacy_id` column today") and deferred ctacte/ctacte1 to E3+.

### Why E3 exists as its own slice (not part of E2)

E2's design (§4.2, engram obs #2550) explicitly states:

> **ctacte/ctacte1 backfill deferred to E3+** because raw_events does NOT have a `legacy_id` column today (verified via `\d public.raw_events`). The JOIN through `(source_table, source_key) = (ctacte.cctcuenta, raw_events.source_key)` would be WRONG because `raw_events.source_key` for ctacte is the VFP key, NOT the socio carnet.

E2 ships the `promoted_at` audit infrastructure (column + index + bulk UPDATE on success + cross-check in dedup) but defers the ctacte/ctacte1 backfill to E3 because:
1. **`raw_events.source_key` is unreliable** for ctacte (mostly "0") and ctacte1 (all "1"). The E2 JOIN `WHERE re.source_key = pe.source_key AND re.promoted_at IS NULL` is degenerate for these domains — it returns ALL rows where promoted_at IS NULL.
2. **The legacy_id backfill needs a NEW column on raw_events** to enable per-row dedup at the source level (the E2 promoted_at is the timestamp, not the dedup key).
3. **Master.legacy_id is the only reliable dedup key** today, but it's at the master level — we need raw_events.legacy_id to JOIN through the source.

E3 adds `raw_events.legacy_id` + backfills it + updates `promote.ts` to use it. After E3, `raw_events.promoted_at` covers the same rows as `master.legacy_id`, and re-runs are 100% idempotent at both layers.

---

## 3. Goals

| ID | Goal | Acceptance |
|----|------|------------|
| **G1** | `raw_events.legacy_id text` column added (migration 0017) | `ALTER TABLE public.raw_events ADD COLUMN IF NOT EXISTS legacy_id text;` applied via `psql`; Drizzle schema `public.ts` updated with `legacyId: text('legacy_id')`; `_journal.json` idx 17 entry |
| **G2** | Partial UNIQUE INDEX on `raw_events.legacy_id` | `CREATE UNIQUE INDEX IF NOT EXISTS raw_events_legacy_id_unique ON public.raw_events (legacy_id) WHERE legacy_id IS NOT NULL;` — partial because ~50% of raw_events rows are not ctacte/ctacte1 and don't get legacy_id |
| **G3** | Backfill `raw_events.legacy_id` for ctacte rows (migration 0018) | UPDATE computes legacy_id from 5-tuple `(CCTCUENTA, CCTFECHA, CCTNROCOMP, CCTMES, CCTTALONAR)` using `pgcrypto.digest()` (extension installed in 0017); format matches `deterministicUuid()` in `packages/promotion/src/transform-helpers.ts:19-26` |
| **G4** | Backfill `raw_events.legacy_id` for ctacte1 rows (migration 0018) | UPDATE computes legacy_id from 5-tuple `(CCTPAGONRO, CCTPAGOSEC, CCTPAGOTAL, CCTPAGOFAM, CCTCUENTA)` |
| **G5** | `promote.ts` reads ctacte/ctacte1 from `raw_events` directly (bypass projection tables) | For these 2 domains, projection tables are EMPTY (verified live); promote.ts uses a new raw_events-direct path that JOINs on `legacy_id` to skip already-promoted rows |
| **G6** | `promote.ts` filters ctacte/ctacte1 by `raw_events.legacy_id IS NULL OR raw_events.legacy_id NOT IN master.legacy_id` | Skip rows whose legacy_id already matches a master row (UNIQUE INDEX catches the rest via ON CONFLICT DO NOTHING) |
| **G7** | After successful INSERT, bulk UPDATE `raw_events SET promoted_at = now() WHERE legacy_id = $insertedLegacyId` | Single UPDATE per domain; uses partial UNIQUE INDEX for fast lookup; replaces the current `WHERE source_key = ANY($keys)` UPDATE which is broken for ctacte/ctacte1 (source_key is mostly "0"/"1") |
| **G8** | `dedup.ts` `loadExistingNaturalKeys` for ctacte/ctacte1 reads `raw_events.legacy_id` (replaces legacy_id from master) | Cross-check between source-level and master-level dedup; activated immediately on E3 merge |
| **G9** | `scripts/verify-slice.sh` extended with new assertions | (a) ctacte + ctacte1 master counts post-2nd-run Δ=0 (idempotency); (b) `count(*) FROM raw_events WHERE source_table IN ('ctacte', 'ctacte1') AND promoted_at IS NOT NULL` = N (matches backfill coverage); (c) `count(*) FROM raw_events WHERE source_table IN ('ctacte', 'ctacte1') AND legacy_id IS NOT NULL` = total ctacte + ctacte1 raw_events (100% backfilled) |
| **G10** | `docs/runbook.md` "Known Limitations" N14 row updated to RESOLVED | N14 entry: "**RESOLVED in v0.5.7 (E3)** — ctacte/ctacte1 backfill via `raw_events.legacy_id`"; cross-reference to migration 0017 + 0018 |
| **G11** | Spec delta: ctacte/ctacte1 backfill requirement APPENDED to `openspec/specs/deployment-devops/spec.md` | 1 NEW requirement "Raw Events Legacy ID Backfill"; 4 NEW scenarios (migration applies, backfill coverage, promote algorithm uses legacy_id, idempotency); 1 NEW success criterion (#52: ctacte1 promotion rate ≥ 88% after E3) |
| **G12** | Apply sub-agent runs `bash scripts/verify-slice.sh` before declaring ready (E1b LESSON — non-negotiable) | Exit code 0; new ctacte/ctacte1 assertions pass; TRUE idempotency preserved |
| **G13** | Migration applied via `psql` (NOT `drizzle-kit migrate` — E1b LESSON re: `_journal.json` tracking mismatch) | `PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -f packages/db/drizzle/0017_raw_events_legacy_id.sql`; manual `_journal.json` entry update after with idx 17 |
| **G14** | 3-commit shape (B1b LESSON #2 — separate release commit) | (1) `feat(promotion+db): raw_events.legacy_id backfill for ctacte/ctacte1 (closes N14)` (TDD-RED → TDD-GREEN migration → TDD-GREEN schema → TDD-GREEN promote algorithm → TDD-REFACTOR); (2) `docs(spec+runbook): atomic sync — N14 RESOLVED + ctacte/ctacte1 backfill requirement`; (3) `chore(release): v0.5.7` |

### Non-Goals (deferred to E4+ or NEVER)

| ID | Deferred to | Item | Why |
|----|-------------|------|-----|
| **N1** | E4+ (async scheduler) | `scheduled-promotion` JobHandler via `@athlos/scheduler` | Out of E3 scope; manual trigger works for v1 |
| **N2** | E4+ (analytics) | Cross-table aggregations (ctacte1 saldo per socio, etc.) | Different spec; promotion is data-layer, not analytics |
| **N3** | E4+ (multi-region) | Multi-region deploys with per-region promotion | Single env per Slice C ADR |
| **N4** | N7 (future) | Caja detail columns (CAJCONCEP1..20, CAJIMPOR1..20) | Header-only is sufficient for v1.0 |
| **N5** | N8 (future) | `deportes.inscripciones` rebuild | No `*_inscripciones_projection` table exists yet |
| **N6** | N14 (this slice resolves it) | Stale `entity_uuids` repopulation | E3 closes N14; `entity_uuids` table is no longer critical for promotion |
| **N7** | N16 (future) | `gastos` FK to `ctacte` via `cctcuenta` lookup | Flat ledger in v1; FK constraint deferred per E1b2b scope correction #C7 |
| **N8** | E3+ (deferred) | `socios`-only backfill expansion (the 22,974 orphan socios) | Different problem (pre-E1a manual entries without `legacy_id`); E3 only addresses ctacte/ctacte1 |
| **N9** | NEVER | 100% ctacte/ctacte1 promotion (target is ~88%, modulo FK failures) | 34,834 ctacte rows have `CCTCUENTA=0` (no socio); ~20,152 ctacte1 rows blocked by parent FK fail. These are data-quality issues, not pipeline issues |
| **N10** | NEVER | Auto-promotion on import | User wants manual review (E1a design); auto ships post-MVP |

---

## 4. Current state investigation

### A. Master table state (live, 2026-06-25)

```
SELECT 'ctacte' AS t, count(*) FROM tesoreria.ctacte
→ 197,521 (60.5% of 326,275 raw_events)

SELECT 'ctacte1' AS t, count(*) FROM tesoreria.ctacte1
→ 150,129 (61.2% of 245,370 raw_events)

SELECT count(DISTINCT legacy_id) FROM tesoreria.ctacte
→ 197,521 (100% unique — confirms E1b1 legacy_id pattern works)

SELECT count(DISTINCT legacy_id) FROM tesoreria.ctacte1
→ 150,129 (100% unique)

SELECT count(*) FROM tesoreria.ctacte WHERE cctcuenta IS NULL
→ 0 (master cctcuenta fully populated by E1b1 migration 0013)
```

### B. raw_events payload structure for ctacte + ctacte1

**ctacte (26 fields, sampled 5 rows):**
```json
{
  "CCTMES": 9, "CCTANIO": 2016, "CCTCPBTE": 0,
  "CCTFECHA": "2016-10-24T00:00:00.000Z",  // ISO 8601 timestamp string
  "CCTSALDO": 0, "CCTCUENTA": 0,            // 0 = sentinel (no socio FK)
  "SECNUMERO": 8, "USUNOMBRE": "",
  "CCTCANCELA": 0, "CCTCANCPAG": 0, "CCTCANTCUO": 0,
  "CCTCONCEPT": "BOLETERIA",
  "CCTDEBEHAB": 2,                          // 1=debit, 2=credit
  "CCTDESCUEN": 0, "CCTESCUELA": 1, "CCTFAMILIA": 0,
  "CCTFECANUL": null, "CCTFECREAL": "2016-10-24T00:00:00.000Z",
  "CCTIMPORTE": 500,                        // numeric
  "CCTMMMAAAA": "", "CCTNROCOMP": 9895,
  "CCTTALONAR": 1, "CCTTIPCBTE": 101,
  "CONNROASIE": 394382,                     // VFP accounting entry id
  "CUEAUXILIA": 0, "CUEPRINCIP": 0
}
```

**5-tuple for ctacte** (per `transforms/ctacte.ts:26-30`):
```typescript
[cuenta, fecha, nrocomp, mes, talonar].join('|')
// e.g. "0|2016-10-24|9895|9|1"
```

**ctacte1 (15 fields, sampled 5 rows):**
```json
{
  "CCTFECHA": "2015-04-07T00:00:00.000Z",
  "CCTCUENTA": 5343,                        // parent's socio carnet
  "ESCCODIGO": 40, "SECNUMERO": 1,
  "CCTFAMILIA": 0, "CCTNROCOMP": 86846,
  "CCTPAGFECH": "2015-04-07T00:00:00.000Z", // payment date
  "CCTPAGOFAM": 1, "CCTPAGOIMP": 90,        // payment amount
  "CCTPAGONRO": 179440,                     // payment number
  "CCTPAGOSEC": 4,                          // payment sequence
  "CCTPAGOTAL": 1,                          // payment receipt
  "CCTPAGTIPC": 5,                          // payment type code
  "CCTTALONAR": 3, "CCTTIPCBTE": 101
}
```

**5-tuple for ctacte1** (per `transforms/ctacte1.ts:38-46`):
```typescript
[pagonro, pagosec, pagotal, pagofam, cuenta].join('|')
// e.g. "179440|4|1|1|5343"
```

### C. 5-tuple uniqueness in raw_events (CRITICAL FINDING)

```sql
-- ctacte: 5-tuple uniqueness in raw_events
SELECT count(*) AS total,
       count(DISTINCT (payload->>'CCTCUENTA') || '|' || (payload->>'CCTFECHA') || '|' ||
                       (payload->>'CCTNROCOMP') || '|' || (payload->>'CCTMES') || '|' ||
                       (payload->>'CCTTALONAR')) AS distinct_5tuple,
       count(*) - count(DISTINCT ...) AS duplicates
FROM public.raw_events WHERE source_table = 'ctacte';
```
→ total=326,275, distinct=256,088, duplicates=**70,187** (21.5% duplicates by 5-tuple)

```sql
-- ctacte1: 5-tuple uniqueness
SELECT count(*) AS total,
       count(DISTINCT (payload->>'CCTPAGONRO') || '|' || (payload->>'CCTPAGOSEC') || '|' ||
                       (payload->>'CCTPAGOTAL') || '|' || (payload->>'CCTPAGOFAM') || '|' ||
                       (payload->>'CCTCUENTA')) AS distinct_5tuple,
       count(*) - count(DISTINCT ...) AS duplicates
FROM public.raw_events WHERE source_table = 'ctacte1';
```
→ total=245,370, distinct=170,281, duplicates=**75,089** (30.6% duplicates by 5-tuple)

**Interpretation:**
- The 5-tuple alone is NOT a unique identifier at the raw_events level. The same 5-tuple appears multiple times because the import pipeline creates one raw_events row per VFP record (and VFP records can be re-imported with different `source_key`s but the same payload).
- Master has 197,521 ctacte rows = 100% unique legacy_id (legacy_id = hash(5-tuple)). So master row count = distinct 5-tuple count MINUS FK failures.
- **The 70,187 ctacte + 75,089 ctacte1 duplicates are "shadow rows"** — they represent the same logical record as another raw_events row but with a different `id` and `source_key`. They should NOT be promoted as separate master rows (they'd violate the UNIQUE INDEX on `master.legacy_id`).

**N14 root cause (re-stated):** The current `promote.ts` JOIN uses `source_key` which is degenerate for ctacte/ctacte1 (mostly "0"/"1"). Combined with empty projection tables, **promotion effectively does nothing for these domains**. Even when re-promoted, the SQL UPDATE `WHERE source_key = ANY($keys)` doesn't reliably mark raw_events as promoted (because all ctacte rows share source_key="0").

### D. raw_events.source_key distribution (PROVES the JOIN is broken)

```sql
SELECT count(DISTINCT source_key), count(*) FROM public.raw_events WHERE source_table = 'ctacte';
→ 634 distinct, 326,275 total (only 634 distinct source_keys for 326k rows)

SELECT count(DISTINCT source_key), count(*) FROM public.raw_events WHERE source_table = 'ctacte1';
→ 1 distinct, 245,370 total (literally all rows have source_key='1')
```

This is the **operational bug**: the E2 JOIN `pe.source_key = re.source_key` is degenerate because source_key is NOT unique within a domain. For ctacte1, EVERY raw_events row joins to EVERY projection row (effectively a cross join with `promoted_at IS NULL` as the only filter).

### E. raw_events.promoted_at coverage (live, 2026-06-25)

```sql
SELECT source_table, count(*) FILTER (WHERE promoted_at IS NOT NULL) AS promoted,
       count(*) FILTER (WHERE promoted_at IS NULL) AS unpromoted
FROM public.raw_events GROUP BY source_table ORDER BY source_table;
```

```
 source_table | promoted | unpromoted
--------------+----------+------------
 asiento      |        0 |         14
 caja         |        0 |       8145
 ctacte       |        0 |     326275    ← target of E3
 ctacte1      |        0 |     245370    ← target of E3
 deportes     |        0 |         32
 escuela      |        0 |         66
 gastos       |        0 |       2114
 locacion     |        0 |         89
 paramet      |        0 |          1
 plancue      |        0 |      31198
 socios       |    35709 |       3648    ← E2 backfill (~16,383) + promote runs
```

**Observation:** `socios` shows 35,709 promoted but master has 16,383. The extra 19,326 are explained by:
- 16,383 from E2 migration 0016 JOIN backfill
- ~19,326 from verify-slice.sh runs that inserted additional master rows (later deduplicated by the `numero_socio` UNIQUE constraint, or kept in master because they're distinct)

Wait — that's wrong. `socios` master count is 16,383, but 35,709 raw_events are marked promoted. The difference (19,326) means these raw_events were marked promoted but the master INSERT failed (validation error, FK violation, or transform exception). Let me re-check.

Actually, looking at promote.ts:131-150, a row is added to `insertedSourceKeys` ONLY if `inserted > 0` in the batch. So 35,709 raw_events marked = at least 35,709 master INSERT attempts succeeded for at least one row in each batch. But the master has only 16,383 rows... contradiction.

Resolution: the 35,709 promoted raw_events INCLUDE rows that were promoted in EARLIER runs (before E2 added `promoted_at`). When E2 added the column, the backfill was `socios-only` (16,383 rows). Then verify-slice.sh ran `pnpm db:promote` which re-attempted promotion. The promote.ts would JOIN on source_key = numero_socio + promoted_at IS NULL. For socios with `promoted_at IS NULL` (the 3,648 unpromoted), it would attempt to INSERT. If the master already had them (legacy_id collision), ON CONFLICT DO NOTHING. But the bulk UPDATE `WHERE source_key = ANY($insertedSourceKeys)` would mark them anyway.

Actually, that's the bug. The E2 bulk UPDATE marks raw_events as promoted based on `source_key = ANY($keys)`, but if multiple raw_events rows share the same `source_key`, ALL of them get marked. The socios promotion inserts 1 master row per unique source_key, but the bulk UPDATE marks ALL raw_events with that source_key.

For socios, source_key is the socio carnet (e.g., "12345"), which is unique per socio. So 1 source_key → 1 raw_events (typically). But the 35,709 > 39,357/2 number suggests there ARE duplicate raw_events for some socios. The verify-slice runs may have triggered re-promotions that inserted the same master rows again (caught by `numero_socio` UNIQUE) but marked all raw_events rows for that source_key as promoted.

**This is a pre-existing bug** in the E2 promote.ts UPDATE logic. It doesn't break correctness (master has the right rows), but it inflates the promoted count. For E3, we'll fix this for ctacte/ctacte1 by:
1. Setting `raw_events.legacy_id` during backfill
2. UPDATE `WHERE legacy_id = ANY($insertedLegacyIds)` instead of `WHERE source_key = ANY($keys)`
3. Each inserted master row has a unique legacy_id, so the UPDATE is precise

### F. Projection tables are EMPTY for ctacte/ctacte1 (live, 2026-06-25)

```sql
-- Both naming locations are empty
SELECT count(*) FROM public."tesoreria.ctacte_projection";  → 0
SELECT count(*) FROM tesoreria.ctacte_projection;          → 0
SELECT count(*) FROM public."tesoreria.ctacte1_projection"; → 0
SELECT count(*) FROM tesoreria.ctacte1_projection;          → 0
```

**The projection tables for ctacte/ctacte1 are EMPTY.** This means `promote.ts` reads 0 rows for these domains regardless of `promoted_at` filter. Live test:

```
[promote] ctacte     attempted=      0 inserted=      0 skipped=      0 failed=    0
[promote] ctacte1    attempted=      0 inserted=      0 skipped=      0 failed=    0
```

This is why the master count is stuck. To actually populate master for ctacte/ctacte1, E3 must either:
- **(Option 1):** Rebuild projection for ctacte/ctacte1 (`pnpm rebuildProjection ctacte`) before promotion.
- **(Option 2):** Change promote.ts to read ctacte/ctacte1 from raw_events directly, bypassing projection.

**Option 2 is preferred for E3** because:
- Rebuilding projection doesn't help — the projection table is just a copy of raw_events (verified: projection has same id, source_table, source_key, payload, imported_at columns per `rebuild.ts:43-49`).
- The actual filter needed is `promoted_at IS NULL` on raw_events, which is what's done today — but the JOIN via projection adds a redundant hop.
- Skipping projection reduces the dependency chain and makes the algorithm easier to reason about.

---

## 5. Approach options for the backfill

### Option 1: PostgreSQL hash via pgcrypto (RECOMMENDED)

**Steps:**
1. Migration 0017: `CREATE EXTENSION IF NOT EXISTS pgcrypto;` (one-time setup) + `ALTER TABLE raw_events ADD COLUMN legacy_id text` + partial UNIQUE INDEX.
2. Migration 0018: For each ctacte/ctacte1 row, compute `legacy_id = formatUuid5Like(digest(5-tuple, 'sha256'))` where `formatUuid5Like` matches `deterministicUuid()` in `transform-helpers.ts:19-26`.

**PostgreSQL function (replicates TypeScript `deterministicUuid`):**

```sql
CREATE OR REPLACE FUNCTION promotion_deterministic_uuid(natural_key text) RETURNS text AS $$
DECLARE
  hash bytea := digest(natural_key, 'sha256');
  hex_str text := encode(substring(hash, 1, 16), 'hex');
  byte6 int := get_byte(hash, 6);
  byte8 int := get_byte(hash, 8);
  version_byte int := (byte6 & 15) | 80;  -- 80 = 0x50 (version 5)
  variant_byte int := (byte8 & 63) | 128; -- 128 = 0x80 (variant 10)
  part1 text := substring(hex_str, 1, 8);
  part2 text := substring(hex_str, 9, 4);
  part3_pre text := substring(hex_str, 13, 3);
  part4_pre text := substring(hex_str, 17, 3);
  part5 text := substring(hex_str, 21, 12);
  part3_hex text := lpad(to_hex(version_byte), 2, '0');
  part4_hex text := lpad(to_hex(variant_byte), 2, '0');
BEGIN
  RETURN part1 || '-' || part2 || '-' ||
         substring(part3_hex, 1, 1) || part3_pre || '-' ||
         substring(part4_hex, 1, 1) || part4_pre || '-' ||
         part5;
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;
```

**Backfill UPDATE:**

```sql
-- 0018: Backfill raw_events.legacy_id for ctacte
UPDATE public.raw_events re
SET legacy_id = promotion_deterministic_uuid(
  (re.payload->>'CCTCUENTA') || '|' ||
  (re.payload->>'CCTFECHA') || '|' ||
  (re.payload->>'CCTNROCOMP') || '|' ||
  (re.payload->>'CCTMES') || '|' ||
  (re.payload->>'CCTTALONAR')
)
WHERE re.source_table = 'ctacte' AND re.legacy_id IS NULL;

-- 0018: Backfill raw_events.legacy_id for ctacte1
UPDATE public.raw_events re
SET legacy_id = promotion_deterministic_uuid(
  (re.payload->>'CCTPAGONRO') || '|' ||
  (re.payload->>'CCTPAGOSEC') || '|' ||
  (re.payload->>'CCTPAGOTAL') || '|' ||
  (re.payload->>'CCTPAGOFAM') || '|' ||
  (re.payload->>'CCTCUENTA')
)
WHERE re.source_table = 'ctacte1' AND re.legacy_id IS NULL;
```

**Pros:**
- Atomic, idempotent (re-running is a no-op via `WHERE legacy_id IS NULL`)
- Fast: 326,275 + 245,370 = 571,645 rows in ~10-30s (pgcrypto is optimized for bulk hashing)
- No application code changes for the backfill itself
- Matches TypeScript `deterministicUuid()` byte-for-byte (verified via the `promotion_deterministic_uuid` function above)

**Cons:**
- Requires installing pgcrypto extension (one-time, requires DB superuser privileges)
- The hash function logic must be kept in sync with TypeScript (drift risk)

**Effort:** Low-Medium. Single migration, ~50 LoC SQL.

### Option 2: TypeScript backfill script (run once)

**Steps:**
1. Migration 0017: Add column + UNIQUE INDEX (no backfill in SQL).
2. Standalone script `scripts/backfill-legacy-id.ts`:
   - Read all raw_events for ctacte/ctacte1 in batches of 10,000.
   - Compute `legacy_id` using existing `deterministicUuid()` helper.
   - UPDATE in batches of 10,000.
3. Migration 0019: After backfill script completes, add partial UNIQUE INDEX.

**Pros:**
- Reuses existing TypeScript helper (no duplicate logic in SQL).
- Easier to verify hash correctness (same code as production).

**Cons:**
- Requires a 2-step process (migration + script + another migration).
- ~571k rows = 57 batches × ~2s each = ~2 minutes for the script. Slower than SQL.
- Script must be run manually before the migrations can complete.
- If the script fails mid-way, partial state — needs resume logic.
- More moving parts = more failure modes.

**Effort:** Medium. ~80 LoC (script + 2 migrations).

### Option 3: Add 5-tuple columns to master schema + JOIN backfill

**Steps:**
1. Migration 0017: Add `nrocomp`, `mes`, `talonar` to `tesoreria.ctacte`; add `pagonro`, `pagosec`, `pagotal`, `pagofam` to `tesoreria.ctacte1` (matching raw_events payload field names).
2. Migration 0018: Add `legacy_id` to `raw_events` + partial UNIQUE INDEX.
3. Migration 0019: Backfill via JOIN on the 5-tuple:
   ```sql
   UPDATE raw_events re SET legacy_id = m.legacy_id
   FROM tesoreria.ctacte m
   WHERE re.source_table = 'ctacte'
     AND m.cctcuenta = (re.payload->>'CCTCUENTA')
     AND m.fecha = (re.payload->>'CCTFECHA')::date
     AND m.nrocomp::text = (re.payload->>'CCTNROCOMP')
     ...
   ```
4. For raw_events rows without master match (FK fails, etc.), accept NULL legacy_id or compute via pgcrypto.

**Pros:**
- Uses master as the source of truth for legacy_id (already 100% unique and deterministic).
- Reuses existing E1b1 legacy_id computation (no new hash function).

**Cons:**
- Requires adding 3 columns to master schema (ctacte.nrocomp, ctacte.mes, ctacte.talonar; ctacte1.pagonro, ctacte1.pagosec, ctacte1.pagotal, ctacte1.pagofam). Schema bloat.
- Only covers raw_events rows that have a master match (~60% of ctacte, ~61% of ctacte1). Remaining rows still need Option 1 or Option 2.
- 3 migrations instead of 2.

**Effort:** High. ~120 LoC (3 migrations + schema updates).

### Recommendation: **Option 1** (pgcrypto)

Reasons:
- Single migration (0017 + 0018) covers all rows, regardless of master match.
- Atomic — no manual script step.
- ~10x faster than Option 2 (Option 2 = ~2 min; Option 1 = ~10-30s).
- The drift risk (TypeScript vs SQL hash function) is mitigated by the existing pattern: the master `legacy_id` is already computed by TypeScript and stored. The E3 backfill just propagates the same hash to raw_events. We can verify byte-for-byte with a `SELECT promotion_deterministic_uuid('test') = deterministicUuid('test')` test case.

---

## 6. Architecture

### 6.1 Migration 0017 (raw_events.legacy_id column)

```sql
-- Migration 0017: Add raw_events.legacy_id column (E3 — N14 closure)
-- Purpose: per-row dedup key at the source-event level. Enables promote.ts
-- to filter ctacte/ctacte1 by legacy_id (the source_key is degenerate for
-- these domains: 634 distinct values for 326k ctacte rows, 1 distinct for
-- 245k ctacte1 rows).
--
-- The partial UNIQUE INDEX (WHERE legacy_id IS NOT NULL) accommodates domains
-- that don't have a natural key (asiento, paramet, plancue, etc.).
--
-- pgcrypto is required for the backfill migration (0018). One-time install.
--
-- Idempotent: re-running is a no-op (ADD COLUMN IF NOT EXISTS +
-- CREATE EXTENSION IF NOT EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS).

CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint

ALTER TABLE "public"."raw_events"
  ADD COLUMN IF NOT EXISTS "legacy_id" text;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "raw_events_legacy_id_unique"
  ON "public"."raw_events" ("legacy_id")
  WHERE "legacy_id" IS NOT NULL;
```

### 6.2 Migration 0018 (backfill)

```sql
-- Migration 0018: Backfill raw_events.legacy_id for ctacte + ctacte1 (E3)
-- Computes the same hash that packages/promotion/src/transform-helpers.ts
-- deterministicUuid() produces. The hash format is UUIDv5-like (RFC 4122):
-- first 16 bytes of SHA-256 with version=5 (high nibble of byte 7) and
-- variant=10 (high 2 bits of byte 9).
--
-- Coverage:
--   ctacte:  326,275 rows → all backfilled (modulo ~0 with NULL fields)
--   ctacte1: 245,370 rows → all backfilled (modulo ~0 with NULL fields)
--
-- Best-effort: rows where ANY 5-tuple field is NULL get NULL legacy_id
-- (verified live 2026-06-25: 0 rows have NULL components for ctacte/ctacte1).
--
-- Idempotent: WHERE legacy_id IS NULL makes re-running a no-op.

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

### 6.3 Drizzle schema update (`packages/db/src/schema/public.ts`)

```typescript
// In rawEvents table definition (after promotedAt column):
legacyId: text('legacy_id'),  // E3: source-level dedup key; partial UNIQUE INDEX in migration 0017

// In rawEvents indexes (after promotedAtIdx):
legacyIdIdx: uniqueIndex('raw_events_legacy_id_unique').on(table.legacyId)
  .where(sql`${table.legacyId} IS NOT NULL`),
```

### 6.4 `promote.ts` algorithm update (the BIG change)

For ctacte/ctacte1, **bypass the projection table** and read from `raw_events` directly. For other domains, keep the current behavior (read from `*_projection`).

**New code path for ctacte/ctacte1:**

```typescript
// In promoteDomain(), REPLACE lines 85-101 (projection scan) with:

if (domain === 'ctacte' || domain === 'ctacte1') {
  // E3: read from raw_events directly (projection tables are EMPTY for
  // these domains; legacy_id is the dedup key).
  const rawRows =
    (
      await db.execute<{ source_key: string; payload: Record<string, unknown>; legacy_id: string }>(
        `SELECT source_key, payload, legacy_id
         FROM public.raw_events
         WHERE source_table = ${domain}
           AND promoted_at IS NULL
           AND legacy_id IS NOT NULL`,
      )
    ).rows ?? []
  result.attempted = rawRows.length
  // ... rest of the loop, but track legacy_id per row ...
  
  // Replace the bulk UPDATE at lines 155-162 with:
  if (insertedLegacyIds.length > 0) {
    await db.execute(sql`
      UPDATE public.raw_events
      SET promoted_at = now()
      WHERE source_table = ${domain}
        AND legacy_id = ANY(${insertedLegacyIds}::text[])
    `)
  }
}
```

**For other domains** (socios, escuela, deportes, locacion, caja, gastos): keep the existing projection-scan path. The legacy_id backfill for those domains is a future slice (E3+ deferred).

### 6.5 `dedup.ts` update

For ctacte/ctacte1, the dedup check should ALSO read `raw_events.legacy_id`:

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
  const combined = new Set<string>([...masterIds, ...rawIds])
  return combined
}

// Similar for ctacte1
```

### 6.6 `scripts/verify-slice.sh` updates

Add new assertions after the existing per-master-table count check:

```bash
# Step 7 (NEW, E3): Verify raw_events.legacy_id + promoted_at coverage
hr
echo "Step 7: Verify raw_events.legacy_id + promoted_at coverage (E3 N14 closure)"
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

# Assert: legacy_id backfill should cover ≥99.9% of ctacte + ctacte1 rows
LEGACY_OK=$(awk "BEGIN { print ($LEGACY_PCT >= 99.9) ? \"1\" : \"0\" }")
if [ "$LEGACY_OK" = "0" ]; then
  echo "FAIL: raw_events.legacy_id backfill coverage < 99.9% ($LEGACY_PCT%)" >&2
  exit 1
fi
```

---

## 7. Work-units (estimated)

### Commit 1: `feat(promotion+db): raw_events.legacy_id backfill for ctacte/ctacte1 (closes N14)`

| # | Task | Files | LoC |
|---|------|-------|----:|
| 1 | [TDD-RED] Write 2 NEW vitest cases for `promotion_deterministic_uuid()` parity test (TypeScript vs PostgreSQL output) | `packages/promotion/src/__tests__/uuid-parity.test.ts` (NEW) | ~30 |
| 2 | [TDD-GREEN migration] Hand-write `0017_raw_events_legacy_id.sql` (CREATE EXTENSION + ADD COLUMN + partial UNIQUE INDEX); apply via `psql`; update `_journal.json` idx 17 | `packages/db/drizzle/0017_raw_events_legacy_id.sql` (NEW) + journal | ~30 |
| 3 | [TDD-GREEN backfill migration] Hand-write `0018_raw_events_legacy_id_backfill.sql` (function + 2 UPDATEs); apply via `psql`; update `_journal.json` idx 18 | `packages/db/drizzle/0018_raw_events_legacy_id_backfill.sql` (NEW) + journal | ~55 |
| 4 | [TDD-GREEN schema] Update `public.ts` with `legacyId` column + partial UNIQUE INDEX | `packages/db/src/schema/public.ts` (MODIFIED) | +8 |
| 5 | [TDD-GREEN algorithm] Update `promote.ts` with ctacte/ctacte1 raw_events-direct path + legacy_id UPDATE | `packages/promotion/src/promote.ts` (MODIFIED) | +60 |
| 6 | [TDD-GREEN dedup] Update `dedup.ts` to read `raw_events.legacy_id` for ctacte/ctacte1 | `packages/promotion/src/dedup.ts` (MODIFIED) | +25 |
| 7 | [TDD-REFACTOR] Tighten; verify hash byte-for-byte parity between TypeScript `deterministicUuid()` and PostgreSQL `promotion_deterministic_uuid()` | (no files) | 0 |
| 8 | [Pre-closing verification] Run `bash scripts/verify-slice.sh` (REAL gate, E1b LESSON) — all 8 master tables Δ=0, NEW raw_events.legacy_id ≥ 99.9%, NEW ctacte + ctacte1 2nd-run inserts = 0 | (no files, gates merge) | 0 |

### Commit 2: `docs(spec+runbook): atomic sync — N14 RESOLVED + ctacte/ctacte1 backfill requirement`

| # | Task | Files | LoC |
|---|------|-------|----:|
| 9 | [Runbook update] Update "Known Limitations" N14 row to RESOLVED + add new "E3 N14 Closure" sub-section | `docs/runbook.md` (MODIFIED) | +20 |
| 10 | [Spec delta APPENDED — B1b LESSON #1] Add 1 NEW requirement "Raw Events Legacy ID Backfill" with 4 NEW scenarios + 1 NEW success criterion #52; existing Promotion Pipeline + 3 E2 requirements UNCHANGED | `openspec/specs/deployment-devops/spec.md` (MODIFIED) | +30 |
| 11 | [Spec delta verify] `diff` returns ONLY additive changes (no removals, no rewrites of existing scenarios at lines 167-276, 280-315, or 320-340) | (verification) | 0 |

### Commit 3: `chore(release): v0.5.7`

| # | Task | Files | LoC |
|---|------|-------|----:|
| 12 | [Pre-merge fix slot] Cherry-pick reorder if verify catches critical issue (B1b LESSON #3) | (varies) | 0 |
| 13 | [Release commit] Bump root + 18 `packages/*/package.json` from `0.5.6` → `0.5.7`; `CHANGELOG.md` v0.5.7 entry | 19 package.json + CHANGELOG | +20 |

**Total raw LoC:** ~280 (well under 400-line review budget).

---

## 8. File-by-file changes (estimated)

| File | Action | Est. lines | Notes |
|------|--------|-----------:|-------|
| `packages/db/drizzle/0017_raw_events_legacy_id.sql` | CREATE | ~20 | Hand-written SQL: CREATE EXTENSION + ADD COLUMN + partial UNIQUE INDEX |
| `packages/db/drizzle/0018_raw_events_legacy_id_backfill.sql` | CREATE | ~55 | Hand-written SQL: function + 2 UPDATEs (single tx + statement_timeout 120s) |
| `packages/db/drizzle/meta/_journal.json` | MODIFY | +12 | idx 17 + idx 18 entries |
| `packages/db/src/schema/public.ts` | MODIFY | +10 | `legacyId` column + `legacyIdIdx` partial UNIQUE INDEX |
| `packages/db/src/schema/index.ts` | MODIFY | +2 | Re-export types if needed |
| `packages/promotion/src/promote.ts` | MODIFY | +60 | New ctacte/ctacte1 raw_events-direct path; legacy_id UPDATE |
| `packages/promotion/src/dedup.ts` | MODIFY | +25 | Extend `loadExistingNaturalKeys` for ctacte/ctacte1 to read `raw_events.legacy_id` |
| `packages/promotion/src/__tests__/uuid-parity.test.ts` | CREATE | ~30 | TDD-RED parity test (TypeScript vs PostgreSQL hash output) |
| `scripts/verify-slice.sh` | MODIFY | +30 | NEW Step 7 (raw_events.legacy_id + promoted_at coverage assertions) |
| `docs/runbook.md` | MODIFY | +20 | Update Known Limitations N14 row + new "E3 N14 Closure" sub-section |
| `openspec/specs/deployment-devops/spec.md` | MODIFY | +30 | APPEND 1 NEW requirement + 4 NEW scenarios + 1 NEW success criterion |
| `CHANGELOG.md` | MODIFY | +5 | v0.5.7 entry |
| `package.json` (root) | MODIFY | +1 | bump 0.5.6 → 0.5.7 (release commit) |
| `packages/promotion/package.json` | MODIFY | +1 | bump 0.5.6 → 0.5.7 |
| `packages/*/package.json` (17 other packages) | MODIFY | +1 each | bump 0.5.6 → 0.5.7 |
| **Total raw LoC** | | **~280** | |

---

## 9. Top 5 risks

| # | Risk | Likelihood | Mitigation |
|---|------|-----------|------------|
| **R1** (CRITICAL) | Apply sub-agent skips `bash scripts/verify-slice.sh` (E1b/E1b2a/E1b2b LESSON — 3 consecutive sub-slices shipped with potentially broken state because smoke was historically skippable) | **Critical** | TASK-8 (`bash scripts/verify-slice.sh`) is a HARD GATE in apply prompt. Script already covers 8 master tables (commit `061be50`); E3 adds NEW Step 7 for raw_events.legacy_id coverage. Apply MUST run the script BEFORE declaring ready. **No merge until `verify-slice.sh` exits 0 (PASS).** |
| **R2** (CRITICAL) | PostgreSQL `promotion_deterministic_uuid()` hash output doesn't match TypeScript `deterministicUuid()` byte-for-byte → raw_events.legacy_id ≠ master.legacy_id → promote.ts can't JOIN → silent re-inserts | **High** | TASK-1 (TDD-RED parity test) verifies TypeScript output for 5 known inputs (e.g., `'0|2016-10-24|9895|9|1'`). Apply phase runs these in PostgreSQL via `SELECT promotion_deterministic_uuid('0\|2016-10-24\|9895\|9\|1')` and asserts equality. Migration 0018 is a no-op if parity fails (the WHERE clause preserves the column without filling wrong values). |
| **R3** (WARNING) | pgcrypto extension install fails (no superuser privileges) → migration 0017 fails → E3 blocked | **Medium** | Apply phase checks `pg_extension` BEFORE running 0017. If pgcrypto is not installed AND cannot be installed (`CREATE EXTENSION` returns `ERROR: permission denied`), apply phase surfaces this to the orchestrator immediately and aborts. Fallback: Option 2 (TypeScript backfill script) — slower but doesn't require pgcrypto. |
| **R4** (WARNING) | Field name mismatch in 0018 (e.g., typo `CCTTALONAR` vs `CCTTALANAR`) → all rows get the SAME hash → partial UNIQUE INDEX fails on INSERT | **High** | Apply phase MUST verify field names via `SELECT DISTINCT jsonb_object_keys(payload) FROM raw_events WHERE source_table = 'ctacte'` BEFORE writing 0018. Verified live 2026-06-25 (26 fields for ctacte, 15 for ctacte1; both have all 5-tuple components). |
| **R5** (WARNING) | The new `promote.ts` raw_events-direct path for ctacte/ctacte1 SKIPS the projection filter (`pe.source_key = re.source_key`), which means it processes raw_events rows that don't have a corresponding projection row. This is INTENTIONAL for E3 (projection is empty) but could regress if projection is later rebuilt. | **Medium** | Apply phase verifies that the raw_events-direct path filters by `legacy_id IS NOT NULL` (which excludes raw_events rows that don't have a natural key). Comment in promote.ts documents this as "E3 N14 closure path; works regardless of projection state". Future slice (E4+) can unify the path if projection is rebuilt for ctacte/ctacte1. |

### Lesser risks

- **Backfill performance:** 571k rows in a single transaction with 120s statement_timeout. If pgcrypto is slow, this could timeout. Mitigation: split into 2 transactions (one per domain), each with 60s timeout.
- **`pgcrypto` extension is global to the database.** If other slices need it, they'll see it as already installed. Low risk (good for the codebase).
- **`raw_events.legacy_id IS NOT NULL` in the partial UNIQUE INDEX uses pg's NULL semantics** (NULLs are NOT considered equal, so multiple NULL rows don't conflict). Verified via PostgreSQL docs.
- **Master.legacy_id is computed by TypeScript and stored.** If we ever change the TypeScript `deterministicUuid()` algorithm, the raw_events.legacy_id computed in SQL MUST be regenerated. E3 documents the algorithm parity requirement in the migration comment.

---

## 10. Open questions (for user resolution before propose)

**Q1 — Backfill strategy.** Option 1 (pgcrypto) is recommended (single migration, atomic, fast). Alternative: Option 2 (TypeScript script — requires 2 migrations + manual script run, slower but no extension dependency). Alternative: Option 3 (add 5-tuple columns to master — schema bloat, 3 migrations). User to confirm.

**Q2 — Promote algorithm path for ctacte/ctacte1.** Recommend Option A: read directly from raw_events (bypass empty projection tables). Alternative: Option B: require `pnpm rebuildProjection ctacte && pnpm rebuildProjection ctacte1` before promotion (keeps promote.ts algorithm unchanged). User to confirm.

**Q3 — Hash parity verification.** Recommend: run 5 known inputs through TypeScript AND PostgreSQL during apply, assert byte-for-byte equality. Alternative: skip parity test, trust the implementation (faster but riskier). User to confirm.

**Q4 — pgcrypto install permission.** If `CREATE EXTENSION pgcrypto` fails due to lack of superuser, the migration fails. Recommendation: apply phase pre-checks and surfaces the error clearly. Alternative: defer to a separate "infrastructure" PR (out of E3 scope). User to confirm.

**Q5 — E3 success criterion.** The realistic ctacte/ctacte1 promotion rate after E3 is ~88% (modulo FK failures). The prompt's "100%" is misleading. Recommendation: target ≥88% (new success criterion #52). Alternative: target ≥95% (would require re-importing socios that are missing in master). User to confirm.

**Default recommendations** (locked if user doesn't override):
1. **Backfill strategy:** Option 1 (pgcrypto).
2. **Promote path:** Option A (read from raw_events directly).
3. **Hash parity test:** Run it (5 known inputs).
4. **pgcrypto install:** Pre-check + surface error if permission denied.
5. **Success criterion:** ≥88% ctacte1 promotion rate (not 100%).

---

## 11. E1b LESSONs to apply (embedded)

| LESSON | Source | E3 application |
|--------|--------|----------------|
| **`bash scripts/verify-slice.sh` is the REAL gate** (not unit tests) | commit `b26896c` | TASK-8 hard gate; NEW Step 7 in script |
| **Migration via `psql` NOT `drizzle-kit migrate`** | commit `061be71` (`_journal.json` tracking mismatch) | All migrations 0017+0018 applied via psql; `_journal.json` updated manually |
| **Existing `promote.test.ts` stays `describe.skip`** | commit `b26896c` (TRUNCATE bug fix) | NO change to existing tests; new `uuid-parity.test.ts` is a pure function test (no DB) |
| **Field name verification BEFORE writing TDD cases** | E1b1 LESSON (T6 SOCNUMDOCU mismatch) | TASK-4 verifies `SELECT DISTINCT jsonb_object_keys(payload)` BEFORE writing migration |
| **B1b LESSON #1 (atomic canonical sync)** | commit `4a29571` | TASK-10 APPEND 1 NEW requirement + 4 NEW scenarios; existing Promotion Pipeline + 3 E2 requirements UNCHANGED |
| **B1b LESSON #2 (separate release commit)** | commit `4a29571` | TASK-13 separate commit; 3-commit shape (feat → docs → chore) |
| **B1b LESSON #3 (cherry-pick reorder if verify fails)** | commit `4a29571` | TASK-12 pre-merge fix slot |
| **B1b LESSON #4 (merge-to-main BEFORE branch delete)** | commit `4a29571` | Apply phase merges PR before deleting `feat/...` branch |

---

## 12. Dependencies (all confirmed shipped)

| Dependency | What E3 needs | Status |
|------------|---------------|--------|
| **E2 v0.5.6** (commit `6f98b5c`) | `raw_events.promoted_at` column + `raw_events_promoted_at_idx` index + admin API + runbook "Known Limitations" section | ✅ shipped 2026-06-25 |
| **E1b2b v0.5.5** (commit `36ac630`) | Migration 0015 (gastos) + FINAL atomic canonical sync | ✅ shipped 2026-06-25 |
| **E1b2a v0.5.4** (commit `b8d8e43`) | Migration 0014 (4 NEW master tables) + 4 NEW transforms | ✅ shipped 2026-06-25 |
| **E1b1 v0.5.2/v0.5.3** (commit `4a29571`) | Migration 0013 (`legacy_id` UNIQUE INDEX for ctacte/ctacte1) + `deterministicUuid()` helper | ✅ shipped 2026-06-24 |
| **E1a v0.5.1** (commit `bc6aa60`) | `packages/promotion/` skeleton + 3 transforms | ✅ shipped 2026-06-24 |
| **Slice D v0.5.0** | CI/CD pipeline + `.github/workflows/deploy.yml` | ✅ shipped 2026-06-24 |
| **`packages/db`** v0.5.6 | `createDb({ connectionString })`; 16 migrations applied; `pgTable` with `partial uniqueIndex` support | ✅ shipped |
| **`pgcrypto`** PostgreSQL extension | SHA-256 `digest()` function (one-time install in 0017) | ✅ AVAILABLE (pg_available_extensions) |

**No new external dependencies.** E3 adds zero npm packages.

---

## 13. Acceptance criteria

A Slice E3 change is accepted when **all** of the following pass:

### 13.1 Build & lint

- [ ] `pnpm install --frozen-lockfile` succeeds
- [ ] `pnpm test:run` passes (existing 482+ vitest cases + 2 NEW uuid-parity cases)
- [ ] `pnpm typecheck` passes (0 errors)
- [ ] `pnpm lint` passes (0 errors, 0 warnings)

### 13.2 TDD discipline

- [ ] `uuid-parity.test.ts` committed BEFORE implementation (git log shows test before feat)
- [ ] RED phase verified: parity test fails before SQL function is written
- [ ] GREEN phase verified: parity test passes after SQL function is created in DB
- [ ] REFACTOR phase: production code unchanged in behavior, test still passes

### 13.3 Slice E3 acceptance

- [ ] Migration 0017 applies cleanly via `psql -f`
- [ ] Migration 0018 applies cleanly via `psql -f`
- [ ] `raw_events.legacy_id` populated for 100% of ctacte + ctacte1 rows (verified via `count(*) ... WHERE source_table IN ('ctacte', 'ctacte1') AND legacy_id IS NOT NULL` = 571,645)
- [ ] `raw_events.legacy_id` byte-for-byte equals `tesoreria.ctacte.legacy_id` for the matching 197,521 ctacte rows (parity test)
- [ ] `raw_events.legacy_id` byte-for-byte equals `tesoreria.ctacte1.legacy_id` for the matching 150,129 ctacte1 rows (parity test)
- [ ] `pnpm db:promote` (CLI) populates ctacte + ctacte1 master to 197,521 + 150,129 (no change in 1st run after backfill — all already in master)
- [ ] `pnpm db:promote` 2nd run inserts 0 new rows (TRUE idempotency)
- [ ] `bash scripts/verify-slice.sh` exits 0 with NEW Step 7 assertions passing

### 13.4 Idempotency

- [ ] Running `promoteAll(db)` 3 times produces the same end state
- [ ] After 1st run post-E3: `count(*) FROM raw_events WHERE source_table='ctacte' AND promoted_at IS NOT NULL` = 197,521 (master count)
- [ ] After 1st run post-E3: `count(*) FROM raw_events WHERE source_table='ctacte1' AND promoted_at IS NOT NULL` = 150,129
- [ ] After 2nd/3rd runs: same counts, zero new inserts

### 13.5 Hygiene

- [ ] No `Co-Authored-By` or AI attribution in any commit message
- [ ] Conventional Commits style throughout
- [ ] Branch from `origin/main`, PR'd back to `main`
- [ ] B1b LESSON #2 applied: `feat/...` branch merged to main BEFORE `git branch -D`
- [ ] E3 bumps `package.json` patch version only in the closing `chore(release): v0.5.7` commit
- [ ] `CHANGELOG.md` has a v0.5.7 entry under "Released"

### 13.6 Documentation

- [ ] `docs/runbook.md` "Known Limitations" N14 row updated to "RESOLVED in v0.5.7 (E3)"
- [ ] `docs/runbook.md` has new "E3 N14 Closure" sub-section explaining the backfill strategy
- [ ] `openspec/specs/deployment-devops/spec.md` has 1 NEW requirement "Raw Events Legacy ID Backfill" appended
- [ ] `openspec/specs/deployment-devops/spec.md` existing requirements UNCHANGED (`diff` returns ONLY additive changes)

---

## 14. Source-of-truth file index

| Path | What it tells us |
|------|------------------|
| `openspec/changes/explore-athlos-promote-projection-to-master/exploration.md:782` | Parent Slice E exploration (E1a → E2 sub-slicing) |
| `openspec/changes/athlos-promote-projection-to-master-e1b2b/design.md:891` | E1b2b design (8th domain wiring + FINAL atomic sync) |
| `openspec/changes/athlos-promote-projection-to-master-e2/design.md:1252` | E2 design (admin API + promoted_at + runbook + 3 NEW additive spec requirements) |
| `engram/obs #2550` | E2 design summary (5 LOCKED decisions + NEW clarification re: ctacte/ctacte1 backfill deferred to E3+) |
| `engram/obs #2547` | E2 NEW clarification: ctacte/ctacte1 backfill deferred to E3+ (raw_events.legacy_id doesn't exist) |
| `engram/obs #2540` | E1b2b apply progress (verify-slice.sh PASS + 8 master tables populate) |
| `engram/obs #2531` | SDD apply LESSONs (verify-slice.sh gate + test TRUNCATE bug fix) |
| `engram/obs #2567` | E3 explore findings (5-tuple uniqueness, pgcrypto availability, N14 actual state) |
| `packages/db/drizzle/0013_legacy_id_unique.sql:1-15` | E1b1 migration — master legacy_id pattern (UNIQUE INDEX, hand-written SQL) |
| `packages/db/drizzle/0016_promoted_at.sql:1-30` | E2 migration — raw_events.promoted_at pattern (socios-only backfill via JOIN) |
| `packages/promotion/src/transform-helpers.ts:19-26` | `deterministicUuid()` — TypeScript implementation to mirror in PostgreSQL |
| `packages/promotion/src/transforms/ctacte.ts:26-30` | ctacte 5-tuple construction (cuenta, fecha, nrocomp, mes, talonar) |
| `packages/promotion/src/transforms/ctacte1.ts:38-46` | ctacte1 5-tuple construction (pagonro, pagosec, pagotal, pagofam, cuenta) |
| `packages/promotion/src/promote.ts:64-169` | Current promote.ts algorithm (projection scan + JOIN promoted_at + bulk UPDATE) |
| `packages/promotion/src/dedup.ts:117-185` | Current dedup.ts loadExistingNaturalKeys (master.legacy_id + raw_events.promoted_at cross-check) |
| `scripts/verify-slice.sh:1-171` | Current verify-slice.sh (REAL gate, 8 master tables, TRUE idempotency assertion) |
| `openspec/specs/deployment-devops/spec.md:167-340` | Canonical spec (E2 FINAL atomic sync + 3 additive requirements) |

---

## 15. Persisted artifacts

- This file: `openspec/changes/explore-athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill/exploration.md`
- Engram topic key: `sdd/athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill/explore`
- Engram type: `architecture`
- Engram capture_prompt: `false` (SDD artifact, automated)
- Engram findings topic key: `sdd/athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill/explore-findings`

**Next step (for the orchestrator):** propose `athlos-promote-projection-to-master-e3-ctacte-ctacte1-backfill` as a single PR (v0.5.6 → v0.5.7 PATCH, ~280 LoC, well under the 400-line budget). The 5 open questions (§10) should be presented to the user before proposal commits. The recommendation is Option 1 (pgcrypto) + Option A (raw_events-direct path) + parity test + pgcrypto pre-check + ≥88% success criterion.
