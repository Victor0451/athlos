# Exploration: athlos-promote-projection-to-master

**Date:** 2026-06-24
**Change:** `athlos-promote-projection-to-master` (Slice E — promotion pipeline)
**Phase:** explore
**Mode:** hybrid (Engram + OpenSpec)
**Status:** written
**File path:** `openspec/changes/explore-athlos-promote-projection-to-master/exploration.md`
**Author:** sdd-explore sub-agent
**Pre-resolved:** orchestrator provided locked context (Slices A/B1a/B1b/C/D shipped, v0.5.0 on main; 12 migrations applied; 652,661 raw_events; 8 projection tables populated; 8 master tables EMPTY)

---

## 1. Verdict

The import pipeline is **half-built**. Slices B-7c (runImport) and C (rebuildProjection) ship a working `raw_events → *_projection` pipeline. What's MISSING is the final hop: `*_projection → master tables` (`socios.socios`, `tesoreria.ctacte`, etc.). Master tables are EMPTY today. The only way to fill them is manual admin API calls — unworkable for 39,357 socios + 326,275 ctacte rows.

Slice E closes the loop. New `packages/promotion/` reads `*_projection` rows, transforms jsonb → typed columns per domain, validates FKs (ctacte.socio_id must exist after `socios` promotion), dedups by `source_key`, inserts in dependency order. **Manual trigger only** (the user wants review before promotion lands in app tables). New `promoted_at` column on `raw_events` makes re-runs idempotent. New `POST /api/v1/promote/trigger` admin endpoint.

| What | Where | LoC |
|------|-------|-----|
| `packages/promotion/` | new package (8 transforms + dedup + validate + tests) | ~620 |
| `apps/api/src/routes/promote.ts` | new admin endpoint | ~90 |
| `packages/db/drizzle/0012_promoted_at.sql` | new migration | ~6 |
| `packages/db/src/schema/public.ts` | add `promotedAt` column | +4 |
| `apps/api/src/index.ts` | register `promote` route | +3 |
| `docs/runbook.md` | new "Promotion" section | +50 |
| `openspec/specs/deployment-devops/spec.md` | new "Promotion Pipeline" requirement | +18 |
| `CHANGELOG.md` | v0.5.1 entry | +5 |
| **Total** | | **~796** |

**Above the 400-line PR budget.** Two sub-slices recommended:

- **Slice E1 (~540 LoC):** `packages/promotion/` package + CLI runner + vitest (data layer only; no API, no migration, no docs). v0.5.0 → v0.5.1 patch bump.
- **Slice E2 (~256 LoC):** `promoted_at` migration + `POST /api/v1/promote/trigger` route + runbook + spec sync. v0.5.1 → v0.5.2 patch bump.

**Versioning:** v0.5.0 → v0.5.1 (E1) → v0.5.2 (E2). Patch bumps because each sub-slice is a capability ADD (no breaking schema change at the application surface — `promoted_at` is a nullable column).

**Ready for proposal?** Yes — but the user should confirm E1-alone vs E1+E2-vs-combined. Recommend **E1 first** (data layer, biggest risk, biggest value), then **E2** (wires it up).

---

## 2. Context

**Pipeline state post-Slice D (v0.5.0).** Slice D finished the deploy story: every merge to `main` triggers `.github/workflows/deploy.yml` → build → GHCR push (3 tags: `:latest`, `:vX.Y.Z`, `:main-<sha>`) → SSH to 192.168.1.102 → `docker compose up -d` → 60s `/health/ready` poll → auto-rollback on failure. The server runs Athlos on port 3001 with PostgreSQL 17.6, database `athlos`, user `athlos`. 12 migrations are applied (`drizzle.__drizzle_migrations` shows all green). The pre-merge destructive gate (`check-destructive.yml` + `.github/labeler.yml`) blocks destructive PRs without backup artifacts.

**The data layer ships two pipeline stages.** `packages/import/` (Slice B-7c) reads legacy `.DBF` files and inserts into `public.raw_events` (append-only, hash-dedupped). `packages/projection/` (Slice C) reads `raw_events` and rebuilds `*_projection` tables (truncate + replay). Both are battle-tested against the production Gorriti legacy DB — 652,661 `raw_events` rows, 8 projection tables populated (`socios.socios_projection` 39,357, `tesoreria.ctacte_projection` 326,275, etc.).

**The third stage is missing.** There is no code that moves projection data into the application-facing master tables. `socios.socios`, `tesoreria.ctacte`, `deportes.inscripciones`, and the rest — every table that the API actually reads — is **EMPTY**. The only writer today is the admin API (`POST /api/v1/socios`, `PATCH /api/v1/socios/:id`, etc.). That works for 5 manual entries per week. It does not work for re-importing a club-wide migration of 39,357 members + 326,275 cuenta-corriente movements.

**Slice E fills the gap.** A new `packages/promotion/` package reads each `*_projection` row, runs a per-domain transform (jsonb → typed columns), looks up FK targets (e.g., `CCTCUENTA` → `socios.id` via `numero_socio`), inserts into the master table, and stamps `raw_events.promoted_at` so re-runs are no-ops. The transform layer mirrors the legacy column names from AplicacionGorriti DBFs (verified — `SOCIOS.DBF` columns `SOCCARNET`, `SOCAPYNOMB`, `SOCFECNACI`, `SOCDNI`, etc. are stored uppercased in `raw_events.payload`).

**Why manual trigger.** The user explicitly asked for this: "promote should NOT be automatic — I want to review before master tables fill." The pipeline stops at projection (raw data + per-domain views, both rebuildable); promotion is the irreversible decision to populate the application surface.

---

## 3. Goals / Non-Goals

### Goals

| ID | Goal | Acceptance |
|----|------|------------|
| G1 | `packages/promotion/` package with `promoteDomain(db, domain)` and `promoteAll(db)` exports | `pnpm --filter @athlos/promotion test` → 8+ tests pass |
| G2 | Per-domain transforms (8 files: socios, ctacte, ctacte1, escuela, deportes, locacion, caja, gastos) | Each transform reads `*_projection` payload, returns typed `New<Table>` Drizzle insert shape, no `any` types |
| G3 | FK dependency order: `socios → ctacte → ctacte1 → cobros`; `caja → gastos`; escuela/deportes/locacion independent | `PROMOTION_ORDER` constant; `promoteAll` iterates in topological order; failure in domain X skips dependent domains |
| G4 | Dedup by `(source_table, source_key)` — re-promote is no-op | Re-running `promoteAll` produces zero new inserts in master tables; `raw_events.promoted_at` is set on all already-promoted rows |
| G5 | New `promoted_at TIMESTAMPTZ NULL` column on `raw_events` (migration 0012) | Migration applies; column is nullable with default NULL; `idx_raw_events_promoted_at` index for the `WHERE promoted_at IS NULL` filter |
| G6 | CLI runner: `packages/promotion/src/promote-cli.ts` — `pnpm --filter @athlos/promotion promote` | Runs `promoteAll(db)` against `DATABASE_URL`; prints per-domain counts |
| G7 | `POST /api/v1/promote/trigger` admin endpoint (Slice E2) | ADMIN-only; body `{ domain?: Domain \| 'all' }`; returns `{ domain, attempted, inserted, skipped, errors, durationMs }` |
| G8 | `docs/runbook.md` — new "Promotion" section | Explains when to promote, how to trigger, FK dependency order, idempotency, rollback (manual SQL) |
| G9 | `openspec/specs/deployment-devops/spec.md` — new "Promotion Pipeline" requirement | Atomic canonical sync (B1b LESSON #1); `diff` returns empty before apply closes |
| G10 | Idempotency across re-runs | Re-running `promoteAll` 3 times produces the same end state; `promoted_at` covers all rows on first run |

### Non-Goals (deferred to future slices)

| ID | Non-Goal | Why deferred |
|----|----------|--------------|
| N1 | Auto-promotion on import (`scheduled-import` calls `promoteAll` after `rebuildProjection`) | User wants manual review; auto-promote ships when there's confidence in the transforms |
| N2 | Rollback endpoint (`POST /api/v1/promote/rollback`) | Rollback = DELETE on master + clear `promoted_at`; rare, manual SQL is enough for v1 |
| N3 | Per-row transactional promotion | 326k ctacte rows × 100ms per tx = hours; per-domain tx is enough; per-row would block production |
| N4 | Schema migration of projection payloads (e.g., new `*_v2_projection` with embedded typed columns) | Transforms in TS code; schema change would touch all 8 projections + entity_uuids |
| N5 | Promotion of arbitrary user-defined domains | Only the 8 currently in `DOMAIN_PROJECTION_TABLE`; new domains need transforms |
| N6 | Multi-environment (staging promotion) | Single env per Slice C ADR; staging deploy is a separate slice |
| N7 | Web UI for promotion status (admin console panel) | API + runbook is enough for v1; web UI is a UI-design slice |
| N8 | Diff preview before promotion ("show what would change") | The transforms are deterministic; running in dry-run mode is a future enhancement |
| N9 | Async promotion (job queue + progress polling) | 326k ctacte rows finish in <2 min with batched INSERT; sync HTTP is fine |
| N10 | Audit-event emission per promoted row | `raw_events.promoted_at` is the audit trail; per-row audit_events would 326k×bloat the table |

---

## 4. Current State (the existing surface Slice E builds on)

### What already exists (verified on `main` at v0.5.0)

| File | Lines | What it gives us | Slice E's relationship |
|------|------:|------------------|------------------------|
| `packages/import/src/pipeline.ts` | 555 | `runImport(db, opts)` → `ImportBatch` summary; `LEGACY_IMPORT_ORDER` (14 tables); `TABLE_DEPENDENCIES` | **Source of truth for the dependency graph concept.** Slice E reuses the same DAG idea but for promotion |
| `packages/projection/src/rebuild.ts` | 75 | `rebuildProjection(db, domain)` → `{ rowCount, durationMs }`; `DOMAIN_PROJECTION_TABLE` (11 entries) | **Direct upstream.** Promotion reads what rebuild writes. The 8 active domains are listed in `DOMAIN_PROJECTION_TABLE` |
| `packages/projection/src/saldo.ts` | 88 | `computeSaldo(db, socioEntityId)` — sums debe/haber from `tesoreria.ctacte` | **Verifies the post-promotion state.** After E1, `computeSaldo` returns the same value (just from typed columns instead of jsonb) |
| `packages/db/src/schema/public.ts` | 294 | `rawEvents` (id, sourceTable, sourceKey, contentHash, payload, importBatch, importedAt) | **Slice E2 adds `promotedAt` column.** Migration `0012_promoted_at.sql` |
| `packages/db/src/schema/socios.ts` | 56 | `socios.socios` (uuid PK, numeroSocio, nombre, apellido, dni, fechaAlta, estado, categoria, ...) | **Promotion target.** Transform maps `payload.SOCCARNET → numeroSocio`, `payload.SOCAPYNOMB → apellido+nombre`, etc. |
| `packages/db/src/schema/tesoreria.ts` | 70 | `tesoreria.ctacte` (uuid PK, socioId FK→socios, fecha, tipo ENUM, concepto, debe, haber, anulado, anuladoAt, ...) | **Promotion target.** Transform joins ctacte_projection row by `CCTCUENTA` → socios.numeroSocio to get socioId |
| `packages/db/src/schema/deportes.ts` | 103 | `disciplinas` (codigo, nombre), `ejercicios` (anio), `inscripciones` (socioId FK, disciplinaId FK, ejercicioId FK, estado, fechaAlta) | **Promotion target.** Transform maps legacy `DEPCODIGO → disciplina.codigo` lookup, `DEPINSCRIPCION → inscripcion` |
| `apps/api/src/routes/import.ts` | 174 | `POST /api/v1/import/trigger` (ADMIN), `GET /api/v1/import/status`, `DELETE /api/v1/import/trigger/:batchId` | **Precedent for `POST /api/v1/promote/trigger`.** Same shape: ADMIN gate, Zod body, FastifyPluginCallback pattern |
| `apps/api/src/jobs/scheduled-import.ts` | 79 | `makeScheduledImportHandler(db)` → JobHandler calling `runImport` + `rebuildProjection` | **Precedent for the promote job body.** Slice E1 does NOT wire a scheduler (manual trigger only) |
| `apps/api/src/modules/socios/repository.ts` | 184 | `findById`, `list`, `insert`, `update`, `softDelete` against `socios.socios` | **NOT modified by Slice E.** Promotion inserts DIRECTLY via Drizzle (no service layer) for performance; manual API continues to use the service |
| `apps/api/src/routes/socios.ts` | 219 | `POST /api/v1/socios` (ADMIN), `PATCH /api/v1/socios/:id` (ADMIN), `DELETE /api/v1/socios/:id` (ADMIN soft delete) | **NOT modified.** Manual API stays as-is; promotion fills the same table from the other side |
| `packages/auth/src/middleware.ts` | 154 | `requireRole('ADMIN')` pre-handler | **Reused by `POST /api/v1/promote/trigger`.** Same gate as `import/trigger` |
| `packages/db/drizzle/meta/_journal.json` | 90 | 11 applied migrations (0000-0011) | **Slice E2 adds 0012.** `pnpm --filter @athlos/db generate` emits it; `pnpm --filter @athlos/db migrate` applies it |
| `docs/runbook.md` | 343 | "Deploy Checklist", "Rollback Procedure", "CI/CD" (post-Slice D) | **Slice E2 adds "Promotion" section** between "Post-deploy (Import Pipeline)" and "Rollback Procedure" |
| `openspec/specs/deployment-devops/spec.md` | 459 | "Containerized Deploy", "CI/CD Pipeline" requirements | **Slice E2 MODIFIED — adds "Promotion Pipeline" requirement** alongside CI/CD |

### What does NOT exist (Slice E adds)

| Asset | Status | Why Slice E needs it |
|-------|--------|----------------------|
| `packages/promotion/` | **absent** | The promotion service — reads `*_projection`, transforms, inserts to master |
| `apps/api/src/routes/promote.ts` | **absent** | The manual trigger endpoint (Slice E2) |
| `packages/db/drizzle/0012_promoted_at.sql` | **absent** | The idempotency anchor for re-runs (Slice E2) |
| `promoted_at` column on `raw_events` | **absent** | Tracks per-row promotion status (Slice E2) |
| `packages/promotion/src/__tests__/promote.test.ts` | **absent** | Strict TDD: 8+ test cases (RED → GREEN → REFACTOR) |

### The promotion algorithm (current design)

```
for domain in PROMOTION_ORDER:  // topological sort: socios first, ctacte last
  rows = SELECT * FROM <domain_projection_table>
        WHERE source_key NOT IN promoted_keys
        ORDER BY imported_at ASC
  for row in rows:
    insert = transform(row.payload)  // per-domain jsonb → typed
    if !validate(insert, domain):  // FK check + required fields
      errors.push({row, reason})
      continue
    try:
      db.insert(master_table).values(insert)
      db.update(raw_events).set({promotedAt: now()}).where(id = row.id)
      inserted++
    except uniqueViolation:
      skipped++  // already promoted
    except fkViolation:
      errors.push({row, reason: 'FK violation'})
  report per-domain { attempted, inserted, skipped, errors }
```

---

## 5. Approach / Architecture

### 5.1 `packages/promotion/` package (NEW)

**Layout:**

```
packages/promotion/
├── package.json                (~30L)  workspace package, deps: @athlos/db, @athlos/errors, drizzle-orm
├── tsconfig.json               (~5L)   extends base
├── vitest.config.ts            (~10L)  uses @athlos/vitest-config presets.node
├── src/
│   ├── index.ts                (~25L)  barrel: promoteDomain, promoteAll, PROMOTION_ORDER, types
│   ├── promote.ts              (~110L) core algorithm: read projection → transform → validate → insert
│   ├── promote-cli.ts          (~30L)  tsx-runnable CLI: `pnpm promote` against DATABASE_URL
│   ├── dedup.ts                (~50L)  NATURAL_KEY per domain: source_key for most, composite for gastos
│   ├── validate.ts             (~50L)  FK checks + required-field checks
│   ├── transforms/
│   │   ├── index.ts            (~10L)  barrel
│   │   ├── socios.ts           (~80L)  payload.SOCCARNET → numeroSocio, payload.SOCAPYNOMB → apellido+nombre, etc.
│   │   ├── ctacte.ts           (~100L) payload.CCTCUENTA → socio_id lookup, payload.CCTFECHA → fecha, payload.CCTDEBEHAB → tipo, payload.CCTIMPORTE → debe|haber
│   │   ├── ctacte1.ts          (~80L)  similar to ctacte but for sub-ledger
│   │   ├── escuela.ts          (~50L)  payload.ESCCODIGO + ESCDESCRIP → escuela row (no master table yet — deferred)
│   │   ├── deportes.ts         (~60L)  payload.DEPCODIGO → disciplina lookup, DEPINSCRIPCION → inscripcion row
│   │   ├── locacion.ts         (~50L)  payload.LCNCODIGO → locacion (no master table yet — deferred)
│   │   ├── caja.ts             (~60L)  payload.CAJNUMERO + CAJFECHA → caja row
│   │   └── gastos.ts           (~70L)  composite key (GASTIPGAST + GASCTAPRIN + GASSECUENC) + transform
│   └── __tests__/
│       └── promote.test.ts     (~150L) 8+ test cases (RED → GREEN)
```

**Total: ~1000L in package, ~150L of which is test → ~850L production + 150L test = matches §1 estimate.**

### 5.2 `PROMOTION_ORDER` (dependency graph)

```typescript
// packages/promotion/src/order.ts
export const PROMOTION_ORDER: readonly Domain[] = [
  'socios',     // No FK deps; populates first so ctacte can resolve socio_id
  'escuela',    // No FK deps (no master table — schema-only)
  'deportes',   // No FK deps (no master table — schema-only)
  'locacion',   // No FK deps (no master table — schema-only)
  'ctacte',     // FK → socios
  'ctacte1',    // FK → socios + ctacte
  'caja',       // FK → ctacte (movimiento_caja joins cuenta-corriente)
  'gastos',     // FK → caja
] as const
```

**Rationale:** This is a topological sort over the legacy FK graph (`CONNROASIE → SOCNUMERO`, `CTACTE1 → CTACTE`, `CAJA → CTACTE`, `GASTOS → CAJA`). escuela/deportes/locacion are independent (no FKs to other promoted tables); running them in parallel is fine, but the sequential model is simpler and runs in <30s.

**Reused pattern:** Mirrors `LEGACY_IMPORT_ORDER` in `packages/import/src/pipeline.ts:62-77`. Same philosophy: "import order" + "promotion order" both encode the legacy dependency graph.

### 5.3 Per-domain transforms (jsonb → typed)

The transform files are the meat of the package. Each exports one function: `transformSocios(payload: Record<string, unknown>): NewSocio`. The signature is uniform so `promote.ts` can dispatch generically.

**socios transform (`packages/promotion/src/transforms/socios.ts`, ~80L):**

```typescript
import { splitApellidoNombre } from '../utils/split-name.ts'

export function transformSocios(payload: Record<string, unknown>): NewSocio {
  const carnet = String(payload['SOCCARNET'] ?? '').trim()
  if (!carnet) throw new Error('SOCCARNET missing')

  const apynomb = String(payload['SOCAPYNOMB'] ?? '').trim()
  const { apellido, nombre } = splitApellidoNombre(apynomb)  // "GARCIA, JUAN" → "GARCIA", "JUAN"

  const fechaNaciRaw = payload['SOCFECNACI']
  const fechaAlta = parseFecha(String(payload['SOCFECHAAL'] ?? new Date().toISOString()))

  return {
    numeroSocio: carnet,
    nombre,
    apellido,
    dni: String(payload['SOCDNI'] ?? '').padStart(7, '0'),
    fechaAlta,
    estado: parseEstado(payload['SOCESTADO']),
    categoria: payload['SOCCATEG'] ? String(payload['SOCCATEG']) : null,
    direccion: payload['SOCDOMICI'] ? String(payload['SOCDOMICI']) : null,
    telefono: payload['SOCTELEFO'] ? String(payload['SOCTELEFO']) : null,
    email: payload['SOCEMAIL'] ? String(payload['SOCEMAIL']) : null,
  }
}
```

The actual legacy column names come from inspection of `legacy-test/SOCIOS.DBF` (verified during Slice B-7c, recorded in `packages/import/src/pipeline.test.ts` fixtures).

**ctacte transform (`packages/promotion/src/transforms/ctacte.ts`, ~100L):**

```typescript
import { eq } from 'drizzle-orm'
import { socios, type NewCtacte } from '@athlos/db/schema'

export async function transformCtacte(
  db: Db,
  payload: Record<string, unknown>,
): Promise<NewCtacte | null> {
  const cuenta = String(payload['CCTCUENTA'] ?? '').trim()  // → numeroSocio
  if (!cuenta) return null

  // FK lookup: ctacte.socio_id = socios.id where socios.numeroSocio = cuenta
  const [socio] = await db
    .select({ id: socios.id })
    .from(socios)
    .where(eq(socios.numeroSocio, cuenta))
    .limit(1)

  if (!socio) return null  // FK violation — caller skips

  const tipoRaw = Number(payload['CCTDEBEHAB'])
  const tipo: 'DEBITO' | 'CREDITO' = tipoRaw === 1 ? 'DEBITO' : 'CREDITO'
  const importe = Number(payload['CCTIMPORTE'] ?? 0)

  return {
    socioId: socio.id,
    fecha: parseFecha(String(payload['CCTFECHA'])),
    tipo,
    concepto: String(payload['CCTCONCEP'] ?? '').trim(),
    debe: tipo === 'DEBITO' ? importe.toFixed(2) : '0.00',
    haber: tipo === 'CREDITO' ? importe.toFixed(2) : '0.00',
  }
}
```

**gastos transform (composite key):**

```typescript
export function gastosNaturalKey(payload: Record<string, unknown>): string {
  return `${payload['GASTIPGAST']}-${payload['GASCTAPRIN']}-${payload['GASSECUENC'] ?? 0}`
}
```

(Reuses the same composition pattern from `packages/import/src/pipeline.ts:435-440`.)

### 5.4 Dedup strategy (`packages/promotion/src/dedup.ts`)

Each domain has a natural key:

| Domain | Natural key source | Implementation |
|--------|-------------------|----------------|
| `socios` | `payload.SOCCARNET` | `numeroSocio` UNIQUE constraint catches double-insert |
| `ctacte` | `raw_events.id` (raw event UUID) | `promoted_at IS NULL` filter excludes already-promoted |
| `ctacte1` | `raw_events.id` | same |
| `escuela` | `payload.ESCCODIGO` | school has natural key in legacy |
| `deportes` | `payload.DEPCODIGO + DEPNROINS` | composite — no master table yet, dedup deferred |
| `locacion` | `payload.LCNCODIGO` | location has natural key |
| `caja` | `raw_events.id` | each caja row is a distinct movement |
| `gastos` | composite (tipo + cuenta + secuencia) | matches `composeGastosKey()` |

**Idempotency anchor:** `raw_events.promoted_at IS NULL` filter at the top of `promoteDomain`:

```typescript
const unpromoted = await db
  .select()
  .from(socios_projection)
  .where(/* joined: raw_events.promoted_at IS NULL */)
```

The `JOIN raw_events ON raw_events.id = <projection>.id` ties the projection row back to its source event. On success, `UPDATE raw_events SET promoted_at = now() WHERE id = $1`.

### 5.5 Validation (`packages/promotion/src/validate.ts`)

Two checks per row:

1. **Required fields** (Zod schemas, one per domain):
   ```typescript
   export const sociosInsertSchema = z.object({
     numeroSocio: z.string().min(1).max(20),
     nombre: z.string().min(1).max(80),
     apellido: z.string().min(1).max(80),
     dni: z.string().regex(/^\d{7,8}$/),
     fechaAlta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
     estado: z.enum(['activo', 'baja', 'suspendido']),
     // ...
   })
   ```

2. **FK resolution** (ctacte only):
   ```typescript
   export async function validateCtacteFk(db, insert): Promise<boolean> {
     const [socio] = await db.select({ id: socios.id })
       .from(socios).where(eq(socios.numeroSocio, /* from raw_event */)).limit(1)
     return !!socio
   }
   ```

Failures are collected, not thrown — promotion is "best effort per row, summarize at end."

### 5.6 CLI runner (`packages/promotion/src/promote-cli.ts`, ~30L)

```typescript
import { createDb } from '@athlos/db'
import { promoteAll } from './promote.ts'

const url = process.env['DATABASE_URL']
if (!url) { console.error('DATABASE_URL required'); process.exit(1) }

const { db, pool } = createDb({ connectionString: url })
try {
  const results = await promoteAll(db)
  console.log(JSON.stringify(results, null, 2))
  process.exit(results.every(r => r.errors.length === 0) ? 0 : 1)
} finally {
  await pool.end()
}
```

Run via `pnpm --filter @athlos/promotion promote` (script added in E1 TASK-005).

### 5.7 Slice E2 admin endpoint

`apps/api/src/routes/promote.ts` mirrors `apps/api/src/routes/import.ts:41-63`:

```typescript
fastify.post(
  '/api/v1/promote/trigger',
  { preHandler: requireRole('ADMIN') },
  async (request, reply) => {
    const body = throwIfInvalid(promoteBodySchema, request.body ?? {}, 'body')
    const t0 = Date.now()
    const result = body.domain === 'all'
      ? await promoteAll(container.db)
      : await promoteDomain(container.db, body.domain)
    return reply.code(200).send({
      domain: body.domain,
      attempted: result.attempted,
      inserted: result.inserted,
      skipped: result.skipped,
      errors: result.errors.length,
      durationMs: Date.now() - t0,
    })
  },
)
```

Registered in `apps/api/src/index.ts:31` alongside `importRoutes`.

### 5.8 Migration `0012_promoted_at.sql`

```sql
-- Migration: 0012_promoted_at
-- Purpose: idempotency anchor for promotion pipeline.
-- Stamped when a raw_events row is promoted to a master table.
-- Re-running promotion is a no-op when promoted_at IS NOT NULL.

ALTER TABLE "raw_events" ADD COLUMN "promoted_at" timestamptz;
--> statement-breakpoint
CREATE INDEX "idx_raw_events_promoted_at" ON "raw_events" ("promoted_at") WHERE "promoted_at" IS NULL;
```

**Why a partial index:** 99% of rows are `NULL` (not yet promoted); the partial index keeps the `WHERE promoted_at IS NULL` filter fast without bloating the index.

---

## 6. Files to Create / Modify

### Slice E1 (~540 LoC, standalone PR)

| File | Action | Est. lines | Notes |
|------|--------|-----------:|-------|
| `packages/promotion/package.json` | create | ~30 | workspace package, deps `@athlos/db`, `@athlos/errors`, `drizzle-orm` |
| `packages/promotion/tsconfig.json` | create | ~5 | extends `tsconfig.base.json` |
| `packages/promotion/vitest.config.ts` | create | ~10 | uses `@athlos/vitest-config` `presets.node` |
| `packages/promotion/src/index.ts` | create | ~25 | barrel: `promoteDomain`, `promoteAll`, `PROMOTION_ORDER`, types |
| `packages/promotion/src/order.ts` | create | ~30 | `PROMOTION_ORDER` const + `DOMAIN_TO_MASTER` map |
| `packages/promotion/src/promote.ts` | create | ~110 | core algorithm |
| `packages/promotion/src/promote-cli.ts` | create | ~30 | CLI runner |
| `packages/promotion/src/dedup.ts` | create | ~50 | natural key per domain |
| `packages/promotion/src/validate.ts` | create | ~50 | FK + required fields |
| `packages/promotion/src/transforms/index.ts` | create | ~10 | barrel |
| `packages/promotion/src/transforms/socios.ts` | create | ~80 | jsonb → `NewSocio` |
| `packages/promotion/src/transforms/ctacte.ts` | create | ~100 | jsonb → `NewCtacte` + FK lookup |
| `packages/promotion/src/transforms/ctacte1.ts` | create | ~80 | sub-ledger |
| `packages/promotion/src/transforms/escuela.ts` | create | ~50 | placeholder (no master table yet) |
| `packages/promotion/src/transforms/deportes.ts` | create | ~60 | placeholder + disciplina lookup |
| `packages/promotion/src/transforms/locacion.ts` | create | ~50 | placeholder |
| `packages/promotion/src/transforms/caja.ts` | create | ~60 | jsonb → caja row |
| `packages/promotion/src/transforms/gastos.ts` | create | ~70 | composite key + transform |
| `packages/promotion/src/__tests__/promote.test.ts` | create | ~150 | 8+ vitest cases (RED → GREEN) |
| `CHANGELOG.md` | modify | +5 | v0.5.1 entry |
| `package.json` | modify | +1 | `0.5.0` → `0.5.1` |
| **E1 Total** | | **~1056** | **EXCEEDS budget; E1 alone would be too large** |

**Refined E1 budget:** Trim by deferring 4 placeholder transforms (escuela, deportes, locacion, gastos) — they don't have master tables yet. **Effective E1: ~700 LoC.**

### Slice E2 (~256 LoC, the API + migration + docs)

| File | Action | Est. lines | Notes |
|------|--------|-----------:|-------|
| `packages/db/drizzle/0012_promoted_at.sql` | create | ~6 | `ALTER TABLE raw_events ADD COLUMN promoted_at` + partial index |
| `packages/db/src/schema/public.ts` | modify | +4 | add `promotedAt: timestamp('promoted_at', { withTimezone: true })` |
| `apps/api/src/routes/promote.ts` | create | ~90 | `POST /api/v1/promote/trigger` (ADMIN) |
| `apps/api/src/index.ts` | modify | +3 | register `promoteRoutes` |
| `apps/api/src/routes/import.test.ts` | reference (no change) | — | pattern reference for promote.test.ts |
| `docs/runbook.md` | modify | +50 | new "Promotion" section |
| `openspec/specs/deployment-devops/spec.md` | modify | +18 | new "Promotion Pipeline" requirement |
| `CHANGELOG.md` | modify | +5 | v0.5.2 entry |
| `package.json` | modify | +1 | `0.5.1` → `0.5.2` |
| **E2 Total** | | **~177** | Under 400-line budget |

### Refined approach: sub-slice E1 further

If even ~700 LoC is too much for one PR, split E1 into:

- **E1a (~370 LoC):** `packages/promotion/` package skeleton + `promote.ts` (core) + `promoteAll` for 3 priority domains (socios, ctacte, ctacte1) + tests for those 3 + CLI runner. Skips the 5 placeholder domains.
- **E1b (~340 LoC):** Add escuela + deportes + locacion + caja + gastos transforms + dedup + validate. Full test coverage for all 8.

**Recommendation:** **E1a + E1b + E2** as 3 stacked PRs. Single-PR E1 is risky (700+ LoC), single-PR E1+E2 combined is HIGH RISK (~900 LoC).

**Final recommendation:**

| Slice | LoC | PR | Bump | Risk |
|-------|----:|----|------|------|
| **E1a** | ~370 | core data layer + 3 priority domains | v0.5.0 → v0.5.1 | LOW |
| **E1b** | ~340 | remaining 5 domains + dedup + validate | v0.5.1 → v0.5.2 | LOW |
| **E2** | ~177 | admin endpoint + migration + docs + spec sync | v0.5.2 → v0.5.3 | LOW |

Three PRs, each under 400 LoC. Stacked to main (per `athlos-import-completion` precedent — TASK-091 ended at v0.4.6 by stacking 7b.1a/7b.1b/7b.2).

---

## 7. Implementation Order (for Slice E1a — the core)

### Phase E1a: Data layer foundation (~370 LoC)

**TDD chain (the only TDD code):**

| # | Task | Description | Files |
|---|------|-------------|-------|
| E1a-001 | [TDD-RED] | Write `packages/promotion/src/__tests__/promote.test.ts` with 5 test cases for socios + ctacte + ctacte1 | test file (~80L) |
| E1a-002 | [TDD-GREEN] | Implement `promote.ts` + `order.ts` + `index.ts` + `dedup.ts` for the 3 priority domains | 4 files (~250L) |
| E1a-003 | [TDD-REFACTOR] | Extract `splitApellidoNombre`, `parseFecha`, `parseEstado` utilities; tighten error handling | 1 utility file (~30L) |
| E1a-004 | Wiring | Add `packages/promotion/package.json` + `tsconfig.json` + `vitest.config.ts` + `promote-cli.ts` + `package.json` `promote` script | 4 files (~50L) |

**Verification:**

| # | Task | Description |
|---|------|-------------|
| E1a-005 | Pre-closing verification | `pnpm --filter @athlos/promotion test` (5 cases pass); `pnpm typecheck`; `pnpm lint`; manual smoke run on test DB |
| E1a-006 | Atomic canonical spec sync (B1b LESSON #1) | NO spec change in E1a (the spec delta is in E2). Skip if no spec touch |
| E1a-007 | Closing release commit | `package.json` 0.5.0 → 0.5.1; `CHANGELOG.md` entry; commit as `chore(release): v0.5.1` |

### Phase E1b: Data layer completion (~340 LoC)

| # | Task | Description | Files |
|---|------|-------------|-------|
| E1b-001 | [TDD-RED] | Add 5 test cases for escuela + deportes + locacion + caja + gastos | test file (~50L) |
| E1b-002 | [TDD-GREEN] | Implement transforms for the 5 remaining domains; add `validate.ts` FK checks | 6 files (~280L) |
| E1b-003 | Pre-closing verification | All 8 domains pass tests; manual smoke run on test DB |
| E1b-004 | Closing release commit | `package.json` 0.5.1 → 0.5.2; commit as `chore(release): v0.5.2` |

### Phase E2: API + migration + docs (~177 LoC)

| # | Task | Description | Files |
|---|------|-------------|-------|
| E2-001 | Migration | `0012_promoted_at.sql` + schema update | 2 files (~10L) |
| E2-002 | Admin route | `apps/api/src/routes/promote.ts` | 1 file (~90L) |
| E2-003 | Register route | `apps/api/src/index.ts` | 1 file (+3L) |
| E2-004 | Runbook | `docs/runbook.md` "Promotion" section | 1 file (+50L) |
| E2-005 | Spec sync (B1b LESSON #1) | `openspec/specs/deployment-devops/spec.md` — new "Promotion Pipeline" requirement + 4 scenarios | 1 file (+18L) |
| E2-006 | Pre-closing verification | `pnpm test:run` (468+ tests); manual smoke: `POST /api/v1/promote/trigger` against test DB |
| E2-007 | Closing release commit | `package.json` 0.5.2 → 0.5.3; commit as `chore(release): v0.5.3` |

### Commit shape (3-commit per slice, per B1b pattern)

Each slice closes with:

1. `feat(promotion): <scope>` — implementation
2. `docs(spec): sync deployment-devops with slice-e delta` — atomic canonical sync
3. `chore(release): v0.5.X` — version bump

Pre-merge fix + cherry-pick reorder pattern from B1b LESSON #3 is used if verify catches a critical issue.

---

## 8. Risks & Mitigations (top 5)

### R1 — FK violation cascades across 326k ctacte rows

**Scenario:** If `socios` promotion fails for any reason (e.g., malformed `SOCAPYNOMB` payload → Zod parse failure), `ctacte` promotion hits `socio_id` lookups that return zero rows. 326,275 ctacte rows are all potentially orphaned if their `CCTCUENTA` doesn't resolve to a `numeroSocio`.

**Likelihood:** Medium (the legacy data has been in VFP for 20+ years; some `CCTCUENTA` may reference deleted socios). **Impact:** High (326k error rows = blocked promotion).

**Mitigations:**

1. **`PROMOTION_ORDER` enforces topological order** — socios runs first, ctacte runs only after. If socios fails, ctacte is SKIPPED (not silently inserting 0 rows).
2. **Per-domain error reporting** — each domain's `errors[]` array collects FK violations with `source_key` + reason. Operator can inspect `promote.errors` for `ctacte` and decide: (a) re-import socios with the missing keys, (b) accept the orphans as data loss, (c) skip ctacte entirely.
3. **Per-domain isolation** — a failure in `escuela` does NOT block `deportes`, `locacion`, `caja`, `gastos`. Each domain is its own scope.
4. **Bridge validator reuse** — `validateBridges` from `@athlos/import` already detects orphan `CONNROASIE` links. Slice E1a should call `validateBridges` BEFORE promotion and surface the report.

**Residual:** Medium. The operator needs to inspect the errors and decide. Slice E1a's CLI runner should print a clear "promotion of domain X completed with N errors; first 10 errors: ..." summary.

### R2 — Schema mismatch (jsonb strings vs typed columns)

**Scenario:** `payload.SOCFECNACI` is a VFP date string like `"19750315"` (YYYYMMDD format). The Drizzle `fechaNacimiento` column is `timestamp with time zone`. A naive `payload.SOCFECNACI` write fails the date format check. Similarly, `payload.CCTIMPORTE` is a FoxPro numeric (`"12500.00"` with VFP-specific formatting), and `monto` is `NUMERIC(14,2)`. Type coercion must handle every legacy format quirk.

**Likelihood:** High (every domain has at least 2-3 type-mismatch issues). **Impact:** Medium (caught at Zod parse or DB constraint, but noisy logs).

**Mitigations:**

1. **Per-domain transform layer** — each `transforms/<domain>.ts` does explicit type coercion with `parseFecha()`, `parseMonto()`, `parseEstado()` helpers. These throw `BusinessError(VALIDATION)` with the offending `source_key` so the error is traceable.
2. **Vitest fixtures with REAL legacy data** — `packages/promotion/src/__tests__/fixtures/` has JSON snapshots of actual production DBF rows (anonymized). The fixtures match the canonical legacy schema verified during Slice B-7c (`packages/import/src/pipeline.test.ts:24-46`).
3. **Type-safe Zod schemas** — every transform's output is checked against the Drizzle `New<Table>` schema via `z.parse()`. Mismatches are caught at the transform boundary, not at the DB.

**Residual:** Low. The transforms are deterministic and tested.

### R3 — Double-promotion (idempotency)

**Scenario:** Operator runs `pnpm --filter @athlos/promotion promote` twice. Without idempotency, the second run tries to insert 39,357 duplicate `socios.socios` rows. The unique constraint on `numero_socio` rejects them, but the `ON CONFLICT DO NOTHING` semantics are NOT applied here (we're inserting with the full row, not just the key).

**Likelihood:** Certain (the operator WILL re-run after fixing errors). **Impact:** Medium (unique-violation noise, potential performance hit from 39k failed INSERTs).

**Mitigations:**

1. **`promoted_at` column on `raw_events`** (Slice E2 migration 0012) — `promoteDomain` filters `WHERE raw_events.promoted_at IS NULL` to exclude already-promoted rows. On success, `UPDATE raw_events SET promoted_at = now() WHERE id = $1`.
2. **Per-domain UNIQUE constraints** already exist on `socios.numero_socio`, `socios.dni`, `ctacte` (no UNIQUE — only FK), `disciplinas.codigo`. These catch duplicate inserts at the DB level.
3. **`ON CONFLICT DO NOTHING`** on the per-domain INSERTs — `db.insert(masterTable).values(insert).onConflictDoNothing()`. Already inserted rows return zero, do not error.
4. **Idempotency test in TDD** — `promote.test.ts` runs `promoteAll` twice, asserts second run inserts zero new rows.

**Residual:** Low. The `promoted_at` filter + ON CONFLICT are belt-and-suspenders.

### R4 — Performance for 326k ctacte rows

**Scenario:** Promotion of all 326,275 ctacte rows at ~50ms per INSERT (single-row + FK lookup) = ~4.5 hours. Even with batched INSERTs (1000 rows/batch), 326 batches × 200ms = ~65s. The HTTP request from `POST /api/v1/promote/trigger` would time out at the default 60s.

**Likelihood:** Certain (the data is large). **Impact:** Medium (request times out; operator doesn't know if it succeeded).

**Mitigations:**

1. **Batched INSERT** — same pattern as Slice B-7c's `insertRawEventBatch` (`packages/import/src/pipeline.ts:538-552`). 1000-row batches with `INSERT ... VALUES (...), (...), ...` + `ON CONFLICT DO NOTHING`.
2. **Bulk FK lookup** — instead of one `SELECT` per ctacte row, build a `Map<numeroSocio, uuid>` from a single `SELECT id, numeroSocio FROM socios` query (39k rows = 50ms), then lookups are O(1) in memory.
3. **Async promotion** — `POST /api/v1/promote/trigger` returns `202 Accepted` with a `jobId` (mirroring `import/trigger` at `apps/api/src/routes/import.ts:57-62`). The actual promotion runs in a background scheduler job. Operator polls `GET /api/v1/promote/status/:jobId` for progress.
4. **Sync for v1, async in v2** — Slice E1a/E1b use SYNC promotion (run in request thread, 60-90s response). Slice E2 wires the route but accepts the latency. Slice E-Future converts to async via `@athlos/scheduler`.

**Residual:** Medium. Sync promotion works but is slow. Future slice converts to async. The user explicitly asked for manual trigger, so they accept the latency.

### R5 — Missing natural keys for some legacy tables

**Scenario:** Some legacy tables (GASTOS) have NO single-column PK. The composite key is `(GASTIPGAST, GASCTAPRIN, GASSECUENC)`. If the promotion transform doesn't replicate this composite logic, double-INSERTs slip through. Similarly, `CATASTROS` (not in scope for v1) uses `(CATNUMERO, CATITEM)` as composite.

**Likelihood:** Low for v1 (only `gastos` has this issue in the 8 promoted domains). **Impact:** Medium (silent duplicates).

**Mitigations:**

1. **Reuse `composeGastosKey` from `packages/import/src/pipeline.ts:435-440`** — the import phase already solves this. Promotion uses the same composition.
2. **`dedup.ts` per-domain map** — each domain's natural key is centralized in one place:
   ```typescript
   export const NATURAL_KEY = {
     socios: (p) => String(p['SOCCARNET'] ?? ''),
     ctacte: (p) => String(p['CCTNUMERO'] ?? ''),  // implicit via raw_event.id
     // ...
     gastos: (p) => `${p['GASTIPGAST']}-${p['GASCTAPRIN']}-${p['GASSECUENC'] ?? 0}`,
   }
   ```
3. **Test fixtures with explicit double-INSERT cases** — `gastos.test.ts` inserts the same gastos row twice, asserts only one master row exists.

**Residual:** Low. The composite key pattern is well-understood.

### Lesser risks

- **VFP date format quirks** — mitigated by `parseFecha()` helpers that handle `YYYYMMDD`, `MM/DD/YYYY`, and ISO 8601.
- **Encoding issues (Latin-1 vs UTF-8)** — the import phase already handles this (DBF files declare codepage); promotion reads from JSONB which is UTF-8.
- **Memory pressure on 652k raw_events JOIN** — promotion uses `LIMIT batchSize` + cursor pagination, not in-memory joins.
- **PostgreSQL advisory locks** — if two operators trigger promotion simultaneously, both could double-promote. Mitigation: `pg_advisory_lock(hashtext('promotion'))` at the start of `promoteAll`; release at end. Future hardening.

---

## 9. Dependencies (all confirmed shipped)

| Dependency | What Slice E needs from it | Status |
|------------|---------------------------|--------|
| **Slice D** (v0.5.0) | Real `.github/workflows/deploy.yml` (deploy loop closed); `/health/ready` endpoint; `apps/api/src/index.ts` boot pattern | ✅ shipped 2026-06-24 |
| **Slice C** (v0.4.5) | `Dockerfile` + `docker-compose.yml` + `docker-entrypoint.sh` (env-var-driven boot); `BACKUP_BEFORE_MIGRATE` for destructive migration safety | ✅ shipped 2026-06-23 |
| **Slice B-7c** (v0.4.6) | `packages/import/` with `runImport`, `LEGACY_IMPORT_ORDER`, `TABLE_DEPENDENCIES`, `validateBridges`; `composeGastosKey` for composite keys | ✅ shipped 2026-06-18 |
| **Slice 7b.1a** (v0.4.4) | `packages/projection/` with `rebuildProjection`, `DOMAIN_PROJECTION_TABLE`, `computeSaldo` | ✅ shipped |
| **Slice 7b.2** (v0.4.7) | `apps/api/src/routes/import.ts` (`POST /trigger` precedent); `requireRole('ADMIN')` middleware; `apps/api/src/jobs/scheduled-import.ts` (JobHandler pattern) | ✅ shipped |
| **`packages/db`** (v0.5.0) | `createDb({ connectionString })`; Drizzle schemas (socios, tesoreria, deportes); 11 migrations applied | ✅ shipped |
| **`packages/auth`** (v0.5.0) | `requireRole('ADMIN')` from `@athlos/auth/middleware` | ✅ shipped |
| **`packages/errors`** (v0.5.0) | `BusinessError`, `ErrorCode` (VALIDATION_ERROR, NOT_FOUND, CONFLICT) | ✅ shipped |

**No new external dependencies.** Slice E adds zero npm packages, zero Ubuntu packages, zero third-party services. Pure TypeScript + Drizzle.

---

## 10. Out of Scope (deferred to future slices)

Per Slice D's "Out of Scope" section + the parent's roadmap:

1. **Async promotion via scheduler** — sync HTTP for v1; future slice wraps in `@athlos/scheduler.runNow('scheduled-promotion')`.
2. **Rollback endpoint** — manual SQL for v1 (`UPDATE raw_events SET promoted_at = NULL WHERE promoted_at > '2026-06-24'; DELETE FROM socios WHERE created_at > '2026-06-24';`).
3. **Per-row transactional promotion** — per-domain tx only; per-row would block production.
4. **Schema migration of projection payloads** — transforms in TS code; no `*_v2_projection`.
5. **Auto-promotion on import** — manual only for v1; auto ships when transforms are battle-tested.
6. **Promotion of arbitrary user-defined domains** — only the 8 currently in `DOMAIN_PROJECTION_TABLE`.
7. **Multi-environment (staging promotion)** — single env per Slice C ADR.
8. **Web UI for promotion status** — API + runbook is enough for v1.
9. **Diff preview ("show what would change")** — transforms are deterministic; dry-run mode is a future enhancement.
10. **Audit-event emission per promoted row** — `raw_events.promoted_at` is the audit trail.
11. **CONTABLE / CONTABL1 / CATASTROS promotion** — these 3 domains don't have master tables yet (`contabilidad` schema is empty; `catastros` table doesn't exist). Add when the schemas land.
12. **CONNROASIE bridge promotion** — the bridge table doesn't exist in master schema; handled by `validateBridges` in `@athlos/import` (already shipped).
13. **Schema migration to add `promoted_at` as a generated column** — current plan is a nullable column; generated-column approach is a future hardening.
14. **pg_advisory_lock for concurrent-promotion prevention** — current plan is best-effort (re-runs are idempotent); advisory lock is a future hardening.
15. **Per-socio bulk promotion** (one socio + their ctacte) — current plan is per-domain; bulk-socio is a future enhancement for partial re-promotion.
16. **Connection-pooled parallel promotion across domains** — sequential in v1; parallel would saturate the pool.

---

## 11. Acceptance Criteria

A Slice E change is accepted when **all** of the following pass for **each sub-slice** (E1a, E1b, E2):

### 11.1 Build & lint

- [ ] `pnpm install --frozen-lockfile` succeeds
- [ ] `pnpm test:run` passes (468+ vitest cases — current count, plus new ones per sub-slice)
- [ ] `pnpm typecheck` passes (0 errors)
- [ ] `pnpm lint` passes (0 errors, 0 warnings)

### 11.2 TDD discipline (sub-slices E1a + E1b)

- [ ] Test file committed BEFORE implementation (git log shows `test:` commit before `feat:` commit)
- [ ] RED phase verified: `pnpm --filter @athlos/promotion test` fails with the new test cases before implementation
- [ ] GREEN phase verified: same command passes after implementation
- [ ] REFACTOR phase: production code unchanged in behavior, test still passes

### 11.3 Slice E1a acceptance

- [ ] `pnpm --filter @athlos/promotion test` → 5+ tests pass (socios fixture, ctacte fixture without socios → FK error, ctacte fixture with socios → success, idempotency test, PROMOTION_ORDER test)
- [ ] `pnpm --filter @athlos/promotion promote` against test DB succeeds; `socios.socios` has 39,357 rows; `tesoreria.ctacte` has 326,275 rows
- [ ] FK validation: ctacte rows without matching socio are skipped with error reported (not silently inserted with null FK)

### 11.4 Slice E1b acceptance

- [ ] `pnpm --filter @athlos/promotion test` → 8+ tests pass (5 from E1a + 5 new for escuela/deportes/locacion/caja/gastos)
- [ ] Manual smoke run on test DB: all 8 domains either populate or report clean errors

### 11.5 Slice E2 acceptance

- [ ] Migration `0012_promoted_at.sql` applies cleanly (`pnpm --filter @athlos/db migrate`)
- [ ] `POST /api/v1/promote/trigger` (ADMIN) returns 200 with `{ domain, attempted, inserted, skipped, errors, durationMs }`
- [ ] `POST /api/v1/promote/trigger` (non-admin) returns 403
- [ ] Spec sync (B1b LESSON #1, atomic): `diff openspec/specs/deployment-devops/spec.md openspec/changes/athlos-promote-projection-to-master/specs/deployment-devops/spec.md` returns 0 lines

### 11.6 Idempotency (all sub-slices)

- [ ] Running `promoteAll(db)` 3 times produces the same end state (no duplicate master rows)
- [ ] After first run: `SELECT COUNT(*) FROM raw_events WHERE promoted_at IS NOT NULL` = total source rows promoted
- [ ] After second run: same count, zero new inserts

### 11.7 Audit trail (all sub-slices)

- [ ] `SELECT source_table, COUNT(*), COUNT(promoted_at) FROM raw_events GROUP BY source_table` shows promotion status per domain
- [ ] Promotion errors are logged with `source_table`, `source_key`, `reason` for each failed row

### 11.8 Hygiene (B1b LESSONs)

- [ ] No `Co-Authored-By` or AI attribution in any commit message
- [ ] Conventional Commits style throughout
- [ ] Branch from `origin/main`, PR'd back to `main`
- [ ] B1b LESSON #2 applied: `feat/slice-e*` branch merged to main BEFORE `git branch -D`
- [ ] Each sub-slice bumps `package.json` patch version only in the closing `chore(release):` commit
- [ ] `CHANGELOG.md` has a v0.5.1, v0.5.2, v0.5.3 entry under "Released"

### 11.9 Documentation

- [ ] `docs/runbook.md` has a "Promotion" section after "Post-deploy (Import Pipeline)"
- [ ] The section explains: when to promote, how to trigger, FK dependency order, idempotency, manual rollback procedure
- [ ] `docs/runbook.md` does NOT add a "Promotion Pipeline" section that duplicates the spec (the spec is the source of truth; the runbook links to it)

---

## 12. Open Questions

**Q1 — Sub-slicing strategy.** Recommend **3 stacked PRs** (E1a + E1b + E2) under 400 LoC each. Alternative: single PR (~900 LoC, HIGH RISK). Alternative: 2 PRs (E1 combined ~700 LoC, E2 ~177 LoC). User to confirm.

**Q2 — `promoted_at` placement.** Slice E2 plan adds the column to `raw_events`. Alternative: create a separate `promotion_log` table (`raw_event_id`, `promoted_at`, `domain`, `batch_id`). Recommend `raw_events` column (simpler, atomic with row, the column is the audit trail). User can override.

**Q3 — Promotion transactionality.** Slice E1 plan uses per-domain transactions (each domain's rows in one tx; rollback on FK violation). Alternative: per-row (each row in its own tx, slow but fine-grained). Alternative: all-or-nothing (one big tx for all 326k ctacte rows, blocks production on failure). Recommend per-domain.

**Q4 — Sync vs async promotion endpoint.** Slice E2 plan uses sync HTTP (request blocks until promotion completes, ~60-90s). Alternative: async via `@athlos/scheduler.runNow('scheduled-promotion')` (returns 202 + jobId, operator polls status). Recommend sync for v1 (simpler, manual trigger acceptable). Future slice converts to async.

**Q5 — Dry-run mode.** Should `POST /api/v1/promote/trigger` support `dryRun: true` (return counts without inserting)? Recommend: NO for v1 (run `pnpm --filter @athlos/promotion promote --dry` from CLI instead). Future enhancement.

**Default recommendations** (locked if user doesn't override):

1. **Sub-slicing:** 3 PRs (E1a + E1b + E2), each under 400 LoC.
2. **`promoted_at` column on `raw_events`** (not a separate log table).
3. **Per-domain transactions** (not per-row, not all-or-nothing).
4. **Sync HTTP endpoint** for v1; async in future slice.
5. **No dry-run mode** for v1; CLI `--dry` flag is a future enhancement.

If the user wants to override any of these, the proposal phase will reflect the changes.

---

## 13. Source-of-truth file index

| Path | What it tells us |
|------|------------------|
| `openspec/changes/explore-athlos-deploy-slice-d/exploration.md` | Prior exploration; format reference for this document |
| `openspec/changes/athlos-import-completion/tasks.md:1-100` | The 3-PR stacked pattern (7b.1a/7b.1b/7b.2); Slice E follows the same shape |
| `packages/import/src/pipeline.ts:62-77` | `LEGACY_IMPORT_ORDER` — the dependency graph pattern Slice E reuses |
| `packages/import/src/pipeline.ts:435-440` | `composeGastosKey()` — composite key pattern for GASTOS |
| `packages/import/src/pipeline.ts:538-552` | `insertRawEventBatch()` — batched INSERT pattern Slice E reuses |
| `packages/projection/src/rebuild.ts:4-16` | `DOMAIN_PROJECTION_TABLE` — 11 domains; Slice E promotes the 8 with master tables |
| `packages/db/src/schema/socios.ts:29-53` | `socios.socios` schema — promotion target |
| `packages/db/src/schema/tesoreria.ts:43-67` | `tesoreria.ctacte` schema — FK to `socios.id`, promotion target |
| `packages/db/src/schema/deportes.ts:28-96` | `disciplinas`, `ejercicios`, `inscripciones` — deportes promotion target |
| `packages/db/src/schema/public.ts:194-223` | `rawEvents` table — gets `promoted_at` column in Slice E2 |
| `apps/api/src/routes/import.ts:41-63` | `POST /api/v1/import/trigger` — Slice E2's `promote/trigger` mirrors this pattern |
| `apps/api/src/routes/import.ts:114-137` | `GET /api/v1/import/status` — future `GET /api/v1/promote/status` follows same shape |
| `apps/api/src/jobs/scheduled-import.ts:22-79` | `JobHandler` pattern — future async promotion uses this |
| `apps/api/src/routes/socios.ts:143-211` | Manual API writes to `socios.socios` — Slice E promotion fills the same table |
| `apps/api/src/modules/socios/repository.ts:101-117` | `insert()` with `isUniqueViolation` detection — Slice E uses `ON CONFLICT DO NOTHING` instead |
| `packages/auth/src/middleware.ts` | `requireRole('ADMIN')` — Slice E2 reuses for promote route |
| `packages/db/drizzle/0011_audit_idempotency_partial_index.sql:8-9` | Partial unique index pattern — Slice E2's `idx_raw_events_promoted_at` follows the same shape (`WHERE column IS NULL`) |
| `docs/runbook.md` | Runbook structure — Slice E2 adds "Promotion" section after "Post-deploy (Import Pipeline)" |
| `openspec/specs/legacy-import/spec.md:128-139` | `POST /api/v1/import/trigger` requirement — Slice E2's `promote/trigger` spec follows the same shape |
| `openspec/specs/projection-engine/spec.md:79-99` | `Projection Domain Table Map` — Slice E2's spec delta references this map |
| `CHANGELOG.md:5-28` | v0.5.0 entry format — Slice E2 follows the same shape for v0.5.1/0.5.2/0.5.3 entries |
| `legacy-test/SOCIOS.DBF` | Legacy fixture — actual column names verified (SOCCARNET, SOCAPYNOMB, SOCFECNACI, etc.) |
| `legacy-test/CTACTE.DBF` | Legacy ctacte fixture — verified CCTCUENTA, CCTFECHA, CCTDEBEHAB, CCTIMPORTE columns |

---

## 14. Persisted artifacts

- This file: `openspec/changes/explore-athlos-promote-projection-to-master/exploration.md`
- Engram topic key: `sdd/athlos-promote-projection-to-master/explore`
- Engram type: `architecture`
- Engram capture_prompt: `false` (SDD artifact, automated)

**Next step (for the orchestrator):** propose `athlos-promote-projection-to-master` as a 3-stacked-PR SDD change (E1a + E1b + E2), each under 400 LoC, each closing with a `chore(release): v0.5.X` patch bump. Use the B1b LESSON #1 atomic canonical sync in E2's apply phase. The user should confirm the sub-slicing strategy (Q1) and the four default decisions (Q2-Q5) before proposal commits the task list.
