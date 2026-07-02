# Tasks: athlos-promote-projection-to-master-e1b2b

## Header

| Field | Value |
|-------|-------|
| **Change** | `athlos-promote-projection-to-master-e1b2b` |
| **Date** | 2026-06-25 |
| **Phase** | Tasks |
| **Mode** | Both (OpenSpec file + Engram topic) |
| **Status** | Ready for apply |
| **File path** | `openspec/changes/athlos-promote-projection-to-master-e1b2b/tasks.md` |
| **Source artifacts** | `openspec/changes/athlos-promote-projection-to-master-e1b2b/design.md` · `openspec/changes/athlos-promote-projection-to-master-e1b2b/specs/deployment-devops/spec.md` |
| **Target release** | v0.5.4 → **v0.5.5** (PATCH — closes Slice E: 8/8 master tables populate + FINAL atomic canonical spec sync) |
| **Commit shape** | 3 commits: `feat(promotion): wire gastos master table (flat ledger, 5-tuple NK)` → `docs(spec): FINAL atomic sync — Promotion Pipeline closes Slice E` → `chore(release): v0.5.5` |
| **TDD chain** | TASK-001 [RED] → TASK-002..005 [GREEN] → TASK-006 [REFACTOR] |

---

## TASK-001 — TDD-RED: Write 2 failing vitest cases T19–T20

| Field | Value |
|-------|-------|
| **ID** | TASK-001 |
| **Type** | `TDD-RED` |
| **Phase** | RED (write tests before implementation) |
| **Dependencies** | None (first task) |
| **Files to modify** | `packages/promotion/src/__tests__/promote.test.ts` |

### What

Write 2 NEW vitest test cases (T19–T20) in `packages/promotion/src/__tests__/promote.test.ts`. Tests use the **production test DB** (`192.168.1.102/athlos`). Per-test cleanup extended to delete from `tesoreria.gastos_projection` + `tesoreria.gastos`.

Both tests will be placed in a **new `describe.skip` block** per E1b2a LESSON re: TRUNCATE bug fix in commit `b26896c`. The REAL gate is `bash scripts/verify-slice.sh`.

### Test cases

| # | Case | Setup | Assertion |
|---|------|-------|-----------|
| **T19** | `promoteDomain('gastos')` happy path | Insert 1 row into `tesoreria.gastos_projection` with 11 fields including `GASTIPGAST=1, GASCTAPRIN=1111001, GASSECUENC=0, GASFECHA='2003-10-15', GASCOMPROB='S/NUMERO', GASIMPORTE='100.00'` | `result.inserted === 1`, `result.failed === 0`; `SELECT * FROM tesoreria.gastos WHERE legacy_id LIKE 'test-%'` returns 1 row; `legacy_id` matches `deterministicUuid('gastos:1|1111001|0|2003-10-15|S/NUMERO')`; 2nd run: `inserted === 0`, `skipped === 1` (idempotent via legacy_id UNIQUE) |
| **T20** | `promoteDomain('gastos')` **5-tuple dedup verified** | Insert 2 rows with SAME 3-tuple `(GASTIPGAST=1, GASCTAPRIN=1111001, GASSECUENC=0)` but DIFFERENT `GASFECHA` and `GASCOMPROB` (different 5-tuple); promote both | `result.inserted === 2`, `result.failed === 0`; both rows present with distinct `legacy_id` (5-tuple UNIQUE catches the 3-tuple collision); explicit assertion that `legacy_id` differs — proves the 5-tuple is correct (NOT 3-tuple) |

### Per-test cleanup extension

Add to `cleanupNewDomainRows()`:

```typescript
// E1b2b: gastos cleanup
await db.execute(sql`DELETE FROM tesoreria.gastos WHERE legacy_id LIKE 'test-%'`)
await db.execute(
  sql`DELETE FROM "public"."tesoreria.gastos_projection" WHERE source_key LIKE 'test-%'`)
```

### Projection table setup extension

Add to `PROJECTION_TABLES` array in `beforeAll`:

```typescript
`"tesoreria"."gastos_projection" (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_table varchar(32) NOT NULL, source_key varchar(64) NOT NULL, payload jsonb NOT NULL, imported_at timestamp with time zone NOT NULL DEFAULT now())`,
```

### New describe.skip block

Add at end of test file (before `afterAll`):

```typescript
// E1b2b: Gastos (tesoreria.gastos — flat expense ledger, 5-tuple NK)
// SKIPPED (2026-06-25): Per E1b2a LESSON (commit b26896c) — destructive TRUNCATE bug fix.
// Tests use `test-%` prefix and per-test cleanup (afterEach). Production data is the
// test data. REAL gate is `bash scripts/verify-slice.sh` which verifies 2,114 rows.
describe.skip('Promotion Pipeline — E1b2b (gastos)', () => {
  // T19 + T20 here
})
```

### Verification step

```bash
pnpm --filter @athlos/promotion test
```
Expected: **2 NEW cases FAIL** (RED) — `transformGastos` / `gastos` domain don't exist yet.

### Commit shape

- **Commit**: `feat(promotion): wire gastos master table (flat ledger, 5-tuple NK)` (part of feat commit)

### Rollback note

Delete the 2 NEW test cases from `describe.skip('Promotion Pipeline — E1b2b (gastos)')` block. Remove the gastos cleanup lines from `cleanupNewDomainRows()` and `PROJECTION_TABLES`.

---

## TASK-002 — TDD-GREEN: Migration 0015 — hand-write + apply via psql

| Field | Value |
|-------|-------|
| **ID** | TASK-002 |
| **Type** | `TDD-GREEN` |
| **Phase** | GREEN |
| **Dependencies** | TASK-001 (tests written — RED phase done) |
| **Files to create** | `packages/db/drizzle/0015_gastos.sql` |
| **Files to modify** | `packages/db/drizzle/meta/_journal.json` |

### What

Hand-write `0015_gastos.sql` (combined migration for `tesoreria.gastos` master table) and apply via `psql` (NOT drizzle-kit per E1b1 LESSON). Update `_journal.json` to add idx 15 entry.

### Files to create

#### `packages/db/drizzle/0015_gastos.sql` (~45L)

Full SQL (from design §4.4):

```sql
-- Migration 0015: tesoreria.gastos master table (E1b2b)
-- 1 NEW master table + 3 UNIQUE INDEXes (legacy_id, 5-tuple composite, cuenta+fecha)
-- + 2 secondary INDEXes for cross-run idempotency.
--
-- Flat expense ledger with optional socio_id FK (deferred to N16).
-- Natural key: 5-tuple (GASTIPGAST, GASCTAPRIN, GASSECUENC, GASFECHA, GASCOMPROB)
--   Verified 2114/2114 distinct = 100% unique (3-tuple yields 346 distinct = 84% dupes).
--
-- Idempotent: re-running is a no-op (CREATE TABLE IF NOT EXISTS,
-- CREATE UNIQUE INDEX IF NOT EXISTS, CREATE INDEX IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS "tesoreria"."gastos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tipo" integer NOT NULL,                              -- GASTIPGAST (1=debit, 2=credit, 3=other)
  "tipo_cuenta" integer NOT NULL,                      -- GASTIPCTA (sentinel 0 for all 2114 rows)
  "cuenta_principal" text NOT NULL,                    -- GASCTAPRIN (accounting-plan code; NOT socio carnet)
  "cuenta_auxiliar" integer,                          -- GASCTAAUXI (auxiliary account; mostly 0)
  "secuencia" integer NOT NULL DEFAULT 0,             -- GASSECUENC (0..8)
  "fecha" date NOT NULL,                               -- GASFECHA
  "comprobante" text NOT NULL DEFAULT '',              -- GASCOMPROB (1/2114 empty)
  "concepto" text,                                    -- GASCONCEPT (free text — operator description)
  "importe" text NOT NULL DEFAULT '0.00',             -- GASIMPORTE (NUMERIC 14,2 stored as text)
  "iva" text DEFAULT '0.00',                          -- GASIVA (NUMERIC 14,2; mostly 0)
  "ingreso_bruto" text,                               -- GASINGBRUT (20-char accounting-grid string)
  "socio_id" uuid,                                   -- FK to socios.socios.id (NULLABLE; deferred to N16)
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

### Files to modify

#### `packages/db/drizzle/meta/_journal.json`

Append new entry at idx 15 (next sequential after 0014):

```json
{
  "idx": 15,
  "version": "7",
  "when": 1782341000000,
  "tag": "0015_gastos",
  "breakpoints": true
}
```

### Verification step

```bash
# Apply migration via psql (NOT drizzle-kit — E1b1 LESSON)
PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -f packages/db/drizzle/0015_gastos.sql

# Verify table exists with 13 columns + 3 UNIQUE INDEXes + 2 INDEXes
PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -c "\d tesoreria.gastos"
# Expected: id (uuid PK), tipo, tipo_cuenta, cuenta_principal, cuenta_auxiliar, secuencia,
#           fecha, comprobante, concepto, importe, iva, ingreso_bruto, socio_id, legacy_id, created_at
#           + gastos_legacy_id_unique, gastos_5tuple_unique, gastos_cuenta_fecha_idx, gastos_socio_id_idx

# Verify idempotent (re-run is a no-op)
PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -f packages/db/drizzle/0015_gastos.sql
# Expected: CREATE TABLE / CREATE INDEX already exist messages (no error)

# Verify journal
jq '.entries[-1]' packages/db/drizzle/meta/_journal.json
# Expected: idx: 15, tag: "0015_gastos"
```

### Commit shape

- **Commit**: `feat(promotion): wire gastos master table (flat ledger, 5-tuple NK)` (part of feat commit)

### Rollback note

```sql
DROP TABLE IF EXISTS tesoreria.gastos CASCADE;
```
And revert `_journal.json` entry for idx 15.

---

## TASK-003 — TDD-GREEN: Schema updates

| Field | Value |
|-------|-------|
| **ID** | TASK-003 |
| **Type** | `TDD-GREEN` |
| **Phase** | GREEN |
| **Dependencies** | TASK-001 (tests written) |
| **Files to modify** | `packages/db/src/schema/tesoreria.ts`, `packages/db/src/schema/index.ts` |

### What

Add `gastos` table + `Gastos` / `NewGastos` types to `tesoreria.ts`. Re-export from `index.ts`.

### Files to modify

#### `packages/db/src/schema/tesoreria.ts` — append `gastos` table

Add after `cajaMovimiento` definition (from design §6.3):

```typescript
/**
 * Flat accounting expense ledger with 5-tuple NK
 * (GASTIPGAST, GASCTAPRIN, GASSECUENC, GASFECHA, GASCOMPROB).
 * Scope correction #C2: 5-tuple verified 2114/2114 = 100% unique
 * (3-tuple = 346 distinct = 84% dupes — would silently lose 1,768 rows).
 * No ctacte FK (#C7: GASCTAPRIN is accounting-plan code, NOT socio carnet).
 * No socio_id FK in v1 (#C8: no source field; socio_id column reserved for N16 backfill).
 * Migration 0015 creates table + 3 UNIQUE INDEXes + 2 secondary INDEXes.
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

#### `packages/db/src/schema/index.ts` — add re-exports

Update the tesoreria re-export:

```typescript
export { tesoreriaSchema, ctacteTipo, ctacte, ctacte1, cajaMovimiento, gastos } from './tesoreria'
export type {
  Ctacte, NewCtacte, Ctacte1, NewCtacte1, CajaMovimiento, NewCajaMovimiento,
  Gastos, NewGastos,  // NEW
} from './tesoreria'
```

### Verification step

```bash
pnpm --filter @athlos/db typecheck
# Expected: exit 0, no type errors
```

### Commit shape

- **Commit**: `feat(promotion): wire gastos master table (flat ledger, 5-tuple NK)` (part of feat commit)

### Rollback note

Revert schema changes in 2 files. Drizzle schema change only — no migration to rollback (migration applied directly via psql in TASK-002).

---

## TASK-004 — TDD-GREEN: Transform `transformGastos`

| Field | Value |
|-------|-------|
| **ID** | TASK-004 |
| **Type** | `TDD-GREEN` |
| **Phase** | GREEN |
| **Dependencies** | TASK-001 (tests written), TASK-003 (schema exists) |
| **Files to create** | `packages/promotion/src/transforms/gastos.ts` |

### What

Create `transforms/gastos.ts` with 5-tuple NK (from design §4.5). No FK lookups (flat ledger). Reuses `parseFechaVFP`, `parseMonto`, `deterministicUuid` from `transform-helpers.ts`.

### File to create

#### `packages/promotion/src/transforms/gastos.ts` (~55L)

Full implementation (from design §4.5):

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

### Verification step

```bash
pnpm --filter @athlos/promotion typecheck
# Expected: exit 0 (after TASK-005 lands — DOMAIN_TRANSFORMS entry needed first)
```

### Commit shape

- **Commit**: `feat(promotion): wire gastos master table (flat ledger, 5-tuple NK)` (part of feat commit)

### Rollback note

Delete `packages/promotion/src/transforms/gastos.ts`. No other files depend on it (DOMAIN_TRANSFORMS entry added in TASK-005).

---

## TASK-005 — TDD-GREEN: Algorithm — extend PROMOTION_ORDER + promote + dedup

| Field | Value |
|-------|-------|
| **ID** | TASK-005 |
| **Type** | `TDD-GREEN` |
| **Phase** | GREEN |
| **Dependencies** | TASK-001 (tests written), TASK-004 (transform exists) |
| **Files to modify** | `packages/promotion/src/PROMOTION_ORDER.ts`, `packages/promotion/src/promote.ts`, `packages/promotion/src/dedup.ts`, `packages/promotion/src/index.ts` |

### What

Extend the promotion algorithm for `gastos`: extend `Domain` union, `PROMOTION_ORDER`, `PROJECTION_TABLE`, `DOMAIN_TRANSFORMS`, `insertMasterBatch` switch, `naturalKey`, and `loadExistingNaturalKeys`.

### Files to modify

#### `packages/promotion/src/PROMOTION_ORDER.ts`

- Extend `Domain` union to include `'gastos'`
- Add `gastos` to `PROMOTION_ORDER` array (6th position: after `caja`, before `ctacte`)
- Add `gastos` entry to `PROJECTION_TABLE` (maps to `tesoreria.gastos_projection`)
- Add `gastos` entry to `DOMAIN_TRANSFORMS` (references `transformGastos`)
- Update JSDoc comment (line 8: "E1b2b will add: gastos" → mark as DONE)

```typescript
// Extend Domain union:
export type Domain = 'socios' | 'ctacte' | 'ctacte1' | 'escuela' | 'deportes' | 'locacion' | 'caja' | 'gastos'

// Extend PROMOTION_ORDER (8 domains now):
export const PROMOTION_ORDER: readonly Domain[] = [
  'socios',
  'escuela',
  'deportes',
  'locacion',
  'caja',
  'gastos',   // NEW (E1b2b): flat ledger, no FK in v1; placed between caja and ctacte
  'ctacte',
  'ctacte1',
] as const

// FK_BLOCKING_DOMAINS unchanged = ['socios', 'ctacte']

// Extend PROJECTION_TABLE:
gastos: { schema: 'public', table: 'tesoreria.gastos_projection' },  // NEW

// Extend DOMAIN_TRANSFORMS:
import { transformGastos } from './transforms/gastos.ts'  // NEW
gastos: transformGastos as TransformFn,  // NEW
```

#### `packages/promotion/src/promote.ts`

- Extend `Domain` union to 8 entries
- Add `gastos` import from `@athlos/db/schema`
- Extend `insertMasterBatch` switch with `gastos` branch

```typescript
// Add import:
import { ..., gastos } from '@athlos/db/schema'  // NEW

// Extend Domain union:
export type Domain = 'socios' | 'ctacte' | 'ctacte1' | 'escuela' | 'deportes' | 'locacion' | 'caja' | 'gastos'

// Extend insertMasterBatch switch:
} else if (domain === 'gastos') {
  inserted = await db
    .insert(gastos)
    .values(rows as unknown as never[])
    .onConflictDoNothing()
    .returning({ id: gastos.id })
}
```

#### `packages/promotion/src/dedup.ts`

- Extend `Domain` union
- Extend `naturalKey` with `gastos` branch (5-tuple)
- Extend `loadExistingNaturalKeys` with `gastos` branch
- Add `gastos` import from `@athlos/db/schema`

```typescript
// Extend Domain union:
export type Domain = 'socios' | 'ctacte' | 'ctacte1' | 'escuela' | 'deportes' | 'locacion' | 'caja' | 'gastos'

// Extend naturalKey:
if (domain === 'gastos') {
  // NEW (E1b2b): 5-tuple (verified 100% unique; 3-tuple had 1,768 duplicates)
  return [
    payload['GASTIPGAST'] ?? '',
    payload['GASCTAPRIN'] ?? '',
    payload['GASSECUENC'] ?? '',
    payload['GASFECHA'] ?? '',
    payload['GASCOMPROB'] ?? '',
  ].join('|')
}

// Extend loadExistingNaturalKeys:
if (domain === 'gastos') {
  const rows = await db
    .select({ legacyId: gastos.legacyId })
    .from(gastos)
    .where(isNotNull(gastos.legacyId))
  return new Set(rows.map((r) => r.legacyId).filter((id): id is string => id !== null))
}
```

#### `packages/promotion/src/index.ts`

Add re-export for `transformGastos`:

```typescript
export { transformGastos } from './transforms/gastos.ts'
```

### Verification step

```bash
pnpm --filter @athlos/promotion typecheck
# Expected: exit 0 (all types resolve)

pnpm --filter @athlos/promotion test
# Expected: T19 + T20 PASS (GREEN) — tests were RED in TASK-001
```

### Commit shape

- **Commit**: `feat(promotion): wire gastos master table (flat ledger, 5-tuple NK)` (part of feat commit)

### Rollback note

Revert changes in 4 algorithm files. No cascade needed.

---

## TASK-006 — TDD-REFACTOR

| Field | Value |
|-------|-------|
| **ID** | TASK-006 |
| **Type** | `TDD-REFACTOR` |
| **Phase** | REFACTOR (tighten helpers, no behavior change) |
| **Dependencies** | TASK-005 (tests green) |
| **Files to modify** | Any in `packages/promotion/src/` |

### What

- Remove any `as any` casts or eslint-disable comments no longer needed after full implementation
- Verify all T19+T20 still pass
- Run full suite

### Verification step

```bash
pnpm --filter @athlos/promotion test
pnpm test:run
pnpm typecheck
pnpm lint
# Expected: all pass
```

### Commit shape

- **Commit**: `feat(promotion): wire gastos master table (flat ledger, 5-tuple NK)` (same feat commit; refactor is cleanup phase within TDD cycle, not a separate commit)

### Rollback note

Refactor only — rollback means reverting to pre-refactor state of the same files.

---

## TASK-007 — Re-promotion smoke test (E1b1/E1b2a LESSON — non-negotiable pre-merge gate)

| Field | Value |
|-------|-------|
| **ID** | TASK-007 |
| **Type** | `verification` |
| **Phase** | smoke test |
| **Dependencies** | TASK-002 (migration applied), TASK-005 (algorithm wired) |
| **Files to modify** | None |

### What

Run the full end-to-end smoke test against `192.168.1.102/athlos`. **CRITICAL: This is the non-negotiable pre-merge gate** (per E1b1/E1b2a LESSON from commit `b26896c`).

**NOTE**: `scripts/verify-slice.sh` is ALREADY updated (commit `061be50` on `main`) — it already includes `tesoreria.gastos` in `MASTER_TABLES` (line 34). Do NOT modify this script.

### Steps

```bash
# 1. Apply migration 0015 via psql (TASK-002 already did this; verify it's applied)
PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -f packages/db/drizzle/0015_gastos.sql
# Expected: CREATE TABLE / CREATE INDEX already exist (idempotent re-run is fine)

# 2. Run verify-slice.sh (the REAL gate — CRITICAL)
bash scripts/verify-slice.sh
# Expected: exit 0 (PASS)
# Output MUST show:
#   - 8 master tables in MASTER_TABLES array
#   - tesoreria.gastos count = 2,114 after 1st promotion run
#   - tesoreria.gastos count unchanged after 2nd run (idempotency)
#   - All other 7 tables Δ=0 between 1st and 2nd run

# If exit != 0: FAIL — surface to orchestrator immediately. Do NOT proceed.
```

### Verification step

All steps above MUST pass. **No merge until `bash scripts/verify-slice.sh` exits 0.**

### Commit shape

No files — verification only. Marks the end of the feat commit work.

### Rollback note

Truncate `tesoreria.gastos` + re-run promotion.

---

## TASK-008 — FINAL atomic canonical spec sync (B1b LESSON #1)

| Field | Value |
|-------|-------|
| **ID** | TASK-008 |
| **Type** | `docs` |
| **Phase** | spec sync |
| **Dependencies** | TASK-007 (smoke test passed) |
| **Files to modify** | `openspec/specs/deployment-devops/spec.md` |

### What

Update the canonical `openspec/specs/deployment-devops/spec.md` to reflect the 8-domain PROMOTION_ORDER. This is the **FINAL atomic spec sync** for Slice E (B1b LESSON #1 — closes Slice E, NOT partial like E1b2a).

### Changes

1. **Update** "Domain promotion order respects FK dependencies" scenario to 8 domains — add `gastos` as 6th position. Keep CLI runner / Batched INSERT / Projection schema-qualified scenarios verbatim.
2. **ADD** 1 NEW requirement: **`tesoreria.gastos` master table** (3 scenarios: table creation via 0015, promotion populates master with 5-tuple NK, re-promotion idempotent).
3. **ADD** 1 NEW scenario: **"Gastos domain promotion (flat expense ledger)"** under the Promotion Pipeline requirement.
4. **ADD** 2 NEW success criteria (#47-48): gastos=2,114 rows verification + verify-slice.sh exits 0.
5. **Document** scope corrections #C2 (5-tuple NK), #C7 (no ctacte FK), #C8 (no socio_id FK) in the E1b2b UPDATE callout.
6. **Extend** E1b2a UPDATE callout to include E1b2b result (8th domain wired, FINAL atomic sync, Slice E closed).
7. **Add** E2 deferred markers (admin API + `promoted_at` + runbook + post-Slice E spec polish).

### Diff verification (CRITICAL — B1b LESSON #1 enforcement)

```bash
diff <(grep -A 500 "Promotion Pipeline" openspec/specs/deployment-devops/spec.md) \
     <(grep -A 500 "Promotion Pipeline" openspec/changes/athlos-promote-projection-to-master-e1b2b/specs/deployment-devops/spec.md) | head -100
```

Expected: **additive-only changes** (~60-100 lines of new spec content). No removals of pre-Slice E scenarios.

If diff shows removals: STOP, surface drift, fix canonical BEFORE proceeding.

### Commit shape

- **Commit**: `docs(spec): FINAL atomic sync — Promotion Pipeline closes Slice E` (2nd commit)

### Rollback note

Revert the rewritten PROMOTION_ORDER scenario + 1 NEW requirement + 1 NEW scenario + 2 NEW success criteria + scope corrections from the canonical spec.

---

## TASK-009 — Pre-merge fix slot (B1b LESSON #3)

| Field | Value |
|-------|-------|
| **ID** | TASK-009 |
| **Type** | `chore` |
| **Phase** | pre-merge |
| **Dependencies** | TASK-008 (spec synced) |
| **Files to modify** | Varies |

### What

Run the full pre-merge checklist. If any check fails, apply fix and cherry-pick reorder to preserve the 3-commit shape.

### Pre-merge checklist

- [ ] `pnpm --filter @athlos/promotion test` → T19+T20 PASS (skipped but present)
- [ ] `pnpm test:run` → full suite (note: pre-existing failures on main are baseline — report but don't fix)
- [ ] `pnpm typecheck` → 0 errors
- [ ] `pnpm lint` → 0 errors
- [ ] TASK-007 `bash scripts/verify-slice.sh` → PASS
- [ ] TASK-008 diff verification → additive-only
- [ ] All new files have conventional commit messages
- [ ] No `Co-Authored-By` in any commit
- [ ] **Merge to `main` BEFORE `git branch -D`** (B1b LESSON #4)

### Commit shape

No new commit if no fix needed. If a fix is applied, cherry-pick reorder to preserve 3-commit shape.

### Rollback note

Revert the applied fix. Re-order commits via rebase if cherry-pick reorder was used.

---

## TASK-010 — Release commit (B1b LESSON #2 + VERSION DRIFT FIX)

| Field | Value |
|-------|-------|
| **ID** | TASK-010 |
| **Type** | `chore` |
| **Phase** | release |
| **Dependencies** | TASK-009 (pre-merge checks green) |
| **Files to modify** | Root `package.json` + `packages/promotion/package.json` + 16 other `packages/*/package.json` + `CHANGELOG.md` |

### What

Bump version from `0.5.3/0.5.0` → `0.5.5` in ALL workspace packages (corrects version drift from E1b2a which tagged v0.5.4 but didn't bump packages). Add CHANGELOG entries for v0.5.5 + backfill v0.5.4 (was missing). **In a SEPARATE commit from the feat commit** (B1b LESSON #2).

### Version bump (ALL 18 packages)

```bash
# Root
# package.json: 0.5.3 → 0.5.5

# packages/promotion/package.json: 0.5.3 → 0.5.5

# 16 other packages (all at 0.5.0 → 0.5.5):
packages/approval/package.json
packages/audit/package.json
packages/auth/package.json
packages/config/package.json
packages/db/package.json
packages/drift/package.json
packages/errors/package.json
packages/freshness/package.json
packages/import/package.json
packages/lineage/package.json
packages/notifications/package.json
packages/projection/package.json
packages/scheduler/package.json
packages/test-builders/package.json
packages/validation/package.json
packages/vitest-config/package.json
```

### CHANGELOG.md additions

Append under `## [0.5.3]` (add 2 new entries):

```markdown
## [0.5.4] — 2026-06-25

### Added

- **4 NEW master tables wired**: `socios.escuela` (66 rows), `deportes.disciplinas` (32 rows), `socios.locacion` (89 rows), `tesoreria.caja_movimiento` (8,145 rows). Total: 8,332 NEW rows via `pnpm db:promote`.
- **Migration `0014_new_masters.sql`**: 3 NEW tables + `legacy_id` columns + 7 UNIQUE INDEXes. Idempotent (IF NOT EXISTS).
- **4 NEW transforms**: `transformEscuela`, `transformDeportes`, `transformLocacion`, `transformCaja`.
- **PROMOTION_ORDER extended to 7 domains**: `['socios', 'escuela', 'deportes', 'locacion', 'caja', 'ctacte', 'ctacte1']`.
- **Dedup + FK lookup extended**: 4 NEW `naturalKey` branches + 4 NEW `loadExistingNaturalKeys` branches.
- **Scope correction #C1**: `escuela` is per-school master with NO `socio_id` FK (verified: 0 projection rows have SOCNUMERO/SOCCARNET fields).
- **Scope correction #C3**: `caja` natural key is **4-tuple** `(CAJNUMERO, CAJSECUENC, CAJFECHA, CAJHORA)`; the 3-tuple silently loses 188 rows (7,957 distinct vs 8,145 total).
- **Cross-run idempotency**: re-running `pnpm db:promote` inserts 0 rows in all 4 NEW domains (via `legacy_id` UNIQUE INDEX + ON CONFLICT DO NOTHING).
- **verify-slice.sh**: NEW post-merge idempotency gate (introduced in commit b26896c).

### Changed

- **`packages/promotion/src/promote.ts`**: cascade short-circuit condition fixed (`inserted === 0 && failed > 0 && failed === attempted`).
- **`packages/promotion/src/fk-lookup.ts`**: replaced stale entity_uuids JOIN with direct `SELECT DISTINCT ON (cctcuenta) cctcuenta, id FROM tesoreria.ctacte`.

### Spec

- `openspec/specs/deployment-devops/spec.md` — atomic sync: PROMOTION_ORDER scenario rewritten to 7 domains + 4 NEW domain scenarios + 10 NEW success criteria (#37-46).

## [0.5.5] — 2026-06-25

### Added

- **`tesoreria.gastos` master table** (E1b2b): flat expense ledger, 2,114 rows, 5-tuple natural key `(GASTIPGAST|GASCTAPRIN|GASSECUENC|GASFECHA|GASCOMPROB)`.
- **Migration `0015_gastos.sql`**: creates `tesoreria.gastos` + 3 UNIQUE INDEXes (legacy_id, 5-tuple composite, cuenta+fecha) + 2 secondary INDEXes. Idempotent.
- **`transformGastos`**: 5-tuple NK transform, no FK lookups (flat ledger).
- **PROMOTION_ORDER extended to 8 domains**: `['socios', 'escuela', 'deportes', 'locacion', 'caja', 'gastos', 'ctacte', 'ctacte1']`.
- **Dedup extended**: `gastos` `naturalKey` (5-tuple) + `loadExistingNaturalKeys` (reads legacy_id from `tesoreria.gastos`).
- **Scope correction #C2**: `gastos` NK is **5-tuple** (verified 2,114/2,114 = 100% unique); 3-tuple yields only 346 distinct (84% dupes — would silently lose 1,768 rows).
- **Scope correction #C7**: `gastos` has NO `ctacte` FK (verified: 0 of 165 distinct GASCTAPRIN match any `tesoreria.ctacte.cctcuenta`; GASCTAPRIN is accounting-plan code, NOT socio carnet).
- **Scope correction #C8**: `gastos` has NO `socio_id` FK in v1 (no source field in 11-field payload; column reserved for future N16 backfill).
- **FINAL atomic canonical spec sync**: `openspec/specs/deployment-devops/spec.md` — 8-domain PROMOTION_ORDER scenario + 1 NEW `gastos` requirement + 1 NEW scenario + 2 NEW success criteria (#47-48). **Slice E closed.**

### Spec

- `openspec/specs/deployment-devops/spec.md` — FINAL atomic sync (B1b LESSON #1): all 8 domains in PROMOTION_ORDER + gastos flat-ledger scenario + scope corrections documented + E2 deferred markers. No further Slice E atomic syncs planned.

### Smoke Test Results (3 runs against 192.168.1.102/athlos test DB)

- **1st run**: gastos inserted=2,114 (all other 7 domains: 0 inserted — already populated from prior slices).
- **2nd run**: all 8 domains → 0 inserted (idempotent via legacy_id UNIQUE). **Idempotency verified.**
- **3rd run**: all 8 domains → 0 inserted. **Idempotency verified.**
- `bash scripts/verify-slice.sh`: **PASS** (exit 0).
```

### Verification step

```bash
git log --oneline -3
# Expected:
# abc1234 chore(release): v0.5.5
# def5678 docs(spec): FINAL atomic sync — Promotion Pipeline closes Slice E
# 9876543 feat(promotion): wire gastos master table (flat ledger, 5-tuple NK)

grep -r '"version"' packages/*/package.json package.json | grep -v 0.5.5
# Expected: 0 output (all packages at 0.5.5)

grep "0.5.5" CHANGELOG.md | wc -l
# Expected: ≥ 2 (entry + reference link)
```

### Commit shape

- **Commit**: `chore(release): v0.5.5` (separate from feat — B1b LESSON #2)

### Rollback note

Revert version changes in all 18 `package.json` files + remove the CHANGELOG entries.

---

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated raw changed lines | **~280** |
| Estimated effective changed lines | **~140** |
| Per-PR target | ≤ 400 |
| 400-line budget risk | **LOW** — ~70% at raw, ~35% at effective |
| Chained PRs recommended | **NO** — fits in single stacked PR |
| Decision needed before apply | **NO** — all decisions locked in design |

### Breakdown by task

| Task | Est. raw | Est. effective |
|------|----------:|----------------:|
| TASK-001 (tests T19-T20) | 60 | 45 |
| TASK-002 (migration 0015) | 60 | 40 |
| TASK-003 (schema updates) | 60 | 40 |
| TASK-004 (transformGastos) | 55 | 40 |
| TASK-005 (algorithm extension) | 50 | 35 |
| TASK-006 (refactor) | 10 | 8 |
| TASK-007 (smoke test) | 0 | 0 |
| TASK-008 (spec sync) | 60 | 50 |
| TASK-009 (pre-merge fix slot) | 0 | 0 |
| TASK-010 (release) | 25 | 20 |
| **Total** | **~280** | **~140** |

---

## LESSONs from E1b1 + B1b (embedded)

| # | LESSON | Where applied |
|---|--------|---------------|
| **E1b1: smoke test non-negotiable** | `bash scripts/verify-slice.sh` MUST run before merge; v0.5.2 shipped broken because smoke was skipped | TASK-007 |
| **E1b1: psql migration** | Migration applied via `psql`, NOT `drizzle-kit migrate` (drizzle-kit tracking mismatches hand-written SQL) | TASK-002 |
| **E1b1: SELECT DISTINCT ON** | `fk-lookup.ts` uses `SELECT DISTINCT ON` for ctacte1 FK lookup — already correct from E1b1; `gastos` has no FK lookups | `fk-lookup.ts` unchanged |
| **B1b LESSON #1 (HIGHEST)** | **FINAL atomic canonical spec sync** — all 8 domains in one atomic update, closes Slice E. NOT partial like E1b2a. | TASK-008 |
| **B1b LESSON #2** | **Separate release commit** — version bump + CHANGELOG in `chore(release): v0.5.5`, NOT in the feat commit | TASK-010 |
| **B1b LESSON #3** | **Pre-merge fix slot** — if verify catches issue, fix + cherry-pick reorder to preserve 3-commit shape | TASK-009 |
| **B1b LESSON #4** | **Merge before delete** — merge feature branch to `main` BEFORE `git branch -D` | TASK-009 pre-merge checklist |

---

## Commit shape summary

```
Commit 1: feat(promotion): wire gastos master table (flat ledger, 5-tuple NK)
  ├── TASK-001 (TDD-RED): tests T19-T20 written (describe.skip)
  ├── TASK-002 (TDD-GREEN): migration 0015 hand-written + applied via psql
  ├── TASK-003 (TDD-GREEN): schema updates (tesoreria.ts + index.ts)
  ├── TASK-004 (TDD-GREEN): transformGastos created
  ├── TASK-005 (TDD-GREEN): algorithm extension (PROMOTION_ORDER + promote + dedup)
  ├── TASK-006 (TDD-REFACTOR): tighten helpers
  └── TASK-007 (smoke test): bash scripts/verify-slice.sh PASS

Commit 2: docs(spec): FINAL atomic sync — Promotion Pipeline closes Slice E
  └── TASK-008: canonical spec sync (8 domains + gastos requirement + scope corrections)

Commit 3: chore(release): v0.5.5
  └── TASK-010: version bump ALL packages to 0.5.5 + CHANGELOG (v0.5.5 + v0.5.4 backfill)

# TASK-009 is a fix slot (no commit if no fix needed)
```

---

## Version Drift Note (TASK-010 corrects E1b2a gap)

E1b2a tagged git commit v0.5.4 but did NOT bump `package.json` versions. After E1b2a:
- Root `package.json`: **0.5.3** (should be 0.5.4)
- `packages/promotion/package.json`: **0.5.3** (should be 0.5.4)
- 16 other packages: **0.5.0** (should be 0.5.4)

TASK-010 bumps ALL to **0.5.5** in one release commit, correcting the accumulated drift.

---

*Persisted to:*
- *`openspec/changes/athlos-promote-projection-to-master-e1b2b/tasks.md`*
- *Engram topic `sdd/athlos-promote-projection-to-master-e1b2b/tasks` (via `mem_save`)*
