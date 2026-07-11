import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { createDb, type Db } from '@athlos/db'
import * as schema from '@athlos/db/schema'
import { addNote } from './ctacte_movement_notes.ts'
import { ErrorCode } from '@athlos/errors'

/**
 * Disposable PostgreSQL proof for the FULL forward manual sequence
 * `0031 → 0032 → 0033 → 0034`.
 *
 * R3 corrective batch (PR #34) committed 0031, 0032, 0033, and 0034
 * as four hand-written forward migrations outside the Drizzle production
 * journal. The existing `ctacte_movement_notes.postgres.integration.test.ts`
 * covers 0031 + 0034 in isolation but never applies 0032 + 0033 between
 * them, so there was no end-to-end confirmation that the FULL forward
 * sequence leaves the database in the right shape.
 *
 * What this test proves (against a real disposable PostgreSQL):
 *   1. All four migrations apply in order, idempotent on re-runs,
 *      without leaking the partial-index state from 0031.
 *   2. The final `ctacte_movement_notes` schema (in the isolated
 *      namespace) has a FULL UNIQUE INDEX on `idempotency_key`
 *      (no `WHERE` predicate) so the bare-column
 *      `ON CONFLICT (idempotency_key)` inference works
 *      (defect #1 is closed).
 *   3. The final `ctacte` schema (isolated) also has a FULL
 *      UNIQUE INDEX on `idempotency_key` (0032 turns the partial
 *      index into a full one — same fix shape, same inference rule).
 *   4. The comprobante retries table (0033) carries its status
 *      CHECK constraint, lease columns, and the expiry index.
 *   5. **Service-layer contract** (real PG, isolated namespace):
 *      a. Concurrent same-key + same-body POSTs through the actual
 *         `addNote` service collapse to one persisted note + one
 *         `CTACTE_MOVEMENT_NOTE_ADDED` audit row.
 *      b. Same key + different payload surfaces as a `CONFLICT`
 *         `BusinessError(ErrorCode.CONFLICT)` — the same shape the
 *         route layer maps to HTTP 409.
 *   6. Re-applying the same sequence is a no-op (idempotency of the
 *      rollout itself).
 *
 * Test isolation strategy:
 *
 * The previous revision of this file ran against the production-named
 * schemas (`socios`, `tesoreria`). It failed in CI when Vitest scheduled
 * the sibling `ctacte_movement_notes.postgres.integration.test.ts` —
 * that file uses `DROP SCHEMA … CASCADE` in `beforeEach`, which races
 * against this file's `beforeAll` `CREATE TABLE IF NOT EXISTS`. The
 * sibling's drop tore down the tables this file just created, and the
 * seed `INSERT` failed with "column `socio_id` does not exist".
 *
 * To coexist with the sibling AND any future test that drops the
 * production schemas, this file now owns a pair of isolated namespaces
 * (`socios_ffseq_<rand>` and `tesoreria_ffseq_<rand>`). The pool is
 * wrapped in a Proxy that rewrites the production schema names in
 * emitted SQL strings to those isolated namespaces so the service
 * module's Drizzle calls land in this file's namespace. The audit
 * table (`public.audit_events`) is left un-rewritten because audit
 * emission is intentionally cross-namespace and the
 * `CTACTE_MOVEMENT_NOTE_ADDED` rows for this test are isolated by the
 * deterministic `entity_id` filter (`note_id = <our isolated note>`).
 *
 * Tests run sequentially within the file (Vitest default) but the
 * file may be parallelised by Vitest with other test files sharing
 * the same disposable database. The isolated namespaces mean this
 * file does NOT mutate the production-shaped schemas (`socios`,
 * `tesoreria`) at all — the sibling's `DROP SCHEMA … CASCADE` is a
 * no-op against the isolated namespaces and vice-versa.
 *
 * CI compatibility:
 *
 *   The CI workflow `.github/workflows/test.yml` provisions a single
 *   PostgreSQL service on port 5432 (`postgres:16-alpine`,
 *   `ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@localhost:5432/athlos`).
 *   This test is gated on `ATHLOS_TEST_DATABASE_URL` and throws loud
 *   if absent — it never silently skips. The disposable PostgreSQL
 *   referenced by the test is THE same CI service container; we
 *   exclusively use isolated namespaces so we do not touch the
 *   production schemas or the production-shaped rows. No separate
 *   port (`5433`) is referenced — the previous revision's claim of a
 *   local `5433` disposable was incorrect and is removed here.
 */

const databaseUrl = process.env['ATHLOS_TEST_DATABASE_URL']

// Two short random suffixes — combined with the test namespace prefix,
// they uniquely tag this file's isolated schemas. A re-run of the suite
// allocates fresh names, so the namespaces are also race-safe across
// concurrent CI jobs that share the same PostgreSQL service.
const SUFFIX = randomBytes(6).toString('hex')
const ISOLATED_SOCIOS = `socios_ffseq_${SUFFIX}`
const ISOLATED_TESORERIA = `tesoreria_ffseq_${SUFFIX}`

// Pool + Drizzle Db bound to the isolated namespaces. We use a Proxy
// around the pool to rewrite the SQL string the driver receives so
// the production Drizzle schema declarations (which emit
// `"socios".<table>` / `"tesoreria".<table>`) land in our isolated
// namespaces instead. The audit emitter writes to `public.audit_events`
// unchanged — that table is shared by the whole suite and is filtered
// by `entity_id` in this test's assertions.
let realPool: Pool | undefined
let db: Db | undefined

/**
 * Resolve a migration file path from inside this test file:
 *   apps/api/src/modules/socios/<this file>
 *     ↳ apps/api/src/modules               (..)
 *     ↳ apps/api/src                       (..)
 *     ↳ apps/api                           (..)
 *     ↳ apps                               (..)
 *     ↳ <repo root>                        (..) + packages/db/drizzle/<name>
 */
function migrationPath(name: string): string {
  const here = path.dirname(new URL(import.meta.url).pathname)
  return path.join(here, '..', '..', '..', '..', '..', 'packages/db/drizzle', name)
}

async function readSql(filename: string): Promise<string> {
  return readFile(migrationPath(filename), 'utf-8')
}

/**
 * Rewrite every `socios.` / `tesoreria.` schema-qualified identifier
 * to the test's isolated namespaces. We match the QUOTED form
 * (`"socios"."…"`) because Drizzle emits PG identifiers in double
 * quotes. The bare-word form (`socios.`, used by SQL hint comments
 * and our own ad-hoc raw SQL in this file) is also rewritten so a
 * test author who runs raw SQL through the proxy still benefits from
 * the isolation. The `public.` namespace is left alone so the audit
 * emitter's `public.audit_events` reads/writes land in the shared
 * schema (intentional — audit is cross-namespace by design).
 */
function rewriteSql(text: string): string {
  return (
    text
      .replaceAll(`"socios".`, `"${ISOLATED_SOCIOS}".`)
      .replaceAll(`"tesoreria".`, `"${ISOLATED_TESORERIA}".`)
      // Bare-word form used in test-side raw SQL strings.
      .replaceAll(`socios.`, `${ISOLATED_SOCIOS}.`)
      .replaceAll(`tesoreria.`, `${ISOLATED_TESORERIA}.`)
  )
}

/**
 * Wrap a `pg.Pool` so every `query()` call rewrites production
 * schema names to this test's isolated namespaces before reaching
 * the driver. The Proxy passes every other property/method through
 * unchanged (connect, end, on, …) so the wrapped pool stays a
 * drop-in replacement for the original.
 */
function wrapPool(pool: Pool): Pool {
  // The query rewriting is implemented inline to avoid the pg Pool
  // overload gymnastics — the inner function uses a permissive
  // signature, and the Proxy returns it cast as Pool['query'] so
  // TypeScript is satisfied without leaking the generic types.
  const queryFn = (target: Pool) =>
    function (this: unknown, ...args: unknown[]): unknown {
      const [config, ...rest] = args
      if (typeof config === 'string') {
        return (target.query as (...a: unknown[]) => unknown).call(
          target,
          rewriteSql(config),
          ...rest,
        )
      }
      if (config && typeof config === 'object' && 'text' in (config as Record<string, unknown>)) {
        const cfg = config as { text: string } & Record<string, unknown>
        return (target.query as (...a: unknown[]) => unknown).call(
          target,
          { ...cfg, text: rewriteSql(cfg.text) },
          ...rest,
        )
      }
      return (target.query as (...a: unknown[]) => unknown).call(target, config, ...rest)
    }
  return new Proxy(pool, {
    get(target, prop, receiver) {
      if (prop === 'query') {
        return queryFn(target)
      }
      return Reflect.get(target, prop, receiver)
    },
  }) as Pool
}

/**
 * Apply a single migration file in ONE transaction so the forward
 * sequence behaves like the production `psql -v ON_ERROR_STOP=1
 * --single-transaction` invocation. Returns the per-statement count
 * for diagnostic logging.
 *
 * The migration files reference `socios.` / `tesoreria.` directly;
 * we rewrite them to the isolated namespaces BEFORE executing, so
 * the migrations land in this test's owned schemas rather than
 * touching the production-named schemas.
 */
async function applySql(pool: Pool, filename: string): Promise<number> {
  const sql = await readSql(filename)
  // Drizzle hand-written files use `-->` as the statement delimiter
  // hint. Strip them so a single `query()` call is single-statement.
  const statements = sql
    .split(/-->\s*statement-breakpoint/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    // Rewrite schema references BEFORE the proxy sees them. (The proxy
    // would also handle this, but rewriting here keeps the migration
    // semantics localised to this helper.)
    .map((s) => rewriteSql(s))
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const stmt of statements) {
      await client.query(stmt)
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
  return statements.length
}

/**
 * Append a column to a table if the column does NOT already exist.
 * Idempotent — safe to call when a prior run already added the
 * column. This is the explicit-safe-setup form the brief asked for:
 * "Do not assume `CREATE TABLE IF NOT EXISTS` supplies missing
 * columns; use an isolated schema/table or explicit safe setup so
 * the real CI PostgreSQL service passes."
 */
async function addColumnIfMissing(
  pool: Pool,
  qualifiedTable: string,
  columnName: string,
  columnDef: string,
): Promise<void> {
  const check = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name   = $2
          AND column_name  = $3
     ) AS exists`,
    [qualifiedTable.split('.')[0], qualifiedTable.split('.')[1], columnName],
  )
  if (check.rows[0]?.exists) return
  await pool.query(`ALTER TABLE ${qualifiedTable} ADD COLUMN ${columnName} ${columnDef}`)
}

beforeAll(async () => {
  if (!databaseUrl)
    throw new Error('ATHLOS_TEST_DATABASE_URL is required for the full forward sequence test')
  // `createDb` returns the typed Drizzle client + the underlying
  // pool. We do ALL structural work (schema setup + migrations +
  // seeding) through the raw pool so the SQL we emit is exact, and
  // THEN wrap the pool in a schema-rewriting Proxy before binding
  // it to the Drizzle client that the service-layer tests use.
  const handle = createDb({ connectionString: databaseUrl })
  realPool = handle.pool
  // Lightweight connectivity probe — fail loud if the CI service is
  // unreachable.
  await realPool.query('SELECT 1')

  // Drop any leftover isolated schemas from a previous failed run.
  // CASCADE is required because the previous run may have left
  // tables / indexes / FKs behind.
  await realPool.query(`DROP SCHEMA IF EXISTS "${ISOLATED_TESORERIA}" CASCADE`)
  await realPool.query(`DROP SCHEMA IF EXISTS "${ISOLATED_SOCIOS}" CASCADE`)

  // Create the isolated namespaces. The test owns these exclusively —
  // the sibling test file's `DROP SCHEMA` against the production
  // `socios` / `tesoreria` namespaces does not touch them.
  await realPool.query(`CREATE SCHEMA "${ISOLATED_SOCIOS}"`)
  await realPool.query(`CREATE SCHEMA "${ISOLATED_TESORERIA}"`)

  // Ensure `public.audit_events` exists in the CI database. The CI
  // service container starts EMPTY — no migrations are applied
  // automatically. Migrations 0000 + 0011 own this table, but neither
  // this file nor the sibling test file applies them. We need the
  // table because the audit emitter (called by `addNote`) writes
  // here, and our concurrency assertions count audit rows by
  // `entity_id`. Without this setup, `addNote` would 5xx on the
  // audit emit AND our assertions would 42P01 (`relation does not
  // exist`).
  await realPool.query(`
    CREATE TABLE IF NOT EXISTS "public"."audit_events" (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      operator_id uuid,
      action text NOT NULL,
      entity_type text NOT NULL,
      entity_id text NOT NULL,
      old_value jsonb,
      new_value jsonb,
      source_ip text,
      metadata jsonb,
      idempotency_key text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  await realPool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS "uq_audit_events_idempotency_key"
      ON "public"."audit_events" ("idempotency_key")
      WHERE "idempotency_key" IS NOT NULL
  `)

  // Create the bare-minimum parent tables the migrations reference.
  // We use `addColumnIfMissing` for any column a prior partial run
  // might have skipped, so the schema is fully populated regardless
  // of history.
  await realPool.query(`
    CREATE TABLE "${ISOLATED_SOCIOS}"."socios" (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      numero_socio text NOT NULL,
      nombre text NOT NULL,
      apellido text NOT NULL,
      dni text NOT NULL,
      fecha_alta date NOT NULL,
      estado varchar(16) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  await realPool.query(`
    CREATE TABLE "${ISOLATED_SOCIOS}"."socio_attachments" (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      socio_id uuid NOT NULL REFERENCES "${ISOLATED_SOCIOS}"."socios"(id),
      filename text NOT NULL,
      category varchar(16) NOT NULL,
      mime_type text NOT NULL,
      size_bytes bigint NOT NULL,
      storage_path text NOT NULL,
      storage_sha256 text NOT NULL,
      uploaded_by uuid NOT NULL,
      uploaded_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  await realPool.query(`
    CREATE TABLE "${ISOLATED_TESORERIA}"."ctacte" (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      socio_id uuid NOT NULL REFERENCES "${ISOLATED_SOCIOS}"."socios"(id),
      fecha date NOT NULL,
      tipo varchar(16) NOT NULL,
      debe numeric(14,2) NOT NULL DEFAULT 0,
      haber numeric(14,2) NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  // Apply all four migrations ONCE at startup. The migrations use
  // `IF NOT EXISTS` everywhere so re-applying is a no-op. Doing this
  // in beforeAll (rather than beforeEach) gives the service-layer
  // tests a stable schema to write to. The migrations land in the
  // isolated namespaces — they NEVER touch the production-shaped
  // `socios` / `tesoreria` schemas.
  await applySql(realPool, '0031_ctacte_movement_notes.sql')
  await applySql(realPool, '0032_ctacte_payment_idempotency.sql')
  await applySql(realPool, '0033_ctacte_comprobante_retries.sql')
  await applySql(realPool, '0034_ctacte_movement_notes_idempotency_key_full_unique.sql')

  // Explicit-safe column guards — defensive net for any future
  // migration that adds a column to `tesoreria.ctacte` without
  // `IF NOT EXISTS`. The brief mandates "do not assume `CREATE
  // TABLE IF NOT EXISTS` supplies missing columns". This is the
  // belt-and-braces complement to the `IF NOT EXISTS` clauses
  // already present in 0031/0032/0034.
  await addColumnIfMissing(
    realPool,
    `${ISOLATED_TESORERIA}.ctacte`,
    'idempotency_operator_id',
    'uuid',
  )

  // Seed the bare minimum parent rows for FK + content tests.
  // Idempotent via ON CONFLICT.
  const socioId = '22222222-2222-4222-8222-222222222222'
  await realPool.query(
    `INSERT INTO "${ISOLATED_SOCIOS}"."socios"
       (id, numero_socio, nombre, apellido, dni, fecha_alta, estado)
     VALUES ($1, '12345', 'Juan', 'Pérez', '28765432', '2024-01-01', 'activo')
     ON CONFLICT (id) DO NOTHING`,
    [socioId],
  )
  const movementId = '11111111-1111-4111-8111-111111111111'
  await realPool.query(
    `INSERT INTO "${ISOLATED_TESORERIA}"."ctacte"
       (id, socio_id, fecha, tipo, debe, haber)
     VALUES ($1, $2, '2026-07-10', 'CREDITO', '0', '100')
     ON CONFLICT (id) DO NOTHING`,
    [movementId, socioId],
  )

  // Bind a Drizzle Db to a SCHEMA-REWRITING proxy of the pool. Every
  // INSERT/SELECT/UPDATE the service emits against `socios.X` or
  // `tesoreria.X` lands in the isolated namespaces. `public.X`
  // queries (audit emitter, operators lookup) pass through
  // unchanged so the cross-namespace audit table is shared with
  // sibling tests (we filter audit rows by `entity_id` to scope
  // counts to this test).
  const proxiedPool = wrapPool(realPool)
  // Re-bind the Drizzle client to the proxied pool, preserving the
  // same schema declarations the API process uses. The schema is
  // imported from the production barrel so the service's table
  // references resolve to the same columns/indexes the API uses —
  // the Proxy on the pool is the ONLY thing that changes.
  db = drizzle(proxiedPool, { schema }) as Db
})

beforeEach(async () => {
  if (!realPool) return
  // TRUNCATE (not DROP) so the schema/tables/migrations persist for
  // the service-layer tests to write to, while leftover rows from
  // prior test runs (or sibling files) are cleared. We only touch
  // the table we own in the isolated namespace; the parent
  // `socios.socios` and `tesoreria.ctacte` rows seeded in
  // `beforeAll` are kept.
  await realPool.query(
    `TRUNCATE TABLE "${ISOLATED_SOCIOS}"."ctacte_movement_notes" RESTART IDENTITY CASCADE`,
  )
  // NOTE: we deliberately do NOT TRUNCATE `public.audit_events` —
  // the table is shared by the whole suite and audit rows are
  // scoped by `entity_id` (= our note_id) when asserted. A blind
  // TRUNCATE here would race with sibling test files and would
  // erase unrelated audit history.
})

afterAll(async () => {
  if (!realPool) return
  // Best-effort cleanup of the isolated namespaces. CASCADE handles
  // any tables / indexes / FKs the migrations left behind. Wrapped
  // in try/catch so a failure here does not mask the actual test
  // outcome — leftover schemas are harmless (next run regenerates
  // a fresh random suffix).
  try {
    await realPool.query(`DROP SCHEMA IF EXISTS "${ISOLATED_TESORERIA}" CASCADE`)
    await realPool.query(`DROP SCHEMA IF EXISTS "${ISOLATED_SOCIOS}" CASCADE`)
  } catch {
    // ignore — see comment above
  }
  await realPool.end()
})

// ──────────────────────────────────────────────────────────────────────────
// Bug-reproduction evidence (defect #1 was real).
//
// The pre-fix production deployment would have applied 0031 with the
// partial `WHERE idempotency_key IS NOT NULL` predicate. Bare-column
// `ON CONFLICT (idempotency_key) DO NOTHING` cannot infer that index
// and PostgreSQL returns:
//   "there is no unique or exclusion constraint matching the ON
//    CONFLICT specification"
// — a 5xx that would 5xx every note POST in production. 0034 is the
// forward-only fix. We prove the index shape in the isolated namespace
// (the same shape production lands in after 0034).
// ──────────────────────────────────────────────────────────────────────────

describe('full forward 0031 → 0032 → 0033 → 0034 sequence (isolated namespace)', () => {
  it('each migration file contributes at least one statement (per-file `;` breakdown)', async () => {
    if (!realPool) throw new Error('PostgreSQL pool was not initialized')
    // The production rollout is `docker exec psql -v ON_ERROR_STOP=1
    // --single-transaction ... < 003X.sql`. We mirror that here with
    // a per-file `BEGIN/COMMIT`. Each file MUST contribute at least
    // one statement (otherwise the migration is effectively empty).
    const counts = {
      '0031': await applySql(realPool, '0031_ctacte_movement_notes.sql'),
      '0032': await applySql(realPool, '0032_ctacte_payment_idempotency.sql'),
      '0033': await applySql(realPool, '0033_ctacte_comprobante_retries.sql'),
      '0034': await applySql(
        realPool,
        '0034_ctacte_movement_notes_idempotency_key_full_unique.sql',
      ),
    }
    expect(counts['0031']).toBeGreaterThan(0)
    expect(counts['0032']).toBeGreaterThan(0)
    expect(counts['0033']).toBeGreaterThan(0)
    expect(counts['0034']).toBeGreaterThan(0)
  })

  it(`final "${ISOLATED_SOCIOS}.ctacte_movement_notes.idempotency_key" carries a FULL UNIQUE INDEX (no WHERE clause)`, async () => {
    if (!realPool) throw new Error('PostgreSQL pool was not initialized')
    const rows = await realPool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
          WHERE schemaname = $1
            AND tablename  = 'ctacte_movement_notes'
            AND indexname  = 'ctacte_movement_notes_idempotency_key_unique'`,
      [ISOLATED_SOCIOS],
    )
    expect(rows.rowCount).toBe(1)
    const def = rows.rows[0]!.indexdef
    expect(def).toMatch(/UNIQUE INDEX/i)
    // The defining property: 0034 must have replaced the partial
    // predicate with a FULL index, so the bare-column ON CONFLICT
    // inference works. Production has the same shape.
    expect(def).not.toMatch(/WHERE/i)
  })

  it(`final "${ISOLATED_TESORERIA}.ctacte.idempotency_key" carries a FULL UNIQUE INDEX (0032 produced the same shape)`, async () => {
    if (!realPool) throw new Error('PostgreSQL pool was not initialized')
    const rows = await realPool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
          WHERE schemaname = $1
            AND tablename  = 'ctacte'
            AND indexname  = 'ctacte_idempotency_key_unique'`,
      [ISOLATED_TESORERIA],
    )
    expect(rows.rowCount).toBe(1)
    const def = rows.rows[0]!.indexdef
    expect(def).toMatch(/UNIQUE INDEX/i)
    // 0031 created a partial index here too (`WHERE idempotency_key
    // IS NOT NULL`); 0032 replaced it with a full index. Same
    // defect-shape, same fix-shape.
    expect(def).not.toMatch(/WHERE/i)
  })

  it('comprobante retries table (0033) carries status CHECK, lease, and expiry index', async () => {
    if (!realPool) throw new Error('PostgreSQL pool was not initialized')

    // Table + primary key present
    const tableRows = await realPool.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM information_schema.tables
          WHERE table_schema = $1
            AND table_name   = 'ctacte_comprobante_retries'
       ) AS exists`,
      [ISOLATED_TESORERIA],
    )
    expect(tableRows.rows[0]!.exists).toBe(true)

    // Status CHECK constraint is present and lists the three states.
    const checkRows = await realPool.query<{ condef: string }>(
      `SELECT pg_get_constraintdef(c.oid) AS condef
         FROM pg_constraint c
         JOIN pg_class t ON c.conrelid = t.oid
         JOIN pg_namespace n ON t.relnamespace = n.oid
        WHERE n.nspname = $1
          AND t.relname = 'ctacte_comprobante_retries'
          AND c.conname = 'ctacte_comprobante_retries_status_check'`,
      [ISOLATED_TESORERIA],
    )
    expect(checkRows.rowCount).toBe(1)
    expect(checkRows.rows[0]!.condef).toMatch(/rendering/)
    expect(checkRows.rows[0]!.condef).toMatch(/complete/)
    expect(checkRows.rows[0]!.condef).toMatch(/failed/)

    // Expiry index present
    const idxRows = await realPool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = $1
          AND tablename  = 'ctacte_comprobante_retries'
          AND indexname  = 'ctacte_comprobante_retries_expires_at_idx'`,
      [ISOLATED_TESORERIA],
    )
    expect(idxRows.rowCount).toBe(1)
  })

  it('bare-column `ON CONFLICT (idempotency_key)` resolves on the isolated ctacte_movement_notes after the full sequence', async () => {
    if (!realPool) throw new Error('PostgreSQL pool was not initialized')

    // First INSERT establishes the row.
    const movementId = '11111111-1111-4111-8111-111111111111'
    const opId = '00000000-0000-4000-8000-000000000001'
    await realPool.query(
      `INSERT INTO "${ISOLATED_SOCIOS}"."ctacte_movement_notes"
           (ctacte_movement_id, body, author_operator_id, idempotency_key)
         VALUES ($1, 'first note', $2, 'full-seq-key-A')`,
      [movementId, opId],
    )

    // Bare-column ON CONFLICT — must return rowCount=0 with no error.
    const conflictRes = await realPool.query(
      `INSERT INTO "${ISOLATED_SOCIOS}"."ctacte_movement_notes"
           (ctacte_movement_id, body, author_operator_id, idempotency_key)
         VALUES ($1, 'first note', $2, 'full-seq-key-A')
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
      [movementId, opId],
    )
    expect(conflictRes.rowCount).toBe(0)

    // DB still has exactly one row for this key.
    const countRes = await realPool.query<{ count: string }>(
      `SELECT count(*)::text AS count
           FROM "${ISOLATED_SOCIOS}"."ctacte_movement_notes"
          WHERE idempotency_key = 'full-seq-key-A'`,
    )
    expect(countRes.rows[0]!.count).toBe('1')
  })

  it('re-applying the full sequence is a no-op (idempotent rollout)', async () => {
    if (!realPool) throw new Error('PostgreSQL pool was not initialized')

    // Snapshot the index definition
    const beforeRows = await realPool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = $1
          AND tablename = 'ctacte_movement_notes'
          AND indexname = 'ctacte_movement_notes_idempotency_key_unique'`,
      [ISOLATED_SOCIOS],
    )
    expect(beforeRows.rowCount).toBe(1)
    const before = beforeRows.rows[0]!.indexdef

    // Re-apply the same four migrations — every CREATE / ADD COLUMN /
    // CREATE INDEX uses IF NOT EXISTS, so the shape must be unchanged.
    await applySql(realPool, '0031_ctacte_movement_notes.sql')
    await applySql(realPool, '0032_ctacte_payment_idempotency.sql')
    await applySql(realPool, '0033_ctacte_comprobante_retries.sql')
    await applySql(realPool, '0034_ctacte_movement_notes_idempotency_key_full_unique.sql')

    const afterRows = await realPool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = $1
          AND tablename = 'ctacte_movement_notes'
          AND indexname = 'ctacte_movement_notes_idempotency_key_unique'`,
      [ISOLATED_SOCIOS],
    )
    expect(afterRows.rowCount).toBe(1)
    const after = afterRows.rows[0]!.indexdef
    expect(after).toBe(before)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Service-layer contract proof (real PG, isolated namespace).
//
// The previous revision exercised the raw `insertNote` repository
// against the production-named schemas. That test raced with the
// sibling `ctacte_movement_notes.postgres.integration.test.ts`
// (which `DROP SCHEMA`s the production namespaces in `beforeEach`)
// and failed in CI with "column `socio_id` of relation `ctacte` does
// not exist". This block exercises the SAME contract through the
// actual service (`addNote`) bound to a schema-rewriting pool proxy
// against isolated namespaces, so the contract is proven end-to-end
// without conflicting with any sibling test file.
//
// The contract under test (real PostgreSQL behaviour):
//
//   1. Concurrent same-key + same-body POSTs through `addNote`
//      collapse to ONE persisted note (real PG UNIQUE INDEX race)
//      and ONE `CTACTE_MOVEMENT_NOTE_ADDED` audit row (only the
//      `created: true` branch emits; the conflict-losers emit none).
//
//   2. Same key + different body surfaces as
//      `BusinessError(ErrorCode.CONFLICT)` — the same shape the
//      route layer maps to HTTP 409.
// ──────────────────────────────────────────────────────────────────────────

describe('full forward sequence → service-layer concurrent contract (defect #2, real PG, isolated namespace)', () => {
  it('same-key + same-body concurrent calls through addNote collapse to one row + one audit (real PG race)', async () => {
    if (!db || !realPool) throw new Error('PostgreSQL Db was not initialized')
    const movementId = '11111111-1111-4111-8111-111111111111'
    const opId = '00000000-0000-4000-8000-000000000001'
    const key = `ffseq-concurrent-same-body-${SUFFIX}`

    const [a, b] = await Promise.all([
      addNote(db, {
        ctacteMovementId: movementId,
        operatorId: opId,
        body: 'mismo cuerpo',
        idempotencyKey: key,
      }),
      addNote(db, {
        ctacteMovementId: movementId,
        operatorId: opId,
        body: 'mismo cuerpo',
        idempotencyKey: key,
      }),
    ])

    // Both service calls return the SAME persisted note — the canonical
    // payload match in the conflict-loser branch surfaces the winner
    // row to the loser without an error (silent replay).
    expect(a.id).toBe(b.id)
    expect(a.body).toBe('mismo cuerpo')

    // Exactly one persisted row in the isolated namespace.
    const noteCount = await realPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "${ISOLATED_SOCIOS}"."ctacte_movement_notes"
        WHERE idempotency_key = $1`,
      [key],
    )
    expect(noteCount.rows[0]!.count).toBe('1')

    // Exactly one CTACTE_MOVEMENT_NOTE_ADDED audit row, scoped to our
    // note's `entity_id` so unrelated sibling-test audit rows do not
    // contaminate the count.
    const auditCount = await realPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.audit_events
        WHERE action = 'CTACTE_MOVEMENT_NOTE_ADDED'
          AND entity_type = 'ctacte_movement_note'
          AND entity_id   = $1`,
      [a.id],
    )
    expect(auditCount.rows[0]!.count).toBe('1')
  })

  it('high-parallelism same-key + same-body (10 racers) through addNote → exactly one row + exactly one audit', async () => {
    if (!db || !realPool) throw new Error('PostgreSQL Db was not initialized')
    const movementId = '11111111-1111-4111-8111-111111111111'
    const opId = '00000000-0000-4000-8000-000000000001'
    const key = `ffseq-concurrent-10x-same-body-${SUFFIX}`

    // 10 parallel calls through the service on the SAME key + SAME
    // body + SAME operator. PG's unique index serialises them; only
    // the creator emits an audit; conflict-losers silently replay.
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        addNote(db!, {
          ctacteMovementId: movementId,
          operatorId: opId,
          body: 'storm body',
          idempotencyKey: key,
        }),
      ),
    )

    // Every call observes the SAME persisted note id.
    const ids = new Set(results.map((r) => r.id))
    expect(ids.size).toBe(1)

    // DB-side: exactly one row for this key in the isolated namespace.
    const noteCount = await realPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "${ISOLATED_SOCIOS}"."ctacte_movement_notes"
          WHERE idempotency_key = $1`,
      [key],
    )
    expect(noteCount.rows[0]!.count).toBe('1')

    // Exactly ONE audit row, scoped to the creator's `entity_id`.
    const winningId = results[0]!.id
    const auditCount = await realPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.audit_events
        WHERE action = 'CTACTE_MOVEMENT_NOTE_ADDED'
          AND entity_type = 'ctacte_movement_note'
          AND entity_id   = $1`,
      [winningId],
    )
    expect(auditCount.rows[0]!.count).toBe('1')
  })

  it('same-key + different-body through addNote throws CONFLICT (real PG; route layer maps to 409)', async () => {
    if (!db || !realPool) throw new Error('PostgreSQL Db was not initialized')
    const movementId = '11111111-1111-4111-8111-111111111111'
    const opId = '00000000-0000-4000-8000-000000000001'
    const key = `ffseq-different-body-${SUFFIX}`

    // First call writes the row.
    const first = await addNote(db, {
      ctacteMovementId: movementId,
      operatorId: opId,
      body: 'primera',
      idempotencyKey: key,
    })
    expect(first.body).toBe('primera')

    // Second call with a DIFFERENT body but the SAME key. The
    // repository's conflict-loser path returns the existing row;
    // the service's canonical-match check fails on `body`, so the
    // service throws `BusinessError(CONFLICT, ...)` — the exact
    // shape the route layer catches and maps to HTTP 409.
    await expect(
      addNote(db, {
        ctacteMovementId: movementId,
        operatorId: opId,
        body: 'segunda (diferente)',
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
    })

    // DB faithfully keeps the FIRST body — not the new one.
    const stored = await realPool.query<{ body: string; id: string }>(
      `SELECT id, body FROM "${ISOLATED_SOCIOS}"."ctacte_movement_notes"
        WHERE idempotency_key = $1`,
      [key],
    )
    expect(stored.rowCount).toBe(1)
    expect(stored.rows[0]!.body).toBe('primera')

    // Exactly one note row.
    const noteCount = await realPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "${ISOLATED_SOCIOS}"."ctacte_movement_notes"
        WHERE idempotency_key = $1`,
      [key],
    )
    expect(noteCount.rows[0]!.count).toBe('1')

    // Exactly one audit row (the creator's; the conflict-loser's
    // `CONFLICT` throw aborts before the audit branch).
    const auditCount = await realPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.audit_events
        WHERE action = 'CTACTE_MOVEMENT_NOTE_ADDED'
          AND entity_type = 'ctacte_movement_note'
          AND entity_id   = $1`,
      [first.id],
    )
    expect(auditCount.rows[0]!.count).toBe('1')
  })

  it('two concurrent same-key + different-body calls through addNote: one creator, one CONFLICT thrower (real PG)', async () => {
    if (!db || !realPool) throw new Error('PostgreSQL Db was not initialized')
    const movementId = '11111111-1111-4111-8111-111111111111'
    const opId = '00000000-0000-4000-8000-000000000001'
    const key = `ffseq-concurrent-different-body-${SUFFIX}`

    // Two parallel calls with different bodies. PG's UNIQUE INDEX
    // serialises them — one becomes the creator, the other takes
    // the conflict-loser path and the service throws CONFLICT
    // because the loser's intent body does not match the persisted
    // row's body.
    const settled = await Promise.allSettled([
      addNote(db, {
        ctacteMovementId: movementId,
        operatorId: opId,
        body: 'intent-A',
        idempotencyKey: key,
      }),
      addNote(db, {
        ctacteMovementId: movementId,
        operatorId: opId,
        body: 'intent-B',
        idempotencyKey: key,
      }),
    ])

    const fulfilled = settled.filter((s) => s.status === 'fulfilled')
    const rejected = settled.filter((s) => s.status === 'rejected')
    // Exactly one of each.
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)

    // The fulfilled one is the creator — its body is whichever won
    // the PG race (A or B).
    const creator = fulfilled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof addNote>>>
    expect(['intent-A', 'intent-B']).toContain(creator.value.body)

    // The rejected one is the conflict-loser; the service surfaces
    // CONFLICT — same envelope the route maps to HTTP 409.
    const loser = rejected[0] as PromiseRejectedResult
    expect((loser.reason as { code?: string }).code).toBe(ErrorCode.CONFLICT)

    // Exactly one persisted row, and one audit row for the creator's
    // note id. The loser's `CONFLICT` throw aborted before the audit
    // branch, so there is exactly one audit row even though both
    // calls reached the service.
    const noteCount = await realPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "${ISOLATED_SOCIOS}"."ctacte_movement_notes"
        WHERE idempotency_key = $1`,
      [key],
    )
    expect(noteCount.rows[0]!.count).toBe('1')

    const auditCount = await realPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.audit_events
        WHERE action = 'CTACTE_MOVEMENT_NOTE_ADDED'
          AND entity_type = 'ctacte_movement_note'
          AND entity_id   = $1`,
      [creator.value.id],
    )
    expect(auditCount.rows[0]!.count).toBe('1')
  })
})
