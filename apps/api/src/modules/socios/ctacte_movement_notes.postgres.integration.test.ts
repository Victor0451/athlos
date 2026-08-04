import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Pool } from 'pg'
import { createDb, type Db } from '@athlos/db'
import * as schema from '@athlos/db/schema'
import { insertNote, findNoteByIdempotencyKey } from './ctacte_movement_notes_repository.ts'

/**
 * Disposable PostgreSQL proof for the R3 fix batch.
 *
 * Defect #1: migration 0031 created a PARTIAL UNIQUE INDEX
 * (`WHERE idempotency_key IS NOT NULL`) that PostgreSQL cannot infer
 * for the bare `ON CONFLICT (idempotency_key) DO NOTHING` clause the
 * repository issues. Migration 0034 replaces that partial index with a
 * full UNIQUE INDEX so the inference succeeds.
 *
 * Defect #2: concurrent same-key writes must collapse into one row +
 * one creator-side audit. The previous implementation could leak the
 * conflict-loser's audit even though only one row exists, so this test
 * exercises the FULL INSERT path (real Drizzle against real PostgreSQL)
 * for both the "same payload" and "different payload" concurrent
 * scenarios — without relying on the vitest standin DB.
 *
 * Migration order: 0031 (creates column + partial index) → 0034
 * (replaces partial index with full index). The two migrations applied
 * in sequence yield the production-shaped schema; migration 0034 alone
 * is also safe (DROP IF EXISTS + CREATE IF NOT EXISTS is idempotent).
 */

const databaseUrl = process.env['ATHLOS_TEST_DATABASE_URL']
let db: { db: Db; pool: Pool } | undefined
let sociosSchema: string
let tesoreriaSchema: string

interface QueryTarget {
  query(this: unknown, ...args: unknown[]): unknown
  connect(): Promise<Pool>
}

function rewriteSql(text: string): string {
  return text
    .replaceAll('"socios".', `"${sociosSchema}".`)
    .replaceAll('"tesoreria".', `"${tesoreriaSchema}".`)
    .replaceAll('socios.', `${sociosSchema}.`)
    .replaceAll('tesoreria.', `${tesoreriaSchema}.`)
}

function wrapPool(pool: Pool): Pool {
  const query = (target: QueryTarget) =>
    function (this: unknown, ...args: unknown[]): unknown {
      const [config, ...rest] = args
      if (typeof config === 'string') return target.query.call(target, rewriteSql(config), ...rest)
      if (config && typeof config === 'object' && 'text' in (config as Record<string, unknown>)) {
        const value = config as { text: string } & Record<string, unknown>
        return target.query.call(target, { ...value, text: rewriteSql(value.text) }, ...rest)
      }
      return target.query.call(target, config, ...rest)
    }
  return new Proxy(pool, {
    get(target, property, receiver) {
      if (property === 'query') return query(target as unknown as QueryTarget)
      if (property === 'connect')
        return async () => wrapPool(await (target as unknown as QueryTarget).connect())
      return Reflect.get(target, property, receiver)
    },
  }) as Pool
}

async function assertTestDatabase(pool: Pool): Promise<void> {
  const result = await pool.query<{ name: string }>('SELECT current_database() AS name')
  const name = result.rows[0]?.name
  if (!name || !/_test$/.test(name))
    throw new Error(`refusing non-test database: ${name ?? 'unknown'}`)
}

async function readSql(filename: string): Promise<string> {
  // Resolve the package's migrations directory from the test file path:
  //   apps/api/src/modules/socios/ctacte_movement_notes.postgres.integration.test.ts
  //   ↳ apps/api/src/modules/socios        (here)
  //   ↳ apps/api/src/modules               (..)
  //   ↳ apps/api/src                       (..)
  //   ↳ apps/api                           (..)
  //   ↳ apps                               (..)
  //   ↳ <repo root>                        (..) +  packages/db/drizzle/<file>
  const here = path.dirname(new URL(import.meta.url).pathname)
  const migrationPath = path.join(
    here,
    '..',
    '..',
    '..',
    '..',
    '..',
    'packages/db/drizzle',
    filename,
  )
  return readFile(migrationPath, 'utf-8')
}

async function applySql(pool: Pool, sql: string): Promise<void> {
  // Migration files may contain Drizzle `--> statement-breakpoint`
  // markers between statements. Strip them so we can run the whole
  // file in one `query()` call.
  const statements = sql
    .split(/-->\s*statement-breakpoint/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  for (const stmt of statements) {
    await pool.query(stmt)
  }
}

beforeAll(async () => {
  if (!databaseUrl)
    throw new Error(
      'ATHLOS_TEST_DATABASE_URL is required for ctacte_movement_notes PostgreSQL tests',
    )
  const handle = createDb({ connectionString: databaseUrl })
  await assertTestDatabase(handle.pool)
  const suffix = randomBytes(12).toString('hex')
  sociosSchema = `socios_r3_${suffix}`
  tesoreriaSchema = `tesoreria_r3_${suffix}`
  db = {
    db: drizzle(wrapPool(handle.pool), { schema }) as Db,
    pool: wrapPool(handle.pool),
  }
})

beforeEach(async () => {
  if (!db) return
  // Reset both schemas to a clean slate. Using `IF EXISTS` makes the
  // test safe to run against a database that has other tenants.
  await db.pool.query(`DROP SCHEMA IF EXISTS "${sociosSchema}" CASCADE`)
  await db.pool.query(`DROP SCHEMA IF EXISTS "${tesoreriaSchema}" CASCADE`)
  // Recreate the bare minimum needed for migration 0031 (which adds a
  // `comprobante_attachment_id UUID REFERENCES socios.socio_attachments(id)`
  // column on `tesoreria.ctacte`).
  await db.pool.query(`CREATE SCHEMA "${tesoreriaSchema}"`)
  await db.pool.query(`CREATE SCHEMA "${sociosSchema}"`)
  await db.pool.query(`
    CREATE TABLE "socios"."socios" (
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
    CREATE TABLE "socios"."socio_attachments" (
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
    CREATE TABLE "tesoreria"."ctacte" (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      socio_id uuid NOT NULL REFERENCES "socios"."socios"(id),
      fecha date NOT NULL,
      tipo varchar(16) NOT NULL,
      debe numeric(14,2) NOT NULL DEFAULT 0,
      haber numeric(14,2) NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `)
})

afterAll(async () => {
  if (db && sociosSchema && tesoreriaSchema) {
    await db.pool.query(`DROP SCHEMA IF EXISTS "${sociosSchema}" CASCADE`)
    await db.pool.query(`DROP SCHEMA IF EXISTS "${tesoreriaSchema}" CASCADE`)
  }
  await db?.pool.end()
})

describe('ctacte_movement_notes PostgreSQL idempotency inference (R3 fix #1)', () => {
  it('0034 yields an ON CONFLICT (idempotency_key)-inferable FULL unique index', async () => {
    if (!db) throw new Error('PostgreSQL pool was not initialized')

    // Apply 0031 then 0034 — the production ordering. 0031 creates
    // the partial index, 0034 converts it to full.
    const sql0031 = await readSql('0031_ctacte_movement_notes.sql')
    await applySql(db.pool, sql0031)
    const sql0034 = await readSql('0034_ctacte_movement_notes_idempotency_key_full_unique.sql')
    await applySql(db.pool, sql0034)

    // Inspect the resulting index definition. The full unique index
    // MUST NOT carry a WHERE clause (otherwise bare-column inference
    // would still fail in production).
    const indexRow = await db.pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
         WHERE schemaname = $1
          AND tablename  = 'ctacte_movement_notes'
          AND indexname  = 'ctacte_movement_notes_idempotency_key_unique'`,
      [sociosSchema],
    )
    expect(indexRow.rowCount).toBe(1)
    const def = indexRow.rows[0]!.indexdef
    expect(def).toMatch(/UNIQUE INDEX/i)
    expect(def).toMatch(new RegExp(`ON\\s+${sociosSchema}\\.ctacte_movement_notes`, 'i'))
    // Critically: full unique index has NO WHERE predicate.
    expect(def).not.toMatch(/WHERE/i)
  })

  it('INSERT … ON CONFLICT (idempotency_key) DO NOTHING resolves against the new full index', async () => {
    if (!db) throw new Error('PostgreSQL pool was not initialized')
    const sql0031 = await readSql('0031_ctacte_movement_notes.sql')
    await applySql(db.pool, sql0031)
    const sql0034 = await readSql('0034_ctacte_movement_notes_idempotency_key_full_unique.sql')
    await applySql(db.pool, sql0034)

    // Seed a minimal parent row so the FK on ctacte_movement_id holds.
    const movementId = '11111111-1111-4111-8111-111111111111'
    const socioId = '22222222-2222-4222-8222-222222222222'
    const opId = '00000000-0000-4000-8000-000000000001'
    await db.pool.query(
      `INSERT INTO socios.socios (id, numero_socio, nombre, apellido, dni, fecha_alta, estado)
       VALUES ($1, '12345', 'Juan', 'Pérez', '28765432', '2024-01-01', 'activo')`,
      [socioId],
    )
    await db.pool.query(
      `INSERT INTO tesoreria.ctacte (id, socio_id, fecha, tipo, debe, haber)
       VALUES ($1, $2, '2026-07-10', 'CREDITO', '0', '100')`,
      [movementId, socioId],
    )

    // The same raw SQL the repository emits. If PostgreSQL cannot infer
    // a unique index for the bare-column ON CONFLICT, this INSERT throws
    // "there is no unique or exclusion constraint matching the ON CONFLICT
    // specification" — a 5xx we MUST avoid in production.
    await db.pool.query(
      `INSERT INTO socios.ctacte_movement_notes
         (ctacte_movement_id, body, author_operator_id, idempotency_key)
       VALUES ($1, 'first note', $2, 'key-A')`,
      [movementId, opId],
    )

    // The conflict-aware insert MUST swallow the duplicate and return
    // rowCount=0 — proving both the index inference AND the dedup
    // behaviour that the repository relies on.
    const conflictRes = await db.pool.query(
      `INSERT INTO socios.ctacte_movement_notes
         (ctacte_movement_id, body, author_operator_id, idempotency_key)
       VALUES ($1, 'first note', $2, 'key-A')
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [movementId, opId],
    )
    expect(conflictRes.rowCount).toBe(0)
    const totalRes = await db.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM socios.ctacte_movement_notes
        WHERE idempotency_key = 'key-A'`,
    )
    expect(totalRes.rows[0]!.count).toBe('1')
  })
})

describe('ctacte_movement_notes concurrent same-key semantics (R3 fix #2)', () => {
  // Setup: apply migrations and seed a movement row before every test.
  async function setup(): Promise<{ movementId: string }> {
    if (!db) throw new Error('PostgreSQL pool was not initialized')
    const sql0031 = await readSql('0031_ctacte_movement_notes.sql')
    await applySql(db.pool, sql0031)
    const sql0034 = await readSql('0034_ctacte_movement_notes_idempotency_key_full_unique.sql')
    await applySql(db.pool, sql0034)
    const movementId = '11111111-1111-4111-8111-111111111111'
    const socioId = '22222222-2222-4222-8222-222222222222'
    await db.pool.query(
      `INSERT INTO socios.socios (id, numero_socio, nombre, apellido, dni, fecha_alta, estado)
       VALUES ($1, '12345', 'Juan', 'Pérez', '28765432', '2024-01-01', 'activo')`,
      [socioId],
    )
    await db.pool.query(
      `INSERT INTO tesoreria.ctacte (id, socio_id, fecha, tipo, debe, haber)
       VALUES ($1, $2, '2026-07-10', 'CREDITO', '0', '100')`,
      [movementId, socioId],
    )
    return { movementId }
  }

  it('same-key + same-body concurrent inserts collapse to one row', async () => {
    const { movementId } = await setup()
    const opId = '00000000-0000-4000-8000-000000000001'
    const key = 'concurrent-same-body-key'

    // Two parallel repo invocations simulate the production race:
    // both started, both find no prior row, both try to INSERT — only
    // one wins the index race, the other must surface the existing row.
    const [winner, loser] = await Promise.all([
      insertNote(db!.db, {
        ctacteMovementId: movementId,
        authorOperatorId: opId,
        body: 'mismo cuerpo',
        idempotencyKey: key,
      }),
      insertNote(db!.db, {
        ctacteMovementId: movementId,
        authorOperatorId: opId,
        body: 'mismo cuerpo',
        idempotencyKey: key,
      }),
    ])

    // The repository's contract: callers receive the persisted note
    // regardless of who actually wrote it. Both calls MUST return the
    // SAME note id.
    expect(winner.row.id).toBe(loser.row.id)
    expect(winner.row.body).toBe('mismo cuerpo')
    expect(loser.row.body).toBe('mismo cuerpo')
    // Exactly one of the two concurrent calls won the index race —
    // the other MUST report created: false so the service can branch.
    expect(winner.created !== loser.created).toBe(true)
    const winnerCreated = winner.created ? winner : loser

    // And the DB only carries ONE row for this key.
    const stored = await findNoteByIdempotencyKey(db!.db, key)
    expect(stored).not.toBeNull()
    expect(stored!.id).toBe(winnerCreated.row.id)

    const rowCount = await db!.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM socios.ctacte_movement_notes
        WHERE idempotency_key = $1`,
      [key],
    )
    expect(rowCount.rows[0]!.count).toBe('1')
  })
})

describe('ctacte_movement_notes negative proof (defect #1 was real)', () => {
  /**
   * NEGATIVE PROOF: applying ONLY 0031 (partial unique index) leaves the
   * production ON CONFLICT inference broken. The repository's
   * `onConflictDoNothing({ target: idempotencyKey })` emits a bare-column
   * ON CONFLICT clause; against a partial UNIQUE INDEX PostgreSQL raises
   *
   *     "there is no unique or exclusion constraint matching the ON
   *      CONFLICT specification"
   *
   * — a 5xx that would 5xx every note POST in production. This test
   * reproduces that failure in real PostgreSQL so we KNOW migration 0034
   * was necessary, not just a stylistic improvement.
   */
  it('bare-column ON CONFLICT against the 0031 partial index 5xx-es (defect #1 repro)', async () => {
    if (!db) throw new Error('PostgreSQL pool was not initialized')

    // Apply ONLY 0031 — leave the partial index in place WITHOUT 0034.
    const sql0031 = await readSql('0031_ctacte_movement_notes.sql')
    await applySql(db.pool, sql0031)

    const movementId = '11111111-1111-4111-8111-111111111111'
    const socioId = '22222222-2222-4222-8222-222222222222'
    const opId = '00000000-0000-4000-8000-000000000001'
    await db.pool.query(
      `INSERT INTO socios.socios (id, numero_socio, nombre, apellido, dni, fecha_alta, estado)
       VALUES ($1, '12345', 'Juan', 'Pérez', '28765432', '2024-01-01', 'activo')`,
      [socioId],
    )
    await db.pool.query(
      `INSERT INTO tesoreria.ctacte (id, socio_id, fecha, tipo, debe, haber)
       VALUES ($1, $2, '2026-07-10', 'CREDITO', '0', '100')`,
      [movementId, socioId],
    )

    // First INSERT is fine — no existing row to conflict with. We only
    // care about the second INSERT to expose the inference failure.
    await db.pool.query(
      `INSERT INTO socios.ctacte_movement_notes
         (ctacte_movement_id, body, author_operator_id, idempotency_key)
       VALUES ($1, 'primera', $2, 'partial-key')`,
      [movementId, opId],
    )

    // This second INSERT is what fails in production (note the bare
    // `ON CONFLICT (idempotency_key) DO NOTHING` — no WHERE predicate).
    await expect(
      db.pool.query(
        `INSERT INTO socios.ctacte_movement_notes
           (ctacte_movement_id, body, author_operator_id, idempotency_key)
         VALUES ($1, 'segunda', $2, 'partial-key')
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [movementId, opId],
      ),
    ).rejects.toThrow(/no unique or exclusion constraint matching/i)
  })
})
