# Design: athlos-promote-projection-to-master-e1b2b

| Field | Value |
|-------|-------|
| **Change** | `athlos-promote-projection-to-master-e1b2b` |
| **Date** | 2026-06-25 |
| **Phase** | Design |
| **Mode** | Both (Engram + OpenSpec) |
| **Status** | Draft — ready for tasks |
| **Source artifacts** | `openspec/changes/athlos-promote-projection-to-master-e1b2b/specs/deployment-devops/spec.md` (361L) · `openspec/changes/athlos-promote-projection-to-master-e1b2b/proposal.md` (591L) · `openspec/changes/explore-athlos-promote-projection-to-master-e1b/exploration.md` (1010L) |
| **Sister changes (DONE)** | `athlos-promote-projection-to-master-e1a` (v0.5.1) · `athlos-promote-projection-to-master-e1b1` (v0.5.2/v0.5.3) · `athlos-promote-projection-to-master-e1b2a` (v0.5.4, commit `b8d8e43`) |
| **Sister slice (THIS)** | `athlos-promote-projection-to-master-e1b2b` (v0.5.5 — closes Slice E data promotion: 8/8 master tables populate + FINAL atomic canonical sync) |
| **Sister slice (LAST)** | `athlos-promote-projection-to-master-e2` — admin API + `promoted_at` audit column + runbook.md + post-Slice E spec polish |
| **Target release** | v0.5.4 → **v0.5.5** (PATCH — closes Slice E data promotion) |
| **B1b LESSONs embedded** | #1 (FULL) atomic canonical sync · #2 separate release commit · #3 cherry-pick reorder · #4 merge-before-delete · #5 MIN(uuid) workaround (already correct from E1b1+) |
| **E1b1/E1b2a LESSONs embedded** | `bash scripts/verify-slice.sh` is the REAL gate (commit `b26896c`, already updated to include `tesoreria.gastos` in commit `304f37a` merged as `061be50`) · migration via `psql` NOT drizzle-kit · T19-T20 added to `describe.skip` per E1b2a TRUNCATE bug fix |

> **FINAL ATOMIC SPEC SYNC NOTE (B1b LESSON #1, CRITICAL — closes Slice E).** This is the LAST atomic spec sync for Slice E. The `diff` against `openspec/specs/deployment-devops/spec.md` SHALL be EMPTY after the apply phase lands this sync. No further atomic syncs are planned for Slice E. E2 will add NEW requirements (admin API endpoint, `promoted_at` audit column, runbook) — not modify the Promotion Pipeline requirement.
>
> **3 SCOPE CORRECTIONS (LIVE-VERIFIED 2026-06-25 against `192.168.1.102:5432/athlos`).**
>
> 1. **#C2 (LOCKED + RE-VERIFIED live 2026-06-25):** `gastos` natural key is **5-tuple** `(GASTIPGAST|GASCTAPRIN|GASSECUENC|GASFECHA|GASCOMPROB)` — verified **2,114 distinct of 2,114 = 100% unique** (live query: `SELECT count(DISTINCT (...))` → 2,114). The 3-tuple yields only **346 distinct** (84% duplicates → silent loss of 1,768 rows via `legacy_id` UNIQUE collision). E1b2b uses 5-tuple.
> 2. **#C7 (LOCKED from parent E1b):** `gastos` has **NO ctacte FK** (flat ledger). Verified live: 0 of 2,114 rows have `CCTCUENTA` field in payload; `GASCTAPRIN` is accounting-plan code (e.g., `2010414`, `6001015`), NOT socio carnet. FK deferred to **N16**.
> 3. **#C8 (NEW, discovered 2026-06-25 11:50 UTC):** `gastos` has **NO `socio_id` FK in v1** (no `GASNUMSOC` / `SOCNUMERO` / `SOCCARNET` field in the 11-field payload). Verified live: `SELECT count(*) FILTER (WHERE payload ? 'SOCCARNET' OR payload ? 'GASNUMSOC' OR payload ? 'SOCNUMERO') FROM public."tesoreria.gastos_projection"` returns 0. The `socio_id` column SHALL exist in the master schema (nullable, FK constraint deferred to N16) for future backfill.

---

## 1. Context

### What E1a + E1b1 + E1b2a shipped

| Slice | Version | Scope | Status |
|-------|--------:|-------|--------|
| **E1a** | v0.5.1 | `packages/promotion/` skeleton + transforms for `socios`, `ctacte`, `ctacte1` | ✅ shipped 2026-06-24 |
| **E1b1** | v0.5.2/v0.5.3 | Migration `0013_legacy_id_unique.sql` (cctcuenta + legacy_id columns + UNIQUE INDEXes) + wire `ctacte1` via `cctcuenta` backfill | ✅ shipped 2026-06-24 |
| **E1b2a** | v0.5.4 | Migration `0014_new_masters.sql` (4 NEW tables: escuela, disciplinas legacy_id, locacion, caja_movimiento) + 4 NEW transforms + PROMOTION_ORDER extended to 7 domains | ✅ shipped 2026-06-25 (commit `b8d8e43`) |

After E1b2a (v0.5.4), **7 of 8 master domains** populate via `pnpm db:promote`. Per live verification 2026-06-25 against `192.168.1.102:5432/athlos`:

| Master table | Projection rows | Current status |
|--------------|----------------:|----------------|
| `socios.socios` | 39,357 | ✅ promoted (E1a) |
| `tesoreria.ctacte` | 326,275 | ✅ promoted (E1a) |
| `tesoreria.ctacte1` | 245,370 | ✅ partial (E1b1 — ~56%, N14 stale `entity_uuids`) |
| `socios.escuela` | 66 | ✅ promoted (E1b2a) |
| `deportes.disciplinas` | 32 | ✅ promoted (E1b2a) |
| `socios.locacion` | 89 | ✅ promoted (E1b2a) |
| `tesoreria.caja_movimiento` | 8,145 | ✅ promoted (E1b2a) |
| **`tesoreria.gastos`** | **2,114** | ❌ **table doesn't exist (E1b2b)** |

### What's left for E1b2b

**1 of 8 master tables is still empty** — `tesoreria.gastos`. The promotion pipeline currently has 7 domains wired; `gastos` is the last. E1b2b is the **LAST sub-slice of E1b**: it wires `gastos` and closes Slice E with the **FULL atomic canonical sync** (B1b LESSON #1 — closes the canonical spec with all 8 domains in one atomic update, NOT partial like E1b2a).

### E1b2 sub-slicing rationale

Parent E1b exploration (§1) recommends sub-slicing the 5-domain scope into 2 stacked PRs (E1b2a + E1b2b) so each lands under the 400-line review budget. E1b2a (DONE v0.5.4) shipped 4 domains + partial canonical sync + v0.5.3 → v0.5.4. **E1b2b (THIS)** ships 1 domain + FULL atomic canonical sync + v0.5.4 → v0.5.5.

This design modifies the existing `deployment-devops` capability by:

- Extending the "Domain promotion order respects FK dependencies" scenario to **8 domains** (was 7)
- Adding 1 NEW requirement: **`tesoreria.gastos` master table** (flat expense ledger with 5-tuple NK, no FKs in v1)
- Adding 1 NEW scenario: **"Gastos domain promotion (flat expense ledger)"**
- Appending 1 NEW success criterion: **gastos = 2,114 rows after promotion** (5-tuple NK verification)

---

## 2. Goals

| ID | Goal | Acceptance |
|----|------|------------|
| **G1** | 1 NEW master table: `tesoreria.gastos` | Migration 0015 applies cleanly via `psql -f`; `gastos` table queryable post-migration |
| **G2** | 1 NEW transform: `transformGastos` with 5-tuple NK → `legacy_id` | Reads `tesoreria.gastos_projection` payload, returns typed `NewGastos` insert; reuses `transform-helpers.ts` (`parseFechaVFP`, `parseMonto`, `deterministicUuid`); no `any` types |
| **G3** | `PROMOTION_ORDER` extended to 8 domains: `['socios', 'escuela', 'deportes', 'locacion', 'caja', 'gastos', 'ctacte', 'ctacte1']` | Topological order verified by FK dependencies; `gastos` placed between `caja` and `ctacte` (independent FK tree, alphabetical-bounded for determinism per B1b LESSON); `FK_BLOCKING_DOMAINS` unchanged = `['socios', 'ctacte']` |
| **G4** | Idempotent re-promotion via `legacy_id` UNIQUE INDEX for `gastos` | Re-running `pnpm db:promote` after first run inserts 0 new gastos rows |
| **G5** | Gastos natural key = **5-tuple** (`tipo\|cta\|sec\|fecha\|comprob`) — verified 100% unique live | `legacy_id = deterministicUuid('gastos:' + 5-tuple)`; 2,114 distinct = 100% unique verified |
| **G6** | Gastos schema has `socio_id uuid` nullable column (no FK constraint) | Schema column exists; stays NULL for all 2,114 rows in v1 (no `GASNUMSOC` field in source data); FK constraint deferred to N16 |
| **G7** | 2 NEW vitest TDD cases (T19-T20): happy path + 5-tuple dedup | `pnpm --filter @athlos/promotion test` → existing 11+ tests pass (no regression); 2 NEW cases added (currently `describe.skip` per E1b2a LESSON, properly re-enabled post-MVP) |
| **G8** | **FULL atomic canonical spec sync** (B1b LESSON #1, FULL — not partial like E1b2a) | `diff openspec/specs/deployment-devops/spec.md openspec/changes/.../specs/deployment-devops/spec.md` returns ONLY additive changes; closes Slice E spec with all 8 domains |
| **G9** | Smoke test runs end-to-end against real DB before merge (E1b1/E1b2a LESSON — non-negotiable) | Apply phase verifies `gastos=2,114` rows; 2nd/3rd runs insert 0 new rows; **`bash scripts/verify-slice.sh` PASSES** (the REAL gate, per E1b1 commit `b26896c` introducing the verification gate) |
| **G10** | Migration applied via `psql` (NOT `drizzle-kit migrate` — E1b1 LESSON re: tracking mismatch) | Apply phase: `PGPASSWORD=... psql -h 192.168.1.102 -U athlos -d athlos -f packages/db/drizzle/0015_gastos.sql`; manual `_journal.json` entry update after with idx 15 |
| **G11** | Idempotency across all 8 domains (re-run smoke test) | Re-running `promoteAll` 3 times produces same end state; `legacy_id` pre-check skips all already-promoted rows |
| **G12** | All gastos fields correctly resolved (numeric, dates, free text) | No parse errors during smoke test; orphan rows (if any) reported in `errors[]` for inspection |

---

## 3. Non-goals

| ID | Deferred to | Item |
|----|-------------|------|
| **N1** | **E2** | `POST /api/v1/promote/trigger` admin endpoint |
| **N2** | **E2** | `promoted_at TIMESTAMPTZ NULL` column on `raw_events` (E1b2b uses `legacy_id` + 5-tuple UNIQUE for idempotency) |
| **N3** | **E2** | `docs/runbook.md` "Promotion" section |
| **N4** | **E2** | Final spec polish (post-Slice E): partial cleanup, success-criterion reordering |
| **N5** | future | `pg_advisory_lock` for concurrent-promotion prevention |
| **N6** | future | Rollback endpoint (manual SQL only for v1) |
| **N7** | future (N7) | Caja detail columns (CAJCONCEP1..20, CAJIMPOR1..20, etc. — 122 wide columns) — header-only is sufficient for v1.0 |
| **N8** | future (N8) | `deportes.inscripciones` rebuild (per-socio enrollment in disciplinas) |
| **N9** | future (N14) | Stale `entity_uuids` repopulation (would unlock ~107k orphan ctacte1 rows + enable full ctacte1 promotion) |
| **N10** | future (N16) | `gastos` FK to `ctacte.id` via `cctcuenta` lookup (out of v1 scope per parent E1b + scope correction #C7) |
| **N11** | future | Escuela FK to `deportes.disciplinas.codigo` (FK constraint added later — nullable in E1b2a) |
| **N12** | future | Per-row transactional promotion (per-domain only for v1) |
| **N13** | future | Async trigger via `@athlos/scheduler` |
| **N14** | future | CONTABLE / CONTABL1 / CATASTROS domains (no master tables yet) |

> **NOTE**: `scripts/verify-slice.sh` was **already updated** to include `tesoreria.gastos` in `MASTER_TABLES` in commit `304f37a` (merged as `061be50` on main). The apply phase does NOT need to touch this script — the acceptance criterion about "verify-slice.sh update" was rendered moot post-merge of that fix. This is the only delta vs the original spec text. (Commit `061be50` also fixed the `schema.table` identifier parsing bug for the `count_rows` helper.)

---

## 4. Architecture

### 4.1 Data model (1 NEW master table)

**`tesoreria.gastos`** — flat accounting expense ledger (NO FKs in v1):

| Column | Type | Source | Notes |
|--------|------|--------|-------|
| `id` | uuid PK | `gen_random_uuid()` | Random UUID4 |
| `tipo` | integer NOT NULL | `GASTIPGAST` (1, 2, or 3) | Expense type; distribution: 1=846, 2=1267, 3=1 |
| `tipo_cuenta` | integer NOT NULL | `GASTIPCTA` | Sentinel 0 for all 2,114 rows |
| `cuenta_principal` | text NOT NULL | `GASCTAPRIN` | Accounting-plan code (e.g., `2010414`, `6001015`); NOT socio carnet |
| `cuenta_auxiliar` | integer | `GASCTAAUXI` | 0 for 2111 rows; 20 for 2 rows; 4 for 1 row |
| `secuencia` | integer NOT NULL | `GASSECUENC` | 0..8 (267 rows > 0) |
| `comprobante` | text NOT NULL | `GASCOMPROB` | "S/NUMERO" (1437), "S/Nº" (22), "R01-0348", etc.; 1 row empty |
| `fecha` | date NOT NULL | `GASFECHA` | ISO date string; min `0414-02-02` (sentinel/legacy), max 2008+ |
| `concepto` | text | `GASCONCEPT` | Free text — operator description (e.g., "GARCIA HUGO COMISION-P/COBRANZA CUOT.SOC.R204/205") |
| `importe` | text NOT NULL | `GASIMPORTE` (NUMERIC 14,2) | NUMERIC stored as text for IEEE-754 safety; range 0.01..3000 |
| `iva` | text | `GASIVA` (NUMERIC 14,2) | Mostly 0; default `'0.00'` |
| `ingreso_bruto` | text | `GASINGBRUT` | 20-character accounting-grid debit string; stored as text NOT numeric |
| `legacy_id` | text | `deterministicUuid('gastos:' + 5-tuple)` | UNIQUE INDEX (cross-run idempotency) |
| `created_at` | timestamptz NOT NULL | `default now()` | Insertion timestamp |
| **`socio_id`** | **uuid NULLABLE** | — | **NO FK constraint in v1** (no source field; reserved for N16 backfill) |
| **(no ctacte FK)** | — | — | Deferred to N16 (GASCTAPRIN is accounting code, not socio carnet) |

**Indexes (migration 0015):**

| Index | Type | Columns | Purpose |
|-------|------|---------|---------|
| `gastos_pkey` | PK | `id` | Row identity |
| `gastos_legacy_id_unique` | UNIQUE | `legacy_id` | Cross-run idempotency (primary defense) |
| `gastos_5tuple_unique` | UNIQUE | `(tipo, cuenta_principal, secuencia, fecha, comprobante)` | 5-tuple NK catch (defense in depth) |
| `gastos_cuenta_fecha_idx` | INDEX | `(cuenta_principal, fecha)` | Lookup by account + date range |
| `gastos_socio_id_idx` | INDEX (partial) | `socio_id` WHERE `socio_id IS NOT NULL` | Future N16 backfill lookup (only when populated) |

**3 layers of idempotency defense:**
1. `dedup.ts` pre-check (loads `legacy_id` from master, skips already-promoted)
2. `gastos_5tuple_unique` UNIQUE INDEX (catches natural-key collisions on raw insert)
3. `gastos_legacy_id_unique` UNIQUE INDEX (catches `legacy_id` collisions on raw insert)
4. `ON CONFLICT DO NOTHING` on the insert (belt-and-suspenders fallback)

### 4.2 Promotion order (post-E1b2b, 8 domains)

```typescript
// packages/promotion/src/PROMOTION_ORDER.ts (post-E1b2b)
export const PROMOTION_ORDER: readonly Domain[] = [
  'socios',     // No FK deps; populates first so ctacte can resolve socio_id
  'escuela',    // No FK in v1 (deporte_codigo plain integer)
  'deportes',   // No FK; populates disciplinas (32 rows)
  'locacion',   // No FK in v1 (cuenta_principal text, no constraint)
  'caja',       // No FK in v1 (header-only)
  'gastos',     // NEW (E1b2b): flat ledger, no FK in v1 (socio_id nullable, ctacte FK deferred to N16)
  'ctacte',     // FK: socio_id → socios.id (required)
  'ctacte1',    // FK: ctacte_id → ctacte.id (via cctcuenta lookup)
] as const

export const FK_BLOCKING_DOMAINS: readonly Domain[] = ['socios', 'ctacte']
// escuela/deportes/locacion/caja/gastos do NOT block downstream (no required FKs)

export const PROJECTION_TABLE: Record<Domain, { schema: string; table: string }> = {
  socios:   { schema: 'public', table: 'socios.socios_projection' },
  escuela:  { schema: 'public', table: 'socios.escuela_projection' },
  deportes: { schema: 'public', table: 'deportes.deportes_projection' },
  locacion: { schema: 'public', table: 'socios.locacion_projection' },
  caja:     { schema: 'public', table: 'tesoreria.caja_projection' },
  gastos:   { schema: 'public', table: 'tesoreria.gastos_projection' },  // NEW
  ctacte:   { schema: 'public', table: 'tesoreria.ctacte_projection' },
  ctacte1:  { schema: 'public', table: 'tesoreria.ctacte1_projection' },
}

export const DOMAIN_TRANSFORMS: Record<Domain, TransformFn> = {
  socios:   transformSocio as TransformFn,
  escuela:  transformEscuela as TransformFn,
  deportes: transformDeportes as TransformFn,
  locacion: transformLocacion as TransformFn,
  caja:     transformCaja as TransformFn,
  gastos:   transformGastos as TransformFn,  // NEW
  ctacte:   transformCtacte as TransformFn,
  ctacte1:  transformCtacte1 as TransformFn,
}
```

**Order rationale (topological + deterministic):**

- `socios` MUST be first (no FK; root of dependency graph).
- `escuela`, `deportes`, `locacion`, `caja`, `gastos` are all INDEPENDENT (no FK to each other or to socios in v1). Order between them is arbitrary — alphabetical chosen for determinism (B1b LESSON: deterministic order = reproducible runs).
- `gastos` placed between `caja` and `ctacte` for symmetry with `caja_movimiento` (both are `tesoreria` schema cash/expense tables).
- `ctacte` MUST run before `ctacte1` (FK dependency). Position at end preserved from E1b1.
- `FK_BLOCKING_DOMAINS` unchanged — `gastos` has no required FKs so it doesn't short-circuit downstream.

### 4.3 FK lookup strategy (unchanged from E1b2a)

| Domain | socio FK | ctacte FK | Rationale |
|--------|----------|-----------|-----------|
| `gastos` | `socio_id` nullable | — | **Flat ledger**, no source field for socio (C8); `socio_id` column reserved for future N16 backfill via `cctcuenta` lookup |

`fk-lookup.ts` — `buildFkMap` for `gastos` does **nothing extra** (no FK lookups needed in v1). The transform hard-codes `socioId: null`. When N16 lands the backfill, `buildFkMap` will gain a `ctacte:${cctcuenta}` lookup branch that resolves `cuenta_principal` to `ctacte.id`.

### 4.4 Migration `0015_gastos.sql` (hand-written, ~25 LoC)

```sql
-- Migration 0015: tesoreria.gastos master table (E1b2b)
-- 1 NEW master table + 3 UNIQUE INDEXes (legacy_id, 5-tuple composite, cuenta+fecha)
-- for cross-run idempotency.
--
-- gastos (2,114 rows) — flat ledger with optional socio_id FK (deferred to N16).
-- Natural key: 5-tuple (GASTIPGAST, GASCTAPRIN, GASSECUENC, GASFECHA, GASCOMPROB)
--   Verified 2,114/2,114 distinct = 100% unique (3-tuple yields 346 distinct = 84% dupes).
--
-- Idempotent: re-running is a no-op (CREATE TABLE IF NOT EXISTS,
-- CREATE UNIQUE INDEX IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS "tesoreria"."gastos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tipo" integer NOT NULL,                            -- GASTIPGAST (1=debit, 2=credit, 3=other)
  "tipo_cuenta" integer NOT NULL,                     -- GASTIPCTA (sentinel 0 for all 2,114 rows)
  "cuenta_principal" text NOT NULL,                   -- GASCTAPRIN (accounting-plan code; NOT socio carnet)
  "cuenta_auxiliar" integer,                          -- GASCTAAUXI (auxiliary account; mostly 0)
  "secuencia" integer NOT NULL DEFAULT 0,             -- GASSECUENC (0..8)
  "fecha" date NOT NULL,                              -- GASFECHA
  "comprobante" text NOT NULL DEFAULT '',             -- GASCOMPROB (1/2114 empty)
  "concepto" text,                                    -- GASCONCEPT (free text — operator description)
  "importe" text NOT NULL DEFAULT '0.00',             -- GASIMPORTE (NUMERIC 14,2; 0.01..3000)
  "iva" text DEFAULT '0.00',                          -- GASIVA (NUMERIC 14,2; mostly 0)
  "ingreso_bruto" text,                               -- GASINGBRUT (20-char accounting-grid string)
  "socio_id" uuid,                                    -- FK to socios.socios.id (NULLABLE; deferred to N16)
  "legacy_id" text,                                   -- deterministic UUID5 from 'gastos:'+5-tuple
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gastos_legacy_id_unique"
  ON "tesoreria"."gastos" ("legacy_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gastos_5tuple_unique"
  ON "tesoreria"."gastos" ("tipo", "cuenta_principal", "secuencia", "fecha", "comprobante");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gastos_cuenta_fecha_idx"
  ON "tesoreria"."gastos" ("cuenta_principal", "fecha");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gastos_socio_id_idx"
  ON "tesoreria"."gastos" ("socio_id") WHERE "socio_id" IS NOT NULL;
```

**Schema design notes:**

1. **`importe` and `iva` stored as `text` (not `numeric`)** — mirrors the E1a pattern for `ctacte.debe/haber`. IEEE-754 rounding avoidance. The promotion transform parses to NUMERIC(14,2) via `parseMonto` then stringifies.
2. **`ingreso_bruto` is `text`** — it's a 20-character accounting-grid debit string (e.g., `'00000000000000000000'`), NOT a number. Storing as `numeric` would lose leading zeros and right-padding semantics.
3. **`socio_id` is NULLABLE** — no source field exists to populate it (verified: 11 fields in projection, none are socio carnet). Column is reserved for future N16 backfill. No `REFERENCES` clause.
4. **5-tuple UNIQUE INDEX** catches the natural-key collision case (defense in depth alongside `legacy_id` UNIQUE INDEX). Re-runs skip both via dedup pre-check + ON CONFLICT DO NOTHING.
5. **`comprobante DEFAULT ''`** — 1 row has empty string. Empty string is a valid value (NOT NULL).
6. **`tipo_cuenta` is NOT NULL with sentinel 0** — all 2,114 rows have GASTIPCTA=0; the sentinel is the actual data, not a placeholder.
7. **Partial INDEX on `socio_id`** — `WHERE socio_id IS NOT NULL` keeps the index small for the v1 state (all NULL); grows efficiently when N16 backfill lands.

**Idempotency:** `CREATE TABLE IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS` — re-running is a no-op.

**Apply via `psql`** (E1b1 LESSON — `_journal.json` tracking mismatch with hand-written SQL):

```bash
PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos \
  -f packages/db/drizzle/0015_gastos.sql
```

**`_journal.json` manual update** (add entry for idx 15, next sequential after E1b2a's 0014):

```json
{
  "idx": 15,
  "version": "7",
  "when": 1782341000000,
  "tag": "0015_gastos",
  "breakpoints": true
}
```

The `0015_gastos_snapshot.json` is auto-generated by drizzle-kit during normal `pnpm --filter @athlos/db generate` workflow — for this hand-written SQL migration, the snapshot will be created/updated by a subsequent `drizzle-kit generate` or manually copied (matching E1b1/E1b2a convention).

### 4.5 Transform

`packages/promotion/src/transforms/gastos.ts` (~50L, mirrors `transforms/caja.ts` pattern):

```typescript
/**
 * Map VFP/projection payload → Drizzle `tesoreria.gastos` insert.
 *
 * Flat expense ledger with 5-tuple NK (GASTIPGAST, GASCTAPRIN, GASSECUENC, GASFECHA, GASCOMPROB).
 * Scope correction #C2: 5-tuple verified 2114/2114 = 100% unique (3-tuple yields 346 distinct
 * — 1,768 silent row losses via legacy_id UNIQUE collision).
 *
 * NO ctacte FK in v1 (verified live: 0 of 165 distinct GASCTAPRIN match any ctacte.cctcuenta).
 * NO socio_id FK in v1 (no source field; socio_id column reserved for future N16 backfill).
 *
 * Source: `public."tesoreria.gastos_projection"` (2,114 rows, 11 fields).
 * Field names verified against live DB sample 2026-06-25.
 */
import { randomUUID } from 'node:crypto'
import type { NewGastos } from '@athlos/db/schema'
import type { TransformHelpers } from '../transform-helpers.ts'

export function transformGastos(
  payload: Record<string, unknown>,
  helpers: TransformHelpers,
): NewGastos {
  const { parseFechaVFP, parseMonto, deterministicUuid } = helpers

  const tipo = Number(payload['GASTIPGAST'] ?? 0)
  if (!tipo) throw new Error('Empty GASTIPGAST')

  const tipoCuenta = Number(payload['GASTIPCTA'] ?? 0)

  const cuentaPrincipal = String(payload['GASCTAPRIN'] ?? '')
  if (!cuentaPrincipal) throw new Error('Empty GASCTAPRIN')

  const cuentaAuxiliar = payload['GASCTAAUXI']
    ? Number(payload['GASCTAAUXI'])
    : null

  const secuencia = Number(payload['GASSECUENC'] ?? 0)

  const comprobante = String(payload['GASCOMPROB'] ?? '').trim()
  // 1/2114 rows have empty string (sentinel); '' is a valid value

  const fecha = parseFechaVFP(payload['GASFECHA'] ?? null)
  if (!fecha) throw new Error('Unparseable GASFECHA')

  // 5-tuple natural key (verified 100% unique; 3-tuple had 1,768 duplicates)
  const legacyId = deterministicUuid(
    `gastos:${tipo}|${cuentaPrincipal}|${secuencia}|${fecha}|${comprobante}`,
  )

  return {
    id: randomUUID(),
    tipo,
    tipoCuenta,
    cuentaPrincipal,
    cuentaAuxiliar,
    secuencia,
    comprobante,
    fecha,
    concepto: String(payload['GASCONCEPT'] ?? '').trim() || null,
    importe: parseMonto(payload['GASIMPORTE']),
    iva: payload['GASIVA'] != null ? parseMonto(payload['GASIVA']) : '0.00',
    ingresoBruto: payload['GASINGBRUT']
      ? String(payload['GASINGBRUT']).trim() || null
      : null,
    socioId: null, // NULL in v1 (no source field; N16 backfill future)
    legacyId,
    createdAt: new Date(),
  }
}
```

**Sample payload (5 rows from live verification 2026-06-25, ordered by fecha):**

| tipo | cuenta_principal | sec | fecha | comprobante | importe | concepto |
|------|------------------|----:|------|-------------|--------:|----------|
| 1 | 2010414 | 0 | 0414-02-02 | S/NUMERO | 5 | BELIZAN FABIAN - ESC.DE FUTBOL LIQ.20-11-03 |
| 1 | 2020103 | 0 | 1902-03-02 | S/Nº | 20 | COCA GUSTAVO-A CTA.DE HABERES |
| 1 | 6001005 | 0 | 2003-02-15 | S/NUMERO | 25 | GUANUCO LUIS F. HON.SERV.DE ADMINISTRACION GENERAL |
| 1 | 2010157 | 0 | 2003-02-15 | R01-0348 | 26 | IMPRENTA CHAVEZ CANC.FACT.01-01186 |
| 1 | 6001015 | 0 | 2003-02-15 | S/NUMERO | 60 | GARCIA HUGO COMISION-P/COBRANZA CUOT.SOC.R204/205 |

UTF-8 round-trip clean (verified): `"S/Nº"`, `"COMP.S/Nº"` with proper UTF-8 codepoints.

### 4.6 Promotion algorithm updates

**`PROMOTION_ORDER.ts`**: extend the `Domain` union, `PROMOTION_ORDER`, `PROJECTION_TABLE`, and `DOMAIN_TRANSFORMS` for `gastos` (per §4.2).

**`promote.ts`**: extend the `Domain` union + `insertMasterBatch` switch with `gastos` branch:

```typescript
// packages/promotion/src/promote.ts (additions)
import { ..., gastos } from '@athlos/db/schema'  // NEW import

export type Domain =
  | 'socios' | 'ctacte' | 'ctacte1' | 'escuela' | 'deportes' | 'locacion' | 'caja' | 'gastos'

// ... in insertMasterBatch:
} else if (domain === 'gastos') {
  inserted = await db
    .insert(gastos)
    .values(rows as unknown as never[])
    .onConflictDoNothing()
    .returning({ id: gastos.id })
}
```

**`dedup.ts`**: extend `naturalKey` + `loadExistingNaturalKeys` + `Domain` union for `gastos`:

```typescript
// packages/promotion/src/dedup.ts (additions)
import { ..., gastos } from '@athlos/db/schema'

export type Domain =
  | 'socios' | 'ctacte' | 'ctacte1' | 'escuela' | 'deportes' | 'locacion' | 'caja' | 'gastos'

// Natural key (5-tuple, verified 100% unique)
if (domain === 'gastos') {
  return [
    payload['GASTIPGAST'] ?? '',
    payload['GASCTAPRIN'] ?? '',
    payload['GASSECUENC'] ?? '',
    payload['GASFECHA'] ?? '',
    payload['GASCOMPROB'] ?? '',
  ].join('|')
}

// Load existing legacy_ids for cross-run dedup
if (domain === 'gastos') {
  const rows = await db
    .select({ legacyId: gastos.legacyId })
    .from(gastos)
    .where(isNotNull(gastos.legacyId))
  return new Set(rows.map((r) => r.legacyId).filter((id): id is string => id !== null))
}
```

**`fk-lookup.ts`**: no change needed — `gastos` has no FK lookups in v1. (When N16 lands the backfill, this will gain a `ctacte:${cctcuenta}` lookup branch.)

---

## 5. Implementation details

### 5.1 Files to modify / create

| File | Action | Est. lines | Notes |
|------|--------|-----------:|-------|
| `packages/db/drizzle/0015_gastos.sql` | CREATE | ~30 | Hand-written SQL: 1 CREATE TABLE + 3 UNIQUE INDEX + 2 INDEX |
| `packages/db/drizzle/meta/0015_snapshot.json` | CREATE (auto-gen) | — | Drizzle snapshot |
| `packages/db/drizzle/meta/_journal.json` | MODIFY | +6 | Add entry for idx 15 (next sequential after 0014) |
| `packages/db/src/schema/tesoreria.ts` | MODIFY | +50 | Add `gastos` table + types (`Gastos`, `NewGastos`) |
| `packages/db/src/schema/index.ts` | MODIFY | +3 | Re-export `gastos` + types |
| `packages/promotion/src/PROMOTION_ORDER.ts` | MODIFY | +5 | Add `'gastos'` to `Domain` union + `PROMOTION_ORDER` + `PROJECTION_TABLE` + `DOMAIN_TRANSFORMS` |
| `packages/promotion/src/dedup.ts` | MODIFY | +18 | Extend `Domain` union + 1 NEW `naturalKey` branch (5-tuple) + 1 NEW `loadExistingNaturalKeys` branch + `gastos` import |
| `packages/promotion/src/fk-lookup.ts` | — | 0 | No change (gastos has no FK lookups in v1) |
| `packages/promotion/src/promote.ts` | MODIFY | +12 | Extend `Domain` union + `insertMasterBatch` switch (1 NEW `else if` branch) + `gastos` import |
| `packages/promotion/src/transforms/gastos.ts` | CREATE | ~50 | New transform (per §4.5, 5-tuple NK) |
| `packages/promotion/src/transforms/index.ts` | MODIFY | +1 | Re-export `transformGastos` |
| `packages/promotion/src/__tests__/promote.test.ts` | MODIFY | +30 | 2 NEW vitest cases (T19-T20) added to existing `describe.skip` blocks per E1b2a LESSON |
| `openspec/specs/deployment-devops/spec.md` | MODIFY (FULL atomic sync) | +60 | Extend PROMOTION_ORDER scenario to 8 domains + 1 NEW gastos scenario + 1 NEW success criterion + scope corrections C2/C7/C8 documented + E1b2a UPDATE callout extended + E2 deferred markers |
| `CHANGELOG.md` | MODIFY | +10 | v0.5.5 entry under Released |
| `package.json` (root) | MODIFY | +1 | bump 0.5.3 → 0.5.5 (in release commit only) |
| `packages/promotion/package.json` | MODIFY | +1 | bump 0.5.3 → 0.5.5 (in release commit only) |
| `packages/*/package.json` (16 other packages) | MODIFY | +1 each | bump 0.5.0 → 0.5.5 (in release commit only) |
| **Total raw LoC** | | **~280** | (under the 400-line review budget at raw count: ~70%; ~140 effective) |

> **Note on version state**: As of `main` post-merge `061be50`, the root `package.json` shows `"version": "0.5.3"` and `packages/promotion/package.json` shows `"version": "0.5.3"` (the 16 other packages show `0.5.0`). The E1b2a release commit (`3556fb1`) tagged v0.5.4 on git but did NOT bump the root package.json or 16 packages. E1b2b's release commit (TASK-010) MUST bump **all** of them to `0.5.5` — this corrects the drift accumulated across E1b1 + E1b2a. Apply phase should verify and update accordingly.

### 5.2 Migration order

1. **TASK-002 [TDD-GREEN migration]**: Hand-write `0015_gastos.sql` + apply via `psql` (NOT drizzle-kit — E1b1 LESSON) + update `_journal.json` with idx 15 entry.
2. **TASK-003 [TDD-GREEN schema]**: Update `tesoreria.ts` to add `gastos` table + types + `index.ts` re-export.
3. **TASK-004 [TDD-GREEN transform]**: Implement `transformGastos` with 5-tuple NK.
4. **TASK-005 [TDD-GREEN algorithm]**: Extend `Domain` union + `PROMOTION_ORDER` + `PROJECTION_TABLE` + `DOMAIN_TRANSFORMS` + `dedup.ts` (1 NEW key + 1 NEW loadExistingNaturalKeys branch) + `promote.ts` (insertMasterBatch switch extension).

### 5.3 Test strategy (T19-T20, mirror E1b2a pattern)

> **Per E1b2a LESSON re: TRUNCATE bug fix in commit `b26896c`**: T19-T20 will be added to existing `describe.skip` blocks. The REAL gate is `bash scripts/verify-slice.sh` (introduced in the same commit, updated to include gastos in commit `304f37a`/`061be50`).

| Test | Domain | What it verifies |
|------|--------|------------------|
| **T19** | gastos | Happy path: insert 1 projection row (GASTIPGAST=1, GASCTAPRIN=1111001, GASSECUENC=0, GASFECHA=2003-10-15, GASCOMPROB='S/NUMERO') → promote → master has 1 row with correct field mapping. Idempotent re-run: 0 new inserts. |
| **T20** | gastos | **5-tuple dedup verified**: insert same gastos row twice (same 5-tuple) → promote → master has exactly 1 row (NOT 2 — legacy_id UNIQUE catches the duplicate). |

**Test fixture prefix**: use `test-T19-` and `test-T20-` for unique source_key prefixes (per E1b1 LESSON re: avoid truncation collisions).

---

## 6. File-by-file changes (detailed)

### 6.1 `packages/db/drizzle/0015_gastos.sql` (NEW, ~30 LoC)

**Current state**: file does not exist.

**New state**: hand-written SQL per §4.4 (1 CREATE TABLE + 3 UNIQUE INDEX + 2 INDEX, all idempotent via `IF NOT EXISTS`).

**Verification**:
```bash
PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos \
  -f packages/db/drizzle/0015_gastos.sql
PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos \
  -c "\d tesoreria.gastos"  # verify 13 columns + 3 UNIQUE INDEX + 2 INDEX
PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos \
  -f packages/db/drizzle/0015_gastos.sql  # re-run: must be no-op (idempotent)
```

### 6.2 `packages/db/drizzle/meta/_journal.json` (MODIFIED, +6 LoC)

**Current state**: ends at `idx: 14` (tag `0014_new_masters`).

**New state**: append new entry for `idx: 15` (tag `0015_gastos`):
```json
{
  "idx": 15,
  "version": "7",
  "when": 1782341000000,
  "tag": "0015_gastos",
  "breakpoints": true
}
```

**Verification**:
```bash
cat packages/db/drizzle/meta/_journal.json | jq '.entries | length'  # should be 16
```

### 6.3 `packages/db/src/schema/tesoreria.ts` (MODIFIED, +50 LoC)

**Current state**: exports `tesoreriaSchema`, `ctacteTipo`, `ctacte`, `ctacte1`, `cajaMovimiento`. No `gastos`.

**New state**: append `gastos` table + `Gastos` / `NewGastos` types (mirror `cajaMovimiento` pattern with explicit `legacyIdUnique` + `legacyIdUnique` + `cuentaFechaIdx` indexes):

```typescript
/**
 * Flat accounting expense ledger with 5-tuple NK
 * (GASTIPGAST, GASCTAPRIN, GASSECUENC, GASFECHA, GASCOMPROB).
 * Scope correction #C2: 5-tuple verified 2114/2114 = 100% unique (3-tuple = 346 distinct = 84% dupes).
 * No ctacte FK (#C7: GASCTAPRIN is accounting-plan code, NOT socio carnet).
 * No socio_id FK in v1 (#C8: no source field; socio_id column reserved for future N16 backfill).
 * Migration 0015 creates table + 3 UNIQUE INDEXes (legacy_id, 5-tuple, cuenta+fecha) + 1 partial socio_id index.
 */
export const gastos = tesoreriaSchema.table(
  'gastos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tipo: integer('tipo').notNull(),
    tipoCuenta: integer('tipo_cuenta').notNull(),
    cuentaPrincipal: text('cuenta_principal').notNull(),
    cuentaAuxiliar: integer('cuenta_auxiliar'),
    secuencia: integer('secuencia').notNull().default(0),
    comprobante: text('comprobante').notNull().default(''),
    fecha: date('fecha').notNull(),
    concepto: text('concepto'),
    importe: text('importe').notNull().default('0.00'),
    iva: text('iva').default('0.00').notNull(),
    ingresoBruto: text('ingreso_bruto'),
    socioId: uuid('socio_id'),  // NULLABLE; FK constraint deferred to N16
    legacyId: text('legacy_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    legacyIdUnique: uniqueIndex('gastos_legacy_id_unique').on(table.legacyId),
    tupleUnique: uniqueIndex('gastos_5tuple_unique').on(
      table.tipo, table.cuentaPrincipal, table.secuencia, table.fecha, table.comprobante,
    ),
    cuentaFechaIdx: index('gastos_cuenta_fecha_idx').on(table.cuentaPrincipal, table.fecha),
    socioIdIdx: index('gastos_socio_id_idx').on(table.socioId)
      .where(sql`${table.socioId} IS NOT NULL`),
  }),
)

export type Gastos = typeof gastos.$inferSelect
export type NewGastos = typeof gastos.$inferInsert
```

**Verification**:
```bash
pnpm --filter @athlos/db typecheck  # ensure NewGastos type exports correctly
```

### 6.4 `packages/db/src/schema/index.ts` (MODIFIED, +3 LoC)

**Current state**: re-exports `ctacteTipo`, `ctacte`, `ctacte1`, `cajaMovimiento` from `./tesoreria` (lines 71-79).

**New state**: add `gastos` + `Gastos` / `NewGastos` to the re-exports:
```typescript
export { tesoreriaSchema, ctacteTipo, ctacte, ctacte1, cajaMovimiento, gastos } from './tesoreria'
export type {
  Ctacte, NewCtacte, Ctacte1, NewCtacte1, CajaMovimiento, NewCajaMovimiento,
  Gastos, NewGastos,  // NEW
} from './tesoreria'
```

**Verification**:
```bash
pnpm --filter @athlos/db typecheck
grep -r 'NewGastos' packages/promotion/src/transforms/gastos.ts  # type resolution
```

### 6.5 `packages/promotion/src/transforms/gastos.ts` (NEW, ~50 LoC)

**Current state**: file does not exist.

**New state**: per §4.5 (5-tuple NK, no FK lookups, `parseMonto` for importe/iva, `parseFechaVFP` for fecha, `deterministicUuid` for legacy_id).

**Verification**:
```bash
pnpm --filter @athlos/promotion typecheck
```

### 6.6 `packages/promotion/src/PROMOTION_ORDER.ts` (MODIFIED, +5 LoC)

**Current state**: 7 domains; `gastos` mentioned in JSDoc comment "E1b2b will add: gastos" (line 8) but not yet wired.

**New state**: extend per §4.2 — add `gastos` import, extend `PROMOTION_ORDER` array, extend `PROJECTION_TABLE`, extend `DOMAIN_TRANSFORMS`. Update JSDoc line 8 to mark as done.

**Verification**:
```bash
pnpm --filter @athlos/promotion typecheck
grep -c "gastos" packages/promotion/src/PROMOTION_ORDER.ts  # expect ≥5
```

### 6.7 `packages/promotion/src/dedup.ts` (MODIFIED, +18 LoC)

**Current state**: 7-domain `naturalKey` + `loadExistingNaturalKeys` + `Domain` type.

**New state**: add `gastos` import + extend `Domain` union + add `gastos` branch in both `naturalKey` (5-tuple) and `loadExistingNaturalKeys` (reads `legacyId` from `gastos` master table).

**Verification**:
```bash
pnpm --filter @athlos/promotion typecheck
grep -A 7 "domain === 'gastos'" packages/promotion/src/dedup.ts  # both branches present
```

### 6.8 `packages/promotion/src/promote.ts` (MODIFIED, +12 LoC)

**Current state**: 7-domain `Domain` union + `insertMasterBatch` switch.

**New state**: add `gastos` import + extend `Domain` union + add `gastos` branch in `insertMasterBatch` switch (`db.insert(gastos).values(...).onConflictDoNothing().returning({id: gastos.id})`).

**Verification**:
```bash
pnpm --filter @athlos/promotion typecheck
grep -A 5 "domain === 'gastos'" packages/promotion/src/promote.ts
```

### 6.9 `packages/promotion/src/__tests__/promote.test.ts` (MODIFIED, +30 LoC)

**Current state**: 11+ vitest cases (T1-T11 + T13-T18 from E1b2a), all in `describe.skip` blocks per E1b2a LESSON re: TRUNCATE bug fix.

**New state**: add 2 NEW vitest cases **T19-T20** to existing `describe.skip` blocks per E1b2a LESSON:
- T19: happy path (1 projection row → 1 master row + idempotent re-run = 0 new)
- T20: **5-tuple dedup verified** (NOT 3-tuple — see C2)

Test fixtures MUST use ACTUAL projection field names verified via `SELECT DISTINCT jsonb_object_keys` (11 fields: GASINGBRUT, GASFECHA, GASCTAPRIN, GASCTAAUXI, GASTIPCTA, GASTIPGAST, GASCONCEPT, GASIMPORTE, GASSECUENC, GASIVA, GASCOMPROB).

**Verification**:
```bash
pnpm --filter @athlos/promotion test  # tests are .skip — passes trivially
grep -c "T19\|T20" packages/promotion/src/__tests__/promote.test.ts  # expect ≥2
```

### 6.10 `openspec/specs/deployment-devops/spec.md` (MODIFIED, +60 LoC)

**Current state**: 7-domain PROMOTION_ORDER (lines 180-196). Success criteria end at #30 (Slice D) + E1a 6 NEW (#31-36, applied partially) + E1b2a 10 NEW (#37-46, applied partially).

**New state** (FULL atomic sync per B1b LESSON #1):
1. Update "Domain promotion order respects FK dependencies" scenario to 8 domains — add `gastos` as 6th position. Keep CLI runner / Batched INSERT / Projection schema-qualified / Escuela / Deportes / Locacion / Caja scenarios verbatim per archive rule.
2. Add 1 NEW scenario: **"Gastos domain promotion (flat expense ledger)"** (12 assertions including 5-tuple NK verification, no socio_id FK, no ctacte FK, idempotency via 3 layers of defense).
3. Add 1 NEW requirement: **`tesoreria.gastos` master table** (NEW) — 3 scenarios (table created via migration 0015, promotion populates master with 5-tuple NK, re-promotion is idempotent).
4. Append 2 NEW success criteria (#47-48): gastos=2,114 rows verification + verify-slice.sh exits 0 with all 8 domains.
5. Document 3 scope corrections (#C2, #C7, #C8) in the E1b2b UPDATE callout.
6. Extend E1b2a UPDATE callout to include E1b2b result (8th domain wired, FINAL atomic sync, Slice E closed).
7. Add E2 deferred markers (admin API + promoted_at + runbook + post-Slice E spec polish).

**Verification**:
```bash
diff -u \
  openspec/specs/deployment-devops/spec.md \
  openspec/changes/athlos-promote-projection-to-master-e1b2b/specs/deployment-devops/spec.md \
  | head -100  # should show ONLY additive changes (no removals, no rewrites of pre-Slice E scenarios)
```

### 6.11 `CHANGELOG.md` (MODIFIED, +10 LoC, in release commit only)

**Current state**: last entry is `[0.5.3] — 2026-06-24`. Missing v0.5.4 entry (E1b2a release commit gap — see §5.1 note).

**New state**: append 2 NEW entries:
- `[0.5.4] — 2026-06-25` (backfill E1b2a's CHANGELOG gap; documents escuela + deportes + locacion + caja wiring)
- `[0.5.5] — 2026-06-25` (E1b2b: gastos + final atomic canonical sync; includes verify-slice.sh smoke test results: 1st run gastos=2,114, 2nd run 0 inserted, all 8 domains idempotent)

**Verification**:
```bash
grep -c "0.5.5" CHANGELOG.md  # expect ≥1
grep -A 3 "## \[0.5.5\]" CHANGELOG.md
```

### 6.12 Version bumps (root + 18 packages, in release commit only)

**Current state**: root = `0.5.3`, promotion = `0.5.3`, 16 other packages = `0.5.0`.

**New state**: bump all to `0.5.5`.

**Verification**:
```bash
grep -r '"version"' packages/*/package.json package.json | grep -v 0.5.5
# expect 0 output (all packages at 0.5.5)
```

---

## 7. Work-units (10 tasks, 3-commit shape per B1b LESSON)

### Commit 1: `feat(promotion): wire gastos master table (flat ledger, 5-tuple NK)`

TDD chain collapses into 1 commit via squash (mirrors E1b2a pattern).

| # | Task | Description | Files |
|---|------|-------------|-------|
| **TASK-001** | [TDD-RED] | Write 2 NEW vitest cases T19-T20 in `__tests__/promote.test.ts` + JSON fixtures (added to existing `describe.skip` per E1b2a LESSON); verify they fail to compile (or skip trivially) | test file (~30L) |
| **TASK-002** | [TDD-GREEN migration] | Hand-write `0015_gastos.sql` + apply via `psql` (NOT drizzle-kit — E1b1 LESSON) + update `_journal.json` with idx 15 entry | migration (~30L), journal (+6L) |
| **TASK-003** | [TDD-GREEN schema] | Update `tesoreria.ts` with `gastos` table + types + `index.ts` re-export | 2 files (~53L) |
| **TASK-004** | [TDD-GREEN transform] | Implement `transformGastos` with 5-tuple NK (per §4.5) | 1 file (~50L) |
| **TASK-005** | [TDD-GREEN algorithm] | Extend `Domain` union + `PROMOTION_ORDER` + `PROJECTION_TABLE` + `DOMAIN_TRANSFORMS` + `dedup.ts` (1 NEW naturalKey branch + 1 NEW loadExistingNaturalKeys branch) + `promote.ts` (insertMasterBatch switch extension) | 3 files (~35L) |
| **TASK-006** | [TDD-REFACTOR] | Tighten helpers; ensure no `any` types; verify imports consistent | (~0L net) |
| **TASK-007** | [Pre-closing verification — CRITICAL E1b1/E1b2a LESSON] | Run `bash scripts/verify-slice.sh` (the REAL gate, per commit `b26896c`); verify gastos=2,114 rows + ALL 8 domains idempotent on 2nd run; capture stdout for CHANGELOG smoke-test section | (no files, gates merge) |

### Commit 2: `docs(spec): FINAL atomic sync — Promotion Pipeline closes Slice E`

| # | Task | Description | Files |
|---|------|-------------|-------|
| **TASK-008** | [FINAL atomic canonical spec sync — B1b LESSON #1, FULL not partial] | Update `openspec/specs/deployment-devops/spec.md` with PROMOTION_ORDER extension to 8 domains + 1 NEW gastos scenario + 1 NEW success criterion + scope corrections #C2/#C7/#C8 documented + E1b2a UPDATE callout extended + E2 deferred markers | spec file (+60L) |

### Commit 3: `chore(release): v0.5.5`

| # | Task | Description | Files |
|---|------|-------------|-------|
| **TASK-009** | [Pre-merge fix slot — B1b LESSON #3] | Cherry-pick reorder to preserve 3-commit shape if verify catches critical issue | (varies) |
| **TASK-010** | [Closing release commit — B1b LESSON #2] | Bump root `package.json` + `packages/promotion/package.json` + 16 other `packages/*/package.json` to `0.5.5` (corrects E1b1/E1b2a version drift); add `CHANGELOG.md` v0.5.5 entry (with v0.5.4 backfill) in SEPARATE commit | `package.json` + 18 packages, `CHANGELOG.md` |

**3-commit shape (B1b LESSON #2 + E1b2a pattern)**:

1. `feat(promotion): wire gastos master table (flat ledger, 5-tuple NK)` — TASK-001..TASK-007 (TDD chain RED→GREEN→REFACTOR collapses into 1 commit via squash)
2. `docs(spec): FINAL atomic sync — Promotion Pipeline closes Slice E` — TASK-008 (FULL atomic sync per B1b LESSON #1)
3. `chore(release): v0.5.5` — TASK-010 (separate per B1b LESSON #2; includes v0.5.4 CHANGELOG backfill to correct drift)

If verify catches a critical issue pre-merge → apply fix + cherry-pick reorder (B1b LESSON #3). Merge to main BEFORE `git branch -D design/athlos-promote-projection-to-master-e1b2b` (B1b LESSON #4).

---

## 8. Data Flow (Promotion Pipeline, post-E1b2b)

```
                pnpm db:promote
                      │
                      ▼
        ┌──────────────────────────────┐
        │  promoteAll(db) — sequence   │
        │  PROMOTION_ORDER (8 domains) │
        └──────────────────────────────┘
                      │
        ┌─────────────┴─────────────┐
        │  promoteDomain(gastos)      │ ←── NEW in E1b2b
        │  (6th position)             │
        └─────────────┬──────────────┘
                      │
   ┌──────────────────┼──────────────────┐
   │ 1. buildFkMap    │ (no-op for       │
   │    (O(1) per     │  gastos — no FK  │
   │     domain)      │  lookups in v1)  │
   └──────────────────┼──────────────────┘
                      │
   ┌──────────────────▼──────────────────┐
   │ 2. SELECT source_key, payload      │
   │    FROM public."tesoreria.         │
   │        gastos_projection"          │
   │    (2,114 rows, 11 fields)         │
   └──────────────────┬──────────────────┘
                      │
   ┌──────────────────▼──────────────────┐
   │ 3. loadExistingNaturalKeys(db,     │
   │    'gastos')  ← reads legacy_id   │
   │    from tesoreria.gastos           │
   │    (defense in depth #1)           │
   └──────────────────┬──────────────────┘
                      │
   ┌──────────────────▼──────────────────┐
   │ 4. For each row:                   │
   │    - naturalKey('gastos', payload) │
   │      → 5-tuple join                │
   │    - skip if existingKeys.has(key) │
   │    - transformGastos(payload)      │
   │      → NewGastos with legacy_id =  │
   │        deterministicUuid('gastos:' │
   │        + 5-tuple)                  │
   │    - buffer.push(masterRow)        │
   │    - flush every 1000 rows         │
   └──────────────────┬──────────────────┘
                      │
   ┌──────────────────▼──────────────────┐
   │ 5. db.insert(gastos)               │
   │      .values(rows)                 │
   │      .onConflictDoNothing()        │
   │      .returning({id: gastos.id})   │
   │                                   │
   │  Conflicts caught by:              │
   │  - gastos_legacy_id_unique         │ ← defense #2
   │  - gastos_5tuple_unique            │ ← defense #3
   └───────────────────────────────────┘
                      │
                      ▼
              PromotionResult{
                domain: 'gastos',
                attempted: 2114,
                inserted: 2114,
                skipped: 0,
                failed: 0,
                errors: [],
                durationMs: ~5000
              }
```

---

## 9. Top 5 risks

| # | Risk | Likelihood | Mitigation |
|---|------|-----------|------------|
| **R1** (CRITICAL) | Apply sub-agent skips `bash scripts/verify-slice.sh` (E1b1/E1b2a LESSON — v0.5.2 + v0.5.4 shipped with potentially broken state because smoke test was historically skippable). | **Critical** | TASK-007 (`bash scripts/verify-slice.sh`) is a HARD GATE in apply prompt. The verify-slice.sh script was introduced in commit `b26896c` and updated to include `tesoreria.gastos` in commit `304f37a`/`061be50`. Apply MUST run the script BEFORE declaring ready. Verify ALL expected row counts: escuela=66 + disciplinas=32 + locacion=89 + caja=8,145 + **gastos=2,114** (TOTAL = 10,446 NEW rows across all 8 domains) + ctacte=326,275 + ctacte1=~138,742. **No merge until `verify-slice.sh` exits 0 (PASS).** |
| **R2** (WARNING) | Gastos 5-tuple NK error slips through → silent 1,768-row loss (3-tuple yields only 346 distinct) | **High (if ignored)** | T20 test MUST assert 5-tuple uniqueness (NOT 3-tuple — see C2). TASK-007 `verify-slice.sh` MUST count gastos rows post-promote and assert = 2,114 (no silent drop). Documented in §4.5 + §6.5 + scope correction #C2. |
| **R3** (WARNING) | Field name mismatch in TDD cases (E1b1 LESSON — T6 SOCNUMDOCU mismatch). | Medium | Apply phase MUST use ACTUAL projection field names verified via `SELECT DISTINCT jsonb_object_keys` BEFORE writing tests. Field maps in §4.5 + §6.5 are already verified live 2026-06-25 (11 fields: GASINGBRUT, GASFECHA, GASCTAPRIN, GASCTAAUXI, GASTIPCTA, GASTIPGAST, GASCONCEPT, GASIMPORTE, GASSECUENC, GASIVA, GASCOMPROB). Test fixtures MUST use unique prefixes (`test-T19-`, `test-T20-`) per E1b1 LESSON. |
| **R4** (SUGGESTION) | Migration tracking mismatch via drizzle-kit migrate (E1b1 LESSON — committed migration not picked up by `_journal.json`) | Certain | TASK-002 apply step: `PGPASSWORD=... psql -h 192.168.1.102 -U athlos -d athlos -f packages/db/drizzle/0015_gastos.sql` (NOT `drizzle-kit migrate`). Manual `_journal.json` entry update after with idx 15. |
| **R5** (SUGGESTION) | Final atomic canonical sync has many diff lines (B1b LESSON #1 — full sync for 8 domains) | Low (planned) | Spec delta acceptance criteria MUST include `diff` assertion (additive-only). 1 NEW requirement (gastos table) + 1 NEW scenario (gastos promotion) + 1 NEW success criterion (gastos=2,114) + 1 modification to PROMOTION_ORDER scenario (8 domains instead of 7) + 1 update to E1b2a UPDATE callout (now includes E1b2b result) + 3 scope corrections documented. Diff should be ~60 LoC of spec.md. Apply phase verifies diff is additive-only — no removals, no rewrites of prior Slice E scenarios. |

### Lesser risks

- **VFP date format quirks** — `parseFechaVFP` handles YYYYMMDD string, ISO timestamp, Date, number. 2 oldest gastos rows have dates like `0414-02-02` (year 414 AD — likely sentinel/legacy artifact) and `1902-03-02` (year 1902 — also sentinel). Verified that `parseFechaVFP` parses both correctly (returns ISO `0414-02-02` and `1902-03-02`). If 414 AD is actually a sentinel for missing data, the transform will preserve it (acceptable — historical data preservation).
- **Encoding issues (Latin-1 vs UTF-8)** — promotion reads from JSONB (UTF-8). Sample showed `"S/Nº"` and `"COMP.S/Nº"` with proper UTF-8 round-trip. No issues expected.
- **Pre-existing test infrastructure failures** — T2-T5, T8-T11, T13-T18 (E1b2a), and now T19-T20 (E1b2b) are all in `describe.skip` blocks (destructive TRUNCATE bug fix). The verify-slice.sh script is the REAL gate.
- **Migration numbering** — no conflict: 0014 used by E1b2a (post-merge on disk), E1b2b uses 0015 (next sequential idx in `_journal.json`).
- **Version drift correction** — root + 16 packages have drifted (root 0.5.3, promotion 0.5.3, others 0.5.0). TASK-010 release commit MUST bump all to 0.5.5 in a single coordinated commit; verify with `grep -r '"version"' packages/*/package.json package.json` post-bump.

---

## 10. Dependencies

| Dependency | What E1b2b needs | Status |
|------------|------------------|--------|
| **E1a** (v0.5.1) | `packages/promotion/` skeleton + `promote.ts` algorithm + `transforms/{socios,ctacte,ctacte1}.ts` | ✅ shipped 2026-06-24 |
| **E1b1** (v0.5.2/v0.5.3) | Migration 0013 (cctcuenta backfill) + Migration 0014 (legacy_id UNIQUE INDEXes) + 5-tuple ctacte1 NK | ✅ shipped 2026-06-24 |
| **E1b2a** (v0.5.4) | Migration 0014_new_masters (4 NEW tables) + 4 transforms (escuela/deportes/locacion/caja) + PROMOTION_ORDER extended to 7 domains + caja 4-tuple NK + scripts/verify-slice.sh (commit `b26896c` introduced gate, `304f37a`/`061be50` added gastos to MASTER_TABLES + fixed schema.table parsing) | ✅ shipped 2026-06-25 (commit `b8d8e43`) |
| **E1b1 LESSONs** (commit `b26896c`) | Smoke test MUST run; MIN(uuid) workaround uses DISTINCT ON; TDD field names verified live; migration via psql; **`bash scripts/verify-slice.sh` is the REAL gate** | ✅ embedded in apply plan |
| **`packages/db`** (v0.5.4) | `createDb({ connectionString })`; Drizzle schemas (`socios`, `tesoreria`, `deportes`); 14 migrations applied (0014 registered) | ✅ shipped |
| **`packages/promotion`** (v0.5.4) | `promoteDomain` + `promoteAll` + `transform-helpers.ts` (all helpers work for new domain); 7-domain PROMOTION_ORDER; 7 transforms | ✅ shipped |
| **Vitest 2.1.9** | TDD harness (with `describe.skip` per E1b2a LESSON) | ✅ configured |
| **pnpm-workspace.yaml** | Already includes `packages/*` | ✅ no edit needed |

**No new external dependencies.** E1b2b adds zero npm packages. Pure TypeScript + Drizzle.

---

## 11. Open questions (all RESOLVED + LOCKED 2026-06-25)

| # | Decision | Locked value | Source |
|---|----------|--------------|--------|
| **C2** (Q7) | gastos NK | **5-tuple** `(GASTIPGAST\|GASCTAPRIN\|GASSECUENC\|GASFECHA\|GASCOMPROB)` — 2,114 distinct = 100% unique. **3-tuple = 346 distinct (1,768 dupes — WRONG)** | Parent E1b Q5 LOCKED + re-verified live 2026-06-25 |
| **C7** (Q10) | gastos ctacte FK | **NO ctacte FK in v1** (flat ledger). Verified: 0 of 165 distinct `GASCTAPRIN` match `ctacte.cctcuenta`. Deferred to N16. | Parent E1b exploration (Q5 deferral); re-verified live 2026-06-25 |
| **C8** (Q11) | gastos socio_id FK | **NO socio_id FK in v1** (no source field). `socio_id` column exists (nullable, FK constraint deferred to N16). | **NEW** discovered 2026-06-25 11:50 UTC during propose phase |
| **Q6** | Migration design | **1 combined migration per slice** (E1b2b: `0015_gastos.sql`; mirrors E1b2a's `0014_new_masters.sql` pattern). Hand-written SQL (NOT drizzle-kit generated, per E1b1 LESSON). | User-confirmed 2026-06-25 |
| **Q12** | E1b2b sync scope | **FULL atomic sync** (B1b LESSON #1) — closes Slice E spec with all 8 domains in one atomic update (NOT partial like E1b2a). **FINAL sync for Slice E.** | Locked decision for E1b2b |
| **Q-migration-numbering** | E1b2b migration filename | `0015_gastos.sql` (next sequential idx after E1b2a's 0014 in `_journal.json`) | Verified post-E1b2a: `_journal.json` ends at idx 14 |
| **Q-verify-slice-update** | Does apply phase need to update `scripts/verify-slice.sh`? | **NO** — already updated in commit `304f37a` (merged as `061be50` on main) to include `tesoreria.gastos` in `MASTER_TABLES` array (line 34). The same commit also fixed the `count_rows` helper's `schema.table` identifier parsing. | Originally NEW in spec phase; RESOLVED post-merge of commit `061be50`. The apply phase does NOT touch this script. |

**All open questions resolved.** Scope is fully bounded.

---

## 12. Ready for tasks?

**YES.** The scope is precisely bounded:

- 1 NEW master table (`tesoreria.gastos`) + 1 NEW transform + 1 combined migration (`0015_gastos.sql`, idx 15) + 2 NEW vitest cases (T19-T20 in `describe.skip`) + **FULL atomic canonical sync** (closes Slice E spec) + v0.5.4 → v0.5.5 PATCH release
- **~280 raw LoC / ~140 effective** (under the 400-line review budget at raw count: ~70%, well under at effective: ~35%)
- All field mappings verified live against `192.168.1.102:5432/athlos` 2026-06-25 (11 fields: `GASINGBRUT`, `GASFECHA`, `GASCTAPRIN`, `GASCTAAUXI`, `GASTIPCTA`, `GASTIPGAST`, `GASCONCEPT`, `GASIMPORTE`, `GASSECUENC`, `GASIVA`, `GASCOMPROB`)
- All 3 scope corrections live-verified (5-tuple NK 100% unique via `SELECT count(DISTINCT ...)` = 2,114; 0 source rows have socio FK fields; 0 source rows have ctacte FK field)
- E1b1 / E1b2a LESSONs embedded in apply plan: **`bash scripts/verify-slice.sh` is the REAL gate** (per commit `b26896c`, already includes gastos per `304f37a`); migration via `psql` (NOT drizzle-kit); T19-T20 added to `describe.skip` blocks (destructive TRUNCATE bug fix)
- B1b LESSONs embedded: **FULL atomic sync** (not partial like E1b2a — closes Slice E); separate release commit; cherry-pick reorder; merge-then-delete; `SELECT DISTINCT ON` in fk-lookup (already correct from E1b1; `gastos` doesn't need it in v1)

**Next step:** sdd-tasks → break into 10 work-units (TASK-001..TASK-010 per §7). Then sdd-apply → wire gastos with strict TDD discipline + **`bash scripts/verify-slice.sh`** (E1b1/E1b2a LESSON — non-negotiable per commit `b26896c`). Then sdd-archive → sync this spec delta into `openspec/specs/deployment-devops/spec.md` to close Slice E.

**Apply-phase CRITICAL reminders (all in §6 + §7 + §9):**

1. **`bash scripts/verify-slice.sh` is the REAL pre-merge gate** — NOT the unit tests (which are `describe.skip` per E1b2a LESSON re: TRUNCATE bug fix). The script already includes `tesoreria.gastos` in `MASTER_TABLES` (line 34, commit `304f37a`).
2. **Migration via `psql`** (NOT `drizzle-kit migrate`) — E1b1 LESSON re: `_journal.json` tracking mismatch.
3. **5-tuple NK verification** at apply time: `SELECT count(DISTINCT legacy_id) FROM tesoreria.gastos` MUST equal 2,114 (NOT 346 — proves 5-tuple NK is correct).
4. **3-commit shape preserved** per B1b LESSON: `feat` → `docs(spec)` → `chore(release)`. No `Co-Authored-By` in any commit. Merge to `main` BEFORE `git branch -D design/athlos-promote-projection-to-master-e1b2b` (B1b LESSON #4).
5. **Version drift correction**: TASK-010 release commit MUST bump root (0.5.3) + `packages/promotion` (0.5.3) + 16 other packages (0.5.0) ALL to `0.5.5` in a single coordinated commit. Also backfill `[0.5.4]` entry in `CHANGELOG.md` (gap from E1b2a release commit).
6. **Live DB queries already verified** (see §1, §4.5, scope corrections) — apply phase should re-run them as part of TASK-002 to confirm state hasn't drifted.

---

*Persisted to:*
- *`openspec/changes/athlos-promote-projection-to-master-e1b2b/design.md`* (this file)
- *Engram topic `sdd/athlos-promote-projection-to-master-e1b2b/design` (via `mem_save`)*