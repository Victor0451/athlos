# Delta for deployment-devops

## Header

| Field | Value |
|-------|-------|
| **Change** | `athlos-promote-projection-to-master-e1b2b` |
| **Date** | 2026-06-25 |
| **Phase** | Spec |
| **Mode** | Both (Engram + OpenSpec) |
| **Status** | Draft — ready for design |
| **File path** | `openspec/changes/athlos-promote-projection-to-master-e1b2b/specs/deployment-devops/spec.md` |
| **Modified capability** | `deployment-devops` (FULL atomic sync — B1b LESSON #1, CLOSES Slice E) |
| **Source artifacts** | `openspec/changes/explore-athlos-promote-projection-to-master-e1b/exploration.md` · `openspec/changes/athlos-promote-projection-to-master-e1b2b/proposal.md` |
| **Sister changes (DONE)** | `athlos-promote-projection-to-master-e1a` (v0.5.1) · `athlos-promote-projection-to-master-e1b1` (v0.5.2/v0.5.3) · `athlos-promote-projection-to-master-e1b2a` (v0.5.4, commit `b8d8e43`) |
| **Sister slice (THIS)** | `athlos-promote-projection-to-master-e1b2b` (v0.5.5 — closes Slice E data promotion: 8/8 master tables populate) |
| **Sister slice (LAST)** | `athlos-promote-projection-to-master-e2` — admin API + `promoted_at` audit column + runbook.md + (further) canonical sync |
| **Target release** | v0.5.4 → **v0.5.5** (PATCH — closes Slice E data promotion) |
| **B1b LESSONs embedded** | #1 FULL atomic sync (final for Slice E) · #2 separate release commit · #3 cherry-pick reorder · #4 merge-before-delete · #5 MIN(uuid) workaround (already correct from E1b1+) |
| **E1b1/E1b2a LESSONs embedded** | `bash scripts/verify-slice.sh` is the REAL gate (commit `b26896c`) · migration via `psql` NOT drizzle-kit · T19-T20 added to `describe.skip` per E1b2a TRUNCATE bug fix |

> **FINAL ATOMIC SPEC SYNC NOTE (B1b LESSON #1, CRITICAL — closes Slice E).** This delta is the LAST atomic spec sync for Slice E. It captures the full E1b2b scope (1 NEW domain `gastos` + 8-domain PROMOTION_ORDER) in ONE atomic update. The `diff` against `openspec/specs/deployment-devops/spec.md` SHALL be EMPTY after the apply phase lands this sync (per TASK-008 in `proposal.md` §7). **No further atomic syncs are planned for Slice E.** E2 will add NEW requirements (admin API endpoint, `promoted_at` audit column, runbook) — not modify the Promotion Pipeline requirement.

> **3 SCOPE CORRECTIONS (LIVE-VERIFIED 2026-06-25 against `192.168.1.102:5432/athlos`).** These corrections were applied during the propose phase and are embedded in this spec delta:
>
> 1. **#C2 (LOCKED from parent E1b, RE-VERIFIED 2026-06-25):** `gastos` natural key is **5-tuple** `(GASTIPGAST|GASCTAPRIN|GASSECUENC|GASFECHA|GASCOMPROB)` — verified **2,114 distinct of 2,114 = 100% unique**. The 3-tuple yields only **346 distinct** (84% duplicates → silent loss of 1,768 rows via `legacy_id` UNIQUE collision). E1b2b uses 5-tuple.
> 2. **#C7 (LOCKED from parent E1b):** `gastos` has **NO ctacte FK** (flat ledger). Verified live: 0 of 165 distinct `GASCTAPRIN` match any `tesoreria.ctacte.cctcuenta`. `GASCTAPRIN` is an accounting-plan code (e.g., `1111001`, `6001015`), NOT the socio carnet. FK constraint deferred to **N16**.
> 3. **#C8 (NEW, discovered 2026-06-25 11:50 UTC during this propose phase):** `gastos` has **NO `socio_id` FK in v1** (no `GASNUMSOC` / `SOCNUMERO` / `SOCCARNET` field exists in the 11-field projection payload). Verified live: `SELECT count(*) FILTER (WHERE payload ? 'SOCCARNET' OR payload ? 'GASNUMSOC' OR payload ? 'SOCNUMERO') FROM public."tesoreria.gastos_projection"` returns 0. The `socio_id` column SHALL exist in the master schema (nullable, FK constraint deferred to N16) for future backfill.

---

## Context

**State post-E1b2a (v0.5.4).** E1a (v0.5.1) shipped the `packages/promotion/` skeleton + transforms for `socios`, `ctacte`, `ctacte1`. E1b1 (v0.5.2/v0.5.3) wired `ctacte1` via the `cctcuenta` backfill + `legacy_id` UNIQUE INDEX pattern. E1b2a (v0.5.4, commit `b8d8e43`) wired 4 NEW domains: `escuela` (66), `deportes` (32), `locacion` (89), `caja` (8,145) — total 8,332 NEW rows via migration `0014_new_masters.sql`. After E1b2a, **7 of 8 master domains** populate via `pnpm db:promote`.

| Master table | Projection rows | Current status (v0.5.4) |
|--------------|----------------:|--------------------------|
| `socios.socios` | 39,357 | ✅ promoted (E1a) |
| `tesoreria.ctacte` | 326,275 | ✅ promoted (E1a) |
| `tesoreria.ctacte1` | 245,370 | ✅ partial (~56%, E1b1 — N14 stale `entity_uuids`) |
| `socios.escuela` | 66 | ✅ promoted (E1b2a) |
| `deportes.disciplinas` | 32 | ✅ promoted (E1b2a) |
| `socios.locacion` | 89 | ✅ promoted (E1b2a) |
| `tesoreria.caja_movimiento` | 8,145 | ✅ promoted (E1b2a) |
| **`tesoreria.gastos`** | **2,114** | **❌ table doesn't exist (E1b2b)** |

**What's LEFT for v1.0 promotion pipeline completion.** **1 of 8 master tables is still empty** — `tesoreria.gastos`. The promotion pipeline currently skips `gastos`. E1b2b is the **LAST sub-slice of E1b**: it wires `gastos` and closes Slice E with the **FULL atomic canonical sync** (B1b LESSON #1 — closes the canonical spec with all 8 domains in one atomic update, NOT partial like E1b2a).

**E1b2 sub-slicing rationale.** Parent E1b exploration (§1) recommends sub-slicing the 5-domain scope into 2 stacked PRs (E1b2a + E1b2b) so each lands under the 400-line review budget. E1b2a (DONE v0.5.4) shipped 4 domains + partial canonical sync + v0.5.3 → v0.5.4. **E1b2b (THIS delta)** ships 1 domain + FULL atomic canonical sync + v0.5.4 → v0.5.5.

This delta modifies the `deployment-devops` capability by:
- Modifying the existing "Promotion Pipeline" requirement: rewrite the "Domain promotion order respects FK dependencies" scenario to list **8 domains** (was 7), keep the CLI runner / Batched INSERT / Projection schema-qualified scenarios verbatim, and add a new inline note documenting the 3 E1b2b scope corrections.
- Adding 1 NEW requirement: **`tesoreria.gastos` master table** (flat expense ledger with 5-tuple NK, no FKs in v1).
- Adding 1 NEW scenario to the "Promotion Pipeline" requirement: **"Gastos domain promotion (flat expense ledger)"**.
- Appending 1 NEW success criterion: **gastos = 2,114 rows after promotion** (5-tuple NK verification).

No existing requirements outside the Promotion Pipeline "Domain promotion order" scenario are rewritten. The E1b2a 4-domain scenarios (escuela / deportes / locacion / caja) remain unchanged. The Slice D success criteria #1-30 remain unchanged.

---

## Capability: `deployment-devops` (modified)

### Requirement: Promotion Pipeline (modified)

The system SHALL provide a workspace package (`packages/promotion/`) that reads rows from each `*_projection` table, transforms each `jsonb` payload into a typed row matching the corresponding master table, resolves foreign keys via bulk in-memory lookups (NOT per-row queries), inserts in batches of 1000 rows with `ON CONFLICT DO NOTHING` for idempotency, and exposes a CLI runner accessible via the root script `pnpm db:promote`. **After E1b2b merges (v0.5.5), all 8 promotion domains SHALL be wired and `pnpm db:promote` populates 8/8 master tables in a single run.**

(Previously: E1a shipped 3 domains, E1b1 added ctacte1 wiring, E1b2a added 4 more domains. E1b2b adds the final `gastos` domain and closes Slice E.)

The system SHALL enforce a topological promotion order (`PROMOTION_ORDER = ['socios', 'escuela', 'deportes', 'locacion', 'caja', 'gastos', 'ctacte', 'ctacte1']`) such that FK targets are populated before dependents: `socios` MUST be promoted before `ctacte` (ctacte.socio_id → socios.id), and `ctacte` MUST be promoted before `ctacte1` (ctacte1.ctacte_id → ctacte.id). The 4 NEW independent domains (`escuela`, `deportes`, `locacion`, `caja`) plus the E1b2b `gastos` domain SHALL be promoted in alphabetical order between `socios` and `ctacte` for deterministic reproducibility (B1b LESSON). The system SHALL NOT fail-fast on per-domain errors; instead, it SHALL collect per-row failures in a `errors[]` array, increment the `failed` counter, and short-circuit downstream domains ONLY when the upstream domain inserted zero rows AND had failures AND the upstream domain is in `FK_BLOCKING_DOMAINS = ['socios', 'ctacte']` (the FK-cascade rule).

#### Scenario: CLI runner via `pnpm db:promote`

- GIVEN the pnpm workspace is installed
- WHEN the operator executes `pnpm db:promote`
- THEN the CLI SHALL run `packages/promotion/src/promote-cli.ts` against the database specified by `DATABASE_URL` (default: `postgresql://athlos:athlos@192.168.1.102:5432/athlos`)
- AND the CLI SHALL NOT require any additional arguments or flags for a full promotion run
- AND the CLI SHALL print per-domain summary lines showing `attempted`, `inserted`, `skipped`, `failed`, and `durationMs`
- AND the CLI SHALL exit with code 0 on success, or non-zero if any domain had `failed > 0`

#### Scenario: Domain promotion order respects FK dependencies (8 domains — E1b2b rewrite)

- GIVEN `pnpm db:promote` is executed after E1b2b lands
- WHEN domains are promoted in sequence
- THEN `socios` SHALL be promoted first (no FK dependencies; populates 39,357 rows)
- AND `escuela` SHALL be promoted second (independent FK tree — no required FK in v1.0; populates 66 rows)
- AND `deportes` SHALL be promoted third (independent FK tree — no required FK in v1.0; populates 32 rows into existing `deportes.disciplinas` table)
- AND `locacion` SHALL be promoted fourth (independent FK tree — no required FK in v1.0; populates 89 rows)
- AND `caja` SHALL be promoted fifth (independent FK tree — no required FK in v1.0; header-only in v1.0, 122 detail columns deferred; populates 8,145 rows)
- AND **`gastos` SHALL be promoted sixth (NEW in E1b2b — flat expense ledger, no FK in v1.0; populates 2,114 rows; 5-tuple natural key verified 2,114/2,114 = 100% unique)**
- AND `ctacte` SHALL be promoted seventh (depends on `socios.id`; populates 326,275 rows)
- AND `ctacte1` SHALL be promoted eighth (depends on `ctacte.id` via `cctcuenta`; populates ~138,742 rows in v1.0, partial due to N14 stale `entity_uuids`)
- AND if any domain fails AND all attempted rows failed AND the domain is in `FK_BLOCKING_DOMAINS` (socios, ctacte), dependent domains SHALL NOT be attempted
- AND the 5 NEW independent domains (escuela, deportes, locacion, caja, gastos) do NOT block each other — their failures do NOT short-circuit each other (verified: `gastos` has no FK dependency on `socios` / `ctacte` / any sibling)

> **E1b1 (v0.5.2/v0.5.3) UPDATE (2026-06-24).** ctacte1 is wired. Migration 0013 added `cctcuenta` to `tesoreria.ctacte` + backfilled best-effort. Migration 0014 added `legacy_id text` + `UNIQUE INDEX` on `tesoreria.ctacte.legacy_id` and `tesoreria.ctacte1.legacy_id`. Cross-run idempotency works: re-running `pnpm db:promote` is a no-op (0 new inserts) via dedup pre-check + ON CONFLICT DO NOTHING.
>
> **E1b2a (v0.5.4) UPDATE (2026-06-25).** 4 NEW domains wired: escuela, deportes, locacion, caja. Migration 0014 (E1b2a) creates `socios.escuela` (per-school master, NO socio_id FK), adds `legacy_id` to `deportes.disciplinas` (table already existed), creates `socios.locacion` (per-socio address), and creates `tesoreria.caja_movimiento` (cash movement header with 4-tuple NK). Scope corrections: (C1) escuela is per-school master with NO `socio_id` FK — verified 0 of 66 projection rows have SOCNUMERO/SOCCARNET fields; (C3) caja NK is 4-tuple `(CAJNUMERO, CAJSECUENC, CAJFECHA, CAJHORA)` — the 3-tuple yields 7,957 distinct = 188 silent row losses, 4-tuple yields 8,145 distinct = 100% unique.
>
> **E1b2b (v0.5.5) UPDATE (2026-06-25) — FINAL SLICE E SYNC.** 8th domain wired: gastos. Migration `0015_gastos.sql` creates `tesoreria.gastos` (flat expense ledger, NO socio_id FK, NO ctacte FK in v1) + adds `legacy_id` column + 3 UNIQUE INDEXes (legacy_id, 5-tuple composite, cuenta+fecha) + 2 secondary INDEXes. Scope corrections: (C2) `gastos` NK is 5-tuple `(GASTIPGAST, GASCTAPRIN, GASSECUENC, GASFECHA, GASCOMPROB)` — the 3-tuple yields 346 distinct (84% duplicates → silent loss of 1,768 rows), 5-tuple yields 2,114 distinct = 100% unique; (C7) `gastos` has NO ctacte FK — verified 0 of 165 distinct `GASCTAPRIN` match any `tesoreria.ctacte.cctcuenta` (GASCTAPRIN is accounting-plan code, e.g., `1111001`, `6001015`); (C8) `gastos` has NO `socio_id` FK in v1 — no `GASNUMSOC` / `SOCNUMERO` / `SOCCARNET` field in the 11-field payload, `socio_id` column exists (nullable, FK constraint deferred to N16) for future backfill.

#### Scenario: Batched INSERT with deduplication

- GIVEN a domain is being promoted
- WHEN rows are inserted into the master table
- THEN inserts SHALL be batched at 1000 rows per batch
- AND each batch SHALL use `ON CONFLICT DO NOTHING` (idempotent — re-running is safe)
- AND the promotion SHALL be considered best-effort: individual row failures SHALL NOT stop the batch; a summary of failed rows SHALL be printed after each domain

#### Scenario: Projection tables are schema-qualified

- GIVEN the promotion query reads from `socios.socios_projection`
- WHEN the query executes
- THEN the SQL SHALL use `"socios"."socios_projection"` (schema-qualified, double-quoted identifiers)
- AND NOT `"socios.socios_projection"` (which PostgreSQL treats as a single identifier name, not schema.table)

#### Scenario: Escuela domain promotion (per-school master)

- GIVEN `escuela` domain is being promoted
- WHEN rows are read from `public."socios.escuela_projection"` and written to `socios.escuela`
- THEN each row SHALL be transformed with natural key `ESCCODIGO` → `codigo` (text, deterministic UUID5 via `legacy_id`)
- AND the transform SHALL compute `legacy_id = deterministicUuid('escuela:codigo')` where `codigo = ESCCODIGO`
- AND `nombre` SHALL be mapped from `ESCNOMBRE` (upstream alias, deferred to v1.1)
- AND there is NO `socio_id` FK column in `socios.escuela` (verified: 0 projection rows contain SOCNUMERO/SOCCARNET)
- AND the projection table `public."socios.escuela_projection"` is schema-qualified (NOT `socios."escuela_projection"`)
- AND idempotency is guaranteed via `ON CONFLICT DO NOTHING` on the natural key `(codigo)` + `legacy_id UNIQUE INDEX`

#### Scenario: Deportes domain promotion (disciplinas with legacy_id)

- GIVEN `deportes` domain is being promoted
- WHEN rows are read from `public."deportes.deportes_projection"` and written to `deportes.disciplinas`
- THEN each row SHALL be transformed with natural key `DEPCODIGO` → `codigo` (numeric → text coercion required)
- AND the transform SHALL compute `legacy_id = deterministicUuid('deporte:codigo')` where `codigo = DEPCODIGO`
- AND `nombre` SHALL be mapped from `DEPNOMBRE`
- AND the projection table `public."deportes.deportes_projection"` is schema-qualified
- AND idempotency is guaranteed via `ON CONFLICT DO NOTHING` on `(codigo)` + `legacy_id UNIQUE INDEX`

#### Scenario: Locacion domain promotion (per-socio address)

- GIVEN `locacion` domain is being promoted
- WHEN rows are read from `public."socios.locacion_projection"` and written to `socios.locacion`
- THEN each row SHALL be transformed with composite natural key `(LCNCTAPRIN, LCNNUMERO)` → `(tipo_principal, numero)`
- AND empty string `''` is a valid value for both NK components (verified: 15 of 89 projection rows have empty `LCNCTAPRIN`)
- AND `legacy_id = deterministicUuid('locacion:tipo_principal|numero')`
- AND the projection table `public."socios.locacion_projection"` is schema-qualified
- AND idempotency is guaranteed via `ON CONFLICT DO NOTHING` on the composite NK + `legacy_id UNIQUE INDEX`

#### Scenario: Caja domain promotion (cash movement header)

- GIVEN `caja` domain is being promoted
- WHEN rows are read from `public."tesoreria.caja_projection"` and written to `tesoreria.caja_movimiento`
- THEN each row SHALL be transformed with 4-tuple natural key `(CAJNUMERO, CAJSECUENC, CAJFECHA, CAJHORA)` → `(numero, secuencia, fecha, hora)`
- AND the 4-tuple NK is CRITICAL: the 3-tuple `(CAJNUMERO, CAJSECUENC, CAJFECHA)` yields only 7,957 distinct values (188 row losses), while the 4-tuple yields 8,145 distinct (100% unique, verified against live data)
- AND `legacy_id = deterministicUuid('caja:numero|secuencia|fecha|hora')` using all 4 NK components
- AND `descripcion` SHALL be mapped from `CAJDESC` (upstream alias, deferred to v1.1)
- AND the projection table `public."tesoreria.caja_projection"` is schema-qualified
- AND idempotency is guaranteed via `ON CONFLICT DO NOTHING` on the 4-tuple NK + `legacy_id UNIQUE INDEX`
- AND v1.0 scope is header-only (122 detail columns deferred to v1.1)

#### Scenario: Gastos domain promotion (flat expense ledger — NEW in E1b2b)

- GIVEN `gastos` domain is being promoted
- WHEN rows are read from `public."tesoreria.gastos_projection"` and written to `tesoreria.gastos`
- THEN each row SHALL be transformed with **5-tuple natural key** `(GASTIPGAST, GASCTAPRIN, GASSECUENC, GASFECHA, GASCOMPROB)` → `(tipo, cuenta, secuencia, fecha, comprob)`
- AND the 5-tuple NK is CRITICAL: the 3-tuple `(GASTIPGAST, GASCTAPRIN, GASSECUENC)` yields only **346 distinct** values (84% duplicates → silent loss of 1,768 rows via `legacy_id` UNIQUE collision), while the **5-tuple yields 2,114 distinct = 100% unique** (verified against live data 2026-06-25)
- AND `legacy_id = deterministicUuid('gastos:tipo|cuenta|secuencia|fecha|comprob')` using all 5 NK components
- AND `importe` SHALL be mapped from `GASIMPORTE` (NUMERIC(14,2), values 0.01..3000, no negatives)
- AND `iva` SHALL be mapped from `GASIVA` (NUMERIC(14,2), mostly 0; default `'0.00'`)
- AND `ingreso_bruto` SHALL be mapped from `GASINGBRUT` (20-character accounting-grid debit string; stored as `text`, NOT numeric)
- AND `concepto` SHALL be mapped from `GASCONCEPT` (free text — operator description; fallback `'(sin concepto)'` if empty)
- AND `tipo_cuenta` SHALL be mapped from `GASTIPCTA` (sentinel 0 for all 2,114 rows; nullable)
- AND `cuenta_auxiliar` SHALL be mapped from `GASCTAAUXI` (sentinel for most rows; nullable)
- AND **there is NO `socio_id` FK constraint** in `tesoreria.gastos` (column exists as nullable `uuid`, FK constraint deferred to N16 — verified live: 0 of 2,114 projection rows have `GASNUMSOC` / `SOCNUMERO` / `SOCCARNET` field; scope correction #C8)
- AND **there is NO `ctacte` FK constraint** in `tesoreria.gastos` (verified live: 0 of 165 distinct `GASCTAPRIN` match any `tesoreria.ctacte.cctcuenta`; `GASCTAPRIN` is accounting-plan code, NOT socio carnet; scope correction #C7)
- AND the projection table `public."tesoreria.gastos_projection"` is schema-qualified
- AND idempotency is guaranteed via `ON CONFLICT DO NOTHING` on the 5-tuple NK (`gastos_5tuple_unique` UNIQUE INDEX) + `gastos_legacy_id_unique` UNIQUE INDEX — defense in depth (3 layers: dedup pre-check → 5-tuple UNIQUE → legacy_id UNIQUE)
- AND `errors[]` SHALL be empty (no FK failures possible — flat ledger)

---

### Requirement: tesoreria.gastos master table (NEW)

The system SHALL provide a `tesoreria.gastos` master table as a flat accounting expense ledger populated from `public."tesoreria.gastos_projection"` via the `gastos` promotion domain. The table SHALL store per-row expense entries (VFP GAS* fields) with a 5-tuple natural key encoded as `legacy_id`, and SHALL have NO foreign key constraints to `socios.socios` or `tesoreria.ctacte` in v1 (flat-ledger scope per corrections #C7 and #C8).

The migration creating this table (`packages/db/drizzle/0015_gastos.sql`) SHALL be hand-written SQL (NOT drizzle-kit generated, per E1b1 LESSON re: `_journal.json` tracking mismatch with hand-written SQL), SHALL be idempotent (`CREATE TABLE IF NOT EXISTS` + `CREATE UNIQUE INDEX IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`), and SHALL be applied via `psql` against the target database. The migration SHALL create 1 NEW table + 3 UNIQUE INDEXes (`legacy_id`, 5-tuple composite, `cuenta+fecha` lookup) + 2 secondary INDEXes (`cuenta+fecha`, `socio_id` partial).

#### Scenario: gastos master table created via migration 0015

- GIVEN migration `0015_gastos.sql` has NOT been applied yet
- WHEN `PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -f packages/db/drizzle/0015_gastos.sql` is executed
- THEN the `tesoreria.gastos` table SHALL be created with 13 columns: `id` (uuid PK), `tipo` (int NOT NULL), `cuenta` (int NOT NULL), `secuencia` (int NOT NULL DEFAULT 0), `fecha` (date NOT NULL), `comprob` (text NOT NULL DEFAULT ''), `tip_cta` (int nullable), `cta_auxi` (int nullable), `concepto` (text NOT NULL), `importe` (numeric(14,2) NOT NULL DEFAULT '0.00'), `iva` (numeric(14,2) nullable), `ing_brut` (text nullable), `socio_id` (uuid nullable, NO FK constraint), `legacy_id` (text nullable), `created_at` (timestamptz NOT NULL DEFAULT now())
- AND 3 UNIQUE INDEXes SHALL be created: `gastos_legacy_id_unique` (on `legacy_id`), `gastos_5tuple_unique` (on `(tipo, cuenta, secuencia, fecha, comprob)`), `gastos_cuenta_fecha_idx` (on `(cuenta, fecha)`)
- AND 1 partial INDEX SHALL be created: `gastos_socio_id_idx` on `socio_id` WHERE `socio_id IS NOT NULL`
- AND running the same SQL twice SHALL be a no-op (idempotent — `IF NOT EXISTS` guards)
- AND `\d tesoreria.gastos` SHALL show NO foreign key constraints (flat ledger)

#### Scenario: gastos promotion populates master table with 5-tuple NK

- GIVEN migration `0015_gastos.sql` has been applied and `tesoreria.gastos` table is empty
- AND `public."tesoreria.gastos_projection"` contains 2,114 rows
- WHEN `pnpm db:promote` runs the `gastos` domain (6th in PROMOTION_ORDER)
- THEN ~2,114 rows SHALL be inserted into `tesoreria.gastos` (1:1 with projection — no FK failures possible)
- AND `legacy_id` SHALL be a deterministic UUID5 from the 5-tuple `(GASTIPGAST, GASCTAPRIN, GASSECUENC, GASFECHA, GASCOMPROB)` via `deterministicUuid('gastos:tipo|cuenta|secuencia|fecha|comprob')`
- AND `SELECT count(DISTINCT legacy_id) FROM tesoreria.gastos` SHALL return 2,114 (100% unique — 5-tuple NK verified live)
- AND `SELECT count(*) FROM tesoreria.gastos WHERE socio_id IS NOT NULL` SHALL return 0 (no source field; per scope correction #C8)
- AND `errors[]` SHALL be empty (no FK failures possible)
- AND `pnpm db:promote` SHALL exit 0 on success

#### Scenario: gastos re-promotion is idempotent (no new inserts on 2nd/3rd run)

- GIVEN `pnpm db:promote` has been run once and `tesoreria.gastos` contains 2,114 rows
- WHEN `pnpm db:promote` is run a 2nd time
- THEN `gastos` SHALL appear in the per-domain output with `{domain: 'gastos', attempted: 2114, inserted: 0, skipped: 2114, failed: 0, errors: []}`
- AND `SELECT count(*) FROM tesoreria.gastos` SHALL STILL be 2,114 (no new rows; dedup pre-check + 5-tuple UNIQUE INDEX + legacy_id UNIQUE INDEX catch duplicates)
- AND `bash scripts/verify-slice.sh` SHALL exit 0 (TRUE idempotency verified)

---

## Success Criteria (2 NEW for E1b2b scope)

1. **E1b2b NEW**: `pnpm db:promote` against the test DB (`192.168.1.102:5432/athlos`) populates `tesoreria.gastos` with exactly **2,114 rows**; the CLI stdout shows `{domain: 'gastos', inserted: 2114, skipped: 0, failed: 0, errors: []}` in the per-domain JSON output. The row count of 2,114 (NOT 346) verifies the 5-tuple NK is correctly applied (per scope correction #C2; 3-tuple would yield 346 distinct via `legacy_id` UNIQUE collision).
2. **E1b2b NEW**: `bash scripts/verify-slice.sh` exits 0 (PASS) after E1b2b lands — promotion works for all **8 domains** + TRUE idempotency verified on 2nd run (0 new inserts across all 8 master tables). **CRITICAL:** The `verify-slice.sh` script MUST be updated by the apply phase to include `tesoreria.gastos` in its `MASTER_TABLES` array (currently lists 7 tables — missing `tesoreria.gastos` per scripts/verify-slice.sh:28-36).

> Existing canonical criteria #1-30 (post-Slice D) remain unchanged. The E1a 6 NEW criteria (#31-36) and the E1b2a 10 NEW criteria (#37-46) are tracked in the proposal.md / spec deltas but were applied as **partial atomic sync** in canonical (per E1b2a's "PARTIAL SPEC SYNC NOTE"). E1b2b adds criteria #47-48 above for the gastos domain + the verify-slice.sh gate. After this sync lands, the same `diff` verification SHALL be additive-only with no further Slice E atomic syncs planned.

---

## Scope Boundary

### In scope for E1b2b (this delta ships)

| Item | Description |
|------|-------------|
| `tesoreria.gastos` master table | NEW — flat expense ledger, 13 columns + 14 indexes (3 UNIQUE + 2 secondary) + `socio_id` nullable column (no FK constraint in v1) |
| Migration `0015_gastos.sql` | NEW — hand-written SQL (~25L), idempotent, applied via `psql` (NOT drizzle-kit — E1b1 LESSON), `0015` is next sequential idx in `_journal.json` (current ends at idx 14 from E1b2a's `0014_new_masters`) |
| `transforms/gastos.ts` | NEW transform (~50L) — 5-tuple NK → `legacy_id`, validates required fields, no FK lookups |
| `PROMOTION_ORDER` extension to 8 domains | `['socios', 'escuela', 'deportes', 'locacion', 'caja', 'gastos', 'ctacte', 'ctacte1']` — `gastos` placed between `caja` and `ctacte` (independent FK tree, alphabetical for determinism per B1b LESSON) |
| `PROJECTION_TABLE` + `DOMAIN_TRANSFORMS` extension | Add `gastos` entries to both maps |
| `dedup.ts` extension | 1 NEW `naturalKey` branch (5-tuple) + 1 NEW `loadExistingNaturalKeys` branch (reads `legacy_id` from `tesoreria.gastos`) |
| `fk-lookup.ts` no-op for `gastos` | `buildFkMap` returns the socio map for `gastos` (no-op for now; reserved for N16) |
| `promote.ts` `insertMasterBatch` switch | 1 NEW `else if (domain === 'gastos')` branch — Drizzle insert into `tesoreria.gastos` with `onConflictDoNothing()` |
| `transformGastos` test cases (T19-T20) | 2 NEW vitest cases added to existing `describe.skip` blocks per E1b2a LESSON re: TRUNCATE bug fix in commit `b26896c` |
| **`scripts/verify-slice.sh` extension** | **CRITICAL**: apply phase MUST add `tesoreria.gastos` to the `MASTER_TABLES` array (currently 7 entries — missing `tesoreria.gastos` per scripts/verify-slice.sh:28-36). Without this update, the post-merge verification gate would NOT verify gastos idempotency. |
| **FULL atomic canonical spec sync** | Updates `openspec/specs/deployment-devops/spec.md` "Promotion Pipeline" requirement: PROMOTION_ORDER scenario rewrite to 8 domains + 1 NEW `gastos` scenario + 1 NEW success criterion + scope corrections #C2/#C7/#C8 documented. **Final sync for Slice E.** |
| `CHANGELOG.md` v0.5.5 entry | NEW — documents gastos + final sync + verify-slice.sh results |
| Version bump 0.5.4 → 0.5.5 | Root `package.json` + 18 `packages/*/package.json` in **separate release commit** (B1b LESSON #2) |

### Deferred to E2 (`athlos-promote-projection-to-master-e2`)

| Item | Description |
|------|-------------|
| Admin API endpoint | `POST /api/v1/promote/trigger` (sync HTTP, ADMIN-gated) |
| `promoted_at` audit column | `raw_events.promoted_at TIMESTAMPTZ NULL` migration + auto-stamp on successful promotion |
| `docs/runbook.md` "Promotion" section | Full runbook: pre-flight checks, expected row counts, rollback procedure |
| Async trigger via `@athlos/scheduler` | Optional cron-like scheduled promotion |
| Dry-run mode | `{dryRun: true}` flag on admin endpoint |
| `(further) canonical sync` | E2 may add NEW scenarios (e.g., admin endpoint flow + audit trail + idempotency via `promoted_at`) — NOT modify the Promotion Pipeline requirement |

### Deferred to FUTURE (out of scope for all Slice E)

| Item | Reason |
|------|--------|
| `pg_advisory_lock` for concurrent-promotion prevention | CLI runner is single-tenant |
| Caja detalle (CAJCONCEPT1..20, etc.) | 122 wide columns; deferred to **N7** |
| `deportes.inscripciones` rebuild | Per-socio enrollment in disciplinas; deferred to **N8** |
| Stale `entity_uuids` repopulation | Would unlock ~107k orphan ctacte1 rows; deferred to **N14** |
| `gastos` FK to `ctacte.id` via `cctcuenta` lookup | Out of v1 scope per parent E1b + scope correction #C7; deferred to **N16** |
| `gastos` `socio_id` FK backfill | No source field in v1 projection (correction #C8); deferred to **N16** |
| Escuela FK to `deportes.disciplinas.codigo` | FK constraint added later — nullable in E1b2a |
| Per-row transactional promotion | Per-domain only for v1 |
| CONTABLE / CONTABL1 / CATASTROS domains | No master tables yet |
| Rollback endpoint | Manual SQL is sufficient for v1 |

---

## Out of Scope (re-stated for clarity)

- **No NEW master tables** in E1b2b other than `tesoreria.gastos`. The 4 NEW tables from E1b2a (escuela, disciplinas legacy_id, locacion, caja_movimiento) are DONE.
- **No NEW FK constraints** in E1b2b. `gastos` deliberately has NO socio_id FK (#C8) and NO ctacte FK (#C7) in v1 — the `socio_id` column is reserved for future N16 backfill.
- **No `promoted_at` audit column** in E1b2b (E2 only). Re-runs rely on `legacy_id` UNIQUE INDEX + 5-tuple UNIQUE INDEX + dedup pre-check + `ON CONFLICT DO NOTHING`.
- **No admin HTTP endpoint** in E1b2b (E2 only).
- **No `docs/runbook.md` change** in E1b2b (E2 only).
- **No `pg_advisory_lock`** in E1b2b.
- **No dry-run flag** in E1b2b.
- **No chained PRs within E1b2b** (per session preflight `delivery_strategy: ask-always` + `review_budget_lines: 400`). E1b2b alone is one PR (~370 raw LoC / ~200 effective — under the 400-line budget at raw count, well under at effective).
- **No `pnpm typecheck` / `pnpm lint` regressions** — all existing 11+ vitest cases must remain green (T19-T20 added to existing `describe.skip` blocks per E1b2a LESSON re: destructive TRUNCATE bug fix in commit `b26896c`).

---

## Acceptance Criteria (delta-specific, pre-apply checklist)

These are the E1b2b delta's acceptance criteria; the full set lives in `proposal.md` §10. Restated here for spec-phase completeness:

- [ ] Migration `0015_gastos.sql` creates `tesoreria.gastos` + `legacy_id` column + 3 UNIQUE INDEXes (legacy_id, 5-tuple composite, cuenta+fecha) + 2 secondary INDEXes (idempotent via `IF NOT EXISTS`)
- [ ] Migration applied via `psql` (NOT `drizzle-kit migrate` per E1b1 LESSON); manual `_journal.json` entry update with idx 15
- [ ] `gastos` transform writes `legacy_id` from 5-tuple NK (verified by selecting 1 promoted row + checking `legacy_id` is populated + matches `deterministicUuid('gastos:<5-tuple>')`)
- [ ] `gastos` has NO `socio_id` FK (verified by `\d tesoreria.gastos` showing no foreign key constraints + `socio_id` column is nullable)
- [ ] `gastos` has NO `ctacte` FK (verified by schema inspection)
- [ ] `gastos` 5-tuple NK produces 100% unique legacy_ids (verified by `SELECT count(DISTINCT legacy_id) FROM tesoreria.gastos` = 2,114)
- [ ] All **8** `PROMOTION_ORDER` domains attempt promotion (verified by smoke test output showing 8 lines + verify-slice.sh output)
- [ ] `bash scripts/verify-slice.sh` exits 0 (PASS — promotion works + idempotency verified for all 8 domains)
- [ ] **`scripts/verify-slice.sh` MUST be updated** to include `tesoreria.gastos` in the `MASTER_TABLES` array (currently 7 entries — missing `gastos` per scripts/verify-slice.sh:28-36)
- [ ] Canonical spec reflects all 8 domains + FINAL atomic sync (diff = additive-only — no removals, no rewrites of pre-Slice E scenarios; PROMOTION_ORDER scenario is rewritten to 8 domains; 1 NEW gastos scenario added; 1 NEW success criterion appended)
- [ ] No remaining E1b / E1b1 / E1b2a deferral notes in canonical spec for the Promotion Pipeline requirement (those deferral markers are REPLACED by the final 8-domain spec)
- [ ] T19-T20 vitest cases added to existing `describe.skip` blocks (per E1b2a LESSON re: TRUNCATE bug fix)
- [ ] T19 covers gastos happy path (1 projection row → 1 master row + idempotent re-run = 0 new)
- [ ] T20 MUST assert 5-tuple uniqueness (NOT 3-tuple — see scope correction #C2)
- [ ] Tests use ACTUAL projection field names verified via `SELECT DISTINCT jsonb_object_keys` (11 fields documented in `proposal.md` §4.1)
- [ ] CHANGELOG.md v0.5.5 entry includes smoke test results from verify-slice.sh (1st + 2nd run deltas)
- [ ] No `Co-Authored-By` or AI attribution in any commit message (Conventional Commits only)
- [ ] 3-commit shape preserved: `feat(promotion): wire gastos (5-tuple NK + flat ledger, v0.5.5 prep)` → `docs(spec): atomic sync — Promotion Pipeline with 8 domains (full Slice E close)` → `chore(release): v0.5.5` (B1b LESSON #2)
- [ ] Merge to `main` BEFORE `git branch -D spec/athlos-promote-projection-to-master-e1b2b` (B1b LESSON #4)

---

## Open Questions (RESOLVED)

All open questions for E1b2b scope are RESOLVED:

| # | Question | Resolution | Source |
|---|----------|------------|--------|
| **Q1** | Sub-slice shape | **2 stacked PRs** (E1b2a DONE v0.5.4 + E1b2b v0.5.5), each under 400 LoC | Parent E1b + user-confirmed 2026-06-25 |
| **Q2** | Migration design | **1 combined migration per slice** (E1b2b: `0015_gastos.sql`; mirrors E1b2a's `0014` pattern) | User-confirmed 2026-06-25 |
| **Q4** | E1b2b contents | **gastos + final canonical sync + v0.5.4 → v0.5.5** | User-confirmed 2026-06-25 |
| **Q5** | Escuela `deporte_codigo` | **nullable integer, NO FK constraint** (deferred to future) | Parent E1b Q9 — LOCKED |
| **Q6** | Locacion NK | **composite `(LCNCTAPRIN, LCNNUMERO)`** — 89 distinct = 100% unique | Parent E1b Q7 — LOCKED |
| **Q7** | Gastos NK | **5-tuple** `(GASTIPGAST\|GASCTAPRIN\|GASSECUENC\|GASFECHA\|GASCOMPROB)` — 2,114 distinct = 100% unique. **3-tuple = 346 distinct (84% dupes — WRONG)** | Parent E1b Q5 LOCKED + re-verified live 2026-06-25 |
| **Q10** | Gastos ctacte FK | **NO ctacte FK in v1** (flat ledger). Verified: 0 of 165 distinct `GASCTAPRIN` match `ctacte.cctcuenta`. Deferred to N16. | Parent E1b exploration (Q5 deferral); re-verified live 2026-06-25 |
| **Q11** | Gastos socio_id FK | **NO socio_id FK in v1** (no source field). `socio_id` column exists (nullable, FK constraint deferred to N16). | **NEW** discovered 2026-06-25 11:50 UTC during this propose phase |
| **Q12** | E1b2b sync scope | **FULL atomic sync** (B1b LESSON #1) — closes Slice E spec with all 8 domains in one atomic update (NOT partial like E1b2a). **FINAL sync for Slice E.** | Locked decision for E1b2b |
| **Q-migration-numbering** | E1b2b migration filename | `0015_gastos.sql` (next sequential idx after E1b2a's 0014 in `_journal.json`) | Verified post-E1b2a: `_journal.json` ends at idx 14 |
| **Q-verify-slice-update** | Does apply phase need to update `scripts/verify-slice.sh`? | **YES** — must add `tesoreria.gastos` to `MASTER_TABLES` array (currently 7 entries). Without this, the post-merge verification gate would NOT verify gastos idempotency. | **NEW** discovered during this spec phase 2026-06-25 |

**All 11 decisions LOCKED.** E1b2b scope is fully bounded — no further open questions.

---

## Ready for design?

**YES.** The scope is precisely bounded:

- 1 NEW master table (`tesoreria.gastos`) + 1 NEW transform + 1 combined migration (`0015_gastos.sql`, idx 15) + 2 NEW vitest cases (T19-T20 in `describe.skip`) + 1 critical `scripts/verify-slice.sh` update + **FULL atomic canonical sync** (closes Slice E spec) + v0.5.4 → v0.5.5 PATCH release
- ~370 raw LoC / ~200 effective — under the 400-line review budget at raw count (~92%), well under at effective (~50%)
- All field mappings verified live against `192.168.1.102:5432/athlos` 2026-06-25 (11 fields: `GASINGBRUT`, `GASFECHA`, `GASCTAPRIN`, `GASCTAAUXI`, `GASTIPCTA`, `GASTIPGAST`, `GASCONCEPT`, `GASIMPORTE`, `GASSECUENC`, `GASIVA`, `GASCOMPROB`)
- All 3 scope corrections live-verified (5-tuple NK 100% unique, no socio_id FK, no ctacte FK)
- E1b1 / E1b2a LESSONs embedded in apply plan: **`bash scripts/verify-slice.sh` is the REAL gate** (per commit `b26896c`); migration via `psql` (NOT drizzle-kit); T19-T20 added to `describe.skip` blocks (destructive TRUNCATE bug fix)
- B1b LESSONs embedded: **FULL atomic sync** (not partial like E1b2a — closes Slice E); separate release commit; cherry-pick reorder; merge-then-delete; `SELECT DISTINCT ON` in fk-lookup (already correct from E1b1)

**Next step:** sdd-design → write `design.md` mirroring E1b2a's `design.md` format (~200-300 lines, focused on gastos + final sync). Then sdd-tasks → break into 10 work-units (TASK-001..TASK-010 per `proposal.md` §7). Then sdd-apply → wire gastos with strict TDD discipline + **`bash scripts/verify-slice.sh`** (E1b1/E1b2a LESSON — non-negotiable per commit `b26896c`). Then sdd-archive → sync this spec delta into `openspec/specs/deployment-devops/spec.md` to close Slice E.

**Apply-phase CRITICAL reminders (all in acceptance criteria above):**

1. **`scripts/verify-slice.sh` MUST be updated** to include `tesoreria.gastos` in `MASTER_TABLES` array (scripts/verify-slice.sh:28-36 currently lists 7 tables — missing `gastos`). This is the post-merge verification gate — without this update the script would NOT verify gastos idempotency.
2. **`bash scripts/verify-slice.sh` is the REAL pre-merge gate** — NOT the unit tests (which are `describe.skip` per E1b2a LESSON re: TRUNCATE bug fix).
3. **Migration via `psql`** (NOT `drizzle-kit migrate`) — E1b1 LESSON re: `_journal.json` tracking mismatch.
4. **5-tuple NK verification** at apply time: `SELECT count(DISTINCT legacy_id) FROM tesoreria.gastos` MUST equal 2,114 (NOT 346 — proves 5-tuple NK is correct).
5. **3-commit shape preserved** per B1b LESSON: `feat` → `docs(spec)` → `chore(release)`. No `Co-Authored-By` in any commit. Merge to `main` BEFORE `git branch -D` (B1b LESSON #4).

---

*Persisted to:*
- *`openspec/changes/athlos-promote-projection-to-master-e1b2b/specs/deployment-devops/spec.md`*
- *Engram topic `sdd/athlos-promote-projection-to-master-e1b2b/spec` (via `mem_save`)*