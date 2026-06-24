# Tasks: athlos-promote-projection-to-master-e1a

## Header

| Field | Value |
|-------|-------|
| **Change** | `athlos-promote-projection-to-master-e1a` |
| **Date** | 2026-06-24 |
| **Phase** | Tasks |
| **Mode** | Both (OpenSpec file + Engram topic) |
| **Status** | Ready for apply |
| **File path** | `openspec/changes/athlos-promote-projection-to-master-e1a/tasks.md` |
| **Source artifacts** | `openspec/changes/athlos-promote-projection-to-master-e1a/design.md` · `openspec/changes/athlos-promote-projection-to-master-e1a/specs/deployment-devops/spec.md` |
| **Target release** | v0.5.0 → **v0.5.1** (PATCH) |
| **Commit shape** | 3 commits: `feat(promotion)` → `docs(spec): atomic sync` → `chore(release): v0.5.1` |
| **TDD chain** | TASK-001 [RED] → TASK-002a/002b [GREEN] → TASK-003 [REFACTOR] |

---

## TASK-001 — TDD-RED: Write test skeleton

| Field | Value |
|-------|-------|
| **ID** | TASK-001 |
| **Type** | `TDD-RED` |
| **Phase** | RED (write tests before implementation) |
| **Dependencies** | None (first task) |
| **Files to create** | `packages/promotion/src/__tests__/promote.test.ts` |

### What

Write 7 vitest test cases (T1–T7) for `packages/promotion/src/__tests__/promote.test.ts`. Tests use the **production test DB** (`192.168.1.102/athlos`). Per-test cleanup via `afterEach` with `DELETE FROM ... WHERE numero_socio LIKE 'test-%'`. Tests do **NOT** truncate master tables.

### Test cases

| # | Case | Setup | Assertion |
|---|------|-------|-----------|
| **T1** | `promoteDomain('socios')` happy path | Insert 1 row into `socios.socios_projection` with `payload={SOCAPYNOMB:'PEREZ JUAN', SOCDNI:'12345678', SOCCARNET:'1001'}` | `result.inserted === 1`, `failed === 0`; `SELECT * FROM socios.socios WHERE numero_socio='1001'` returns row with `apellido='PEREZ'`, `nombre='JUAN'` |
| **T2** | `promoteDomain('ctacte')` FK failure (empty socios) | `socios.socios` empty, `tesoreria.ctacte_projection` has 1 row with `payload={CCTCUENTA:'9999', CCTDEBEHAB:1, CCTIMPORTE:'500'}` | `result.inserted === 0`, `failed === 1`, `errors[0].reason` includes `'no matching socio'` |
| **T3** | `promoteDomain('ctacte')` happy path (after socios) | Insert 1 socios projection row + 1 ctacte projection row with matching `CCTCUENTA='1001'` | After `promoteDomain('socios')` then `promoteDomain('ctacte')`: ctacte row inserted with `socioId` matching the socios uuid; `inserted === 1` |
| **T4** | Idempotency on socios | 1 socios projection row | First run: `inserted === 1`. Second run: `inserted === 0`, `skipped === 1` (relies on `socios_numero_socio_unique`) |
| **T5** | `PROMOTION_ORDER` enforces FK dependency | 0 socios rows, 1 ctacte projection row | `promoteAll(db)` returns: `[socios: inserted=0, failed=0], [ctacte: skipped with 'Skipped due to upstream failure in socios']` |
| **T6** | Unit test for `transformSocio` + `parseFechaVFP` | Direct call | `parseFechaVFP('19800515')` → `Date(1980-05-15)`; `transformSocio({SOCAPYNOMB:'PEREZ JUAN', SOCDNI:'12345678', SOCCARNET:'1001'})` → `{numeroSocio:'1001', apellido:'PEREZ', nombre:'JUAN'}`; missing `SOCDNI` throws |
| **T7** | Unit test for `transformCtacte` + enum split | Direct call | `CCTDEBEHAB=1` → `tipo='DEBITO'`, `debe='500.00'`, `haber='0.00'`; `CCTDEBEHAB=-1` → `tipo='CREDITO'`, `debe='0.00'`, `haber='500.00'`; no matching socio throws |

### Per-test cleanup helper

```typescript
async function cleanupTestRows(socioNumero?: string) {
  if (socioNumero) {
    await db.execute(sql`DELETE FROM socios.socios WHERE numero_socio = ${socioNumero}`)
  }
  await db.execute(sql`DELETE FROM tesoreria.ctacte WHERE socio_id IN (SELECT id FROM socios.socios WHERE numero_socio LIKE 'test-%')`)
  await db.execute(sql`DELETE FROM socios.socios WHERE numero_socio LIKE 'test-%'`)
  await db.execute(sql`DELETE FROM tesoreria.ctacte1_projection WHERE source_key LIKE 'test-%'`)
  await db.execute(sql`DELETE FROM socios.socios_projection WHERE source_key LIKE 'test-%'`)
  await db.execute(sql`DELETE FROM tesoreria.ctacte_projection WHERE source_key LIKE 'test-%'`)
}
```

### Verification step

```bash
pnpm --filter @athlos/promotion test
```
Expected: **7 tests FAIL** (RED) — modules don't exist yet.

### Commit shape

- **Commit**: `feat(promotion): write TDD tests for projection→master promotion (RED)` (part of `feat(promotion)` commit)

### Rollback note

Delete `packages/promotion/src/__tests__/promote.test.ts`. No other files depend on it.

---

## TASK-002a — TDD-GREEN: Schema + transforms + helpers

| Field | Value |
|-------|-------|
| **ID** | TASK-002a |
| **Type** | `TDD-GREEN` |
| **Phase** | GREEN (implementation to make tests pass) |
| **Dependencies** | TASK-001 (tests written) |
| **Files to create** | 7 files |
| **Files to modify** | 2 files |

### What

Add `ctacte1` table to `tesoreria.ts` schema, generate Drizzle migration, write 4 transform files, write transform-helpers.

### Files to create

#### `packages/db/src/schema/tesoreria.ts` — add `ctacte1` table

Add after `ctacte` table definition:

```typescript
// ctacte1 sub-ledger — created lazily by rebuild.ts projection only;
// E1a ships the master table so 245,370 rows can be promoted into it.
export const ctacte1 = tesoreriaSchema.table(
  'ctacte1',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ctacteId: uuid('ctacte_id')
      .notNull()
      .references(() => ctacte.id, { onDelete: 'restrict' }),
    fecha: date('fecha').notNull(),
    concepto: text('concepto').notNull(),
    monto: text('monto').notNull().default('0.00'), // NUMERIC(14,2) stored as text
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ctacteIdIdx: index('ctacte1_ctacte_id_idx').on(table.ctacteId),
  }),
)

export type Ctacte1 = typeof ctacte1.$inferSelect
export type NewCtacte1 = typeof ctacte1.$inferInsert
```

Also add to the re-exports in `packages/db/src/schema/index.ts`:
```typescript
export { ctacte1 } from './tesoreria'
export type { Ctacte1, NewCtacte1 } from './tesoreria'
```

#### `packages/db/drizzle/00XX_ctacte1_master.sql` (auto-generated)

Run `pnpm --filter @athlos/db generate` after schema change. Expected shape:

```sql
CREATE TABLE "tesoreria"."ctacte1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ctacte_id" uuid NOT NULL REFERENCES "tesoreria"."ctacte"("id") ON DELETE restrict,
  "fecha" date NOT NULL,
  "concepto" text NOT NULL,
  "monto" text DEFAULT '0.00' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "ctacte1_ctacte_id_idx" ON "tesoreria"."ctacte1" USING btree ("ctacte_id");
```

#### `packages/promotion/src/transform-helpers.ts`

```typescript
/**
 * Parse a VFP date (YYYYMMDD compact string, ISO string, or Date instance)
 * into a JS Date. Returns null on unparseable input.
 */
export function parseFechaVFP(raw: unknown): Date | null {
  if (raw === null || raw === undefined) return null
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (/^\d{8}$/.test(trimmed)) {
      const y = Number.parseInt(trimmed.slice(0, 4), 10)
      const m = Number.parseInt(trimmed.slice(4, 6), 10) - 1
      const d = Number.parseInt(trimmed.slice(6, 8), 10)
      const dt = new Date(y, m, d)
      return isNaN(dt.getTime()) ? null : dt
    }
    const iso = new Date(trimmed)
    return isNaN(iso.getTime()) ? null : iso
  }
  if (typeof raw === 'number') {
    // Assume YYYYMMDD as integer
    const y = Math.floor(raw / 10000)
    const m = (Math.floor(raw / 100) % 100) - 1
    const d = raw % 100
    const dt = new Date(y, m, d)
    return isNaN(dt.getTime()) ? null : dt
  }
  return null
}

/** Parse a monetary amount to NUMERIC(14,2) string. */
export function parseMonto(raw: unknown): string {
  if (raw === null || raw === undefined) return '0.00'
  const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw).replace(/[^\d.-]/g, ''))
  if (Number.isNaN(n)) return '0.00'
  return n.toFixed(2)
}

/** Split monto into debe/haber based on tipo. */
export function splitDebeHaber(monto: string, tipo: 'DEBITO' | 'CREDITO'): { debe: string; haber: string } {
  if (tipo === 'DEBITO') return { debe: monto, haber: '0.00' }
  return { debe: '0.00', haber: monto }
}

/** Split 'APELLIDO NOMBRE' into parts. */
export function splitApellidoNombre(full: string): { apellido: string; nombre: string } {
  if (!full || !full.trim()) return { apellido: '(sin apellido)', nombre: '(sin nombre)' }
  const parts = full.trim().split(/\s+/)
  const apellido = parts[0]
  const nombre = parts.slice(1).join(' ') || '(sin nombre)'
  return { apellido, nombre }
}

/** Typed FK map — namespaced keys for O(1) lookup. */
export interface FkMap {
  get(key: string): string | undefined
}

export interface TransformHelpers {
  fkMap: FkMap
  parseFechaVFP: typeof parseFechaVFP
  parseMonto: typeof parseMonto
  splitDebeHaber: typeof splitDebeHaber
  splitApellidoNombre: typeof splitApellidoNombre
}
```

#### `packages/promotion/src/transforms/socios.ts`

```typescript
import { randomUUID } from 'node:crypto'
import type { NewSocio } from '@athlos/db/schema'
import type { TransformHelpers } from '../transform-helpers.ts'

export function transformSocio(
  payload: Record<string, unknown>,
  helpers: TransformHelpers,
): NewSocio {
  const { parseFechaVFP, parseMonto, splitApellidoNombre } = helpers

  const carnet = String(payload.SOCCARNET ?? payload.SOCNUMERO ?? '')
  if (!carnet.trim()) throw new Error('Empty SOCCARNET/SOCNUMERO')

  const dni = String(payload.SOCDNI ?? '').trim()
  if (!dni) throw new Error('Empty SOCDNI')

  const fullName = String(payload.SOCAPYNOMB ?? '').trim()
  const { apellido, nombre } = splitApellidoNombre(fullName)

  const fechaAlta = parseFechaVFP(payload.SOCFECALTA ?? payload.SOCFECNACI ?? null)
  if (!fechaAlta) throw new Error('Unparseable SOCFECALTA/SOCFECNACI')

  return {
    id: randomUUID(),
    numeroSocio: carnet.trim(),
    nombre,
    apellido,
    dni,
    fechaAlta,
    estado: 'activo',
    categoria: payload.SOCCATEGO ? String(payload.SOCCATEGO).trim() || null : null,
    direccion: payload.SOCDIRECC ? String(payload.SOCDIRECC).trim() || null : null,
    telefono: payload.SOCTELEFO ? String(payload.SOCTELEFO).trim() || null : null,
    email: payload.SOCEMAIL ? String(payload.SOCEMAIL).trim() || null : null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}
```

#### `packages/promotion/src/transforms/ctacte.ts`

```typescript
import { randomUUID } from 'node:crypto'
import type { NewCtacte } from '@athlos/db/schema'
import type { TransformHelpers } from '../transform-helpers.ts'

export function transformCtacte(
  payload: Record<string, unknown>,
  helpers: TransformHelpers,
): NewCtacte {
  const { fkMap, parseFechaVFP, parseMonto, splitDebeHaber } = helpers

  const cuenta = String(payload.CCTCUENTA ?? '')
  const socioUuid = fkMap.get(`socio:${cuenta}`)
  if (!socioUuid) throw new Error('no matching socio')

  const tipoRaw = Number(payload.CCTDEBEHAB)
  const tipo: 'DEBITO' | 'CREDITO' = tipoRaw >= 0 ? 'DEBITO' : 'CREDITO'

  const monto = parseMonto(payload.CCTIMPORTE)
  const { debe, haber } = splitDebeHaber(monto, tipo)

  const fecha = parseFechaVFP(payload.CCTFECHA ?? null)
  if (!fecha) throw new Error('Unparseable CCTFECHA')

  return {
    id: randomUUID(),
    socioId: socioUuid,
    fecha,
    tipo,
    concepto: String(payload.CCTCONCEPT ?? '').trim(),
    debe,
    haber,
    anulado: false,
    createdAt: new Date(),
  }
}
```

#### `packages/promotion/src/transforms/ctacte1.ts`

```typescript
import { randomUUID } from 'node:crypto'
import type { NewCtacte1 } from '@athlos/db/schema'
import type { TransformHelpers } from '../transform-helpers.ts'

export function transformCtacte1(
  payload: Record<string, unknown>,
  helpers: TransformHelpers,
): NewCtacte1 {
  const { fkMap, parseFechaVFP, parseMonto } = helpers

  const cct1Numero = String(payload.CCT1NUMERO ?? '')
  const ctacteUuid = fkMap.get(`ctacte:${cct1Numero}`)
  if (!ctacteUuid) throw new Error('no matching ctacte')

  const fecha = parseFechaVFP(payload.CCT1FECHA ?? null)
  if (!fecha) throw new Error('Unparseable CCT1FECHA')

  return {
    id: randomUUID(),
    ctacteId: ctacteUuid,
    fecha,
    concepto: String(payload.CCT1CONCEPT ?? '').trim(),
    monto: parseMonto(payload.CCT1IMPORTE),
    createdAt: new Date(),
  }
}
```

### Files to modify

1. **`packages/db/src/schema/tesoreria.ts`** — add `ctacte1` table + `NewCtacte1` type
2. **`packages/db/src/schema/index.ts`** — re-export `ctacte1`, `Ctacte1`, `NewCtacte1`

### Verification step

```bash
pnpm --filter @athlos/db generate
pnpm --filter @athlos/promotion test
```
Expected: **7 tests PASS** (GREEN).

### Commit shape

- **Commit**: `feat(promotion): add ctacte1 schema + migration + 3 domain transforms + helpers` (part of `feat(promotion)` commit, combined with TASK-002b)

### Rollback note

- Revert `tesoreria.ts` and `index.ts` changes
- Delete the generated migration file
- Delete `packages/promotion/src/transforms/*.ts` and `transform-helpers.ts`

---

## TASK-002b — TDD-GREEN: Core algorithm + CLI

| Field | Value |
|-------|-------|
| **ID** | TASK-002b |
| **Type** | `TDD-GREEN` |
| **Phase** | GREEN (implementation to make tests pass) |
| **Dependencies** | TASK-002a (schema + transforms exist) |
| **Files to create** | 6 files |

### Files to create

#### `packages/promotion/src/PROMOTION_ORDER.ts`

```typescript
import type { Domain } from './promote.ts'
import type { TransformFn } from './promote.ts'
import type { NewSocio } from '@athlos/db/schema'
import type { NewCtacte } from '@athlos/db/schema'
import type { NewCtacte1 } from '@athlos/db/schema'
import { transformSocio } from './transforms/socios.ts'
import { transformCtacte } from './transforms/ctacte.ts'
import { transformCtacte1 } from './transforms/ctacte1.ts'
import { sql } from 'drizzle-orm'

export type { Domain }

export const PROMOTION_ORDER: readonly Domain[] = [
  'socios',
  'ctacte',
  'ctacte1',
] as const

/** Domains whose failure (inserted=0 + failed>0) short-circuits downstream dependents. */
export const FK_BLOCKING_DOMAINS: readonly Domain[] = ['socios', 'ctacte']

/** Map domain → projection table (schema-qualified). */
export const PROJECTION_TABLE: Record<Domain, string> = {
  socios: 'socios.socios_projection',
  ctacte: 'tesoreria.ctacte_projection',
  ctacte1: 'tesoreria.ctacte1_projection',
}

export type TransformFn = (payload: Record<string, unknown>, helpers: import('./transform-helpers.js').TransformHelpers) => unknown

export const DOMAIN_TRANSFORMS: Record<Domain, TransformFn> = {
  socios: transformSocio as TransformFn,
  ctacte: transformCtacte as TransformFn,
  ctacte1: transformCtacte1 as TransformFn,
}
```

#### `packages/promotion/src/fk-lookup.ts`

```typescript
import { sql } from 'drizzle-orm'
import type { Db } from '@athlos/db'
import { socios } from '@athlos/db/schema'
import type { FkMap } from './transform-helpers.ts'

export async function buildFkMap(db: Db, domain: string): Promise<FkMap> {
  const map = new Map<string, string>()

  if (domain === 'ctacte' || domain === 'ctacte1') {
    // Bulk load: ONE SELECT for all socios → in-memory Map
    const rows = await db.select({ id: socios.id, numeroSocio: socios.numeroSocio }).from(socios)
    for (const r of rows) map.set(`socio:${r.numeroSocio}`, r.id)
  }

  if (domain === 'ctacte1') {
    // ctacte master has no legacy_id column in E1a.
    // Build ctacte natural-key → uuid by joining ctacte → entity_uuids → raw_events (source_key = CCTNUMERO).
    const rows = await db.execute<{ id: string; cctnumero: string }>(sql`
      SELECT c.id, r.source_key AS cctnumero
      FROM "tesoreria"."ctacte" c
      JOIN "public"."entity_uuids" e ON e.source_table = 'ctacte' AND e.entity_uuid = c.id
      JOIN "public"."raw_events" r ON r.source_table = 'ctacte' AND r.source_key = e.source_key
    `)
    for (const r of (rows.rows ?? [])) map.set(`ctacte:${r.cctnumero}`, r.id)
  }

  return {
    get: (key: string) => map.get(key),
  }
}
```

#### `packages/promotion/src/dedup.ts`

```typescript
import { sql } from 'drizzle-orm'
import type { Db } from '@athlos/db'
import { socios, ctacte } from '@athlos/db/schema'

export type Domain = 'socios' | 'ctacte' | 'ctacte1'

/** Natural key extractor from VFP jsonb payload. */
export function naturalKey(domain: Domain, payload: Record<string, unknown>): string {
  if (domain === 'socios') return String(payload.SOCCARNET ?? payload.SOCNUMERO ?? '')
  if (domain === 'ctacte') return String(payload.CCTNUMERO ?? '')
  // ctacte1: composite key
  const num = String(payload.CCT1NUMERO ?? '')
  const item = String(payload.CCT1ITEM ?? '0')
  return `${num}-${item}`
}

/** Load existing natural keys already in master table (for dedup pre-check). */
export async function loadExistingNaturalKeys(db: Db, domain: Domain): Promise<Set<string>> {
  if (domain === 'socios') {
    const rows = await db.select({ numeroSocio: socios.numeroSocio }).from(socios)
    return new Set(rows.map(r => r.numeroSocio))
  }
  // ctacte and ctacte1 have no legacy_id column in E1a — dedup relies on ON CONFLICT DO NOTHING only.
  // Return empty set; skipped counter will only reflect intra-batch dedup.
  return new Set<string>()
}
```

#### `packages/promotion/src/promote.ts`

```typescript
import { sql } from 'drizzle-orm'
import type { Db } from '@athlos/db'
import { buildFkMap } from './fk-lookup.ts'
import { loadExistingNaturalKeys, naturalKey } from './dedup.ts'
import { PROMOTION_ORDER, FK_BLOCKING_DOMAINS, PROJECTION_TABLE, DOMAIN_TRANSFORMS } from './PROMOTION_ORDER.ts'
import { parseFechaVFP, parseMonto, splitDebeHaber, splitApellidoNombre } from './transform-helpers.ts'
import type { TransformHelpers } from './transform-helpers.ts'

export type Domain = 'socios' | 'ctacte' | 'ctacte1'

export interface PromotionResult {
  domain: Domain
  attempted: number
  inserted: number
  skipped: number
  failed: number
  errors: Array<{ sourceKey: string; reason: string }>
  durationMs: number
}

const BATCH_SIZE = 1000

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

export async function promoteDomain(db: Db, domain: Domain): Promise<PromotionResult> {
  const t0 = Date.now()
  const result: PromotionResult = { domain, attempted: 0, inserted: 0, skipped: 0, failed: 0, errors: [], durationMs: 0 }

  try {
    const transform = DOMAIN_TRANSFORMS[domain]
    if (!transform) throw new Error(`No transform for domain ${domain}`)

    // 1. Bulk FK lookup (1 SELECT per domain — the O(1) optimization)
    const fkMap = await buildFkMap(db, domain)

    // 2. Read all projection rows for this domain (full scan; E2 will add `promoted_at` filter)
    const projTable = PROJECTION_TABLE[domain]
    // Projection tables are created lazily by rebuild.ts; use raw SQL to avoid Drizzle schema dependency.
    const projectionRows = (await db.execute<{ source_key: string; payload: Record<string, unknown> }>(
      sql.raw(`SELECT source_key, payload FROM "${projTable}"`),
    )).rows ?? []
    result.attempted = projectionRows.length

    // 3. Build dedup set (natural keys already in master — belt-and-suspenders with ON CONFLICT)
    const existingKeys = await loadExistingNaturalKeys(db, domain)

    // 4. Transform + batch insert
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
        const key = naturalKey(domain, row.payload)
        if (existingKeys.has(key)) { result.skipped++; continue }
        const masterRow = transform(row.payload, helpers)
        buffer.push(masterRow)
        existingKeys.add(key)
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
    // FK cascade short-circuit: block dependents if upstream inserted zero rows AND had failures
    if (FK_BLOCKING_DOMAINS.includes(domain) && r.inserted === 0 && r.failed > 0) {
      for (const downstream of PROMOTION_ORDER.slice(PROMOTION_ORDER.indexOf(domain) + 1)) {
        results.push({
          domain: downstream,
          attempted: 0, inserted: 0, skipped: 0, failed: 0,
          errors: [{ sourceKey: '*', reason: `Skipped due to upstream failure in ${domain}` }],
          durationMs: 0,
        })
      }
      break
    }
  }
  return results
}

async function insertMasterBatch(db: Db, domain: Domain, rows: unknown[]): Promise<number> {
  if (rows.length === 0) return 0
  // Dynamically resolve the table reference per domain.
  // We build raw INSERT per domain to avoid circular schema imports at the type level.
  const tableName = domain === 'socios' ? '"socios"."socios"'
    : domain === 'ctacte' ? '"tesoreria"."ctacte"'
    : '"tesoreria"."ctacte1"'
  const columns = domain === 'socios'
    ? '(id, numero_socio, nombre, apellido, dni, fecha_alta, estado, categoria, direccion, telefono, email, created_at, updated_at)'
    : domain === 'ctacte'
    ? '(id, socio_id, fecha, tipo, concepto, debe, haber, anulado, created_at)'
    : '(id, ctacte_id, fecha, concepto, monto, created_at)'
  const inserted = await db.execute(sql.raw(
    `INSERT INTO ${tableName} ${columns} VALUES ${rows.map((_, i) => {
      const offset = i * (domain === 'socios' ? 13 : domain === 'ctacte' ? 9 : 6)
      const vals = (domain === 'socios' ? [13, 9, 6, 5, 4, 3, 2, 2, 2, 2, 1, 1, 1] // column count per domain
        : domain === 'ctacte' ? [9, 5, 3, 2, 2, 2, 2, 1, 1]
        : [6, 5, 3, 2, 1, 1])
        .map((_, j) => `$${offset + j + 1}`)
        .join(', ')
      return `(${vals})`
    }).join(', ')} ON CONFLICT DO NOTHING RETURNING id`,
  ))
  return Number(inserted.rowCount ?? 0)
}
```

> **Note on `insertMasterBatch`**: The raw SQL approach avoids circular import issues between `@athlos/promotion` and `@athlos/db`. A future refactor (E2 or later) could use Drizzle's query builder directly if the schema imports are restructured.

#### `packages/promotion/src/promote-cli.ts`

```typescript
import { createDb } from '@athlos/db'
import { promoteAll } from './promote.ts'

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

#### `packages/promotion/src/index.ts`

```typescript
export { promoteDomain, promoteAll, type Domain, type PromotionResult } from './promote.ts'
export { PROMOTION_ORDER, FK_BLOCKING_DOMAINS, PROJECTION_TABLE, DOMAIN_TRANSFORMS, type TransformFn } from './PROMOTION_ORDER.ts'
export { buildFkMap } from './fk-lookup.ts'
export { loadExistingNaturalKeys, naturalKey, type Domain as DedupDomain } from './dedup.ts'
export { parseFechaVFP, parseMonto, splitDebeHaber, splitApellidoNombre, type TransformHelpers, type FkMap } from './transform-helpers.ts'
```

### Verification step

```bash
pnpm --filter @athlos/promotion test
```
Expected: **7 tests PASS** (GREEN).

### Commit shape

- **Commit**: `feat(promotion): add ctacte1 schema + migration + 3 domain transforms + helpers` (part of `feat(promotion)` commit, combined with TASK-002a as one impl commit)

### Rollback note

- Delete `packages/promotion/src/promote.ts`, `promote-cli.ts`, `index.ts`, `PROMOTION_ORDER.ts`, `fk-lookup.ts`, `dedup.ts`
- Revert if needed (schema already rolled back in TASK-002a)

---

## TASK-003 — TDD-REFACTOR

| Field | Value |
|-------|-------|
| **ID** | TASK-003 |
| **Type** | `TDD-REFACTOR` |
| **Phase** | REFACTOR (tighten helpers, no behavior change) |
| **Dependencies** | TASK-002a + TASK-002b (tests green) |
| **Files to modify** | Any in `packages/promotion/src/` |

### What

- Tighten `parseFechaVFP` to single-pass parsing (remove redundant branches)
- Deduplicate numeric parsing between `parseMonto` and the transform functions
- Add doc comments to public API surfaces
- Ensure `insertMasterBatch` handles empty rows gracefully (already does)
- Verify all 7 tests still pass

### Verification step

```bash
pnpm --filter @athlos/promotion test
pnpm test:run  # full suite — no regression
pnpm typecheck
pnpm lint
```
Expected: all pass, no behavior change.

### Commit shape

- **Commit**: `feat(promotion): add ctacte1 schema + migration + 3 domain transforms + helpers` (same feat commit; refactor is a cleanup phase within the TDD cycle, not a separate commit — the 3-commit shape is feat + spec-sync + release)

### Rollback note

Refactor only — rollback means reverting to the pre-refactor state of the same files.

---

## TASK-004 — Package skeleton

| Field | Value |
|-------|-------|
| **ID** | TASK-004 |
| **Type** | `config` |
| **Phase** | wiring |
| **Dependencies** | None (first, can run in parallel with TASK-001) |
| **Files to create** | 2 files |

### Files to create

#### `packages/promotion/package.json`

```json
{
  "name": "@athlos/promotion",
  "version": "0.5.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "promote": "tsx src/promote-cli.ts",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@athlos/db": "workspace:*",
    "@athlos/errors": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "tsx": "^4.19.0",
    "vitest": "^2.1.0"
  }
}
```

#### `packages/promotion/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "outDir": "./dist"
  },
  "include": ["src/**/*.ts"]
}
```

### Verification step

```bash
pnpm install
pnpm --filter @athlos/promotion typecheck
```
Expected: no TS errors (modules resolve).

### Commit shape

- **Commit**: `feat(promotion): add @athlos/promotion package skeleton` (part of `feat(promotion)` commit)

### Rollback note

Delete `packages/promotion/` directory entirely.

---

## TASK-005 — Root `db:promote` script

| Field | Value |
|-------|-------|
| **ID** | TASK-005 |
| **Type** | `config` |
| **Phase** | wiring |
| **Dependencies** | TASK-004 (package skeleton exists) |
| **Files to modify** | `package.json` (root) |

### What

Add `"db:promote": "pnpm --filter @athlos/promotion run promote"` to root `package.json` scripts.

### Verification step

```bash
pnpm db:promote --help 2>&1 | head -5
# or just check script exists
cat package.json | grep db:promote
```
Expected: script defined.

### Commit shape

- **Commit**: `feat(promotion): add db:promote root script` (part of `feat(promotion)` commit)

### Rollback note

Remove the `db:promote` script line from root `package.json`.

---

## TASK-006 — Pre-closing verification

| Field | Value |
|-------|-------|
| **ID** | TASK-006 |
| **Type** | `docs` |
| **Phase** | verification |
| **Dependencies** | TASK-001 through TASK-005 (everything wired) |
| **Files to modify** | None |

### What

Run the full verification checklist:

```bash
# 1. TDD tests pass
pnpm --filter @athlos/promotion test
# Expected: 7/7 PASS

# 2. Full suite — no regression
pnpm test:run
# Expected: 468+ existing + 7 new = 475+ PASS

# 3. Typecheck
pnpm typecheck
# Expected: 0 errors

# 4. Lint
pnpm lint
# Expected: 0 errors

# 5. Build (confirm no emit issues)
pnpm build
# Expected: completes

# 6. Manual smoke (if test DB accessible)
# pnpm db:promote
# Expected: 39357 socios + 326275 ctacte + 245370 ctacte1 rows in master tables
```

### Commit shape

No files — verification only. Marks the end of the feat commit work.

---

## TASK-007 — Atomic canonical spec sync (B1b LESSON #1)

| Field | Value |
|-------|-------|
| **ID** | TASK-007 |
| **Type** | `docs` |
| **Phase** | spec sync |
| **Dependencies** | TASK-006 (feat work complete) |
| **Files to modify** | `openspec/specs/deployment-devops/spec.md` |

### What

Add new "Promotion Pipeline" requirement to the canonical `openspec/specs/deployment-devops/spec.md` with exactly the 3 E1a scenarios and 6 success criteria. This is **PARTIAL** — E1b and E2 will add their own scenarios in subsequent syncs.

### Changes to `openspec/specs/deployment-devops/spec.md`

Append after the existing 30 criteria (end of file, before the last line):

```markdown
### Requirement: Promotion Pipeline

The system SHALL provide a workspace package (`packages/promotion/`) that reads rows from each `*_projection` table, transforms each `jsonb` payload into a typed row matching the corresponding master table, resolves foreign keys via bulk in-memory lookups (NOT per-row queries), inserts in batches of 1000 rows with `ON CONFLICT DO NOTHING` for idempotency, and exposes a CLI runner accessible via the root script `pnpm db:promote`. Per E1a scope, only 3 priority domains are wired: `socios`, `ctacte`, and `ctacte1`. The remaining 5 domains (`escuela`, `deportes`, `locacion`, `caja`, `gastos`) and the admin HTTP endpoint are explicitly OUT OF SCOPE for this delta (deferred to E1b and E2 respectively).

The system SHALL enforce a topological promotion order (`PROMOTION_ORDER = ['socios', 'ctacte', 'ctacte1']`) such that FK targets are populated before dependents: `socios` MUST be promoted before `ctacte` (ctacte.socio_id → socios.id), and `ctacte` MUST be promoted before `ctacte1` (ctacte1.ctacte_id → ctacte.id). The system SHALL NOT fail-fast on per-domain errors; instead, it SHALL collect per-row failures in a `errors[]` array, increment the `failed` counter, and short-circuit downstream domains ONLY when the upstream domain inserted zero rows AND had failures (the FK-cascade rule).

#### Scenario: Promotion: socios (jsonb → typed `socios.socios`)

- GIVEN `socios.socios_projection` contains 39,357 rows with VFP jsonb payloads
- AND `socios.socios` (master) is empty
- WHEN the operator runs `pnpm db:promote`
- THEN the `socios` transform SHALL read each projection row, parse VFP fields → typed columns
- AND SHALL insert into `socios.socios` in batches of 1000 rows with `ON CONFLICT DO NOTHING`
- AND SHALL return `{ domain: 'socios', attempted: 39357, inserted: 39357, skipped: 0, failed: 0, errors: [], durationMs: <N> }`
- AND `SELECT COUNT(*) FROM socios.socios` SHALL return 39357

#### Scenario: Promotion: ctacte (FK dependency on `socios.socios`)

- GIVEN `tesoreria.ctacte_projection` contains 326,275 rows
- AND `socios.socios` has been populated (39,357 rows)
- WHEN the `ctacte` promotion step runs
- THEN the algorithm SHALL execute exactly ONE `SELECT id, numero_socio FROM socios.socios` query (bulk FK lookup)
- AND SHALL load the result into an in-memory `Map<string, uuid>` for O(1) per-row socio_id resolution
- AND if lookup returns null, the row SHALL be skipped with `errors.push({ sourceKey, reason: 'no matching socio' })` — no fail-fast
- AND SHALL insert into `tesoreria.ctacte` in batches of 1000 with `ON CONFLICT DO NOTHING`
- AND `SELECT COUNT(*) FROM tesoreria.ctacte` SHALL return 326,275

#### Scenario: Promotion: ctacte1 (FK dependency on `tesoreria.ctacte`)

- GIVEN `tesoreria.ctacte1_projection` contains 245,370 rows
- AND `tesoreria.ctacte` has been populated (326,275 rows)
- WHEN the `ctacte1` promotion step runs
- THEN the algorithm SHALL execute ONE bulk lookup against freshly-promoted ctacte rows (single SELECT, not 245,370 queries)
- AND SHALL resolve `ctacte_id` via in-memory Map keyed by composite natural key
- AND SHALL insert into `tesoreria.ctacte1` in batches of 1000 with `ON CONFLICT DO NOTHING`
- AND `SELECT COUNT(*) FROM tesoreria.ctacte1` SHALL return 245,370

> **DEFERRED to E1b:** escuela, deportes, locacion, caja, gastos scenarios.
> **DEFERRED to E2:** admin API endpoint, `promoted_at` audit migration, full idempotency.

---

**Criteria #31–36 (E1a NEW):**

31. `pnpm --filter @athlos/promotion test` exits 0 with 5+ vitest cases covering: happy path, FK resolution, skipped FK, idempotency, per-domain isolation, VFP parsing.
32. `pnpm db:promote` populates `socios.socios` with exactly 39,357 rows; CLI stdout shows `{domain:'socios', inserted:39357}`.
33. `pnpm db:promote` populates `tesoreria.ctacte` with exactly 326,275 rows; CLI stdout shows `{domain:'ctacte', inserted:326275}`.
34. `pnpm db:promote` populates `tesoreria.ctacte1` with exactly 245,370 rows; CLI stdout shows `{domain:'ctacte1', inserted:245370}`.
35. Re-running `pnpm db:promote` immediately after a successful run produces 0 new inserts across all 3 domains (idempotent via UNIQUE + `ON CONFLICT DO NOTHING`).
36. Running `pnpm db:promote` with empty `socios.socios` (simulated FK failure) results in `socios.inserted=39357` AND `ctacte.inserted=0` AND `ctacte1.inserted=0` with `errors` on the dependents.
```

### Verification step (CRITICAL — B1b LESSON #1 enforcement)

```bash
diff <(grep -A 200 "Promotion Pipeline" openspec/specs/deployment-devops/spec.md) \
     <(grep -A 200 "Promotion Pipeline" openspec/changes/athlos-promote-projection-to-master-e1a/specs/deployment-devops/spec.md)
```
Expected: **empty output** (only additive changes — no removals, no rewrites of pre-Slice D content).

If diff is NOT empty: STOP, surface drift, fix canonical BEFORE marking TASK-007 complete.

### Commit shape

- **Commit**: `docs(spec): sync deployment-devops canonical with slice-e1a delta (partial)`

### Rollback note

Revert the appended "Promotion Pipeline" requirement and criteria #31–36 from `openspec/specs/deployment-devops/spec.md`.

---

## TASK-008 — Pre-merge fix slot (B1b LESSON #3)

| Field | Value |
|-------|-------|
| **ID** | TASK-008 |
| **Type** | `chore` |
| **Phase** | pre-merge |
| **Dependencies** | TASK-007 (spec synced) |
| **Files to modify** | Varies |

### What

If any pre-merge check (TASK-006) catches an issue:

1. Apply the fix
2. **Cherry-pick reorder** to preserve the 3-commit shape:
   - If fix is in the feat layer → amend the feat commit
   - If fix is in the spec sync → amend the spec-sync commit
   - If fix is in the release → amend the release commit
3. The 3-commit shape must be preserved: `feat` → `docs(spec)` → `chore(release)`

### Pre-merge checklist

- [ ] `pnpm --filter @athlos/promotion test` → 7/7 PASS
- [ ] `pnpm test:run` → no regression
- [ ] `pnpm typecheck` → 0 errors
- [ ] `pnpm lint` → 0 errors
- [ ] `diff` for spec sync → empty (TASK-007 verification)
- [ ] All new files have conventional commit messages
- [ ] No `Co-Authored-By` in any commit
- [ ] Merge to `main` BEFORE `git branch -D` (B1b LESSON #4)

### Commit shape

No new commit if no fix needed. If a fix is applied, it amends the relevant commit or lands as a fixup commit that is then autosquashed into the appropriate commit via interactive rebase.

### Rollback note

Revert the applied fix. Re-order commits via rebase if cherry-pick reorder was used.

---

## TASK-009 — Closing release commit (B1b LESSON #2)

| Field | Value |
|-------|-------|
| **ID** | TASK-009 |
| **Type** | `chore` |
| **Phase** | release |
| **Dependencies** | TASK-008 (pre-merge checks green) |
| **Files to modify** | Root `package.json`, 18 `packages/*/package.json`, `CHANGELOG.md` |

### What

Bump version from `0.5.0` → `0.5.1` and add CHANGELOG entry. **In a SEPARATE commit from the feat commit** (B1b LESSON #2).

### Changes

#### Root `package.json`

```json
{ "version": "0.5.1" }
```

#### Each workspace package (`packages/*/package.json`)

Update `"version"` field to `"0.5.0"` → `"0.5.1"` in each.

#### `CHANGELOG.md`

Append under the `## Released` header (or create if absent):

```markdown
## Released

### v0.5.1 (2026-06-24)

**Promotion Pipeline — E1a (data layer foundation)**

- NEW `packages/promotion/` workspace package with `promoteDomain` + `promoteAll` algorithms
- NEW `tesoreria.ctacte1` master table (Drizzle schema + migration)
- NEW per-domain transforms: `socios` (39,357 rows), `ctacte` (326,275 rows), `ctacte1` (245,370 rows)
- NEW bulk FK lookup pattern (1 SELECT → in-memory `Map<string, uuid>`)
- NEW CLI runner: `pnpm db:promote`
- NEW 7 vitest cases (TDD RED → GREEN → REFACTOR)
- DEFERRED to E1b: 5 remaining domain transforms (escuela, deportes, locacion, caja, gastos)
- DEFERRED to E2: admin API endpoint, `promoted_at` audit column, dry-run mode
```

### Verification step

```bash
git log --oneline -3
# Expected:
# abc1234 chore(release): v0.5.1
# def5678 docs(spec): sync deployment-devops canonical with slice-e1a delta (partial)
# 9876543 feat(promotion): data layer + 3 priority domain transforms + CLI (v0.5.1 prep)
```

### Commit shape

- **Commit**: `chore(release): v0.5.1` (separate from feat — B1b LESSON #2)

### Rollback note

Revert version changes in all 19 `package.json` files + remove the CHANGELOG entry.

---

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated raw changed lines | **~700** |
| Estimated effective changed lines | **~340** |
| Per-PR target | ≤ 400 |
| 400-line budget risk | **MEDIUM-HIGH** (~85% of budget at effective count; ~175% at raw) |
| Chained PRs recommended | **NO** — E1a is a single PR; E1b + E2 are separate stacked PRs |
| Decision needed before apply | **YES** — confirm raw LoC estimate acceptable OR accept size:exception |

### Breakdown by task

| Task | Est. raw | Est. effective |
|------|----------|----------------|
| TASK-001 (tests) | 200 | 150 |
| TASK-002a (schema + transforms + helpers) | 320 | 200 |
| TASK-002b (algorithm + CLI) | 350 | 220 |
| TASK-003 (refactor) | 30 | 20 |
| TASK-004 (package skeleton) | 45 | 35 |
| TASK-005 (root script) | 3 | 3 |
| TASK-007 (spec sync) | 60 | 55 |
| TASK-009 (release) | 25 | 20 |
| **Total** | **~700** | **~340** |

### Key risks

- **R1 (CRITICAL):** ctacte1 master table field mapping requires sampling a real `ctacte1_projection` row at TASK-002b — if VFP schema diverges, migration + transform must be adjusted before GREEN.
- **R2 (CRITICAL):** ctacte FK map uses `entity_uuids → raw_events` join (E1a has no `legacy_id` column on ctacte master) — if `entity_uuids` is not populated for ctacte rows, ctacte1 promotion will fail for all rows.
- **R3 (WARNING):** ctacte/ctacte1 dedup is partial — re-runs may duplicate rows (E2 will fix via `promoted_at` audit column).
- **R4 (WARNING):** Raw LoC (~700) exceeds 400-line budget; effective (~340) is under. If actual PR diff >400 lines at verify, fallback is to split TASK-002b (algorithm) from TASK-002a (transforms) into 2 separate commits — but NO chained PRs per user lock.

---

## LESSONs from B1b (embedded)

| # | LESSON | Where applied |
|---|--------|---------------|
| **1 (HIGHEST)** | **Partial atomic canonical sync** — E1a adds 3 scenarios + 6 criteria; diff MUST be additive only; E1b+E2 extend in their slices | TASK-007 + canonical spec verification |
| **2** | **Separate release commit** — version bump + CHANGELOG in `chore(release): v0.5.1`, NOT in the feat commit | TASK-009 |
| **3** | **Pre-merge fix slot** — if verify catches issue, fix + cherry-pick reorder to preserve 3-commit shape | TASK-008 |
| **4** | **Merge before delete** — merge feature branch to `main` BEFORE `git branch -D` | TASK-008 pre-merge checklist |

---

## Commit shape summary

```
Commit 1: feat(promotion): data layer + 3 priority domain transforms + CLI (v0.5.1 prep)
  ├── TASK-001 (TDD-RED): tests written
  ├── TASK-002a (TDD-GREEN): schema + transforms + helpers
  ├── TASK-002b (TDD-GREEN): core algorithm + CLI
  ├── TASK-003 (TDD-REFACTOR): tighten helpers
  ├── TASK-004: package skeleton
  └── TASK-005: root db:promote script

Commit 2: docs(spec): sync deployment-devops canonical with slice-e1a delta (partial)
  └── TASK-007: atomic canonical spec sync

Commit 3: chore(release): v0.5.1
  └── TASK-009: version bump + CHANGELOG entry

# TASK-006 is verification-only (no commit)
# TASK-008 is a fix slot (no commit if no fix needed)
```

---

*Persisted to:*
- *`openspec/changes/athlos-promote-projection-to-master-e1a/tasks.md`*
- *Engram topic `sdd/athlos-promote-projection-to-master-e1a/tasks` (via `mem_save`)*
