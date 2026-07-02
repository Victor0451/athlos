# Tasks: athlos-promote-projection-to-master-e1b2a

## Header

| Field | Value |
|-------|-------|
| **Change** | `athlos-promote-projection-to-master-e1b2a` |
| **Date** | 2026-06-25 |
| **Phase** | Tasks |
| **Mode** | Both (OpenSpec file + Engram topic) |
| **Status** | Ready for apply |
| **File path** | `openspec/changes/athlos-promote-projection-to-master-e1b2a/tasks.md` |
| **Source artifacts** | `openspec/changes/athlos-promote-projection-to-master-e1b2a/design.md` |
| **Target release** | v0.5.3 → **v0.5.4** (PATCH) |
| **Commit shape** | 3 commits: `feat(promotion): wire 4 NEW master tables` → `docs(spec): atomic sync` → `chore(release): v0.5.4` |
| **TDD chain** | TASK-001 [RED] → TASK-002..005 [GREEN] → TASK-006 [REFACTOR] |

---

## TASK-001 — TDD-RED: Write 6 failing vitest cases T13–T18

| Field | Value |
|-------|-------|
| **ID** | TASK-001 |
| **Type** | `TDD-RED` |
| **Phase** | RED (write tests before implementation) |
| **Dependencies** | None (first task) |
| **Files to create/modify** | `packages/promotion/src/__tests__/promote.test.ts` |

### What

Write 6 NEW vitest test cases (T13–T18) in `packages/promotion/src/__tests__/promote.test.ts`. Tests use the **production test DB** (`192.168.1.102/athlos`). Per-test cleanup via `afterEach` extended to delete from the 4 NEW master tables + projection tables.

### Test cases

| # | Case | Setup | Assertion |
|---|------|-------|-----------|
| **T13** | `promoteDomain('escuela')` happy path | Insert 1 row into `socios.escuela_projection` with `payload={ESCCODIGO:99, ESCNOMBRE:'TEST ESCUELA', ESCESTADO:'S', ESCDEPORTE:1}` | `result.inserted === 1`, `result.failed === 0`; `SELECT * FROM socios.escuela WHERE codigo=99` returns row with `nombre='TEST ESCUELA'`, `estado='S'`, `deporte_codigo=1`; `legacy_id` matches `deterministicUuid('escuela:99')` |
| **T14** | `promoteDomain('deportes')` happy path | Insert 1 row into `deportes.deportes_projection` with `payload={DEPCODIGO:99, DEPNOMBRE:'TEST DEPORTE'}` | `result.inserted === 1`; `SELECT codigo, nombre FROM deportes.disciplinas WHERE codigo='99'` returns row; `legacy_id` matches `deterministicUuid('deporte:99')` |
| **T15** | `promoteDomain('locacion')` happy path + empty `cuenta_principal` sentinel | Insert 2 rows: one with `LCNCTAPRIN:'1111004', LCNNUMERO:99`; another with `LCNCTAPRIN:'', LCNNUMERO:100, LCNNOMBRE:'TEST'` | `result.inserted === 2`, `result.failed === 0`; both rows present with distinct `legacy_id` (composite NK); empty `LCNCTAPRIN` promoted as `''` (no FK violation) |
| **T16** | `promoteDomain('caja')` happy path + **4-tuple dedup** | Insert 2 rows with SAME 3-tuple `(numero=99, secuencia=0, fecha='2024-01-01')` but DIFFERENT `hora` (`0` and `1`); promote both | `result.inserted === 2`, `result.failed === 0`; both rows present with distinct `legacy_id` (4-tuple catches the 3-tuple collision); explicit assertion that `legacy_id` differs (`UNIQUE` constraint proves the 4-tuple is correct) |
| **T17** | Cross-domain idempotency (3 sequential runs) | Run `promoteAll` 3× against the test DB | 1st run: `inserted > 0` for the 4 NEW domains (66 + 32 + 89 + 8,145 = 8,332 total NEW); 2nd + 3rd runs: `inserted === 0` for all 4 NEW domains (idempotent via legacy_id UNIQUE) |
| **T18** | `PROMOTION_ORDER` independence (school failure does not short-circuit siblings) | Insert 1 failing escuela row (e.g., `ESCNOMBRE=''` triggers NOT NULL violation); run `promoteAll` | `escuela.result.failed === 1`; `deportes.result.attempted > 0` (NOT skipped); `locacion.result.attempted > 0` (NOT skipped); `caja.result.attempted > 0` (NOT skipped); `FK_BLOCKING_DOMAINS` unchanged = `['socios', 'ctacte']` |

### Per-test cleanup extension

```typescript
async function cleanupNewDomainRows() {
  await db.execute(sql`DELETE FROM socios.escuela WHERE legacy_id LIKE 'test-%'`)
  await db.execute(sql`DELETE FROM socios.locacion WHERE legacy_id LIKE 'test-%'`)
  await db.execute(sql`DELETE FROM tesoreria.caja_movimiento WHERE legacy_id LIKE 'test-%'`)
  await db.execute(sql`DELETE FROM deportes.disciplinas WHERE legacy_id LIKE 'test-%'`)
  await db.execute(sql`DELETE FROM socios.escuela_projection WHERE source_key LIKE 'test-%'`)
  await db.execute(sql`DELETE FROM socios.locacion_projection WHERE source_key LIKE 'test-%'`)
  await db.execute(sql`DELETE FROM tesoreria.caja_projection WHERE source_key LIKE 'test-%'`)
  await db.execute(sql`DELETE FROM deportes.deportes_projection WHERE source_key LIKE 'test-%'`)
}
```

### Projection table setup extension

Add 4 NEW projection table creates to `beforeAll`:

```typescript
const NEW_PROJECTION_TABLES = [
  `"socios"."escuela_projection" (...)`,
  `"socios"."locacion_projection" (...)`,
  `"tesoreria"."caja_projection" (...)`,
  `"deportes"."deportes_projection" (...)`,
]
```

### Verification step

```bash
pnpm --filter @athlos/promotion test
```
Expected: **6 NEW cases FAIL** (RED) — modules/tables/transforms don't exist yet.

### Commit shape

- **Commit**: `feat(promotion): write TDD tests for 4 NEW domains T13–T18 (RED)` (part of `feat(promotion)` commit)

### Rollback note

Delete the 6 NEW test cases from `packages/promotion/src/__tests__/promote.test.ts`. No other files depend on them.

---

## TASK-002 — TDD-GREEN: Migration 0014 — hand-write + apply via psql

| Field | Value |
|-------|-------|
| **ID** | TASK-002 |
| **Type** | `TDD-GREEN` |
| **Phase** | GREEN (implementation to make tests pass) |
| **Dependencies** | TASK-001 (tests written — RED phase done) |
| **Files to create** | `packages/db/drizzle/0014_new_masters.sql` |
| **Files to modify** | `packages/db/drizzle/meta/_journal.json` |

### What

Hand-write `0014_new_masters.sql` (combined migration for 4 NEW master tables) and apply via `psql` (NOT drizzle-kit per E1b1 LESSON). Update `_journal.json` to add idx 14 entry.

### Files to create

#### `packages/db/drizzle/0014_new_masters.sql` (~80L)

Full SQL (from design §4.4 + §6.1):

```sql
-- Migration 0014: Add 4 NEW master tables (3 CREATE TABLE + 1 EXISTING populated)
-- + legacy_id columns + UNIQUE INDEXes for cross-run idempotency.
--
-- Idempotent: re-running is a no-op.
--
-- escuela: per-school master (NO socio_id FK per scope correction #C1).
-- disciplinas: table already exists; migration adds legacy_id column + UNIQUE INDEX.
-- locacion: per-socio address with composite NK (LCNCTAPRIN, LCNNUMERO).
-- caja_movimiento: cash movement header with 4-tuple NK (CAJNUMERO, CAJSECUENC, CAJFECHA, CAJHORA).

-- ─── escuela ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "socios"."escuela" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "codigo" integer NOT NULL,
  "nombre" text NOT NULL,
  "deporte_codigo" integer,
  "estado" varchar(1) NOT NULL,
  "cuota_social" numeric(14,2),
  "cobertura" numeric(14,2),
  "contribucion" numeric(14,2),
  "importe_escolar" numeric(14,2),
  "otro_contrib" numeric(14,2),
  "clave_inscripcion" numeric(14,2),
  "fecha_escolar" date,
  "entrenador_codigo" integer,
  "escuela_numero" integer,
  "instructor" text,
  "legacy_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "escuela_codigo_unique"
  ON "socios"."escuela" ("codigo");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "escuela_legacy_id_unique"
  ON "socios"."escuela" ("legacy_id");
--> statement-breakpoint

-- ─── disciplinas (table exists; add legacy_id column + UNIQUE INDEX) ──────────
ALTER TABLE "deportes"."disciplinas" ADD COLUMN IF NOT EXISTS "legacy_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "disciplinas_legacy_id_unique"
  ON "deportes"."disciplinas" ("legacy_id");
--> statement-breakpoint

-- ─── locacion ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "socios"."locacion" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "cuenta_principal" text NOT NULL,
  "cuenta_secundaria" text,
  "numero" integer NOT NULL,
  "calle" text,
  "barrio" integer,
  "piso" text,
  "puerta" integer,
  "departamento" text,
  "anexo1" integer,
  "anexo2" integer,
  "nombre" text NOT NULL,
  "dni" integer,
  "cuit" integer,
  "telefono" integer,
  "fecha_nacimiento" date,
  "fecha_baja" date,
  "situacion_iva" integer,
  "cuota" numeric(14,2),
  "legacy_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "locacion_cuenta_principal_numero_unique"
  ON "socios"."locacion" ("cuenta_principal", "numero");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "locacion_legacy_id_unique"
  ON "socios"."locacion" ("legacy_id");
--> statement-breakpoint

-- ─── caja_movimiento ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "tesoreria"."caja_movimiento" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "numero" integer NOT NULL,
  "secuencia" integer NOT NULL,
  "fecha" date NOT NULL,
  "hora" integer NOT NULL,
  "tip" integer,
  "descrip" text,
  "legacy_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "caja_movimiento_numero_secuencia_fecha_hora_unique"
  ON "tesoreria"."caja_movimiento" ("numero", "secuencia", "fecha", "hora");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "caja_movimiento_legacy_id_unique"
  ON "tesoreria"."caja_movimiento" ("legacy_id");
```

### Files to modify

#### `packages/db/drizzle/meta/_journal.json`

Add entry at idx 14:

```json
{
  "idx": 14,
  "version": "7",
  "when": 1782350000000,
  "tag": "0014_new_masters",
  "breakpoints": true
}
```

### Verification step

```bash
# Apply migration via psql (NOT drizzle-kit — E1b1 LESSON)
PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -f packages/db/drizzle/0014_new_masters.sql

# Verify 3 NEW tables exist
PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -c "\dt socios.escuela socios.locacion tesoreria.caja_movimiento"
# Expected: 3 rows showing the new tables

# Verify disciplinas has legacy_id column
PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -c "\d deportes.disciplinas"
# Expected: legacy_id text column + disciplinas_legacy_id_unique index

# Verify idempotent (re-run is a no-op)
PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -f packages/db/drizzle/0014_new_masters.sql
# Expected: CREATE TABLE / CREATE INDEX already exist messages (no error)

# Verify journal
jq '.entries[-1]' packages/db/drizzle/meta/_journal.json
# Expected: idx: 14, tag: "0014_new_masters"
```

### Commit shape

- **Commit**: `feat(promotion): wire 4 NEW master tables (escuela, deportes, locacion, caja)` (part of `feat(promotion)` commit)

### Rollback note

Run `DROP TABLE IF EXISTS socios.escuela, socios.locacion, tesoreria.caja_movimiento CASCADE; ALTER TABLE deportes.disciplinas DROP COLUMN IF EXISTS legacy_id;` and revert `_journal.json`.

---

## TASK-003 — TDD-GREEN: Schema updates

| Field | Value |
|-------|-------|
| **ID** | TASK-003 |
| **Type** | `TDD-GREEN` |
| **Phase** | GREEN |
| **Dependencies** | TASK-001 (tests written) |
| **Files to create** | None |
| **Files to modify** | `packages/db/src/schema/socios.ts`, `packages/db/src/schema/deportes.ts`, `packages/db/src/schema/tesoreria.ts`, `packages/db/src/schema/index.ts` |

### What

Update 3 schema files to add `escuela` + `locacion` (socios.ts), `legacyId` on existing `disciplinas` (deportes.ts), `cajaMovimiento` (tesoreria.ts). Re-export from index.ts.

### Files to modify

#### `packages/db/src/schema/socios.ts` — append `escuela` + `locacion` tables

Add after `socios` table definition (from design §6.3):

```typescript
export const escuela = sociosSchema.table(
  'escuela',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codigo: integer('codigo').notNull(),
    nombre: text('nombre').notNull(),
    deporteCodigo: integer('deporte_codigo'),
    estado: varchar('estado', { length: 1 }).notNull(),
    cuotaSocial: numeric('cuota_social', { precision: 14, scale: 2 }),
    cobertura: numeric('cobertura', { precision: 14, scale: 2 }),
    contribucion: numeric('contribucion', { precision: 14, scale: 2 }),
    importeEscolar: numeric('importe_escolar', { precision: 14, scale: 2 }),
    otroContrib: numeric('otro_contrib', { precision: 14, scale: 2 }),
    claveInscripcion: numeric('clave_inscripcion', { precision: 14, scale: 2 }),
    fechaEscolar: date('fecha_escolar'),
    entrenadorCodigo: integer('entrenador_codigo'),
    escuelaNumero: integer('escuela_numero'),
    instructor: text('instructor'),
    legacyId: text('legacy_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    codigoUnique: uniqueIndex('escuela_codigo_unique').on(table.codigo),
    legacyIdUnique: uniqueIndex('escuela_legacy_id_unique').on(table.legacyId),
  }),
)

export type Escuela = typeof escuela.$inferSelect
export type NewEscuela = typeof escuela.$inferInsert

export const locacion = sociosSchema.table(
  'locacion',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cuentaPrincipal: text('cuenta_principal').notNull(),
    cuentaSecundaria: text('cuenta_secundaria'),
    numero: integer('numero').notNull(),
    calle: text('calle'),
    barrio: integer('barrio'),
    piso: text('piso'),
    puerta: integer('puerta'),
    departamento: text('departamento'),
    anexo1: integer('anexo1'),
    anexo2: integer('anexo2'),
    nombre: text('nombre').notNull(),
    dni: integer('dni'),
    cuit: integer('cuit'),
    telefono: integer('telefono'),
    fechaNacimiento: date('fecha_nacimiento'),
    fechaBaja: date('fecha_baja'),
    situacionIva: integer('situacion_iva'),
    cuota: numeric('cuota', { precision: 14, scale: 2 }),
    legacyId: text('legacy_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    cuentaPrincipalNumeroUnique: uniqueIndex('locacion_cuenta_principal_numero_unique')
      .on(table.cuentaPrincipal, table.numero),
    legacyIdUnique: uniqueIndex('locacion_legacy_id_unique').on(table.legacyId),
  }),
)

export type Locacion = typeof locacion.$inferSelect
export type NewLocacion = typeof locacion.$inferInsert
```

#### `packages/db/src/schema/deportes.ts` — add `legacyId` to `disciplinas`

Modify `disciplinas` table: add `legacyId: text('legacy_id')` field + `legacyIdUnique` UNIQUE INDEX.

```typescript
export const disciplinas = deportesSchema.table(
  'disciplinas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codigo: text('codigo').notNull(),
    nombre: text('nombre').notNull(),
    legacyId: text('legacy_id'),   // NEW
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    codigoUnique: uniqueIndex('disciplinas_codigo_unique').on(table.codigo),
    legacyIdUnique: uniqueIndex('disciplinas_legacy_id_unique').on(table.legacyId),   // NEW
  }),
)
```

#### `packages/db/src/schema/tesoreria.ts` — append `cajaMovimiento`

Add `cajaMovimiento` table (import `integer` from drizzle-orm/pg-core if not present):

```typescript
export const cajaMovimiento = tesoreriaSchema.table(
  'caja_movimiento',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    numero: integer('numero').notNull(),
    secuencia: integer('secuencia').notNull(),
    fecha: date('fecha').notNull(),
    hora: integer('hora').notNull(),
    tip: integer('tip'),
    descrip: text('descrip'),
    legacyId: text('legacy_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    numeroSecuenciaFechaHoraUnique: uniqueIndex('caja_movimiento_numero_secuencia_fecha_hora_unique')
      .on(table.numero, table.secuencia, table.fecha, table.hora),
    legacyIdUnique: uniqueIndex('caja_movimiento_legacy_id_unique').on(table.legacyId),
  }),
)

export type CajaMovimiento = typeof cajaMovimiento.$inferSelect
export type NewCajaMovimiento = typeof cajaMovimiento.$inferInsert
```

#### `packages/db/src/schema/index.ts` — add re-exports

```typescript
export { sociosSchema, socioEstado, socios, escuela, locacion } from './socios'
export type { Socio, NewSocio, Escuela, NewEscuela, Locacion, NewLocacion } from './socios'

// tesoreria section — add cajaMovimiento:
export { tesoreriaSchema, ctacteTipo, ctacte, ctacte1, cajaMovimiento } from './tesoreria'
export type { Ctacte, NewCtacte, Ctacte1, NewCtacte1, CajaMovimiento, NewCajaMovimiento } from './tesoreria'

// deportes section — unchanged (disciplinas already exported; legacyId added in-place)
```

### Verification step

```bash
pnpm --filter @athlos/db typecheck
# Expected: exit 0, no type errors
```

### Commit shape

- **Commit**: `feat(promotion): wire 4 NEW master tables (escuela, deportes, locacion, caja)` (part of `feat(promotion)` commit)

### Rollback note

Revert schema changes in 4 files. Drizzle schema change only — no migration to rollback (migration applied directly via psql in TASK-002).

---

## TASK-004 — TDD-GREEN: 4 transform files

| Field | Value |
|-------|-------|
| **ID** | TASK-004 |
| **Type** | `TDD-GREEN` |
| **Phase** | GREEN |
| **Dependencies** | TASK-001 (tests written), TASK-003 (schema exists) |
| **Files to create** | `packages/promotion/src/transforms/escuela.ts`, `packages/promotion/src/transforms/deportes.ts`, `packages/promotion/src/transforms/locacion.ts`, `packages/promotion/src/transforms/caja.ts` |

### What

Create 4 NEW transform files following the existing pattern from `transforms/socios.ts`, `transforms/ctacte.ts`, `transforms/ctacte1.ts`.

### Files to create

#### `packages/promotion/src/transforms/escuela.ts` (~50L)

Full implementation (from design §4.5):

```typescript
import { randomUUID } from 'node:crypto'
import type { NewEscuela } from '@athlos/db/schema'
import type { TransformHelpers } from '../transform-helpers.ts'

export function transformEscuela(
  payload: Record<string, unknown>,
  helpers: TransformHelpers,
): NewEscuela {
  const { parseFechaVFP, parseMonto, deterministicUuid } = helpers

  const codigo = Number(payload['ESCCODIGO'] ?? 0)
  if (!codigo) throw new Error('Empty ESCCODIGO')

  const nombre = String(payload['ESCNOMBRE'] ?? '').trim()
  if (!nombre) throw new Error('Empty ESCNOMBRE')

  const estadoRaw = String(payload['ESCESTADO'] ?? '').trim()
  if (estadoRaw !== 'S' && estadoRaw !== 'N') throw new Error(`Invalid ESCESTADO: ${estadoRaw}`)

  return {
    id: randomUUID(),
    codigo,
    nombre,
    deporteCodigo: payload['ESCDEPORTE'] ? Number(payload['ESCDEPORTE']) : null,
    estado: estadoRaw,
    cuotaSocial: payload['ESCCUOSOC'] ? parseMonto(payload['ESCCUOSOC']) : null,
    cobertura: payload['ESCCOBERTU'] ? parseMonto(payload['ESCCOBERTU']) : null,
    contribucion: payload['ESCCONTRIB'] ? parseMonto(payload['ESCCONTRIB']) : null,
    importeEscolar: payload['ESCIMPESC'] ? parseMonto(payload['ESCIMPESC']) : null,
    otroContrib: payload['ESCOTRCONT'] ? parseMonto(payload['ESCOTRCONT']) : null,
    claveInscripcion: payload['ESCCLAVINS'] ? parseMonto(payload['ESCCLAVINS']) : null,
    fechaEscolar: payload['ESCFESCAG'] ? parseFechaVFP(payload['ESCFESCAG']) : null,
    entrenadorCodigo: payload['ESCENTRENA'] ? Number(payload['ESCENTRENA']) : null,
    escuelaNumero: payload['ESCESCUELA'] ? Number(payload['ESCESCUELA']) : null,
    instructor: payload['ESCINSTRUC'] ? String(payload['ESCINSTRUC']).trim() || null : null,
    legacyId: deterministicUuid(`escuela:${codigo}`),
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}
```

#### `packages/promotion/src/transforms/deportes.ts` (~30L)

```typescript
import { randomUUID } from 'node:crypto'
import type { NewDisciplina } from '@athlos/db/schema'
import type { TransformHelpers } from '../transform-helpers.ts'

export function transformDeportes(
  payload: Record<string, unknown>,
  helpers: TransformHelpers,
): NewDisciplina {
  const { deterministicUuid } = helpers

  // VFP DEPCODIGO is numeric; schema disciplinas.codigo is text. Coerce.
  const codigo = String(payload['DEPCODIGO'] ?? '').trim()
  if (!codigo) throw new Error('Empty DEPCODIGO')

  const nombre = String(payload['DEPNOMBRE'] ?? '').trim()
  if (!nombre) throw new Error('Empty DEPNOMBRE')

  return {
    id: randomUUID(),
    codigo,
    nombre,
    legacyId: deterministicUuid(`deporte:${codigo}`),
    createdAt: new Date(),
  }
}
```

#### `packages/promotion/src/transforms/locacion.ts` (~55L)

```typescript
import { randomUUID } from 'node:crypto'
import type { NewLocacion } from '@athlos/db/schema'
import type { TransformHelpers } from '../transform-helpers.ts'

export function transformLocacion(
  payload: Record<string, unknown>,
  helpers: TransformHelpers,
): NewLocacion {
  const { parseFechaVFP, parseMonto, deterministicUuid } = helpers

  const cuentaPrincipal = String(payload['LCNCTAPRIN'] ?? '').trim()
  // Empty '' is allowed (15/89 rows); FK constraint NOT enforced in v1.0

  const numero = Number(payload['LCNNUMERO'] ?? 0)
  if (!numero) throw new Error('Empty LCNNUMERO')

  const nombre = String(payload['LCNNOMBRE'] ?? '').trim()
  if (!nombre) throw new Error('Empty LCNNOMBRE')

  return {
    id: randomUUID(),
    cuentaPrincipal,
    cuentaSecundaria: payload['LCNCTASECU'] ? String(payload['LCNCTASECU']).trim() || null : null,
    numero,
    calle: payload['LCNCALLE'] ? String(payload['LCNCALLE']).trim() || null : null,
    barrio: payload['LCNBARRIO'] ? Number(payload['LCNBARRIO']) : null,
    piso: payload['LCNPISO'] ? String(payload['LCNPISO']).trim() || null : null,
    puerta: payload['LCNPUERTA'] ? Number(payload['LCNPUERTA']) : null,
    departamento: payload['LCNDEPARTA'] ? String(payload['LCNDEPARTA']).trim() || null : null,
    anexo1: payload['LCNANEXO1'] ? Number(payload['LCNANEXO1']) : null,
    anexo2: payload['LCNANEXO2'] ? Number(payload['LCNANEXO2']) : null,
    nombre,
    dni: payload['LCNDNI'] ? Number(payload['LCNDNI']) : null,
    cuit: payload['LCNCUIT'] ? Number(payload['LCNCUIT']) : null,
    telefono: payload['LCNTE'] ? Number(payload['LCNTE']) : null,
    fechaNacimiento: payload['LCNFECNACI'] ? parseFechaVFP(payload['LCNFECNACI']) : null,
    fechaBaja: payload['LCNFECBAJA'] ? parseFechaVFP(payload['LCNFECBAJA']) : null,
    situacionIva: payload['LCNSITUIVA'] ? Number(payload['LCNSITUIVA']) : null,
    cuota: payload['LCNCUOTA'] ? parseMonto(payload['LCNCUOTA']) : null,
    legacyId: deterministicUuid(`locacion:${cuentaPrincipal}|${numero}`),
    createdAt: new Date(),
  }
}
```

#### `packages/promotion/src/transforms/caja.ts` (~50L)

```typescript
import { randomUUID } from 'node:crypto'
import type { NewCajaMovimiento } from '@athlos/db/schema'
import type { TransformHelpers } from '../transform-helpers.ts'

export function transformCaja(
  payload: Record<string, unknown>,
  helpers: TransformHelpers,
): NewCajaMovimiento {
  const { parseFechaVFP, deterministicUuid } = helpers

  const numero = Number(payload['CAJNUMERO'] ?? 0)
  if (!numero) throw new Error('Empty CAJNUMERO')

  const secuencia = Number(payload['CAJSECUENC'] ?? 0)
  const hora = Number(payload['CAJHORA'] ?? 0)   // CRITICAL for 4-tuple NK

  const fecha = parseFechaVFP(payload['CAJFECHA'] ?? null)
  if (!fecha) throw new Error('Unparseable CAJFECHA')

  return {
    id: randomUUID(),
    numero,
    secuencia,
    fecha,
    hora,
    tip: payload['CAJTIP'] ? Number(payload['CAJTIP']) : null,
    descrip: payload['CAJDESCRIP']
      ? String(payload['CAJDESCRIP']).trim() || null
      : null,
    legacyId: deterministicUuid(`caja:${numero}|${secuencia}|${fecha}|${hora}`),
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

- **Commit**: `feat(promotion): wire 4 NEW master tables (escuela, deportes, locacion, caja)` (part of `feat(promotion)` commit)

### Rollback note

Delete 4 transform files. No other files depend on them (DOMAIN_TRANSFORMS map entry added in TASK-005).

---

## TASK-005 — TDD-GREEN: Algorithm — extend PROMOTION_ORDER + promote + dedup

| Field | Value |
|-------|-------|
| **ID** | TASK-005 |
| **Type** | `TDD-GREEN` |
| **Phase** | GREEN |
| **Dependencies** | TASK-001 (tests written), TASK-004 (transforms exist) |
| **Files to create** | None |
| **Files to modify** | `packages/promotion/src/PROMOTION_ORDER.ts`, `packages/promotion/src/promote.ts`, `packages/promotion/src/dedup.ts`, `packages/promotion/src/index.ts` |

### What

Extend the promotion algorithm for 4 NEW domains: extend `Domain` union, `PROMOTION_ORDER`, `PROJECTION_TABLE`, `DOMAIN_TRANSFORMS`, `insertMasterBatch` switch, `naturalKey`, and `loadExistingNaturalKeys`.

### Files to modify

#### `packages/promotion/src/PROMOTION_ORDER.ts`

Extend `Domain` union, `PROMOTION_ORDER`, `FK_BLOCKING_DOMAINS`, `PROJECTION_TABLE`, `DOMAIN_TRANSFORMS` (from design §4.6):

```typescript
// Extend Domain union:
export type Domain =
  | 'socios' | 'ctacte' | 'ctacte1'
  | 'escuela' | 'deportes' | 'locacion' | 'caja'

// Extend PROMOTION_ORDER:
export const PROMOTION_ORDER: readonly Domain[] = [
  'socios', 'escuela', 'deportes', 'locacion', 'caja', 'ctacte', 'ctacte1',
] as const

// FK_BLOCKING_DOMAINS unchanged:
export const FK_BLOCKING_DOMAINS: readonly Domain[] = ['socios', 'ctacte']

// Extend PROJECTION_TABLE:
export const PROJECTION_TABLE: Record<Domain, { schema: string; table: string }> = {
  socios: { schema: 'public', table: 'socios.socios_projection' },
  escuela: { schema: 'public', table: 'socios.escuela_projection' },
  deportes: { schema: 'public', table: 'deportes.deportes_projection' },
  locacion: { schema: 'public', table: 'socios.locacion_projection' },
  caja: { schema: 'public', table: 'tesoreria.caja_projection' },
  ctacte: { schema: 'public', table: 'tesoreria.ctacte_projection' },
  ctacte1: { schema: 'public', table: 'tesoreria.ctacte1_projection' },
}

// Extend DOMAIN_TRANSFORMS:
import { transformEscuela } from './transforms/escuela.ts'
import { transformDeportes } from './transforms/deportes.ts'
import { transformLocacion } from './transforms/locacion.ts'
import { transformCaja } from './transforms/caja.ts'

export const DOMAIN_TRANSFORMS: Record<Domain, TransformFn> = {
  socios: transformSocio as TransformFn,
  escuela: transformEscuela as TransformFn,
  deportes: transformDeportes as TransformFn,
  locacion: transformLocacion as TransformFn,
  caja: transformCaja as TransformFn,
  ctacte: transformCtacte as TransformFn,
  ctacte1: transformCtacte1 as TransformFn,
}
```

#### `packages/promotion/src/promote.ts`

- Extend `Domain` union to 7 entries
- Extend `insertMasterBatch` switch with 4 NEW branches for `escuela`, `deportes`, `locacion`, `caja`
- Add imports for `escuela`, `locacion`, `disciplinas`, `cajaMovimiento` from `@athlos/db/schema`

```typescript
// Add imports:
import { socios, ctacte, ctacte1, escuela, locacion, disciplinas, cajaMovimiento } from '@athlos/db/schema'

// Extend Domain union:
export type Domain = 'socios' | 'ctacte' | 'ctacte1' | 'escuela' | 'deportes' | 'locacion' | 'caja'

// Extend insertMasterBatch switch:
if (domain === 'escuela') {
  inserted = await db.insert(escuela).values(rows as unknown as never[]).onConflictDoNothing()
    .returning({ id: escuela.id })
} else if (domain === 'deportes') {
  inserted = await db.insert(disciplinas).values(rows as unknown as never[]).onConflictDoNothing()
    .returning({ id: disciplinas.id })
} else if (domain === 'locacion') {
  inserted = await db.insert(locacion).values(rows as unknown as never[]).onConflictDoNothing()
    .returning({ id: locacion.id })
} else if (domain === 'caja') {
  inserted = await db.insert(cajaMovimiento).values(rows as unknown as never[]).onConflictDoNothing()
    .returning({ id: cajaMovimiento.id })
}
// ... existing ctacte + ctacte1 branches unchanged
```

#### `packages/promotion/src/dedup.ts`

- Extend `Domain` union
- Extend `naturalKey` with 4 NEW branches
- Extend `loadExistingNaturalKeys` with 4 NEW branches
- Add imports for `escuela`, `locacion`, `disciplinas`, `cajaMovimiento`

```typescript
// Imports:
import { ctacte, ctacte1, socios, escuela, locacion, disciplinas, cajaMovimiento } from '@athlos/db/schema'

// Extend Domain union:
export type Domain = 'socios' | 'ctacte' | 'ctacte1' | 'escuela' | 'deportes' | 'locacion' | 'caja'

// Extend naturalKey:
if (domain === 'escuela') return String(payload['ESCCODIGO'] ?? '')
if (domain === 'deportes') return String(payload['DEPCODIGO'] ?? '')
if (domain === 'locacion') {
  return [payload['LCNCTAPRIN'] ?? '', payload['LCNNUMERO'] ?? ''].join('|')
}
if (domain === 'caja') {
  return [
    payload['CAJNUMERO'] ?? '',
    payload['CAJSECUENC'] ?? '',
    payload['CAJFECHA'] ?? '',
    payload['CAJHORA'] ?? '',
  ].join('|')
}

// Extend loadExistingNaturalKeys:
if (domain === 'escuela') {
  const rows = await db.select({ legacyId: escuela.legacyId }).from(escuela)
    .where(isNotNull(escuela.legacyId))
  return new Set(rows.map((r) => r.legacyId).filter((id): id is string => id !== null))
}
if (domain === 'deportes') {
  const rows = await db.select({ legacyId: disciplinas.legacyId }).from(disciplinas)
    .where(isNotNull(disciplinas.legacyId))
  return new Set(rows.map((r) => r.legacyId).filter((id): id is string => id !== null))
}
if (domain === 'locacion') {
  const rows = await db.select({ legacyId: locacion.legacyId }).from(locacion)
    .where(isNotNull(locacion.legacyId))
  return new Set(rows.map((r) => r.legacyId).filter((id): id is string => id !== null))
}
if (domain === 'caja') {
  const rows = await db.select({ legacyId: cajaMovimiento.legacyId }).from(cajaMovimiento)
    .where(isNotNull(cajaMovimiento.legacyId))
  return new Set(rows.map((r) => r.legacyId).filter((id): id is string => id !== null))
}
```

#### `packages/promotion/src/index.ts`

Add re-exports for 4 NEW transforms:

```typescript
export { transformEscuela } from './transforms/escuela.ts'
export { transformDeportes } from './transforms/deportes.ts'
export { transformLocacion } from './transforms/locacion.ts'
export { transformCaja } from './transforms/caja.ts'
```

### Verification step

```bash
pnpm --filter @athlos/promotion test
# Expected: T13-T18 PASS (all 6 GREEN)
```

### Commit shape

- **Commit**: `feat(promotion): wire 4 NEW master tables (escuela, deportes, locacion, caja)` (part of `feat(promotion)` commit)

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
- Ensure all 6 NEW tests still pass
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

- **Commit**: `feat(promotion): wire 4 NEW master tables (escuela, deportes, locacion, caja)` (same feat commit; refactor is cleanup phase within TDD cycle, not a separate commit)

### Rollback note

Refactor only — rollback means reverting to pre-refactor state of the same files.

---

## TASK-007 — Re-promotion smoke test (E1b1 LESSON — non-negotiable pre-merge gate)

| Field | Value |
|-------|-------|
| **ID** | TASK-007 |
| **Type** | `verification` |
| **Phase** | smoke test |
| **Dependencies** | TASK-002 (migration applied), TASK-005 (algorithm wired) |
| **Files to modify** | None |

### What

Run the full end-to-end smoke test against `192.168.1.102/athlos`. **CRITICAL: This is the non-negotiable pre-merge gate** (E1b1's v0.5.2 shipped broken because smoke was skipped).

### Steps

```bash
# 1. Truncate test DB master tables (fresh start)
PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -c "
  TRUNCATE TABLE tesoreria.caja_movimiento, socios.locacion, socios.escuela, deportes.disciplinas CASCADE;
"

# 2. Verify idempotency of migration re-run
PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -f packages/db/drizzle/0014_new_masters.sql

# 3. First promotion run
DATABASE_URL="postgresql://athlos:athlos@192.168.1.102:5432/athlos" pnpm db:promote
# Expected stdout: escuela inserted=66, deportes inserted=32, locacion inserted=89, caja inserted=8145

# 4. Second promotion run (idempotency check)
DATABASE_URL="postgresql://athlos:athlos@192.168.1.102:5432/athlos" pnpm db:promote
# Expected: all 4 NEW domains inserted=0 (idempotent via legacy_id UNIQUE)

# 5. Third promotion run (idempotency check)
DATABASE_URL="postgresql://athlos:athlos@192.168.1.102:5432/athlos" pnpm db:promote
# Expected: all 4 NEW domains inserted=0

# 6. Verify master counts
PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -c "
  SELECT 'escuela' as domain, count(*) as rows FROM socios.escuela
  UNION ALL SELECT 'deportes', count(*) FROM deportes.disciplinas
  UNION ALL SELECT 'locacion', count(*) FROM socios.locacion
  UNION ALL SELECT 'caja', count(*) FROM tesoreria.caja_movimiento;
"
# Expected: escuela=66, deportes=32, locacion=89, caja=8145
```

### Verification step

All 6 steps above MUST pass. Do NOT proceed to TASK-008 without a passing smoke test.

### Commit shape

No files — verification only. Marks the end of the feat commit work.

### Rollback note

Truncate tables + re-run promotion.

---

## TASK-008 — Atomic canonical spec sync (B1b LESSON #1)

| Field | Value |
|-------|-------|
| **ID** | TASK-008 |
| **Type** | `docs` |
| **Phase** | spec sync |
| **Dependencies** | TASK-007 (smoke test passed) |
| **Files to modify** | `openspec/specs/deployment-devops/spec.md` |

### What

Update the canonical `openspec/specs/deployment-devops/spec.md` to reflect the 4 NEW domains wired in E1b2a. This is a **PARTIAL** atomic sync — E1b2b adds `gastos`; E2 adds admin API + `promoted_at` + final sync.

### Changes

1. **Rewrite** "Domain promotion order respects FK dependencies" scenario to list 7 domains instead of 3.
2. **ADD** 4 NEW domain scenarios (escuela, deportes, locacion, caja) under the "Promotion Pipeline" requirement.
3. **ADD** 10 NEW success criteria (#45-54) for the 4 NEW domains + cross-run idempotency.
4. **ADD** inline notes for scope decisions (#C1, #C3).

### Diff verification (CRITICAL — B1b LESSON #1 enforcement)

```bash
diff <(grep -A 200 "Promotion Pipeline" openspec/specs/deployment-devops/spec.md) \
     <(grep -A 200 "Promotion Pipeline" openspec/changes/athlos-promote-projection-to-master-e1b2a/specs/deployment-devops/spec.md) | head -50
```

Expected: **empty output** (only additive changes + 1 PROMOTION_ORDER scenario rewrite, no removals).

If diff is NOT empty: STOP, surface drift, fix canonical BEFORE proceeding.

### Commit shape

- **Commit**: `docs(spec): atomic sync — Promotion Pipeline with 4 NEW domains`

### Rollback note

Revert the rewritten PROMOTION_ORDER scenario and 4 NEW domain scenarios + 10 NEW criteria from the canonical spec.

---

## TASK-009 — Pre-closing verification (B1b LESSON #3)

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

- [ ] `pnpm --filter @athlos/promotion test` → 13+ tests pass (7 existing E1a + 6 NEW E1b2a)
- [ ] `pnpm test:run` → full suite (note: 5 pre-existing failures on main are baseline — report but don't fix)
- [ ] `pnpm typecheck` → 0 errors
- [ ] `pnpm lint` → 0 errors
- [ ] TASK-007 smoke test → PASS
- [ ] TASK-008 diff verification → empty
- [ ] All new files have conventional commit messages
- [ ] No `Co-Authored-By` in any commit
- [ ] **Merge to `main` BEFORE `git branch -D`** (B1b LESSON #4)

### Commit shape

No new commit if no fix needed. If a fix is applied, cherry-pick reorder to preserve 3-commit shape.

### Rollback note

Revert the applied fix. Re-order commits via rebase if cherry-pick reorder was used.

---

## TASK-010 — Release commit (B1b LESSON #2)

| Field | Value |
|-------|-------|
| **ID** | TASK-010 |
| **Type** | `chore` |
| **Phase** | release |
| **Dependencies** | TASK-009 (pre-merge checks green) |
| **Files to modify** | Root `package.json`, 19 `packages/*/package.json`, `CHANGELOG.md` |

### What

Bump version from `0.5.3` → `0.5.4` and add CHANGELOG entry. **In a SEPARATE commit from the feat commit** (B1b LESSON #2).

### Changes

#### Root `package.json`

```json
{ "version": "0.5.4" }
```

#### Each workspace package (`packages/*/package.json`)

Update `"version"` field to `"0.5.4"` in each of the 19 workspace packages.

#### `CHANGELOG.md`

Append under the `## Released` header:

```markdown
## v0.5.4 (2026-06-25) — E1b2a: Promotion Pipeline — 4 NEW master tables

**Adds:** `socios.escuela`, `deportes.disciplinas` (populated), `socios.locacion`, `tesoreria.caja_movimiento` master tables.
**Schema:** `0014_new_masters.sql` creates 3 NEW tables + adds `legacy_id` columns + 7 UNIQUE INDEXes (idempotent).
**Promotion:** 8,332 NEW rows promoted (66 escuela + 32 deportes + 89 locacion + 8,145 caja).
**Cross-run idempotency:** re-running `pnpm db:promote` inserts 0 rows in the 4 NEW domains (via `legacy_id` UNIQUE INDEX).
**Scope correction #C1:** escuela is per-school master with NO `socio_id` FK.
**Scope correction #C3:** caja natural key is 4-tuple `(CAJNUMERO, CAJSECUENC, CAJFECHA, CAJHORA)`; the 3-tuple would silently lose 188 rows.
```

### Verification step

```bash
git log --oneline -3
# Expected:
# abc1234 chore(release): v0.5.4
# def5678 docs(spec): atomic sync — Promotion Pipeline with 4 NEW domains
# 9876543 feat(promotion): wire 4 NEW master tables (escuela, deportes, locacion, caja)
```

### Commit shape

- **Commit**: `chore(release): v0.5.4` (separate from feat — B1b LESSON #2)

### Rollback note

Revert version changes in all 19 `package.json` files + remove the CHANGELOG entry.

---

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated raw changed lines | **~700** |
| Estimated effective changed lines | **~280** |
| Per-PR target | ≤ 400 effective |
| 400-line budget risk | **LOW** — effective (~280) is well under 400 |
| Chained PRs recommended | **NO** — 3-commit shape with effective ~280 LoC fits in single stacked PR |
| Decision needed before apply | **NO** — all decisions locked in design |

### Breakdown by task

| Task | Est. raw | Est. effective |
|------|----------|----------------|
| TASK-001 (tests T13-T18) | 120 | 100 |
| TASK-002 (migration 0014) | 90 | 60 |
| TASK-003 (schema updates) | 120 | 80 |
| TASK-004 (4 transform files) | 185 | 130 |
| TASK-005 (algorithm extension) | 100 | 70 |
| TASK-006 (refactor) | 20 | 15 |
| TASK-007 (smoke test) | 0 | 0 |
| TASK-008 (spec sync) | 60 | 50 |
| TASK-009 (pre-merge fix slot) | 0 | 0 |
| TASK-010 (release) | 25 | 20 |
| **Total** | **~700** | **~280** |

---

## LESSONs from E1b1 + B1b (embedded)

| # | LESSON | Where applied |
|---|--------|---------------|
| **E1b1: smoke test non-negotiable** | `pnpm db:promote` end-to-end smoke test MUST run before merge; v0.5.2 shipped broken because smoke was skipped | TASK-007 |
| **E1b1: psql migration** | Migration applied via `psql`, NOT `drizzle-kit migrate` (drizzle-kit tracking mismatches hand-written SQL) | TASK-002 |
| **E1b1: legacy_id UNIQUE INDEX** | Cross-run idempotency via `legacy_id` UNIQUE INDEX pattern extends to 4 NEW domains | TASK-002 |
| **E1b1: SELECT DISTINCT ON** | `fk-lookup.ts` uses `SELECT DISTINCT ON` for ctacte1 FK lookup — `MIN(uuid)` not available in this PostgreSQL deployment | `fk-lookup.ts` unchanged |
| **B1b LESSON #1 (HIGHEST)** | **Partial atomic canonical sync** — E1b2a adds 7-domain PROMOTION_ORDER scenario + 4 NEW domain scenarios + 10 NEW criteria; diff MUST be additive only + 1 rewrite | TASK-008 |
| **B1b LESSON #2** | **Separate release commit** — version bump + CHANGELOG in `chore(release): v0.5.4`, NOT in the feat commit | TASK-010 |
| **B1b LESSON #3** | **Pre-merge fix slot** — if verify catches issue, fix + cherry-pick reorder to preserve 3-commit shape | TASK-009 |
| **B1b LESSON #4** | **Merge before delete** — merge feature branch to `main` BEFORE `git branch -D` | TASK-009 pre-merge checklist |

---

## Commit shape summary

```
Commit 1: feat(promotion): wire 4 NEW master tables (escuela, deportes, locacion, caja)
  ├── TASK-001 (TDD-RED): tests T13-T18 written
  ├── TASK-002 (TDD-GREEN): migration 0014 hand-written + applied via psql
  ├── TASK-003 (TDD-GREEN): schema updates (socios + deportes + tesoreria + index)
  ├── TASK-004 (TDD-GREEN): 4 transform files (escuela + deportes + locacion + caja)
  ├── TASK-005 (TDD-GREEN): algorithm extension (PROMOTION_ORDER + promote + dedup)
  ├── TASK-006 (TDD-REFACTOR): tighten helpers
  └── TASK-007 (smoke test): 3-run idempotency + row count verification

Commit 2: docs(spec): atomic sync — Promotion Pipeline with 4 NEW domains
  └── TASK-008: canonical spec sync (PROMOTION_ORDER rewrite + 4 domain scenarios + 10 criteria)

Commit 3: chore(release): v0.5.4
  └── TASK-010: version bump + CHANGELOG entry

# TASK-009 is a fix slot (no commit if no fix needed)
```

---

*Persisted to:*
- *`openspec/changes/athlos-promote-projection-to-master-e1b2a/tasks.md`*
- *Engram topic `sdd/athlos-promote-projection-to-master-e1b2a/tasks` (via `mem_save`)*
