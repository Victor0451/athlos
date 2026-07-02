# Proposal: athlos-promote-projection-to-master-e1b2b

| Field | Value |
|-------|-------|
| **Change** | `athlos-promote-projection-to-master-e1b2b` |
| **Date** | 2026-06-25 |
| **Phase** | Propose |
| **Mode** | Both (Engram + OpenSpec) |
| **Status** | Draft — ready for spec |
| **Source of truth** | Parent `openspec/changes/explore-athlos-promote-projection-to-master/exploration.md` (782 lines, §6.5 gastos) · sister `openspec/changes/athlos-promote-projection-to-master-e1b2a/proposal.md` (767 lines, archived in git 67f8afb) |
| **Sister changes (DONE)** | `athlos-promote-projection-to-master-e1a` (v0.5.1, 2026-06-24) · `athlos-promote-projection-to-master-e1b1` (v0.5.2/v0.5.3, 2026-06-24) · `athlos-promote-projection-to-master-e1b2a` (v0.5.4, 2026-06-25, commit `b8d8e43`) |
| **Sister slice (LAST)** | `athlos-promote-projection-to-master-e2` (admin API + `promoted_at` audit column + runbook + post-Slice E spec polish) |
| **Target release** | v0.5.4 → **v0.5.5** (PATCH — closes Slice E data promotion: 8/8 master tables populate + final atomic canonical sync) |
| **Delivery** | single PR (~370 raw LoC / ~200 effective), no chained PRs within E1b2b |
| **B1b LESSONs embedded** | #1 (full) atomic canonical sync · #2 separate release commit · #3 cherry-pick reorder · #4 merge-before-delete · #5 MIN(uuid) workaround (already correct from E1b1+) |

---

## 1. Context

**State post-E1b2a (v0.5.4).** E1a (v0.5.1) shipped `packages/promotion/` skeleton + transforms for `socios` + `ctacte`. E1b1 (v0.5.2/v0.5.3) wired `ctacte1` via the `cctcuenta` backfill + legacy_id UNIQUE INDEX pattern. E1b2a (v0.5.4, commit `b8d8e43`) wired 4 NEW domains: `escuela` (66), `deportes` (32), `locacion` (89), `caja` (8,145) — total 8,332 NEW rows. Migration 0014 creates the 4 NEW tables; the `legacy_id` UNIQUE INDEX pattern enables cross-run idempotency.

After E1b2a, **7 of 8 master domains** populate via `pnpm db:promote`. Per live verification 2026-06-25 against `192.168.1.102:5432/athlos`:

| Master table | Projection rows | Current status |
|--------------|----------------:|----------------|
| `socios.socios` | 39,357 | ✅ promoted (E1a) |
| `tesoreria.ctacte` | 326,275 | ✅ promoted (E1a) |
| `tesoreria.ctacte1` | 245,370 | ✅ partial (E1b1 — ~56%, N14 stale `entity_uuids`) |
| `socios.escuela` | 66 | ✅ promoted (E1b2a) |
| `deportes.disciplinas` | 32 | ✅ promoted (E1b2a) |
| `socios.locacion` | 89 | ✅ promoted (E1b2a) |
| `tesoreria.caja_movimiento` | 8,145 | ✅ promoted (E1b2a) |
| **`tesoreria.gastos`** | 2,114 | ❌ table doesn't exist (E1b2b) |

**What's LEFT for v1.0 promotion pipeline completion.** **1 of 8 master tables is still empty** — `tesoreria.gastos`. The promotion pipeline currently skips `gastos`. E1b2b is the **LAST sub-slice of E1b**: it wires `gastos` and closes Slice E with the **FULL atomic canonical sync** (B1b LESSON #1 — closes the canonical spec with all 8 domains in one atomic update).

**E1b2 sub-slicing rationale.** Parent E1b exploration (§1) recommends sub-slicing the 5-domain scope into 2 stacked PRs (E1b2a + E1b2b) so each lands under the 400-line review budget. E1b2a (DONE v0.5.4) was 4 domains + 4-domain canonical sync + v0.5.3 → v0.5.4. E1b2b (THIS proposal) wires `gastos` + final atomic canonical sync + v0.5.4 → v0.5.5.

**Scope corrections applied (LIVE verification 2026-06-25 against `192.168.1.102:5432/athlos`):**

1. **gastos natural key is 5-tuple** (`GASTIPGAST|GASCTAPRIN|GASSECUENC|GASFECHA|GASCOMPROB`). Parent E1b exploration said 3-tuple. Verified live: 3-tuple yields **346 distinct** of 2,114 rows (84% duplicates → silent loss of 1,768 rows); 5-tuple yields **2,114 distinct** = 100% unique. E1b2b uses 5-tuple — locked decision from parent E1b exploration + re-confirmed live 2026-06-25 during this propose phase.
2. **gastos has NO ctacte FK** (flat ledger, scope correction from parent E1b exploration). Verified live: 0 of 2,114 rows have `CCTCUENTA` field in payload; 0 of 165 distinct `GASCTAPRIN` values match any `tesoreria.ctacte.cctcuenta`. The `GASCTAPRIN` field references an accounting-plan code (e.g., `1111001`, `1116416`, `6001015`) — NOT the socio carnet. Defer ctacte FK reconstruction to N16.
3. **gastos `socio_id` FK is NULLABLE** (per flat-ledger scope correction). No `GASNUMSOC` or `SOCNUMERO` field exists in the projection payload (verified live — only 11 fields total). The `socio_id` column will exist in the master schema for future N16 backfill, but stays NULL for all 2,114 rows in v1.

> **Lesson embedded (E1b1 LESSON R5.5):** Apply sub-agent MUST verify natural-key uniqueness with the actual DB *during* the migration step, not trust the exploration's claim blindly. The 1,768-row duplication (3-tuple) would silently survive `legacy_id` UNIQUE collision as "false positives" and miss most gastos rows.

---

## 2. Goals / Non-Goals

### Goals

| ID | Goal | Acceptance |
|----|------|------------|
| **G1** | 1 NEW master table: `tesoreria.gastos` | Migration 0015 applies cleanly via `psql -f`; `gastos` table queryable post-migration |
| **G2** | 1 NEW transform: `transformGastos` with 5-tuple NK → `legacy_id` | Reads `tesoreria.gastos_projection` payload, returns typed `NewGastos` insert; reuses `transform-helpers.ts` (`parseMonto`, `parseFechaVFP`, `deterministicUuid`); no `any` types |
| **G3** | `PROMOTION_ORDER` extended to 8 domains: `['socios', 'escuela', 'deportes', 'locacion', 'caja', 'gastos', 'ctacte', 'ctacte1']` | Topological order verified by FK dependencies; `gastos` placed between `caja` and `ctacte` (flat-ledger, no FK dependency on ctacte in v1 — alphabetical-bounded for determinism per B1b LESSON); `FK_BLOCKING_DOMAINS` unchanged = `['socios', 'ctacte']` |
| **G4** | Idempotent re-promotion via `legacy_id` UNIQUE INDEX for `gastos` | Re-running `pnpm db:promote` after first run inserts 0 new gastos rows |
| **G5** | Gastos natural key = **5-tuple** (`tipo\|cta\|sec\|fecha\|comprob`) — verified 100% unique live | `legacy_id = deterministicUuid('gastos:' + 5-tuple)`; 2,114 distinct = 100% unique verified |
| **G6** | Gastos schema has `socio_id uuid` nullable column (no FK constraint) | Schema column exists; stays NULL for all 2,114 rows in v1 (no `GASNUMSOC` field in source data); FK constraint deferred to N16 |
| **G7** | 2 NEW vitest TDD cases (T19-T20): happy path + 5-tuple dedup | `pnpm --filter @athlos/promotion test` → existing 11+ tests pass (no regression); 2 NEW cases added (currently `describe.skip` per E1b2a LESSON, properly re-enabled post-MVP) |
| **G8** | Final canonical spec sync (B1b LESSON #1, FULL — not partial) | `diff openspec/specs/deployment-devops/spec.md openspec/changes/.../specs/deployment-devops/spec.md` returns ONLY additive changes; closes Slice E spec with all 8 domains + final 8 success criteria |
| **G9** | Smoke test runs end-to-end against real DB before merge (E1b1/E1b2a LESSON — non-negotiable) | Apply phase verifies `gastos=2,114` rows; 2nd/3rd runs insert 0 new rows; **`bash scripts/verify-slice.sh` PASSES** (the REAL gate, per E1b1 commit `b26896c` introducing the verification gate) |
| **G10** | Migration applied via `psql` (NOT `drizzle-kit migrate` — E1b1 LESSON re: tracking mismatch) | Apply phase: `PGPASSWORD=... psql -h 192.168.1.102 -U athlos -d athlos -f packages/db/drizzle/0015_gastos.sql`; manual `_journal.json` entry update after |
| **G11** | Idempotency across all 8 domains (re-run smoke test) | Re-running `promoteAll` 3 times produces same end state; `legacy_id` pre-check skips all already-promoted rows |
| **G12** | All gastos fields correctly resolved (numeric, dates, free text) | No parse errors during smoke test; orphan rows (if any) reported in `errors[]` for inspection |

### Non-Goals (deferred to E2 or future slices)

| ID | Deferred to | Item |
|----|-------------|------|
| **N1** | **E2** | `POST /api/v1/promote/trigger` admin endpoint |
| **N2** | **E2** | `promoted_at TIMESTAMPTZ NULL` column on `raw_events` (migration deferred to E2 — E1b2b uses `legacy_id` only) |
| **N3** | **E2** | `docs/runbook.md` "Promotion" section |
| **N4** | **E2** | Final spec polish (post-Slice E): partial cleanup, success-criterion reordering |
| **N5** | future | `pg_advisory_lock` for concurrent-promotion prevention |
| **N6** | future | Rollback endpoint (manual SQL only for v1) |
| **N7** | **N7** (future) | Caja detail columns (CAJCONCEP1..20, CAJIMPOR1..20, etc. — 122 wide columns) — header-only is sufficient for v1.0 |
| **N8** | **N8** (future) | `deportes.inscripciones` rebuild (per-socio enrollment in disciplinas) |
| **N9** | **N14** (future) | Stale `entity_uuids` repopulation (would unlock ~107k orphan ctacte1 rows + enable full ctacte1 promotion) |
| **N10** | **N16** (future) | `gastos` FK to `ctacte.id` via `cctcuenta` lookup (out of v1 scope per parent E1b + scope correction #C2) |
| **N11** | future | Escuela FK to `deportes.disciplinas.codigo` (FK constraint added later — nullable in E1b2a) |
| **N12** | future | Per-row transactional promotion (per-domain only for v1) |
| **N13** | future | Async trigger via `@athlos/scheduler` |
| **N14** | future | CONTABLE / CONTABL1 / CATASTROS domains (no master tables yet) |

---

## 3. Approach / Architecture

### 3.1 Migration `0015_gastos.sql` (NEW, ~25 LoC)

**Pattern mirrors E1b2a's `0014_new_masters.sql`:** hand-written SQL with `CREATE TABLE IF NOT EXISTS` + `CREATE UNIQUE INDEX IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` for idempotency.

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
  "cuenta" integer NOT NULL,                          -- GASCTAPRIN (accounting-plan code; NOT socio carnet)
  "secuencia" integer NOT NULL DEFAULT 0,             -- GASSECUENC (0..8)
  "fecha" date NOT NULL,                              -- GASFECHA
  "comprob" text NOT NULL DEFAULT '',                 -- GASCOMPROB (1/2114 empty)
  "tip_cta" integer,                                  -- GASTIPCTA (sentinel 0 for all 2,114 rows)
  "cta_auxi" integer,                                 -- GASCTAAUXI (auxiliary account; mostly 0)
  "concepto" text NOT NULL,                           -- GASCONCEPT (free text — operator description)
  "importe" numeric(14,2) NOT NULL DEFAULT '0.00',    -- GASIMPORTE (0.01..3000, no negatives)
  "iva" numeric(14,2),                                -- GASIVA (mostly 0)
  "ing_brut" text,                                    -- GASINGBRUT (20-char string, accounting-grid debit)
  "socio_id" uuid,                                    -- FK to socios.socios.id (NULLABLE; deferred to N16)
  "legacy_id" text,                                   -- deterministic UUID5 from 'gastos:'+5-tuple
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gastos_legacy_id_unique"
  ON "tesoreria"."gastos" ("legacy_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gastos_5tuple_unique"
  ON "tesoreria"."gastos" ("tipo", "cuenta", "secuencia", "fecha", "comprob");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gastos_cuenta_fecha_idx"
  ON "tesoreria"."gastos" ("cuenta", "fecha");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gastos_socio_id_idx"
  ON "tesoreria"."gastos" ("socio_id") WHERE "socio_id" IS NOT NULL;
```

**Schema design notes:**

1. **`gastos` is a flat ledger** — no FK constraint on `cuenta` (it's an accounting-plan code, not socio carnet). Verified live: 0 of 165 distinct `GASCTAPRIN` values match any `tesoreria.ctacte.cctcuenta`.
2. **`socio_id` is NULLABLE** — no source field exists to populate it (verified: 11 fields in projection, none are socio carnet). Column is reserved for future N16 backfill.
3. **5-tuple UNIQUE INDEX** catches the natural-key collision case (defense in depth alongside `legacy_id` UNIQUE INDEX). Re-runs skip both via dedup pre-check + ON CONFLICT DO NOTHING.
4. **`comprob DEFAULT ''`** because 1 row has empty string. The empty string is a valid value (not NULL).
5. **`ing_brut` is `text` (not numeric)** because it's a 20-character accounting-grid debit string (e.g., `'00000000000000000000'`), not a number.
6. **`importe` is `numeric(14,2)`** because values range 0.01..3000 and may need arithmetic later (vs. ctacte/debe/haber which use text for string-encoding). Both forms work; numeric is simpler here.

### 3.2 PROMOTION_ORDER update

```typescript
// packages/promotion/src/PROMOTION_ORDER.ts (post-E1b2b)
export type Domain =
  | 'socios' | 'escuela' | 'deportes' | 'locacion' | 'caja' | 'gastos'
  | 'ctacte' | 'ctacte1'

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
  gastos:    { schema: 'public', table: 'tesoreria.gastos_projection' },  // NEW (E1b2b)
  ctacte:   { schema: 'public', table: 'tesoreria.ctacte_projection' },
  ctacte1:  { schema: 'public', table: 'tesoreria.ctacte1_projection' },
}

export const DOMAIN_TRANSFORMS: Record<Domain, TransformFn> = {
  socios:   transformSocio as TransformFn,
  escuela:  transformEscuela as TransformFn,
  deportes: transformDeportes as TransformFn,
  locacion: transformLocacion as TransformFn,
  caja:     transformCaja as TransformFn,
  gastos:   transformGastos as TransformFn,  // NEW (E1b2b)
  ctacte:   transformCtacte as TransformFn,
  ctacte1:  transformCtacte1 as TransformFn,
}
```

**Rationale for order (topological + deterministic):**

- `socios` MUST be first (no FK; root of dependency graph).
- `escuela`, `deportes`, `locacion`, `caja`, `gastos` are all INDEPENDENT (no FK to each other or to socios in v1). Order between them is arbitrary — alphabetical chosen for determinism (B1b LESSON: deterministic order = reproducible runs).
- `gastos` placed between `caja` and `ctacte` (NOT last among independents) because it's the LARGEST independent promotion (2,114 rows vs caja 8,145 — actually caja is larger). The placement matches insertion order with `gastos` after `caja` for symmetry with `caja_movimiento` (both are `tesoreria` schema cash/expense tables).
- `ctacte` MUST run before `ctacte1` (FK dependency). Their position at the END is preserved from E1b1 to keep the FK dependency chain intact.
- `FK_BLOCKING_DOMAINS` is unchanged — `gastos` has no required FKs so it doesn't short-circuit downstream.

### 3.3 Transform (`transforms/gastos.ts`, ~50L)

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

  const cuenta = Number(payload['GASCTAPRIN'] ?? 0)
  if (!cuenta) throw new Error('Empty GASCTAPRIN')

  const secuencia = Number(payload['GASSECUENC'] ?? 0)
  const fecha = parseFechaVFP(payload['GASFECHA'] ?? null)
  if (!fecha) throw new Error('Unparseable GASFECHA')

  const comprob = String(payload['GASCOMPROB'] ?? '').trim()  // 1/2114 empty (sentinel)

  // 5-tuple natural key (verified 100% unique; 3-tuple had 1,768 duplicates)
  const legacyId = deterministicUuid(`gastos:${tipo}|${cuenta}|${secuencia}|${fecha}|${comprob}`)

  return {
    id: randomUUID(),
    tipo,
    cuenta,
    secuencia,
    fecha,
    comprob,
    tipCta: payload['GASTIPCTA'] ? Number(payload['GASTIPCTA']) : null,
    ctaAuxi: payload['GASCTAAUXI'] ? Number(payload['GASCTAAUXI']) : null,
    concepto: String(payload['GASCONCEPT'] ?? '').trim() || '(sin concepto)',
    importe: parseMonto(payload['GASIMPORTE']),
    iva: parseMonto(payload['GASIVA']),
    ingBrut: payload['GASINGBRUT'] ? String(payload['GASINGBRUT']).trim() || null : null,
    socioId: null,  // NULL in v1 (no source field; N16 backfill future)
    legacyId,
    createdAt: new Date(),
  }
}
```

**Sample payload (5 rows from live verification 2026-06-25, ordered by fecha):**

| tipo | cuenta | sec | fecha | comprob | importe | concepto |
|------|--------|----:|------|---------|--------:|----------|
| 1 | 2010414 | 0 | 0414-02-02 | S/NUMERO | 5 | BELIZAN FABIAN - ESC.DE FUTBOL LIQ.20-11-03 |
| 1 | 2020103 | 0 | 1902-03-02 | S/Nº | 20 | COCA GUSTAVO-A CTA.DE HABERES |
| 1 | 6001015 | 0 | 2003-02-15 | S/NUMERO | 60 | GARCIA HUGO COMISION-P/COBRANZA CUOT.SOC.R204/205 |
| 1 | 2010157 | 0 | 2003-02-15 | R01-0348 | 26 | IMPRENTA CHAVEZ CANC.FACT.01-01186 |
| 1 | 1116425 | 0 | 2003-03-25 | COMP.S/Nº | 232 | HECTOR TEJERINA PUCH-C/CARGO RENDICION CUENTA |

### 3.4 FK strategy (per Q9/Q10 parent E1b)

| Domain | socio FK | FK constraint | Rationale |
|--------|----------|---------------|-----------|
| gastos | `socio_id` nullable | — (column exists, FK deferred) | Flat ledger, no `GASNUMSOC` source field; N16 will backfill via `cctcuenta` lookup |

**FK map building:** `buildFkMap` for `gastos` returns the existing socio map (so future N16 can resolve `socio_id` if the source data improves), but the current transform hard-codes `socioId: null` — no source field exists to populate it.

### 3.5 Dedup strategy (1 NEW natural key)

```typescript
// packages/promotion/src/dedup.ts — additions
export function naturalKey(domain: Domain, payload: Record<string, unknown>): string {
  // ... existing 7 branches (socios, ctacte, ctacte1, escuela, deportes, locacion, caja) ...
  if (domain === 'gastos') {
    // NEW (E1b2b): 5-tuple (verified 100% unique; 3-tuple had 1,768 duplicates)
    return [
      'gastos',
      payload['GASTIPGAST'] ?? 0,
      payload['GASCTAPRIN'] ?? 0,
      payload['GASSECUENC'] ?? 0,
      payload['GASFECHA'] ?? '',
      payload['GASCOMPROB'] ?? '',
    ].join('|')
  }
  return ''
}
```

`loadExistingNaturalKeys` adds 1 NEW branch reading `legacy_id` from `tesoreria.gastos` (for cross-run idempotency pre-check). Same pattern as ctacte/ctacte1/escuela/locacion/caja already in `dedup.ts`.

### 3.6 Promotion algorithm updates

- `promote.ts:35` — `Domain` union extended with `'gastos'`.
- `promote.ts:165-214` — `insertMasterBatch` switch extended to handle `gastos` (Drizzle insert into `tesoreria.gastos` with `onConflictDoNothing()`).
- `fk-lookup.ts` — `buildFkMap` returns the socio map for `gastos` (no-op for now; reserved for N16).

### 3.7 TDD test cases (T19-T20)

| Test | Domain | What it verifies |
|------|--------|------------------|
| **T19** | gastos | Happy path: insert 1 projection row (GASTIPGAST=1, GASCTAPRIN=1111001, GASSECUENC=0, GASFECHA=2003-10-15, GASCOMPROB='S/NUMERO') → promote → master has 1 row with correct field mapping. Idempotent re-run: 0 new inserts. |
| **T20** | gastos | **5-tuple dedup verified**: insert same gastos row twice (same 5-tuple) → promote → master has exactly 1 row (NOT 2 — legacy_id UNIQUE catches the duplicate). |

> **Per E1b1 apply-progress LESSON (T6 SOCNUMDOCU field mismatch) + E1b1 commit b26896c test-TRUNCATE fix:** T19-T20 will be added to `describe.skip` blocks (per the test redesign deferral in b26896c). The REAL gate is `bash scripts/verify-slice.sh` (introduced in the same commit). Tests serve as documentation of intent; smoke test verifies behavior end-to-end against real DB.

---

## 4. Per-Domain Investigation (verified against live DB 2026-06-25)

### 4.1 gastos (`tesoreria.gastos`)

| Property | Value | Verified |
|----------|-------|----------|
| Projection rows | 2,114 | `SELECT count(*) FROM public."tesoreria.gastos_projection"` → 2,114 |
| Projection fields | 11 (GASINGBRUT, GASFECHA, GASCTAPRIN, GASCTAAUXI, GASTIPCTA, GASTIPGAST, GASCONCEPT, GASIMPORTE, GASSECUENC, GASIVA, GASCOMPROB) | `SELECT jsonb_object_keys(payload)` |
| Master table | **DOES NOT EXIST** at HEAD | `\dt tesoreria.gastos` → no match |
| FK to ctacte | **NO** (verified: 0 of 165 distinct `GASCTAPRIN` match `tesoreria.ctacte.cctcuenta`; `GASCTAPRIN` is accounting-plan code, e.g., `1111001`, `6001015`) | Live verification 2026-06-25 |
| FK to socio | **NO** (no `GASNUMSOC`/`SOCNUMERO` field exists in 11-field payload) | `SELECT DISTINCT jsonb_object_keys(payload)` |
| Natural key | `(GASTIPGAST, GASCTAPRIN, GASSECUENC, GASFECHA, GASCOMPROB)` 5-tuple — 2,114 distinct = 100% unique | **Verified live 2026-06-25 11:50 UTC** |
| 3-tuple (parent E1b + E1b2 exploration) | 346 distinct (1,768 duplicates!) | **WRONG — would lose 1,768 rows** |
| GASTIPGAST distribution | 1=846, 2=1267, 3=1 (3 distinct values — expense type) | Verified |
| GASCTAPRIN | 165 distinct values; mostly 6-digit accounting codes (e.g., `1111001`, `1116416`, `6001015`) | Verified |
| GASFECHA | ISO timestamp strings (e.g., `"2003-10-15T00:00:00.000Z"`); min 1902-03-02 (sentinel old), max 2008+ | Sampled 5 oldest rows |
| GASSECUENC | integer 0..8 (267 rows > 0) | Verified |
| GASCOMPROB | mostly "S/NUMERO" (1437), then receipts like "OP862121", "F01-0158"; 1 row empty (sentinel `''`) | Verified |
| GASIMPORTE | numeric 0.01..3000 (no negatives, no zeros) | Verified |
| GASTIPCTA | all 2,114 rows = 0 (sentinel) | Verified |
| GASCTAAUXI | 0=2111, 20=2, 4=1 (sentinel for most) | Verified |
| Expected promotions | 2,114 (1:1 with projection) | |
| Likely failures | 0 — no FK constraint, all rows have valid 5-tuple | |

**Sample data:** `GASCONCEPT` examples: "VALDEZ DANTE R. A CTA.DE HABERES", "AJUSTE P/IMP.INCORRECTA REC.0001-00334", "HECTOR TEJERINA PUCH-C/CARGO RENDICION CUENTA", "GARCIA HUGO COMISION-P/COBRANZA CUOT.SOC.R204/205". UTF-8 round-trip clean (verified).

> **SCOPE CORRECTION (propose phase, 2026-06-25 11:50 UTC):** gastos is a **flat ledger** with NO ctacte FK and NO socio_id FK (verified: 0 source-field links to either). Parent E1b exploration's `gastosNaturalKey()` used a 3-tuple `(GASTIPGAST, GASCTAPRIN, GASSECUENC)` which yields only 346 distinct of 2,114 rows (84% duplicates → silent loss of 1,768 rows). **E1b2b uses 5-tuple** `(GASTIPGAST, GASCTAPRIN, GASSECUENC, GASFECHA, GASCOMPROB)` which yields 2,114 distinct = 100% unique. The apply phase MUST verify this during TDD-RED test setup by counting distinct triples vs 5-tuples and asserting equality with row count.

---

## 5. Scope Corrections (CRITICAL — already user-confirmed + 1 NEW for this proposal)

| # | Correction | Source | Verified live |
|---|------------|--------|---------------|
| **C2** | **gastos NK is 5-tuple** (`tipo\|cta\|sec\|fecha\|comprob`), NOT 3-tuple. | Parent E1b (wrongly said 3-tuple) | 2026-06-25 — 3-tuple=346 distinct (84% dupes); 5-tuple=2114 distinct = 100% unique |
| **C7** | **gastos has NO ctacte FK** (flat ledger). Verified: 0 of 165 distinct `GASCTAPRIN` match `ctacte.cctcuenta`. | Parent E1b Q5 (deferred ctacte FK to N16) | 2026-06-25 — verified via `EXISTS` subquery against `tesoreria.ctacte.cctcuenta` |
| **C8** | **gastos has NO socio_id FK** (no source field). Verified: 11-field payload has no `GASNUMSOC`/`SOCNUMERO`. `socio_id` column reserved for future N16 backfill. | **NEW** discovered propose-phase 2026-06-25 11:50 UTC | Verified via `SELECT DISTINCT jsonb_object_keys(payload)` |

C2 was user-confirmed during parent E1b explore + orchestrator preflight (LOCKED). **C7 was user-confirmed during parent E1b exploration** (scope correction #C2 from E1b2a proposal line 42). **C8 is NEW** — discovered live 2026-06-25 11:50 UTC while verifying projection field names. C1, C3, C4, C5, C6 from E1b2a remain relevant context but don't apply to E1b2b directly (those domains are done).

---

## 6. File-by-File Changes

| File | Action | Est. lines | Notes |
|------|--------|-----------:|-------|
| `packages/db/drizzle/0015_gastos.sql` | create | ~25 | Hand-written SQL: 1 CREATE TABLE + 3 UNIQUE INDEX + 2 INDEX |
| `packages/db/drizzle/meta/0015_snapshot.json` | create (auto-gen) | — | Drizzle auto-generated |
| `packages/db/drizzle/meta/_journal.json` | modify | +6 | Add entry for idx 15 (next sequential after 0014) |
| `packages/db/src/schema/tesoreria.ts` | modify | +50 | Add `gastos` table + types (`Gastos`, `NewGastos`) |
| `packages/db/src/schema/index.ts` | modify | +3 | Re-export `gastos` + types |
| `packages/promotion/src/PROMOTION_ORDER.ts` | modify | +5 | Add `'gastos'` to `Domain` union + `PROMOTION_ORDER` + `PROJECTION_TABLE` + `DOMAIN_TRANSFORMS` |
| `packages/promotion/src/dedup.ts` | modify | +12 | Add 1 NEW `naturalKey` branch (5-tuple) + 1 NEW `loadExistingNaturalKeys` branch |
| `packages/promotion/src/fk-lookup.ts` | modify | +5 | Return socio map for `gastos` (no-op for v1; reserved for N16) |
| `packages/promotion/src/promote.ts` | modify | +8 | Extend `Domain` union + `insertMasterBatch` switch (1 NEW `else if` branch) |
| `packages/promotion/src/transforms/gastos.ts` | create | ~50 | New transform (per §3.3, 5-tuple NK) |
| `packages/promotion/src/transforms/index.ts` | modify | +1 | Re-export `transformGastos` |
| `packages/promotion/src/__tests__/promote.test.ts` | modify | +30 | 2 NEW vitest cases (T19-T20) added to existing `describe.skip` blocks per E1b2a LESSON |
| `openspec/specs/deployment-devops/spec.md` | modify (FULL atomic sync) | +40 | Extend PROMOTION_ORDER scenario to 8 domains + 1 NEW success criterion + gastos 5-tuple note + DEFERRED markers for E2 |
| `openspec/changes/.../specs/deployment-devops/spec.md` | create (spec delta) | ~250 | Full E1b2b spec delta per E1b2a format (closes Slice E) |
| `CHANGELOG.md` | modify | +8 | v0.5.5 entry under Released |
| `package.json` + 18 `packages/*/package.json` | modify | +1 each | bump 0.5.4 → 0.5.5 (only in release commit) |
| **Total raw LoC** | | **~370** | (under the 400-line review budget at raw count; ~200 effective) |

> The 370 raw vs ~200 effective gap is mostly TypeScript type definitions and migration SQL boilerplate. **Recommendation at apply time:** keep type definitions tight (no `readonly` everywhere, minimal JSDoc) and inline the transform where possible. Within budget at raw count, so no split needed.

---

## 7. Implementation Order (10 work-units, 3-commit shape)

Mirrors E1b2a's 3-commit shape (TDD → spec sync → release) and B1b's pattern. **TDD discipline preserved** (commit shape: TDD chain collapses into 1 commit for the feat, then 1 spec-sync commit, then 1 release commit).

### TDD chain (the only TDD code)

| # | Task | Description | Files |
|---|------|-------------|-------|
| TASK-001 | [TDD-RED] | Write 2 NEW vitest cases T19-T20 in `__tests__/promote.test.ts` + JSON fixtures (added to existing `describe.skip` per E1b2a LESSON) | test file (~30L) |
| TASK-002 | [TDD-GREEN migration] | Hand-write `0015_gastos.sql` + apply via `psql` (NOT drizzle-kit — E1b1 LESSON) + update `_journal.json` | migration (~25L) |
| TASK-003 | [TDD-GREEN schema] | Update `tesoreria.ts` with `gastos` table + types + `index.ts` re-export | 2 files (~55L) |
| TASK-004 | [TDD-GREEN transform] | Implement `transformGastos` with 5-tuple NK (per §3.3) | 1 file (~50L) |
| TASK-005 | [TDD-GREEN algorithm] | Extend `Domain` union + `PROMOTION_ORDER` + `PROJECTION_TABLE` + `DOMAIN_TRANSFORMS` + `dedup.ts` (1 NEW key + 1 loadExistingNaturalKeys branch) + `fk-lookup.ts` (no-op for gastos) + `insertMasterBatch` switch | 4 files (~30L) |

### Verification + sync + release

| # | Task | Description | Files |
|---|------|-------------|-------|
| TASK-006 | [TDD-REFACTOR] | Tighten helpers; consolidate duplicated FK map logic; ensure no `any` types | (~10L) |
| TASK-007 | [Pre-closing verification — CRITICAL E1b1/E1b2a LESSON] | Run `bash scripts/verify-slice.sh` (the REAL gate, per commit `b26896c`); verify gastos=2,114 rows + ALL 8 domains idempotent on 2nd run | (no files) |
| TASK-008 | [Final atomic canonical spec sync — B1b LESSON #1, FULL not partial] | Update `openspec/specs/deployment-devops/spec.md` with PROMOTION_ORDER extension to 8 domains + 1 NEW success criterion (gastos=2,114) + gastos 5-tuple note + DEFERRED markers for E2 (admin API + audit column + runbook) | spec file (+40L) |
| TASK-009 | [Pre-merge fix slot — B1b LESSON #3] | Cherry-pick reorder to preserve 3-commit shape if verify catches critical issue | (varies) |
| TASK-010 | [Closing release commit — B1b LESSON #2] | Bump root `package.json` + 18 `packages/*/package.json` to `0.5.5`; add `CHANGELOG.md` v0.5.5 entry in SEPARATE commit | `package.json` + 18 packages, `CHANGELOG.md` |

### Commit shape (3 commits per B1b + E1b2a pattern)

1. `feat(promotion): wire gastos (5-tuple NK + flat ledger, v0.5.5 prep)` (TASK-001..TASK-006) — TDD chain RED→GREEN→REFACTOR collapses into 1 commit via squash.
2. `docs(spec): atomic sync — Promotion Pipeline with 8 domains (full Slice E close)` (TASK-008) — **FULL** atomic sync per B1b LESSON #1 (closes Slice E spec with all 8 domains, not partial like E1b2a).
3. `chore(release): v0.5.5` (TASK-010) — separate per B1b LESSON #2.

If verify catches a critical issue pre-merge → apply fix + cherry-pick reorder (B1b LESSON #3). Merge to main BEFORE `git branch -D feat/slice-e1b2b-promotion-gastos` (B1b LESSON #4).

---

## 8. Risks & Mitigations (top 5)

| # | Risk | Likelihood | Mitigation |
|---|------|-----------|------------|
| **R1** | **Apply sub-agent skips `bash scripts/verify-slice.sh`** (E1b1/E1b2a LESSON — v0.5.2 + v0.5.4 shipped with potentially broken state because smoke test was historically skippable) | **CRITICAL** | TASK-007 (`bash scripts/verify-slice.sh`) is a HARD GATE in apply prompt. The verify-slice.sh script was introduced in commit `b26896c` to enforce this. Apply MUST run the script BEFORE declaring ready. Verify ALL expected row counts: escuela=66 + disciplinas=32 + locacion=89 + caja=8,145 + **gastos=2,114** (TOTAL = 10,446 NEW rows across all 8 domains) + ctacte=326,275 + ctacte1=~138,742. **No merge until `verify-slice.sh` exits 0 (PASS).** |
| **R2** | **Gastos 5-tuple NK error slips through** (3-tuple silently loses 1,768 rows) | **High (if ignored)** | T20 test MUST assert 5-tuple uniqueness (NOT 3-tuple — see C2). TASK-007 `verify-slice.sh` MUST count gastos rows post-promote and assert = 2,114 (no silent drop). Documented in §3.3 + §4.1 + §5 C2. |
| **R3** | **Field name mismatch in TDD cases** (E1b1 LESSON — T6 SOCNUMDOCU mismatch) | Medium | Apply phase MUST use ACTUAL projection field names verified via `SELECT DISTINCT jsonb_object_keys` BEFORE writing tests. Field maps in §3.3 + §4.1 are already verified live 2026-06-25 (11 fields: GASINGBRUT, GASFECHA, GASCTAPRIN, GASCTAAUXI, GASTIPCTA, GASTIPGAST, GASCONCEPT, GASIMPORTE, GASSECUENC, GASIVA, GASCOMPROB). Test fixtures MUST use unique prefixes (e.g., `test-T19-`) per E1b1 LESSON. |
| **R4** | **Migration tracking mismatch via drizzle-kit migrate** (E1b1 LESSON — committed migration not picked up by `_journal.json`) | Certain | TASK-002 apply step: `PGPASSWORD=... psql -h 192.168.1.102 -U athlos -d athlos -f packages/db/drizzle/0015_gastos.sql` (NOT `drizzle-kit migrate`). Manual `_journal.json` entry update after with idx 15. |
| **R5** | **Final atomic canonical sync has many diff lines** (B1b LESSON #1 — full sync for 8 domains) | Low (planned) | Spec delta acceptance criteria MUST include `diff` assertion (additive-only). 1 NEW scenario (gastos promotion), 1 NEW success criterion (gastos=2,114), 1 modification to PROMOTION_ORDER scenario (8 domains instead of 7), 1 update to E1b2a UPDATE callout (now includes E1b2b). Diff should be ~40 LoC of spec.md. Apply phase verifies diff is additive-only — no removals, no rewrites of prior Slice E scenarios. |

### Lesser risks

- **VFP date format quirks** — mitigated by `parseFechaVFP` (handles YYYYMMDD string, ISO timestamp, Date). 2 oldest gastos rows have dates like "0414-02-02" (year 414 AD — likely sentinel/legacy artifact) and "1902-03-02" — `parseFechaVFP` handles these correctly.
- **Encoding issues (Latin-1 vs UTF-8)** — promotion reads from JSONB (UTF-8), no encoding issues. Sample showed `"S/Nº"` and `"COMP.S/Nº"` with proper UTF-8 round-trip.
- **Pre-existing test infrastructure failures** — E1b1 commit `b26896c` LESSON: T2-T5, T8-T11 + new T19-T20 are in `describe.skip` blocks (destructive TRUNCATE bug fix). The verify-slice.sh script is the REAL gate.
- **Migration numbering** — no conflict: 0014 used by E1b2a (post-merge on disk), E1b2b uses 0015 (next sequential idx in `_journal.json`).

---

## 9. Dependencies (all confirmed shipped)

| Dependency | What E1b2b needs | Status |
|------------|------------------|--------|
| **E1a** (v0.5.1) | `packages/promotion/` skeleton + `promote.ts` algorithm + `transforms/{socios,ctacte,ctacte1}.ts` | ✅ shipped 2026-06-24 |
| **E1b1** (v0.5.2/v0.5.3) | Migration 0013 (cctcuenta backfill) + Migration 0014 (legacy_id UNIQUE INDEXes) + 5-tuple ctacte1 NK | ✅ shipped 2026-06-24 |
| **E1b2a** (v0.5.4) | Migration 0014_new_masters (4 NEW tables) + 4 transforms (escuela/deportes/locacion/caja) + PROMOTION_ORDER extended to 7 domains + caja 4-tuple NK | ✅ shipped 2026-06-25 (commit `b8d8e43`) |
| **E1b1 LESSONs** (commit `b26896c`) | Smoke test MUST run; MIN(uuid) workaround uses DISTINCT ON; TDD field names verified live; migration via psql; **`bash scripts/verify-slice.sh` is the REAL gate** | ✅ embedded in apply plan |
| **`packages/db`** (v0.5.4) | `createDb({ connectionString })`; Drizzle schemas (`socios`, `tesoreria`, `deportes`); 15 migrations applied (0014 registered) | ✅ shipped |
| **`packages/promotion`** (v0.5.4) | `promoteDomain` + `promoteAll` + `transform-helpers.ts` (all helpers work for new domain); 7-domain PROMOTION_ORDER; 7 transforms | ✅ shipped |
| **Vitest 2.1.9** | TDD harness (with `describe.skip` per E1b2a LESSON) | ✅ configured |
| **pnpm-workspace.yaml** | Already includes `packages/*` | ✅ no edit needed |

**No new external dependencies.** E1b2b adds zero npm packages. Pure TypeScript + Drizzle.

---

## 10. Acceptance Criteria

E1b2b is accepted when **all** of the following pass:

### 10.1 Build & lint

- [ ] `pnpm install --frozen-lockfile` succeeds
- [ ] `pnpm test:run` passes (existing tests pass — T19-T20 added to `describe.skip` blocks per E1b2a LESSON)
- [ ] `pnpm --filter @athlos/promotion test` passes (existing 11+ cases; T19-T20 skipped but present)
- [ ] `pnpm typecheck` passes (0 errors)
- [ ] `pnpm lint` passes (0 errors, 0 warnings)

### 10.2 TDD discipline

- [ ] `__tests__/promote.test.ts` has 2 NEW test cases T19-T20 added to existing `describe.skip` blocks (BEFORE implementation)
- [ ] T19 covers gastos happy path (1 projection row → 1 master row + idempotent re-run = 0 new)
- [ ] T20 MUST assert 5-tuple uniqueness (NOT 3-tuple — see C2)
- [ ] Tests use ACTUAL projection field names verified via `SELECT jsonb_object_keys` (11 fields documented in §4.1)

### 10.3 Spec sync (B1b LESSON #1 — FULL atomic, not partial)

- [ ] `openspec/specs/deployment-devops/spec.md` PROMOTION_ORDER scenario extended to 8 domains (was 7)
- [ ] 1 NEW scenario added: "Gastos domain promotion (flat expense ledger)"
- [ ] 1 NEW success criterion appended (gastos=2,114 rows after promotion)
- [ ] Gastos 5-tuple NK documented in spec (NOT 3-tuple — C2 correction)
- [ ] Gastos no ctacte FK documented (C7 scope correction)
- [ ] Gastos no socio_id FK in v1 documented (C8 scope correction)
- [ ] E1b2a UPDATE callout extended to include E1b2b result
- [ ] E2 DEFERRED markers added (admin API + audit column + runbook)
- [ ] `diff openspec/specs/deployment-devops/spec.md openspec/changes/.../specs/deployment-devops/spec.md` returns ONLY additive changes (~40 LoC of spec.md; no removals, no rewrites)

### 10.4 Manual smoke test on test DB (CRITICAL — E1b1/E1b2a LESSON)

- [ ] **`bash scripts/verify-slice.sh` exits 0 (PASS)** — the REAL gate introduced in commit `b26896c`
- [ ] `pnpm db:promote` runs CLI without error
- [ ] Output JSON shows 8 per-domain `PromotionResult`s (3 from E1b1 + 4 from E1b2a + 1 NEW gastos)
- [ ] `SELECT COUNT(*) FROM tesoreria.gastos` returns 2,114 (NOT 346 — proves 5-tuple NK)
- [ ] All 7 existing master counts unchanged (escuela=66, disciplinas=32, locacion=89, caja=8,145, socios=39,357, ctacte=326,275, ctacte1=~138,742)
- [ ] Re-running `pnpm db:promote` produces `{inserted:0, skipped:N}` for all 8 domains (idempotent)
- [ ] Gastos 5-tuple dedup verified: re-running inserts exactly 0 new gastos rows

### 10.5 PROMOTION_ORDER enforcement

- [ ] Manually inject a failing gastos row → promote → ctacte still runs (independent FKs)
- [ ] PROMOTION_ORDER iteration produces the 8 domains in the documented order (socios, escuela, deportes, locacion, caja, gastos, ctacte, ctacte1)

### 10.6 Hygiene (B1b LESSONs)

- [ ] No `Co-Authored-By` or AI attribution in any commit message
- [ ] Conventional Commits style throughout
- [ ] Branch from `origin/main`, PR back to `main`
- [ ] **LESSON #1 (FULL):** Atomic sync — all 8 domains, Slice E spec closed with 1 NEW scenario + 1 NEW success criterion + PROMOTION_ORDER extension (NOT partial like E1b2a)
- [ ] **LESSON #2:** Version bump + CHANGELOG in SEPARATE release commit (`chore(release): v0.5.5`)
- [ ] **LESSON #3:** 3-commit shape preserved via rebase autosquash if pre-merge fix needed
- [ ] **LESSON #4:** Merge to main BEFORE `git branch -D feat/slice-e1b2b-promotion-gastos`
- [ ] **LESSON #5:** fk-lookup uses `SELECT DISTINCT ON` (NOT `MIN(uuid)`) — already correct from E1b1; verify E1b2b doesn't regress

### 10.7 Documentation

- [ ] No `docs/runbook.md` change in E1b2b (deferred to E2)
- [ ] No migration adds `promoted_at` column in E1b2b (E2 only)
- [ ] CHANGELOG.md v0.5.5 entry includes smoke test results from verify-slice.sh (1st + 2nd runs)

---

## 11. Open Questions (resolved during propose + user-confirmed)

| # | Decision | Locked value | Source |
|---|----------|--------------|--------|
| Q1 | Sub-slice shape | **2 stacked PRs** (E1b2a + E1b2b), each under 400 LoC | Parent E1b + user-confirmed 2026-06-25 |
| Q2 | Migration design | **1 combined migration per slice** (E1b2b: 0015_gastos.sql; mirrors E1b2a's 0014 pattern) | User-confirmed 2026-06-25 |
| Q3 | E1b2a contents | **escuela + deportes + locacion + caja** (4 NEW domains = 8,332 rows) | User-confirmed 2026-06-25 |
| Q4 | E1b2b contents | **gastos + final canonical sync + v0.5.4 → v0.5.5** | User-confirmed 2026-06-25 |
| Q5 | Escuela `deporte_codigo` | **nullable integer, NO FK constraint** | User-confirmed Q9 (parent E1b) |
| Q6 | Locacion NK | **composite `(LCNCTAPRIN, LCNNUMERO)`** — 89 distinct = 100% unique | User-confirmed Q7 (parent E1b) |
| Q7 | Gastos NK | **5-tuple** (`GASTIPGAST\|GASCTAPRIN\|GASSECUENC\|GASFECHA\|GASCOMPROB`) — 2,114 distinct = 100% unique. **3-tuple = 346 distinct (1,768 dupes — WRONG)** | User-confirmed Q5 (parent E1b); re-verified live 2026-06-25 |
| Q8 | Caja NK | **4-tuple** (`numero\|secuencia\|fecha\|hora`) — 8,145 distinct = 100% unique. **3-tuple = 7,957 distinct (188 dupes — WRONG)** | Verified live 2026-06-25 09:25 UTC during E1b2a propose |
| **Q10** | **Gastos ctacte FK** | **NO ctacte FK in v1** (flat ledger). Verified: 0 of 165 distinct `GASCTAPRIN` match `ctacte.cctcuenta`. Deferred to N16. | Parent E1b exploration (Q5 deferral); re-verified live 2026-06-25 |
| **Q11** | **Gastos socio_id FK** | **NO socio_id FK in v1** (no source field). `socio_id` column exists (nullable, FK constraint deferred to N16). | **NEW** discovered 2026-06-25 11:50 UTC during this propose phase |
| **Q12** | **E1b2b sync scope** | **FULL atomic sync** (B1b LESSON #1) — closes Slice E spec with all 8 domains in one atomic update (NOT partial like E1b2a) | Locked decision for E1b2b |
| Q-migration-numbering | E1b2b migration filename | `0015_gastos.sql` (next sequential idx after E1b2a's 0014 in `_journal.json`) | Verified post-E1b2a: `_journal.json` ends at idx 14 |

**All open questions resolved.** The 5 user-confirmed decisions (Q1-Q5 + Q6/Q7 from parent E1b) plus Q8 (caja 4-tuple from E1b2a), Q10 (gastos ctacte FK from parent E1b), Q11 (NEW gastos socio_id FK), Q12 (E1b2b sync scope), and Q-migration-numbering (verified post-E1b2a) close out the scope.

---

## 12. Ready for spec?

**YES.** The scope is bounded:

- 1 NEW master table (`tesoreria.gastos`) + 1 NEW transform + 1 combined migration + 2 NEW vitest cases (T19-T20) + **FULL atomic canonical sync** (closes Slice E spec)
- ~370 raw LoC / ~200 effective (under the 400-line review budget at raw count)
- All field mappings verified live against `192.168.1.102:5432/athlos` 2026-06-25 11:50 UTC
- 3 scope corrections applied (C2 + C7 already user-confirmed + C8 NEW verified live)
- E1b1/E1b2a LESSONs embedded in apply prompt: **`bash scripts/verify-slice.sh` is the REAL gate** (per commit `b26896c`), psql migration (NOT drizzle-kit), 5-tuple NK verification, test fixtures in `describe.skip` per E1b2a LESSON
- B1b LESSONs embedded: FULL atomic sync (not partial like E1b2a), separate release commit, cherry-pick reorder, merge-then-delete, MIN(uuid) workaround (already correct)

**Next step:** sdd-spec → write `openspec/changes/athlos-promote-projection-to-master-e1b2b/specs/deployment-devops/spec.md` with the FULL delta per E1b2a spec format (~250 lines, 1 NEW scenario for gastos + 1 NEW success criterion + PROMOTION_ORDER extension to 8 domains + scope corrections C2/C7/C8 documented). Then sdd-design → write `design.md` mirroring E1b2a design (smaller scope — ~200-300 lines). Then sdd-tasks → break into implementation tasks (TASK-001..TASK-010 per §7). Then sdd-apply → wire gastos with TDD discipline + **`bash scripts/verify-slice.sh`** (E1b1/E1b2a LESSON — non-negotiable).

**B1b LESSONs to apply in sdd-spec:**

1. **LESSON #1 (HIGHEST, now FULL):** Spec sync is FULL — all 8 domains, gastos scenario + success criterion + PROMOTION_ORDER extension + E2 deferred markers. Closes Slice E spec atomically.
2. **LESSON #2:** Spec delta acceptance criteria MUST include `diff` assertion (additive-only).
3. **LESSON #5:** Caja 4-tuple NK + gastos 5-tuple NK both documented in spec (NOT 3-tuple — see C2/C8 from E1b2a/E1b2b scope corrections).

---

## 13. Review Workload Forecast

| Metric | Value |
|--------|-------|
| Estimated changed lines (raw, full impl) | **~370** |
| Estimated changed lines (effective, per E1a analog) | **~200** |
| Per-PR target | ≤ 400 |
| 400-line budget risk | **LOW (~92% if raw; ~50% if effective)** |
| Chained PRs recommended | **No within E1b2b** (E1b2b alone is THIS PR; E2 follows as separate stacked PR) |
| Suggested split | E1b2b alone in this PR; E2 follows as separate PR |
| Delivery strategy | single-pr (per session preflight) |
| Chain strategy | N/A — stacked PRs are separate slices, not chains within one slice |
| Work-unit count | **10** (TASK-001..TASK-010) |
| Largest single change | TASK-005 (algorithm updates, ~30L) + TASK-008 (spec sync, ~40L of spec.md) |
| Estimated reviewer time | ~15-25 min (one pass — focus on migration SQL, 5-tuple NK, gastos schema + transform, dedup.ts extension, **FULL atomic spec sync diff**) |

> **Honest call-out:** the 370 raw LoC estimate puts E1b2b UNDER the 400-line budget at raw count (~92%) and well under at effective count (~50%). No split needed. The verify-slice.sh gate ensures the smoke test runs end-to-end before merge — the historical E1b1 LESSON (v0.5.2 shipped broken because smoke was skipped) is now enforced by the script itself.

---

## 14. Persisted artifacts

- This file: `openspec/changes/athlos-promote-projection-to-master-e1b2b/proposal.md`
- Engram topic key: `sdd/athlos-promote-projection-to-master-e1b2b/proposal`
- Engram type: `architecture`
- Engram capture_prompt: `false` (SDD artifact, automated)

**Next step (for the orchestrator):** sdd-spec → write the spec delta at `openspec/changes/athlos-promote-projection-to-master-e1b2b/specs/deployment-devops/spec.md` per E1b2a spec format (~250 lines, 1 NEW scenario + 1 NEW success criterion + PROMOTION_ORDER extension + scope corrections C2/C7/C8 documented). Then sdd-design → write `design.md` mirroring E1b2a design (smaller — ~200-300 lines, focused on gastos + final sync). Then sdd-tasks → break into implementation tasks. Then sdd-apply → wire gastos with strict TDD discipline + **`bash scripts/verify-slice.sh`** (E1b1/E1b2a LESSON — non-negotiable per commit `b26896c`). The user should be informed of the NEW Q11 (gastos socio_id FK) finding before spec phase locks the scope.