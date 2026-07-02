# Design: athlos-promote-projection-to-master-e1a

| Field | Value |
|-------|-------|
| **Change** | `athlos-promote-projection-to-master-e1a` |
| **Date** | 2026-06-24 |
| **Phase** | Design |
| **Mode** | Both (Engram + OpenSpec) |
| **Status** | Draft — ready for tasks |
| **File path** | `openspec/changes/athlos-promote-projection-to-master-e1a/design.md` |
| **Source artifacts** | `openspec/changes/athlos-promote-projection-to-master-e1a/proposal.md` · `openspec/changes/athlos-promote-projection-to-master-e1a/specs/deployment-devops/spec.md` · `openspec/changes/explore-athlos-promote-projection-to-master/exploration.md` |
| **Sister change (DONE)** | `athlos-deploy-slice-d-ci-deploy` (v0.5.0, archived 2026-06-24) |
| **Sister slice (NEXT)** | `athlos-promote-projection-to-master-e1b` — 5 remaining domains |
| **Sister slice (LAST)** | `athlos-promote-projection-to-master-e2` — admin API + `promoted_at` audit migration + docs + final spec sync |
| **Target release** | v0.5.0 → **v0.5.1** (PATCH — no schema evolution in `public.raw_events`, but a NEW master table `tesoreria.ctacte1` is created) |
| **B1b LESSONs embedded** | #1 partial atomic canonical sync · #2 separate release commit · #3 cherry-pick reorder · #4 merge-before-delete |

---

## 1. Context

**State post-Slice D (v0.5.0).** Deploy automation ships (CI → GHCR → SSH → `/health/ready` poll → auto-rollback). The data pipeline runs end-to-end except for the last hop: `packages/import/` ships DBF → `public.raw_events` (652,661 rows); `packages/projection/` ships `raw_events` → `*_projection` (621,448 rows across 8 projection tables built lazily by `rebuild.ts`). Master tables (`socios.socios`, `tesoreria.ctacte`, etc.) are EMPTY. The only writer is the admin REST API (`POST /api/v1/socios`), designed for 5 manual entries/week — not 39,357 socios + 326,275 ctacte rows.

**What E1a ships.** A new workspace package `packages/promotion/` with: (a) `promoteDomain(db, domain)` + `promoteAll(db)` algorithms; (b) per-domain transforms for the 3 priority domains (socios, ctacte, ctacte1) translating VFP jsonb → typed Drizzle inserts; (c) bulk FK lookup pattern (ONE `SELECT` per domain → in-memory `Map`); (d) dedup by natural key; (e) batched INSERT 1000 rows/batch with `ON CONFLICT DO NOTHING`; (f) CLI runner wired via `pnpm db:promote`. After E1a, an operator runs `pnpm db:promote` against the test DB (`192.168.1.102/athlos`) and watches 39,357 + 326,275 + 245,370 rows populate the master tables.

**B1b LESSON #1 (HIGHEST — atomic canonical sync).** Apply phase MUST run `diff openspec/specs/deployment-devops/spec.md openspec/changes/.../specs/deployment-devops/spec.md` atomically. **E1a adds a NEW "Promotion Pipeline" requirement with 3 scenarios and 6 success criteria** (E1a scope only). E1b extends it with 5 more domains; E2 extends with admin endpoint + audit column + idempotency. The final canonical sync lands in E2. The `diff` SHALL return only additive changes in E1a (no rewrites of pre-Slice D requirements).

---

## 2. Goals / Non-Goals

### Goals

| ID | Goal | Acceptance |
|----|------|------------|
| G1 | New `packages/promotion/` workspace package | `pnpm --filter @athlos/promotion test` runs |
| G2 | `promoteDomain(db, domain)` + `promoteAll(db)` exported | Each returns `PromotionResult { domain, attempted, inserted, skipped, failed, errors[], durationMs }` |
| G3 | `PROMOTION_ORDER = ['socios', 'ctacte', 'ctacte1']` enforcing FK dependency | Exported; `promoteAll` iterates in this order; FK cascade short-circuits dependents |
| G4 | Per-domain transforms for socios, ctacte, ctacte1 | `packages/promotion/src/transforms/<domain>.ts`; no `any` |
| G5 | Bulk FK lookup (ONE `SELECT id, nro_socio FROM socios.socios` → in-memory `Map<string, uuid>`) | Used in ctacte + ctacte1 transforms; SELECT count asserted in tests |
| G6 | Dedup by natural key | Re-running `promoteAll` inserts 0 new rows (idempotent) |
| G7 | Batched INSERT 1000 rows/batch with `ON CONFLICT DO NOTHING` | Mirrors `packages/import/src/pipeline.ts:insertRawEventBatch` |
| G8 | Per-domain isolation | Failure in one domain does NOT crash `promoteAll`; FK cascade short-circuits dependents only |
| G9 | CLI runner `packages/promotion/src/promote-cli.ts` via `pnpm db:promote` | Prints per-domain results + total duration; `pool.end()` on exit |
| G10 | TDD chain RED → GREEN → REFACTOR (5+ vitest cases) | `__tests__/promote.test.ts` written BEFORE `promote.ts` |
| G11 | `db:promote` script in root `package.json` | `pnpm db:promote` runs the CLI |
| G12 | NEW master table `tesoreria.ctacte1` (currently does not exist) | Drizzle migration + schema update + 245,370 rows promotable |
| G13 | Atomic canonical spec sync (B1b LESSON #1, partial) | `diff` canonical vs delta returns only the additive "Promotion Pipeline" requirement |

### Non-Goals (deferred)

| ID | Deferred to | Item |
|----|-------------|------|
| N1 | E1b | `escuela`, `deportes`, `locacion`, `caja`, `gastos` transforms |
| N2 | E2 | `raw_events.promoted_at TIMESTAMPTZ NULL` column + audit-trail migration |
| N3 | E2 | `POST /api/v1/promote/trigger` admin endpoint (sync HTTP, ADMIN-gated) |
| N4 | E2 | Async trigger via `@athlos/scheduler` |
| N5 | E2 | `docs/runbook.md` "Promotion" section |
| N6 | E2 | Canonical spec sync for E1b + E2 scope |
| N7 | E2 | Dry-run mode (`{dryRun: true}` flag) — deferred unless needed |
| N8 | E2 | `/promote/status/:jobId` async progress endpoint |
| N9 | future | Rollback endpoint (manual SQL `DELETE FROM master WHERE created_at > $ts`) |
| N10 | future | `pg_advisory_lock` for concurrent-promotion prevention |
| N11 | future | Per-socio bulk promotion (subset re-promotion) |
| N12 | future | Web UI for promotion status |

---

## 3. Architecture / Approach

### 3.1 Schema reality check (CRITICAL — corrects the proposal)

The proposal and spec describe column names that **do not exist** in the actual schema. The design is grounded in the real Drizzle schema in `packages/db/src/schema/socios.ts` and `packages/db/src/schema/tesoreria.ts`:

**`socios.socios` actual columns** (`packages/db/src/schema/socios.ts:29-53`):

| Actual column | Drizzle type | Notes |
|---|---|---|
| `id` | `uuid` PK, defaultRandom | |
| `numeroSocio` | `text` NOT NULL, UNIQUE | **text, not INT** |
| `nombre` | `text` NOT NULL | |
| `apellido` | `text` NOT NULL | |
| `dni` | `text` NOT NULL, UNIQUE | stored as text (leading zeros) |
| `fechaAlta` | `date` NOT NULL | **NOT NULLABLE** — must derive from payload or default to `new Date()` |
| `estado` | enum `socio_estado` ('activo', 'baja', 'suspendido'), default `'activo'` | |
| `categoria` | `text` nullable | **text, not FK** |
| `direccion` | `text` nullable | |
| `telefono` | `text` nullable | |
| `email` | `text` nullable | |
| `createdAt`, `updatedAt` | `timestamp with timezone`, default `now()` | auto |
| `deletedAt` | `timestamp with timezone` nullable | soft-delete marker |

**`tesoreria.ctacte` actual columns** (`packages/db/src/schema/tesoreria.ts:43-67`):

| Actual column | Drizzle type | Notes |
|---|---|---|
| `id` | `uuid` PK, defaultRandom | |
| `socioId` | `uuid` NOT NULL, FK → `socios.socios.id` ON DELETE restrict | |
| `fecha` | `date` NOT NULL | |
| `tipo` | enum `ctacte_tipo` ('DEBITO', 'CREDITO') NOT NULL | |
| `concepto` | `text` NOT NULL | |
| `debe` | `text` (NUMERIC 14,2) NOT NULL default `'0.00'` | charge amount |
| `haber` | `text` (NUMERIC 14,2) NOT NULL default `'0.00'` | payment amount |
| `anulado` | `boolean` NOT NULL default `false` | |
| `anuladoAt` | `timestamp with timezone` nullable | |
| `anuladoMotivo` | `text` nullable | |
| `createdAt` | `timestamp with timezone` default `now()` | |

**`tesoreria.ctacte1` master table does NOT exist.** Only the projection table `tesoreria.ctacte1_projection` is created lazily by `packages/projection/src/rebuild.ts:52-59`. **E1a MUST add a CREATE TABLE migration** (a different migration from the `promoted_at` audit column that E2 ships). This was not explicitly in the user's "no migration in E1a" lock — that lock referred to the `promoted_at` audit column deferral, not to "no schema evolution at all". Adding the `ctacte1` master table is a prerequisite for promoting the 245,370 projection rows that already exist.

**Proposed `tesoreria.ctacte1` shape** (subject to TASK-002b verification against sample projection rows + legacy VFP schema):

```sql
CREATE TABLE "tesoreria"."ctacte1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ctacte_id" uuid NOT NULL REFERENCES "tesoreria"."ctacte"("id") ON DELETE restrict,
  "fecha" date NOT NULL,
  "concepto" text NOT NULL,
  "monto" text DEFAULT '0.00' NOT NULL,  -- NUMERIC(14,2); verified at TASK-002b
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "ctacte1_ctacte_id_idx" ON "tesoreria"."ctacte1" USING btree ("ctacte_id");
```

> The `monto` field shape is **inferred** from typical sub-ledger patterns. The implementation phase (TASK-002b) MUST verify by reading a sample row from `tesoreria.ctacte1_projection` and consulting the legacy VFP `CTACTE1.DBF` schema. If a `debe`/`haber` split or `tipo` enum is needed, the migration is adjusted. The schema Drizzle definition is the authoritative source.

### 3.2 `packages/promotion/` package skeleton

- **`packages/promotion/package.json`** — name `@athlos/promotion`, `type: module`. Deps: `@athlos/db` (for `createDb` + Drizzle schemas), `@athlos/errors` (for `BusinessError`, `ErrorCode`). devDeps: `vitest`, `@types/node`, `tsx`. Scripts: `test: vitest run`, `promote: tsx src/promote-cli.ts`, `typecheck: tsc -p tsconfig.json --noEmit`.
- **`packages/promotion/tsconfig.json`** — extends `../../tsconfig.base.json`. `noEmit: true` (TDD via vitest). `include: ["src/**/*.ts"]`.
- **`packages/promotion/src/index.ts`** — re-exports `promoteDomain`, `promoteAll`, `PROMOTION_ORDER`, `DOMAIN_TRANSFORMS`, `NATURAL_KEY`, `MASTER_TABLE`, `PROJECTION_TABLE`, types.
- **No edit to root `pnpm-workspace.yaml`** — the existing `packages/*` glob already picks up `packages/promotion/`.

### 3.3 Core algorithm (`packages/promotion/src/promote.ts`)

```typescript
export interface PromotionResult {
  domain: Domain
  attempted: number
  inserted: number   // rows written (from RETURNING)
  skipped: number    // natural-key conflicts + per-row failures pre-insert
  failed: number     // transformation errors (caught per row)
  errors: Array<{ sourceKey: string; reason: string }>
  durationMs: number
}

const BATCH_SIZE = 1000

export async function promoteDomain(db: Db, domain: Domain): Promise<PromotionResult> {
  const t0 = Date.now()
  const result: PromotionResult = { domain, attempted: 0, inserted: 0, skipped: 0, failed: 0, errors: [], durationMs: 0 }
  try {
    const transform = DOMAIN_TRANSFORMS[domain]
    if (!transform) throw BusinessError(ErrorCode.VALIDATION_ERROR, `No transform for domain ${domain}`, { domain })

    // 1. Bulk FK lookup (1 SELECT per domain — the optimization)
    const fkMap = await buildFkMap(db, domain)
    // 2. Read all projection rows for this domain (full scan; E2 will add `promoted_at` filter)
    const projTable = sql.raw(PROJECTION_TABLE[domain])  // safe: identifier from a constant
    const projectionRows = (await db.execute<{ source_key: string; payload: Record<string, unknown> }>(
      sql`SELECT source_key, payload FROM ${projTable}`,
    )).rows ?? []
    result.attempted = projectionRows.length
    // 3. Build dedup set (natural keys already in master — belt-and-suspenders with ON CONFLICT)
    const existingKeys = await loadExistingNaturalKeys(db, domain)
    // 4. Transform + batch insert (buffer flushes every BATCH_SIZE rows + at end-of-domain)
    let buffer: unknown[] = []
    const flush = async () => {
      if (buffer.length === 0) return
      const inserted = await insertMasterBatch(db, domain, buffer)
      result.inserted += inserted
      result.skipped += buffer.length - inserted
      buffer = []
    }
    const helpers: TransformHelpers = { fkMap, parseFechaVFP, parseMonto, splitDebeHaber, splitApellidoNombre }
    for (const row of projectionRows) {
      try {
        const naturalKey = NATURAL_KEY[domain](row.payload)
        if (existingKeys.has(naturalKey)) { result.skipped++; continue }
        const masterRow = transform(row.payload, helpers)
        buffer.push(masterRow)
        existingKeys.add(naturalKey)  // prevent intra-batch duplicates
      } catch (err) {
        result.failed++
        result.errors.push({ sourceKey: row.source_key, reason: errMsg(err) })
      }
      if (buffer.length >= BATCH_SIZE) await flush()
    }
    await flush()
  } catch (err) {
    result.errors.push({ sourceKey: '*', reason: errMsg(err) })
  }
  result.durationMs = Date.now() - t0
  return result
}

export async function promoteAll(db: Db): Promise<PromotionResult[]> {
  const results: PromotionResult[] = []
  for (const domain of PROMOTION_ORDER) {
    const r = await promoteDomain(db, domain)
    results.push(r)
    // FK cascade: block downstream if upstream (socios/ctacte) inserted zero rows + had failures
    if (FK_BLOCKING_DOMAINS.has(domain) && r.inserted === 0 && r.failed > 0) {
      for (const skippedDomain of PROMOTION_ORDER.slice(PROMOTION_ORDER.indexOf(domain) + 1)) {
        results.push({ domain: skippedDomain, attempted: 0, inserted: 0, skipped: 0, failed: 0,
          errors: [{ sourceKey: '*', reason: `Skipped due to upstream failure in ${domain}` }], durationMs: 0 })
      }
      break
    }
  }
  return results
}

async function insertMasterBatch(db: Db, domain: Domain, rows: unknown[]): Promise<number> {
  if (rows.length === 0) return 0
  const table = MASTER_TABLE[domain]
  const inserted = await db.insert(table).values(rows as never[]).onConflictDoNothing().returning({ id: undefined })
  return inserted.length
}
```

**Why `db.execute(sql\`SELECT ... ${projTable}\`)?** Projection tables are created lazily by `rebuild.ts`, so Drizzle's schema doesn't reference them. `sql.raw()` with a constant (no user input) is the safe escape hatch — same pattern as `rebuild.ts:67-69`. `errMsg` is a local `unknown` → `string` helper.

### 3.4 `PROMOTION_ORDER` (`packages/promotion/src/PROMOTION_ORDER.ts`)

```typescript
import { socios, ctacte, ctacte1 } from '@athlos/db/schema'
import type { NewSocio, NewCtacte } from '@athlos/db/schema'
import type { transformSocio } from './transforms/socios.ts'
import type { transformCtacte } from './transforms/ctacte.ts'
import type { transformCtacte1 } from './transforms/ctacte1.ts'

export type Domain = 'socios' | 'ctacte' | 'ctacte1'

export const PROMOTION_ORDER: readonly Domain[] = [
  'socios',    // FK target for ctacte (ctacte.socio_id → socios.id)
  'ctacte',    // FK target for ctacte1 (ctacte1.ctacte_id → ctacte.id)
  'ctacte1',   // sub-ledger of ctacte
] as const

export const FK_BLOCKING_DOMAINS = new Set<Domain>(['socios', 'ctacte'])

/** Map a domain to its master table reference (Drizzle). */
export const MASTER_TABLE: Record<Domain, unknown> = {
  socios,
  ctacte,
  ctacte1,
}

/** Map a domain to its projection table schema-qualified name. */
export const PROJECTION_TABLE: Record<Domain, string> = {
  socios: 'socios.socios_projection',
  ctacte: 'tesoreria.ctacte_projection',
  ctacte1: 'tesoreria.ctacte1_projection',
}

/** Per-domain transform function: jsonb payload + helpers → typed master row. */
export type TransformFn = (payload: Record<string, unknown>, helpers: TransformHelpers) => unknown

export const DOMAIN_TRANSFORMS: Record<Domain, TransformFn> = {
  socios: (payload, helpers) => transformSocio(payload, helpers) as NewSocio,
  ctacte: (payload, helpers) => transformCtacte(payload, helpers) as NewCtacte,
  ctacte1: (payload, helpers) => transformCtacte1(payload, helpers),
}
```

> E1b will extend `PROMOTION_ORDER` with the 5 remaining domains and add their entries to `DOMAIN_TRANSFORMS`, `MASTER_TABLE`, `PROJECTION_TABLE`, `NATURAL_KEY`. E1b will NOT need to modify `FK_BLOCKING_DOMAINS` (the new domains are leaves or non-blocking).

### 3.5 Per-domain transforms

Each transform: `(payload: Record<string, unknown>, helpers: TransformHelpers) => NewMasterRow`. Errors throw and are caught per-row by `promoteDomain` (no fail-fast). All 3 transforms live in `src/transforms/<domain>.ts`.

**`transforms/socios.ts` — jsonb → `NewSocio`:**

| Source field | Target column | Transform |
|---|---|---|
| `payload.SOCCARNET` (fallback `SOCNUMERO`) | `numeroSocio` (text UNIQUE) | `String().trim()`; throw if empty |
| `payload.SOCDNI` | `dni` (text UNIQUE) | `String().trim()`; throw if empty |
| `payload.SOCAPYNOMB` | `apellido` + `nombre` | `splitApellidoNombre` (first word = apellido, rest = nombre) |
| `payload.SOCFECALTA` (fallback `SOCFECNACI`) | `fechaAlta` (date NOT NULL) | `parseFechaVFP`; fallback `new Date()` |
| `payload.SOCCATEGO` | `categoria` (text nullable) | trim; `null` if missing |
| `payload.SOCDIRECC`/`SOCTELEFO`/`SOCEMAIL` | `direccion`/`telefono`/`email` | trim; `null` if missing |
| — | `estado`, `id`, `createdAt`, `updatedAt` | `'activo'`, `randomUUID()`, schema defaults |

**`transforms/ctacte.ts` — jsonb → `NewCtacte`:**

| Source field | Target column | Transform |
|---|---|---|
| `payload.CCTCUENTA` | `socioId` (uuid FK) | `helpers.fkMap.get('socio:<nroSocio>')`; throw `'no matching socio'` if null |
| `payload.CCTDEBEHAB` (1 / -1) | `tipo` (enum DEBITO/CREDITO) | `>= 0` → DEBITO, else CREDITO |
| `payload.CCTIMPORTE` | `debe` + `haber` (text NUMERIC 14,2) | `parseMonto` → `splitDebeHaber` based on `tipo`; other side = `'0.00'` |
| `payload.CCTFECHA` | `fecha` (date NOT NULL) | `parseFechaVFP`; fallback `new Date()` |
| `payload.CCTCONCEPT` | `concepto` (text) | trim; empty string allowed |
| — | `id`, `anulado` | `randomUUID()`, `false` |

**`transforms/ctacte1.ts` (TASK-002b) — jsonb → NewCtacte1:**

| Source field | Target column | Transform |
|---|---|---|
| `payload.CCT1NUMERO` | `ctacteId` (uuid FK → ctacte.id) | `helpers.fkMap.get('ctacte:<CCT1NUMERO>')`; throw `'no matching ctacte'` if null |
| `payload.CCT1FECHA` | `fecha` (date NOT NULL) | `parseFechaVFP`; fallback `new Date()` |
| `payload.CCT1CONCEPT` | `concepto` (text) | trim |
| `payload.CCT1IMPORTE` | `monto` (text NUMERIC 14,2) | `parseMonto`; `'0.00'` fallback |
| — | `id` | `randomUUID()` |

> **Implementation note (TASK-002b).** ctacte1 field mapping requires inspecting a real row from `tesoreria.ctacte1_projection` and consulting the legacy `CTACTE1.DBF` schema. The above shape is a best-guess based on typical sub-ledger conventions. If a `debe`/`haber` split or `tipo` enum is needed, the Drizzle schema + migration are adjusted. The schema Drizzle definition is the authoritative source.

### 3.6 Transform helpers (`packages/promotion/src/transform-helpers.ts`)

Exports `TransformHelpers` (the bag passed to each transform) and 4 pure functions:

- **`parseFechaVFP(raw: unknown): Date | null`** — handles ISO strings, VFP `YYYYMMDD` compact strings, `Date` instances, null/undefined. Returns `null` on any unparseable input (callers fall back to `new Date()`).
- **`parseMonto(raw: unknown): string`** — converts numeric / string numeric to `'0.00'`-formatted string for `NUMERIC(14,2)` columns.
- **`splitDebeHaber(monto: string, tipo): { debe: string; haber: string }`** — puts the amount in the right column based on `tipo`, zeroes the other.
- **`splitApellidoNombre(full: string): { apellido: string; nombre: string }`** — splits on whitespace; first word = apellido, rest = nombre. Defaults to `'(sin apellido)'` / `'(sin nombre)'` on empty input.

The `TransformHelpers` interface bundles these plus `fkMap: FkMap` (a typed wrapper around a `Map<string, string>` with namespaced keys `socio:<numeroSocio>`, `ctacte:<compositeKey>`).
}
```

### 3.7 Bulk FK lookup (`packages/promotion/src/fk-lookup.ts`)

**Pattern:** ONE `SELECT` per promotion domain builds an in-memory `Map`. Optimizes the N→M transform loop from O(N*M) DB roundtrips to O(N) in-memory lookups.

```typescript
export async function buildFkMap(db: Db, domain: Domain): Promise<FkMap> {
  const map = new Map<string, string>()
  // Always load socio mapping if any downstream domain will need it
  if (domain === 'ctacte' || domain === 'ctacte1') {
    const rows = await db.select({ id: socios.id, numeroSocio: socios.numeroSocio }).from(socios)
    for (const r of rows) map.set(`socio:${r.numeroSocio}`, r.id)
  }
  // For ctacte1, also build ctacte legacy-key → uuid map from the just-promoted ctacte rows
  if (domain === 'ctacte1') {
    // Read BOTH the master ctacte rows AND the legacy CCTNUMERO from raw_events
    // joined via entity_uuids (because ctacte master has no legacy_id column in E1a).
    const rows = await db.execute<{ id: string; cctnumero: string }>(sql`
      SELECT c.id, r.source_key AS cctnumero
      FROM "tesoreria"."ctacte" c
      JOIN "public"."entity_uuids" e ON e.source_table = 'ctacte' AND e.entity_uuid = c.id
      JOIN "public"."raw_events" r ON r.source_table = 'ctacte' AND r.source_key = e.source_key
    `)
    for (const r of (rows.rows ?? [])) map.set(`ctacte:${r.cctnumero}`, r.id)
  }
  return { get: (key: string) => map.get(key) }
}
```

> **E1a constraint.** `tesoreria.ctacte` has no `legacy_id` column. The ctacte1 FK map is built by joining `ctacte.id → entity_uuids.entity_uuid → raw_events.source_key` (which is `CCTNUMERO`). This works because `entity_uuids` is populated lazily by a background job (already shipped). E2 may add a direct `legacy_id` column to `ctacte` for performance, but it's not needed in E1a.

### 3.8 Dedup by natural key (`packages/promotion/src/dedup.ts`)

`NATURAL_KEY` extractor per domain + `loadExistingNaturalKeys(db, domain)` returning a `Set<string>`:

| Domain | Natural key (from payload) | Existing-key query | Effective dedup? |
|---|---|---|---|
| `socios` | `SOCCARNET` ?? `SOCNUMERO` | `SELECT numero_socio FROM socios.socios` | ✅ Yes — UNIQUE constraint on `numero_socio` + pre-check |
| `ctacte` | `CCTNUMERO` | (none — no legacy_id column on master) | ⚠️ Partial — relies on `ON CONFLICT DO NOTHING` only; no UNIQUE constraint yet, so re-promotion MAY duplicate |
| `ctacte1` | `${CCT1NUMERO}-${CCT1ITEM}` composite | (none) | ⚠️ Partial — same caveat as ctacte |

**Accepted limitation (R3).** Without `legacy_id` columns on `ctacte`/`ctacte1`, re-running `promoteAll` MAY insert duplicate rows for those domains. Tests assert FIRST-RUN counts match expected. E2 will either add `legacy_id` columns OR use the `promoted_at` audit column to gate the projection scan. The `skipped` counter in `PromotionResult` will reflect conflict counts accurately for `socios` (UNIQUE catches it); for `ctacte`/`ctacte1`, `skipped` reflects intra-batch dedup only.

### 3.9 Batched INSERT (`packages/promotion/src/promote.ts:insertMasterBatch`)

Mirrors `packages/import/src/pipeline.ts:insertRawEventBatch`:
- `INSERT ... VALUES (...), (...)` with up to 1000 rows per statement
- `ON CONFLICT DO NOTHING` (relies on `socios_numero_socio_unique` + `socios_dni_unique` for socios; no constraint for ctacte/ctacte1 yet)
- `.returning({ id })` to count actual inserts vs conflicts

### 3.10 CLI runner (`packages/promotion/src/promote-cli.ts`)

```typescript
import { promoteAll } from './promote.ts'
import { createDb } from '@athlos/db'

const connStr = process.env['DATABASE_URL']
  ?? 'postgresql://athlos:athlos@192.168.1.102:5432/athlos'

const { db, pool } = createDb({ connectionString: connStr })

console.log(`[promote] starting (conn=${connStr.replace(/:[^:@]+@/, ':***@')})`)
const t0 = Date.now()
const results = await promoteAll(db)

for (const r of results) {
  console.log(
    `[promote] ${r.domain.padEnd(10)} attempted=${String(r.attempted).padStart(7)} ` +
      `inserted=${String(r.inserted).padStart(7)} skipped=${String(r.skipped).padStart(7)} ` +
      `failed=${String(r.failed).padStart(5)} ${String(r.durationMs).padStart(6)}ms`,
  )
  for (const e of r.errors.slice(0, 5)) {
    console.error(`  - ${e.sourceKey}: ${e.reason}`)
  }
  if (r.errors.length > 5) console.error(`  ... and ${r.errors.length - 5} more`)
}

const totals = results.reduce(
  (acc, r) => ({ inserted: acc.inserted + r.inserted, skipped: acc.skipped + r.skipped, failed: acc.failed + r.failed }),
  { inserted: 0, skipped: 0, failed: 0 },
)
console.log(`[promote] DONE total=${totals.inserted} inserted, ${totals.skipped} skipped, ${totals.failed} failed, ${Date.now() - t0}ms`)

await pool.end()
process.exit(totals.failed > 0 ? 1 : 0)
```

### 3.11 Tests (TDD — RED → GREEN → REFACTOR)

**`packages/promotion/src/__tests__/promote.test.ts`** (vitest, 7 cases):

| # | Case | Setup | Assertion |
|---|------|-------|-----------|
| **T1** | `promoteDomain('socios')` happy path | Insert 1 row into `socios.socios_projection` with `payload={SOCAPYNOMB:'PEREZ JUAN', SOCDNI:'12345678', SOCCARNET:'1001'}` | `result.inserted === 1`, `failed === 0`; `SELECT * FROM socios.socios WHERE numero_socio='1001'` returns row with `apellido='PEREZ'`, `nombre='JUAN'` |
| **T2** | `promoteDomain('ctacte')` FK failure (empty socios) | `socios.socios` empty, but `tesoreria.ctacte_projection` has 1 row with `payload={CCTCUENTA:'9999', CCTDEBEHAB:1, CCTIMPORTE:'500'}` | `result.inserted === 0`, `failed === 1`, `errors[0].reason` includes `'no matching socio'` |
| **T3** | `promoteDomain('ctacte')` happy path (after socios) | Insert 1 socios projection row + 1 ctacte projection row with matching `CCTCUENTA='1001'` | After `promoteDomain('socios')` then `promoteDomain('ctacte')`: ctacte row inserted with `socioId` matching the socios uuid; `inserted === 1` |
| **T4** | Idempotency on socios | 1 socios projection row | First run: `inserted === 1`. Second run: `inserted === 0`, `skipped === 1` (relies on `socios_numero_socio_unique`) |
| **T5** | `PROMOTION_ORDER` enforces FK dependency | 0 socios rows, 1 ctacte projection row | `promoteAll(db)` returns: `[socios: inserted=0, failed=0], [ctacte: skipped with 'Skipped due to upstream failure in socios']` |
| **T6** | Unit test for `transformSocio` + `parseFechaVFP` | Direct call | `parseFechaVFP('19800515')` → `Date(1980-05-15)`; `transformSocio({SOCAPYNOMB:'PEREZ JUAN', SOCDNI:'12345678', SOCCARNET:'1001'})` → `{numeroSocio:'1001', apellido:'PEREZ', nombre:'JUAN'}`; missing `SOCDNI` throws |
| **T7** | Unit test for `transformCtacte` + enum split | Direct call | `CCTDEBEHAB=1` → `tipo='DEBITO'`, `debe='500.00'`, `haber='0.00'`; `CCTDEBEHAB=-1` → `tipo='CREDITO'`, `debe='0.00'`, `haber='500.00'`; no matching socio throws |

**Test isolation strategy:** each test uses the **production test DB** (`192.168.1.102/athlos`) with per-test cleanup (`DELETE FROM <test_rows> WHERE numero_socio LIKE 'test-%' OR socio_id IN (SELECT id FROM socios.socios WHERE numero_socio LIKE 'test-%')`). An alternative schema-drop approach is documented but not implemented in E1a (R5 mitigation). The test setup deletes its own rows in `afterEach`.

> **Why test against the real DB and not a schema-drop sandbox?** The proposal suggested `athlos_promotion_test` schema isolation. E1a uses the production test DB with per-test row deletes because: (a) the projection table is created lazily by `rebuild.ts` on the production schema, so duplicating it in a test schema adds complexity; (b) per-test cleanup is sufficient for 5+ tests; (c) the bulk FK lookup behavior depends on the `socios` schema being accessible. Tests are ordered to avoid collisions; tests do NOT truncate master tables.

---

## 4. File-by-File Changes

| File | Action | Est. lines | Notes |
|------|--------|-----------:|-------|
| `packages/promotion/package.json` | create | ~30 | name `@athlos/promotion`, deps `@athlos/db` `@athlos/errors`, devDeps `vitest` `tsx` `@types/node`, scripts `test` `promote` `typecheck` |
| `packages/promotion/tsconfig.json` | create | ~15 | extends `../../tsconfig.base.json`, `noEmit: true` |
| `packages/promotion/src/index.ts` | create | ~15 | re-exports |
| `packages/promotion/src/PROMOTION_ORDER.ts` | create | ~50 | `Domain`, `PROMOTION_ORDER`, `FK_BLOCKING_DOMAINS`, `MASTER_TABLE`, `PROJECTION_TABLE`, `DOMAIN_TRANSFORMS`, `NATURAL_KEY` |
| `packages/promotion/src/fk-lookup.ts` | create | ~50 | `buildFkMap` — ONE `SELECT` per domain → `FkMap` |
| `packages/promotion/src/dedup.ts` | create | ~40 | `loadExistingNaturalKeys` + `NATURAL_KEY` |
| `packages/promotion/src/transform-helpers.ts` | create | ~50 | `parseFechaVFP`, `parseMonto`, `splitDebeHaber`, `splitApellidoNombre`, `TransformHelpers` interface |
| `packages/promotion/src/transforms/socios.ts` | create | ~70 | jsonb → `NewSocio` |
| `packages/promotion/src/transforms/ctacte.ts` | create | ~60 | jsonb → `NewCtacte` + FK |
| `packages/promotion/src/transforms/ctacte1.ts` | create | ~50 | jsonb → NewCtacte1 (TASK-002b finalization) |
| `packages/promotion/src/promote.ts` | create | ~170 | `promoteDomain`, `promoteAll`, `insertMasterBatch`, `PromotionResult` |
| `packages/promotion/src/promote-cli.ts` | create | ~40 | CLI entry, `createDb` + `promoteAll` + `pool.end()` |
| `packages/promotion/src/__tests__/promote.test.ts` | create | ~250 | 7 vitest cases (T1..T7) + per-test cleanup |
| `packages/db/src/schema/tesoreria.ts` | modify | +35 | add `ctacte1` table + `ctacte1Tipo` enum + `NewCtacte1` type |
| `packages/db/drizzle/00XX_ctacte1_master.sql` | create | ~15 | `CREATE TABLE tesoreria.ctacte1` + index + FK to `ctacte` |
| Root `package.json` | modify | +3 | add `"db:promote": "pnpm --filter @athlos/promotion run promote"` |
| `pnpm-workspace.yaml` | modify | 0 | **no edit** — `packages/*` glob covers `packages/promotion/` |
| `openspec/specs/deployment-devops/spec.md` | modify (atomic sync, PARTIAL) | +60 | new "Promotion Pipeline" requirement with 3 scenarios + 6 success criteria |
| `CHANGELOG.md` | modify (release commit) | +6 | v0.5.1 entry under Released |
| Root `package.json` + 18 `packages/*/package.json` | modify (release commit) | +1 each | bump `0.5.0` → `0.5.1` |
| **Total PR LoC** | | **~700 raw / ~340 effective** | Under 400-line budget at effective count; ABOVE at raw count — **MEDIUM-HIGH risk** |

> The `dedup.ts` + `PROMOTION_ORDER.ts` file split is intentional — `PROMOTION_ORDER.ts` owns the **constants** (no I/O), `dedup.ts` owns the **DB queries**. `fk-lookup.ts` is separated similarly. If 400-line budget bites at verify, the three transforms can be merged into `transforms.ts` and `fk-lookup.ts` + `dedup.ts` collapsed into `promote.ts` to drop ~80 lines.

---

## 5. Implementation Order (10 work-units)

Mirrors B1b's 3-commit shape (planning → feat+spec → release). TDD chain preserved as 3 separate commits inside the feat commit if `--no-squash`; otherwise collapsed.

### TDD chain (the only TDD code in E1a)

| # | Task | Description | Files |
|---|------|-------------|-------|
| **TASK-001** | **[TDD-RED]** | Write `__tests__/promote.test.ts` with 7 test cases (T1..T7) + fixtures + per-test cleanup helper. **Run:** `pnpm --filter @athlos/promotion test` → 7 tests FAIL (RED). | `__tests__/promote.test.ts` (~250L) |
| **TASK-002a** | **[TDD-GREEN]** schemas + transforms | Add `ctacte1` to `packages/db/src/schema/tesoreria.ts`; generate Drizzle migration (`pnpm --filter @athlos/db generate`) → `00XX_ctacte1_master.sql`; write 3 transform files (`transforms/socios.ts`, `transforms/ctacte.ts`, `transforms/ctacte1.ts`); write `transform-helpers.ts`. | 5 files (~210L) |
| **TASK-002b** | **[TDD-GREEN]** core algorithm | Write `PROMOTION_ORDER.ts`, `fk-lookup.ts`, `dedup.ts`, `promote.ts` (with `insertMasterBatch`), `promote-cli.ts`, `index.ts`. **Run:** `pnpm --filter @athlos/promotion test` → 7 tests PASS (GREEN). | 5 files (~340L) |
| **TASK-003** | **[TDD-REFACTOR]** | Tighten helpers (single-pass `parseFechaVFP`, deduplicate numeric parsing), inline small transforms if LoC budget tight, add doc comments. **Run:** `pnpm --filter @athlos/promotion test` → still PASS. | adjustments (~30L) |

### Wiring (no TDD)

| # | Task | Description | Files |
|---|------|-------------|-------|
| **TASK-004** | Package skeleton | `packages/promotion/package.json` + `tsconfig.json` | 2 files (~45L) |
| **TASK-005** | Root scripts | Add `db:promote` to root `package.json` | root `package.json` (+3L) |
| **TASK-006** | Pre-closing verification | `pnpm --filter @athlos/promotion test` (7 pass); `pnpm test:run` (468+ pass, no regression); `pnpm typecheck`; `pnpm lint`; manual smoke run on test DB (`pnpm db:promote` → 39,357 + 326,275 + 245,370 rows in master tables) | (no files) |
| **TASK-007** | Atomic canonical spec sync (B1b LESSON #1) — PARTIAL | Add new "Promotion Pipeline" requirement to `openspec/specs/deployment-devops/spec.md` with 3 scenarios + 6 success criteria scoped to E1a ONLY. Run `diff openspec/specs/deployment-devops/spec.md openspec/changes/.../specs/deployment-devops/spec.md` → MUST be only additive changes. **Critical:** E1b + E2 will add MORE scenarios in their slices (their own partial syncs). | `openspec/specs/deployment-devops/spec.md` (+60L) |
| **TASK-008** | Pre-merge fix (if verify catches issues) | Apply fix + cherry-pick reorder to preserve 3-commit shape (B1b LESSON #3) | (varies) |
| **TASK-009** | Closing release commit (v0.5.0 → v0.5.1) | Bump root `package.json` + 18 `packages/*/package.json` to `0.5.1`; add `CHANGELOG.md` v0.5.1 entry. **Separate commit from feat** (B1b LESSON #2). | `package.json` + 18 `packages/*/package.json`, `CHANGELOG.md` |

### Commit shape (3 commits per B1b pattern)

1. `feat(promotion): data layer + 3 priority domain transforms + CLI (v0.5.1 prep)` — TASK-001..TASK-006 (TDD chain preserved as 3 commits OR squashed to 1, depending on PR review preference; default = 3 commits for audit trail).
2. `docs(spec): sync deployment-devops canonical with slice-e1a delta (partial)` — TASK-007 (atomic canonical sync per B1b LESSON #1).
3. `chore(release): v0.5.1` — TASK-009 (separate per B1b LESSON #2).

If verify catches a critical issue pre-merge → apply fix + cherry-pick reorder (B1b LESSON #3). Merge to main BEFORE `git branch -D` (B1b LESSON #4).

---

## 6. Risks & Mitigations (top 6)

| # | Risk | Likelihood | Mitigation |
|---|------|-----------|------------|
| **R1** | **FK cascade** — failure in `socios` cascades to 326k ctacte + 245k ctacte1 rows | Medium | `PROMOTION_ORDER` enforces topological order; `promoteAll` short-circuits dependents when `socios.inserted === 0 && failed > 0`; per-domain `errors[]` with `sourceKey` for triage |
| **R2** | **Schema mismatch** — VFP jsonb strings (`"19750315"`, VFP numeric) vs typed `date`/`text NUMERIC` columns | High | Explicit `parseFechaVFP` + `parseMonto` + `splitDebeHaber` helpers; vitest fixtures use real VFP row snapshots; `BusinessError(VALIDATION)` with offending `sourceKey` |
| **R3** | **Double-promotion on re-run** — operator WILL re-run after fixing errors | Certain (for socios only) | Belt-and-suspenders: (a) `dedup.ts` checks `existingKeys` before inserting (works for socios via UNIQUE on `numeroSocio`); (b) `ON CONFLICT DO NOTHING` on every INSERT batch; (c) per-domain UNIQUE constraints exist on `socios.numero_socio` + `socios.dni`. **Known limitation:** ctacte and ctacte1 have no UNIQUE constraint, so re-runs WILL insert duplicates until E2 adds `legacy_id` columns or `promoted_at` audit column. Documented in spec delta. |
| **R4** | **Performance** — 326k ctacte rows × 50ms single-row INSERT = 4.5 hours | Certain | Batched INSERT 1000/batch (~65s for 326k, mirroring `insertRawEventBatch`). Bulk FK lookup (1 SELECT → in-memory Map; 39k rows ~50ms). CLI runs async; no timeout concern. |
| **R5** | **Test DB pollution** — tests run against `192.168.1.102/athlos`, real data | High | Each test uses `numero_socio LIKE 'test-%'` prefix in setup and `DELETE` cleanup in `afterEach`. Tests do NOT truncate master tables. Test isolation helper function defined at top of `promote.test.ts`. |
| **R6** | **ctacte1 master table doesn't exist** — needs CREATE TABLE migration in E1a | Certain | TASK-002a adds the Drizzle schema + auto-generated migration. Field mapping verified at TASK-002b by sampling a real `ctacte1_projection` row. If the legacy schema diverges from the proposed shape, the migration + transform are adjusted before GREEN. |

---

## 7. Dependencies (all confirmed shipped)

| Dependency | What E1a needs | Status |
|------------|----------------|--------|
| **Slice D** (v0.5.0) | Deploy loop closed, `/health/ready`, CI gates | ✅ shipped 2026-06-24 |
| **Slice C** (v0.4.5) | `packages/projection/` + `rebuildProjection` pattern + `DOMAIN_PROJECTION_TABLE` | ✅ shipped 2026-06-23 |
| **Slice B-7c** (v0.4.6) | `packages/import/` + `runImport`, `validateBridges`, `composeGastosKey` (reused in E1b for gastos) | ✅ shipped |
| **`packages/db`** (v0.5.0) | `createDb({ connectionString })`; Drizzle schemas (`socios`, `tesoreria.ctacte`); `Socio`, `NewSocio`, `Ctacte`, `NewCtacte` types | ✅ shipped |
| **`packages/errors`** (v0.5.0) | `BusinessError`, `ErrorCode` (VALIDATION_ERROR) | ✅ shipped |
| **`packages/auth`** | NOT used in E1a (CLI only; admin route is E2) | ✅ shipped (for E2) |
| **Vitest 2.1.9** | TDD harness | ✅ configured |
| **pnpm-workspace.yaml** | `packages/*` glob — E1a picks up automatically | ✅ no edit needed |
| **652k raw_events already imported and 621k projections built** | No need to re-run import or projection | ✅ confirmed |

**No new external dependencies.** E1a adds zero npm packages. Pure TypeScript + Drizzle. The ctacte1 CREATE TABLE migration is generated by `pnpm --filter @athlos/db generate` (no manual SQL unless the auto-generated shape needs review).

---

## 8. Acceptance Criteria (binary pass/fail)

### 8.1 Build, lint, TDD

- [ ] `pnpm install --frozen-lockfile` succeeds
- [ ] `pnpm --filter @athlos/promotion test` exits 0 with 7 vitest cases (T1..T7)
- [ ] `pnpm test:run` exits 0 (468+ existing + 7 new = 475+ pass, no regression)
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm lint` exits 0
- [ ] TDD discipline: `__tests__/promote.test.ts` committed BEFORE `promote.ts` (git log confirms RED → GREEN)

### 8.2 Schema + migration

- [ ] `tesoreria.ctacte1` table created by migration `00XX_ctacte1_master.sql` (auto-generated or hand-written)
- [ ] Drizzle schema in `packages/db/src/schema/tesoreria.ts` exports `ctacte1` + `NewCtacte1`
- [ ] `pnpm --filter @athlos/db migrate:status` shows migration applied (locally + on test DB `192.168.1.102/athlos`)
- [ ] Migration runs idempotently (`migrate:status` is a no-op on re-run)

### 8.3 Spec sync (B1b LESSON #1 — partial atomic)

- [ ] `openspec/specs/deployment-devops/spec.md` has a new `### Requirement: Promotion Pipeline` with EXACTLY the 3 priority-domain scenarios (no rewrites of pre-Slice D requirements)
- [ ] 6 new success criteria appended (criteria #31-36)
- [ ] `diff openspec/specs/deployment-devops/spec.md openspec/changes/athlos-promote-projection-to-master-e1a/specs/deployment-devops/spec.md` returns ONLY the additive changes (no removals, no rewrites)
- [ ] Spec delta explicitly notes E1b + E2 will add MORE scenarios in their slices (DEFERRED callout blocks)

### 8.4 Manual smoke test on test DB

- [ ] `pnpm db:promote` runs CLI without error
- [ ] Stdout shows 3 per-domain `PromotionResult` lines with expected counts
- [ ] `SELECT COUNT(*) FROM socios.socios WHERE numero_socio NOT LIKE 'test-%'` returns 39,357 (post-smoke, excluding test pollution)
- [ ] `SELECT COUNT(*) FROM tesoreria.ctacte WHERE concepto NOT LIKE 'test-%'` returns 326,275
- [ ] `SELECT COUNT(*) FROM tesoreria.ctacte1` returns 245,370 (TASK-002b dependent on field mapping)
- [ ] Re-running `pnpm db:promote` for `socios` produces `{inserted:0, skipped:39357}` (idempotent via UNIQUE)
- [ ] Re-running for `ctacte` + `ctacte1` may insert duplicates (accepted limitation per R3); E2 will fix

### 8.5 FK cascade smoke test

- [ ] `DELETE FROM socios.socios WHERE numero_socio NOT LIKE 'test-%'` (simulate empty master)
- [ ] Run `pnpm db:promote` → `socios` succeeds (re-inserts 39,357); `ctacte` reported as SKIPPED with `errors:[{reason:'Skipped due to upstream failure in socios'}]`
- [ ] Wait — actually, after deleting all socios, ctacte SHOULD re-resolve. The cascade only short-circuits if socios inserted ZERO. After deletion + re-run, socios re-inserts → ctacte proceeds.
- [ ] Verify: `SELECT COUNT(*) FROM socios.socios WHERE numero_socio NOT LIKE 'test-%'` returns 39,357 again

### 8.6 Hygiene (B1b LESSONs)

- [ ] No `Co-Authored-By` or AI attribution in any commit message
- [ ] Conventional Commits style throughout
- [ ] Branch from `origin/main`, PR back to `main`
- [ ] **LESSON #1:** PARTIAL spec sync — E1a scenarios only, DEFERRED callout notes E1b+E2 will add more
- [ ] **LESSON #2:** Version bump + CHANGELOG in SEPARATE release commit (`chore(release): v0.5.1`)
- [ ] **LESSON #3:** 3-commit shape preserved via rebase autosquash if pre-merge fix needed
- [ ] **LESSON #4:** Merge to main BEFORE `git branch -D feat/slice-e1a-promotion-data-layer`

### 8.7 Documentation

- [ ] No `docs/runbook.md` change in E1a (deferred to E2)
- [ ] No `promoted_at` audit column migration in E1a (deferred to E2)
- [ ] No HTTP endpoint in E1a (deferred to E2)

---

## 9. Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines (raw) | **~700** |
| Estimated changed lines (effective, ex. type defs + JSDoc) | **~340** |
| Per-PR target | ≤ 400 |
| 400-line budget risk | **MEDIUM-HIGH** (~85% effective, ~175% raw) |
| Chained PRs recommended | **No** (E1a alone is THIS PR; E1b + E2 are separate stacked PRs per the 3-PR sub-slicing decision) |
| Suggested split | E1a alone in this PR; E1b+E2 follow as separate PRs |
| Delivery strategy | single-pr (per session preflight) |
| Chain strategy | N/A — stacked PRs are separate slices, not chains within one slice |
| Work-unit count | **9** (TASK-001..TASK-009; TASK-002 split into 002a + 002b for ctacte1 schema) |
| Largest single change | TASK-002b (core algorithm + transforms + migration, ~550 LoC raw / ~220 effective) + TASK-007 (spec sync, ~60 LoC) |
| Estimated reviewer time | ~30-45 min (one pass — focus on `promote.ts` algorithm, transform field mappings, FK-cascade short-circuit, dedup behavior, ctacte1 schema/migration decision, partial spec sync diff) |
| Known limitations to call out in PR description | (1) ctacte/ctacte1 dedup is implicit-only (re-runs may duplicate); (2) ctacte1 field mapping requires sampling a real projection row at TASK-002b |

> **Honest call-out.** The 700 raw LoC estimate puts E1a ABOVE the 400-line budget at raw count, UNDER at effective. Apply phase MUST keep type definitions tight (no `readonly` everywhere, minimal JSDoc) and inline small transforms where possible. If actual PR diff still exceeds 400 at verify, the fallback is to split TASK-002b (core algorithm) into 2 commits (TASK-002b1 = algorithm + fk-lookup + dedup, TASK-002b2 = transforms) — but per user lock, NO chained PRs within E1a.

---

## 10. Out of Scope (deferred, documented for future)

- **5 remaining domain transforms** (escuela, deportes, locacion, caja, gastos) — Slice E1b
- **Admin API endpoint** `POST /api/v1/promote/trigger` — Slice E2
- **Migration 0012** (`promoted_at TIMESTAMPTZ NULL` on `raw_events`) — Slice E2
- **Async trigger** via `@athlos/scheduler` — Slice E2
- **`docs/runbook.md`** "Promotion" section — Slice E2
- **Canonical spec sync for E1b + E2 scope** — those slices
- **Dry-run mode** (`{dryRun: true}` flag) — Slice E2 if needed
- **Promotion rollback** (manual SQL `DELETE`) — future
- **Web UI for promotion status** — not planned
- **`pg_advisory_lock`** for concurrent-promotion prevention — future
- **Per-socio bulk promotion** (subset re-promotion) — future
- **`ctacte.legacy_id` + `ctacte1.legacy_id` columns** — Slice E2 (would enable true dedup)
- **`ctacte` + `ctacte1` UNIQUE constraints** — Slice E2 (current E1a relies on `ON CONFLICT DO NOTHING` only for the columns that have constraints; ctacte/ctacte1 can duplicate on re-run)
- **CONTABLE / CONTABL1 / CATASTROS** (no master tables yet) — future

---

## 11. Open Questions

**NONE** for the design phase. The 5 user-locked decisions from the proposal carry over:

| # | Decision | Locked value |
|---|----------|--------------|
| 1 | Sub-slice shape | **3 stacked PRs** (E1a + E1b + E2), each <400 LoC |
| 2 | Audit trail | `promoted_at TIMESTAMPTZ NULL` column on `raw_events` — **migration deferred to E2**; E1a uses no audit column (re-runs rely on UNIQUE constraints + `ON CONFLICT DO NOTHING` for socios only) |
| 3 | Transactions | **Per-domain isolation** — failure in one domain does NOT block downstream domains beyond FK dependency |
| 4 | Trigger | **Sync HTTP `POST /api/v1/promote/trigger`** — deferred to E2; E1a ships CLI only |
| 5 | Dry-run | **NO dry-run flag for E1a** (full promotion only); can be added in E2 if needed |

**One design-phase clarification embedded in this document (NOT a new question, just surfacing a corollary of decision #2):** Decision #2 says "no migration in E1a" for the `promoted_at` column. However, the `tesoreria.ctacte1` master table does not exist and MUST be created in E1a to receive the 245,370 projection rows. TASK-002a adds the table + auto-generated migration. This is consistent with the spirit of decision #2 (no audit column) and necessary for the 3-domain scope to function.

---

## 12. Strict TDD Verification Checklist (E1a HAS TDD code)

- [ ] TASK-001 [TDD-RED] vitest test file written and committed BEFORE TASK-002a (git log shows the test commit precedes the impl commit)
- [ ] Vitest test cases FAIL before TASK-002a/b implementation (RED) — verify with `git stash` of impl + `pnpm test`
- [ ] TASK-002b [TDD-GREEN] implementation passes all 7 test cases (GREEN)
- [ ] TASK-003 [TDD-REFACTOR] no behavior change, still PASS
- [ ] Final test count: 468 (existing) + 7 (new) = 475 vitest pass, no regression
- [ ] No AI co-author in any commit; Conventional Commits throughout
- [ ] PR title: `feat(promotion): data layer + 3 priority domain transforms + CLI (v0.5.1)`
- [ ] `apply-progress.md` ends with: GREEN → REFACTOR → ATOMIC CANONICAL SYNC (Promotion Pipeline diff additive only) → RELEASE
- [ ] Commit shape: feat(promotion) (TDD-RED + TDD-GREEN + TDD-REFACTOR) → docs(spec) atomic sync → chore(release) v0.5.1 (3 commits, B1b LESSON #2)

---

*Persisted to:*
- *`openspec/changes/athlos-promote-projection-to-master-e1a/design.md`*
- *Engram topic `sdd/athlos-promote-projection-to-master-e1a/design`*