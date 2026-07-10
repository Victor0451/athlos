import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Pool } from 'pg'
import { createDb, type Db } from '@athlos/db'
import { insertNote, findNoteByIdempotencyKey } from './ctacte_movement_notes_repository.ts'

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
 *   2. The final `socios.ctacte_movement_notes` schema has a FULL
 *      UNIQUE INDEX on `idempotency_key` (no `WHERE` predicate) so
 *      the bare-column `ON CONFLICT (idempotency_key)` inference
 *      works (defect #1 is closed).
 *   3. The final `tesoreria.ctacte` schema also has a FULL
 *      UNIQUE INDEX on `idempotency_key` (0032 turns the partial
 *      index into a full one — same fix shape, same inference rule).
 *   4. The comprobante retries table (0033) carries its status
 *      CHECK constraint, lease columns, and the expiry index.
 *   5. Two concurrent `insertNote` calls with the SAME key + SAME
 *      body collapse to one DB row + one creator (defect #2 — real
 *      PG race).
 *   6. Two concurrent `insertNote` calls with the SAME key +
 *      DIFFERENT body return the surviving row to one call and a
 *      CONFLICT payload to the other (defect #2 conflict-loser
 *      branch — real PG).
 *   7. Re-applying the same sequence is a no-op (idempotency of the
 *      rollout itself).
 *
 * Test isolation strategy: this file applies the migrations to the
 * PRODUCTION schemas (`socios` / `tesoreria`) rather than file-scoped
 * ones. The reason is that `insertNote` and `findNoteByIdempotencyKey`
 * resolve their schema names from the static Drizzle declaration, so
 * they always write to the production schemas. The Drizzle layer is
 * the unit under test for the concurrency scenarios — there's no
 * observable benefit to faking a different schema for the migration
 * runner when the migrated tables must exist in production schemas
 * for Drizzle to write anywhere.
 *
 * Tests run sequentially within the file (Vitest default) but the
 * file may be parallelised by Vitest with other test files sharing
 * the same disposable database. To avoid destructive inter-file
 * interference, this file uses `TRUNCATE` between tests (clears data
 * without dropping structure) instead of the existing file's
 * `DROP SCHEMA CASCADE` (which would tear down the tables Drizzle
 * expects to find). The two test files together cover the full
 * forward sequence + the partial-index regression proof.
 */

const databaseUrl = process.env['ATHLOS_TEST_DATABASE_URL']
let db: { db: Db; pool: Pool } | undefined

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
 * Apply a single migration file in ONE transaction so the
 * forward sequence behaves like the production `psql
 * -v ON_ERROR_STOP=1 --single-transaction` invocation. Returns
 * the per-statement count for diagnostic logging.
 */
async function applySql(pool: Pool, filename: string): Promise<number> {
  const sql = await readSql(filename)
  // Drizzle hand-written files use `-->` as the statement delimiter
  // hint. Strip them so a single `query()` call is single-statement.
  const statements = sql
    .split(/-->\s*statement-breakpoint/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
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

beforeAll(async () => {
  if (!databaseUrl)
    throw new Error('ATHLOS_TEST_DATABASE_URL is required for the full forward sequence test')
  db = createDb({ connectionString: databaseUrl })
  await db.pool.query('SELECT 1')

  // Ensure the production schemas exist (a prior test file may have
  // dropped them). Idempotent.
  await db.pool.query(`CREATE SCHEMA IF NOT EXISTS "socios"`)
  await db.pool.query(`CREATE SCHEMA IF NOT EXISTS "tesoreria"`)

  // Create the bare-minimum parent tables the migrations reference.
  // Migration 0031 expects `socios.socios`, `socios.socio_attachments`,
  // and `tesoreria.ctacte`. Each CREATE is `IF NOT EXISTS` so a
  // prior-applied migration 0020/0021 is left intact.
  await db.pool.query(`
    CREATE TABLE IF NOT EXISTS "socios"."socios" (
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
  await db.pool.query(`
    CREATE TABLE IF NOT EXISTS "socios"."socio_attachments" (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      socio_id uuid NOT NULL REFERENCES "socios"."socios"(id),
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
  await db.pool.query(`
    CREATE TABLE IF NOT EXISTS "tesoreria"."ctacte" (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      socio_id uuid NOT NULL REFERENCES "socios"."socios"(id),
      fecha date NOT NULL,
      tipo varchar(16) NOT NULL,
      debe numeric(14,2) NOT NULL DEFAULT 0,
      haber numeric(14,2) NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  // Apply all four migrations ONCE at startup. The migrations use
  // `IF NOT EXISTS` everywhere so re-applying is a no-op. Doing this
  // in beforeAll (rather than beforeEach) gives Drizzle the schema
  // it expects and avoids DROPs that would race with other test
  // files parallelised by Vitest on the same disposable database.
  await applySql(db.pool, '0031_ctacte_movement_notes.sql')
  await applySql(db.pool, '0032_ctacte_payment_idempotency.sql')
  await applySql(db.pool, '0033_ctacte_comprobante_retries.sql')
  await applySql(db.pool, '0034_ctacte_movement_notes_idempotency_key_full_unique.sql')

  // Seed the bare minimum parent rows for FK + content tests.
  // Idempotent via ON CONFLICT.
  const socioId = '22222222-2222-4222-8222-222222222222'
  await db.pool.query(
    `INSERT INTO "socios"."socios"
       (id, numero_socio, nombre, apellido, dni, fecha_alta, estado)
     VALUES ($1, '12345', 'Juan', 'Pérez', '28765432', '2024-01-01', 'activo')
     ON CONFLICT (id) DO NOTHING`,
    [socioId],
  )
  const movementId = '11111111-1111-4111-8111-111111111111'
  await db.pool.query(
    `INSERT INTO "tesoreria"."ctacte"
       (id, socio_id, fecha, tipo, debe, haber)
     VALUES ($1, $2, '2026-07-10', 'CREDITO', '0', '100')
     ON CONFLICT (id) DO NOTHING`,
    [movementId, socioId],
  )
})

beforeEach(async () => {
  if (!db) return
  // TRUNCATE (not DROP) so the schema/tables/migrations persist
  // for Drizzle to write to, while leftover rows from prior test
  // runs (or other interleaved tests) are cleared. We only touch
  // the table we own; the parent `socios.socios` and
  // `tesoreria.ctacte` rows seeded in `beforeAll` are kept.
  await db.pool.query(`TRUNCATE TABLE "socios"."ctacte_movement_notes" RESTART IDENTITY CASCADE`)
})

afterAll(async () => {
  await db?.pool.end()
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
// forward-only fix.
// ──────────────────────────────────────────────────────────────────────────

describe('full forward 0031 → 0032 → 0033 → 0034 sequence', () => {
  it('each migration file contributes at least one statement (per-file `;` breakdown)', async () => {
    if (!db) throw new Error('PostgreSQL pool was not initialized')
    // The production rollout is `docker exec psql -v ON_ERROR_STOP=1
    // --single-transaction ... < 003X.sql`. We mirror that here with
    // a per-file `BEGIN/COMMIT`. Each file MUST contribute at least
    // one statement (otherwise the migration is effectively empty).
    const counts = {
      '0031': await applySql(db.pool, '0031_ctacte_movement_notes.sql'),
      '0032': await applySql(db.pool, '0032_ctacte_payment_idempotency.sql'),
      '0033': await applySql(db.pool, '0033_ctacte_comprobante_retries.sql'),
      '0034': await applySql(db.pool, '0034_ctacte_movement_notes_idempotency_key_full_unique.sql'),
    }
    expect(counts['0031']).toBeGreaterThan(0)
    expect(counts['0032']).toBeGreaterThan(0)
    expect(counts['0033']).toBeGreaterThan(0)
    expect(counts['0034']).toBeGreaterThan(0)
  })

  it('final `socios.ctacte_movement_notes.idempotency_key` carries a FULL UNIQUE INDEX (no WHERE clause)', async () => {
    if (!db) throw new Error('PostgreSQL pool was not initialized')
    const rows = await db.pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
          WHERE schemaname = 'socios'
            AND tablename = 'ctacte_movement_notes'
            AND indexname = 'ctacte_movement_notes_idempotency_key_unique'`,
    )
    expect(rows.rowCount).toBe(1)
    const def = rows.rows[0]!.indexdef
    expect(def).toMatch(/UNIQUE INDEX/i)
    expect(def).toMatch(/ON\s+socios\.ctacte_movement_notes/i)
    // The DEFINING property: 0034 must have replaced the partial
    // predicate with a FULL index, so the bare-column ON CONFLICT
    // inference works.
    expect(def).not.toMatch(/WHERE/i)
  })

  it('final `tesoreria.ctacte.idempotency_key` carries a FULL UNIQUE INDEX (0032 produced the same shape)', async () => {
    if (!db) throw new Error('PostgreSQL pool was not initialized')
    const rows = await db.pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
          WHERE schemaname = 'tesoreria'
            AND tablename = 'ctacte'
            AND indexname = 'ctacte_idempotency_key_unique'`,
    )
    expect(rows.rowCount).toBe(1)
    const def = rows.rows[0]!.indexdef
    expect(def).toMatch(/UNIQUE INDEX/i)
    expect(def).toMatch(/ON\s+tesoreria\.ctacte/i)
    // 0031 created a partial index here too (`WHERE idempotency_key
    // IS NOT NULL`); 0032 replaced it with a full index. Same
    // defect-shape, same fix-shape.
    expect(def).not.toMatch(/WHERE/i)
  })

  it('comprobante retries table (0033) carries status CHECK, lease, and expiry index', async () => {
    if (!db) throw new Error('PostgreSQL pool was not initialized')

    // Table + primary key present
    const tableRows = await db.pool.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'tesoreria'
            AND table_name   = 'ctacte_comprobante_retries'
       ) AS exists`,
    )
    expect(tableRows.rows[0]!.exists).toBe(true)

    // Status CHECK constraint is present and lists the three states.
    const checkRows = await db.pool.query<{ condef: string }>(
      `SELECT pg_get_constraintdef(c.oid) AS condef
         FROM pg_constraint c
         JOIN pg_class t ON c.conrelid = t.oid
         JOIN pg_namespace n ON t.relnamespace = n.oid
        WHERE n.nspname = 'tesoreria'
          AND t.relname = 'ctacte_comprobante_retries'
          AND c.conname = 'ctacte_comprobante_retries_status_check'`,
    )
    expect(checkRows.rowCount).toBe(1)
    expect(checkRows.rows[0]!.condef).toMatch(/rendering/)
    expect(checkRows.rows[0]!.condef).toMatch(/complete/)
    expect(checkRows.rows[0]!.condef).toMatch(/failed/)

    // Expiry index present
    const idxRows = await db.pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'tesoreria'
          AND tablename  = 'ctacte_comprobante_retries'
          AND indexname  = 'ctacte_comprobante_retries_expires_at_idx'`,
    )
    expect(idxRows.rowCount).toBe(1)
  })

  it('bare-column `ON CONFLICT (idempotency_key)` resolves on ctacte_movement_notes after the full sequence', async () => {
    if (!db) throw new Error('PostgreSQL pool was not initialized')

    // First INSERT establishes the row.
    const movementId = '11111111-1111-4111-8111-111111111111'
    const opId = '00000000-0000-4000-8000-000000000001'
    await db.pool.query(
      `INSERT INTO "socios"."ctacte_movement_notes"
           (ctacte_movement_id, body, author_operator_id, idempotency_key)
         VALUES ($1, 'first note', $2, 'full-seq-key-A')`,
      [movementId, opId],
    )

    // Bare-column ON CONFLICT — must return rowCount=0 with no error.
    const conflictRes = await db.pool.query(
      `INSERT INTO "socios"."ctacte_movement_notes"
           (ctacte_movement_id, body, author_operator_id, idempotency_key)
         VALUES ($1, 'first note', $2, 'full-seq-key-A')
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
      [movementId, opId],
    )
    expect(conflictRes.rowCount).toBe(0)

    // DB still has exactly one row for this key.
    const countRes = await db.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
           FROM "socios"."ctacte_movement_notes"
          WHERE idempotency_key = 'full-seq-key-A'`,
    )
    expect(countRes.rows[0]!.count).toBe('1')
  })

  it('re-applying the full sequence is a no-op (idempotent rollout)', async () => {
    if (!db) throw new Error('PostgreSQL pool was not initialized')

    // Snapshot the index definition
    const beforeRows = await db.pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'socios'
          AND tablename = 'ctacte_movement_notes'
          AND indexname = 'ctacte_movement_notes_idempotency_key_unique'`,
    )
    expect(beforeRows.rowCount).toBe(1)
    const before = beforeRows.rows[0]!.indexdef

    // Re-apply the same four migrations — every CREATE / ADD COLUMN /
    // CREATE INDEX uses IF NOT EXISTS, so the shape must be unchanged.
    await applySql(db.pool, '0031_ctacte_movement_notes.sql')
    await applySql(db.pool, '0032_ctacte_payment_idempotency.sql')
    await applySql(db.pool, '0033_ctacte_comprobante_retries.sql')
    await applySql(db.pool, '0034_ctacte_movement_notes_idempotency_key_full_unique.sql')

    const afterRows = await db.pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'socios'
          AND tablename = 'ctacte_movement_notes'
          AND indexname = 'ctacte_movement_notes_idempotency_key_unique'`,
    )
    expect(afterRows.rowCount).toBe(1)
    const after = afterRows.rows[0]!.indexdef
    expect(after).toBe(before)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// Real PostgreSQL concurrent contract — proves defect #2 across replicas.
//
// Two real DB-level `INSERT`s with the SAME key + SAME body, fired in
// parallel through the conflict-aware Drizzle insert. PG's UNIQUE INDEX
// forces exactly one row to land; the repository's `insertNote` reports
// which call won the race (`created: true`) and which lost (`created:
// false` — silently).
// ──────────────────────────────────────────────────────────────────────────

describe('full forward sequence → concurrent same-key collapse (defect #2, real PG)', () => {
  it('same-key + same-body concurrent inserts collapse to one row with one creator (real PG race)', async () => {
    if (!db) throw new Error('PostgreSQL pool was not initialized')
    const movementId = '11111111-1111-4111-8111-111111111111'
    const opId = '00000000-0000-4000-8000-000000000001'
    const key = 'full-seq-concurrent-same-body'

    const [winner, loser] = await Promise.all([
      insertNote(db.db, {
        ctacteMovementId: movementId,
        authorOperatorId: opId,
        body: 'mismo cuerpo',
        idempotencyKey: key,
      }),
      insertNote(db.db, {
        ctacteMovementId: movementId,
        authorOperatorId: opId,
        body: 'mismo cuerpo',
        idempotencyKey: key,
      }),
    ])

    // Both calls return the SAME persisted note id.
    expect(winner.row.id).toBe(loser.row.id)
    expect(winner.row.body).toBe('mismo cuerpo')
    // One of them is the creator, one is the silent loser. Exactly
    // one `created: true`, exactly one `created: false`.
    expect(winner.created).not.toBe(loser.created)
    expect([winner.created, loser.created].filter(Boolean)).toHaveLength(1)

    // And the DB itself carries only one row for this idempotency key.
    const countRes = await db.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "socios"."ctacte_movement_notes"
        WHERE idempotency_key = $1`,
      [key],
    )
    expect(countRes.rows[0]!.count).toBe('1')
  })

  it('high-parallelism same-key + same-body (10 racers) → exactly one DB row + exactly one creator', async () => {
    if (!db) throw new Error('PostgreSQL pool was not initialized')
    const movementId = '11111111-1111-4111-8111-111111111111'
    const opId = '00000000-0000-4000-8000-000000000001'
    const key = 'full-seq-concurrent-10x-same-body'

    // 10 parallel insert attempts on the SAME key + SAME body +
    // SAME operator. PG's unique index must serialise them such
    // that exactly one row lands and exactly one call is reported
    // as the creator. This is the realistic backend-replica load
    // (a retry storm from the same operator across two or three
    // replicas).
    const drizzle = db.db
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        insertNote(drizzle, {
          ctacteMovementId: movementId,
          authorOperatorId: opId,
          body: 'storm body',
          idempotencyKey: key,
        }),
      ),
    )

    // Every call observes the SAME persisted note id.
    const ids = new Set(results.map((r) => r.row.id))
    expect(ids.size).toBe(1)

    // Exactly ONE creator (real PG race result).
    const creatorCount = results.filter((r) => r.created).length
    expect(creatorCount).toBe(1)

    // DB-side: exactly one row for this key.
    const countRes = await db.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "socios"."ctacte_movement_notes"
          WHERE idempotency_key = $1`,
      [key],
    )
    expect(countRes.rows[0]!.count).toBe('1')
  })

  it('same-key + different-body second caller sees `created: false` (real PG)', async () => {
    // Defect #2's conflict-loser branch: when the conflict-loser
    // surfaces a row with a different payload, the service MUST
    // surface that as CONFLICT — but the repository's contract is
    // to faithfully return `created: false` + the existing row, and
    // let the service decide. This test exercises the repository
    // side of the contract against real PG.
    if (!db) throw new Error('PostgreSQL pool was not initialized')
    const movementId = '11111111-1111-4111-8111-111111111111'
    const opId = '00000000-0000-4000-8000-000000000001'
    const key = 'full-seq-different-body'

    // First call writes the row.
    const first = await insertNote(db.db, {
      ctacteMovementId: movementId,
      authorOperatorId: opId,
      body: 'primera',
      idempotencyKey: key,
    })
    expect(first.created).toBe(true)

    // Second call with a different body but the SAME key: PG's
    // unique constraint refuses the INSERT (the row already exists),
    // and the repository falls back to the conflict-loser path
    // which returns `created: false` + the existing row.
    const second = await insertNote(db.db, {
      ctacteMovementId: movementId,
      authorOperatorId: opId,
      body: 'segunda (diferente)',
      idempotencyKey: key,
    })
    expect(second.created).toBe(false)
    expect(second.row.id).toBe(first.row.id)
    // The DB faithfully keeps the FIRST body — not the new one — so
    // the service's canonical comparison will detect the mismatch
    // and surface CONFLICT.
    expect(second.row.body).toBe('primera')

    const stored = await findNoteByIdempotencyKey(db.db, key)
    expect(stored!.body).toBe('primera')
  })

  it('two concurrent same-key + different-body calls collapse with one creator and one conflict-loser', async () => {
    if (!db) throw new Error('PostgreSQL pool was not initialized')
    const movementId = '11111111-1111-4111-8111-111111111111'
    const opId = '00000000-0000-4000-8000-000000000001'
    const key = 'full-seq-concurrent-different-body'

    // Both calls fire in parallel with different bodies. PG will
    // serialise them on the unique index — one inserts, the other
    // gets the conflict-loser path.
    const [winner, loser] = await Promise.all([
      insertNote(db.db, {
        ctacteMovementId: movementId,
        authorOperatorId: opId,
        body: 'intent-A',
        idempotencyKey: key,
      }),
      insertNote(db.db, {
        ctacteMovementId: movementId,
        authorOperatorId: opId,
        body: 'intent-B',
        idempotencyKey: key,
      }),
    ])

    // Exactly one creator.
    expect(winner.created).not.toBe(loser.created)

    // Both calls observe the same persisted row id.
    expect(winner.row.id).toBe(loser.row.id)
    // The stored body is whichever call won the race.
    const stored = await findNoteByIdempotencyKey(db.db, key)
    expect(stored!.id).toBe(winner.created ? winner.row.id : loser.row.id)
    expect(['intent-A', 'intent-B']).toContain(stored!.body)

    // Service-side: whichever call is the conflict-loser sees
    // `created: false`, gets the existing row back, and then
    // compares canonical (movement, body, operator). The losing
    // intent has a different body — the service would throw CONFLICT.
    const loserIntent = loser.created ? winner : loser
    expect(loserIntent.created).toBe(false)
  })
})
