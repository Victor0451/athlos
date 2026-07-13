import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import type { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { createDb, type Db } from '@athlos/db'
import * as schema from '@athlos/db/schema'
import { insertNote, findNoteByIdempotencyKey } from './ctacte_movement_notes_repository.ts'

/**
 * S2.b / PR 4 — Concurrent same-key dedup proof.
 *
 * Stacked-to-main slice 4 of 7 of `athlos-ctacte-security-reliability-remediation`.
 * Proves the existing schema + repository collapse parallel same-key
 * inserts into exactly one row, using real disposable PostgreSQL.
 *
 * Isolation: the repo's existing PG integration tests drop/recreate
 * the production `socios` / `tesoreria` schemas in their `beforeEach`.
 * Vitest schedules test files in parallel workers, so without isolation
 * the sibling's drop tears down the tables this test just created.
 *
 * The fix follows the convention from
 * `ctacte_movement_notes.full-forward-sequence.integration.test.ts`:
 * own a pair of isolated namespaces (`socios_s2b_<rand>` /
 * `tesoreria_s2b_<rand>`) and wrap the pool in a Proxy that rewrites
 * the production schema names in emitted SQL to those isolated
 * namespaces so Drizzle's queries land here without touching the
 * production-shaped schemas.
 */

const databaseUrl = process.env['ATHLOS_TEST_DATABASE_URL']
const SUFFIX = randomBytes(6).toString('hex')
const ISOLATED_SOCIOS = `socios_s2b_${SUFFIX}`
const ISOLATED_TESORERIA = `tesoreria_s2b_${SUFFIX}`

function migrationPath(filename: string): string {
  const here = path.dirname(new URL(import.meta.url).pathname)
  return path.join(here, '..', '..', '..', '..', '..', 'packages/db/drizzle', filename)
}

async function readSql(filename: string): Promise<string> {
  return readFile(migrationPath(filename), 'utf-8')
}

/** Rewrite every `socios.` / `tesoreria.` schema-qualified identifier to
 *  this test's isolated namespaces. Match both the QUOTED form Drizzle
 *  emits and the bare-word form used by raw SQL in this test. */
function rewriteSql(text: string): string {
  return text
    .replaceAll(`"socios".`, `"${ISOLATED_SOCIOS}".`)
    .replaceAll(`"tesoreria".`, `"${ISOLATED_TESORERIA}".`)
    .replaceAll(`socios.`, `${ISOLATED_SOCIOS}.`)
    .replaceAll(`tesoreria.`, `${ISOLATED_TESORERIA}.`)
}

/** Wrap a `pg.Pool` so every `query()` call rewrites production schema
 *  names to this test's isolated namespaces before reaching the driver. */
function wrapPool(pool: Pool): Pool {
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
      if (prop === 'query') return queryFn(target)
      return Reflect.get(target, prop, receiver)
    },
  }) as Pool
}

async function applySql(pool: Pool, filename: string): Promise<void> {
  const sql = await readSql(filename)
  const statements = sql
    .split(/-->\s*statement-breakpoint/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => rewriteSql(s))
  for (const stmt of statements) {
    await pool.query(stmt)
  }
}

let realPool: Pool | undefined
let db: Db | undefined

beforeAll(async () => {
  if (!databaseUrl)
    throw new Error(
      'ATHLOS_TEST_DATABASE_URL is required for ctacte_movement_notes concurrent test',
    )
  // `createDb` returns the typed Drizzle client + the underlying pool.
  // We do structural work (schema setup + migrations + seeding) through
  // the raw pool, then wrap it in the schema-rewriting Proxy before
  // handing it to the Drizzle client the repository uses.
  const handle = createDb({ connectionString: databaseUrl })
  realPool = handle.pool
  await realPool.query('SELECT 1')

  // Drop any leftover isolated schemas from a previous failed run.
  await realPool.query(`DROP SCHEMA IF EXISTS "${ISOLATED_TESORERIA}" CASCADE`)
  await realPool.query(`DROP SCHEMA IF EXISTS "${ISOLATED_SOCIOS}" CASCADE`)
  // Create the isolated namespaces.
  await realPool.query(`CREATE SCHEMA "${ISOLATED_TESORERIA}"`)
  await realPool.query(`CREATE SCHEMA "${ISOLATED_SOCIOS}"`)
  // Minimal parent tables 0031 expects to exist (0031 adds a
  // `comprobante_attachment_id UUID REFERENCES socios.socio_attachments(id)`
  // column on `tesoreria.ctacte`). Use the rewritten schema names so
  // these land in the isolated namespaces.
  await realPool.query(
    rewriteSql(`
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
  `),
  )
  await realPool.query(
    rewriteSql(`
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
  `),
  )
  await realPool.query(
    rewriteSql(`
    CREATE TABLE "tesoreria"."ctacte" (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      socio_id uuid NOT NULL REFERENCES "socios"."socios"(id),
      fecha date NOT NULL,
      tipo varchar(16) NOT NULL,
      debe numeric(14,2) NOT NULL DEFAULT 0,
      haber numeric(14,2) NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `),
  )

  // Wrap the pool so Drizzle's production-shaped queries land in the
  // isolated namespaces. The Drizzle client below consumes the wrapped
  // pool; structural setup above uses the raw pool directly so its
  // SQL is exact and the rewriter does not see its own output.
  const proxiedPool = wrapPool(realPool)
  db = drizzle(proxiedPool, { schema }) as Db
})

beforeEach(async () => {
  if (!realPool) return
  // No-op: per-test isolation is handled by `applyMigrationsAndSeed`,
  // which TRUNCATEs `ctacte_movement_notes` after reapplying the
  // migrations. Doing it here would race with the `CREATE TABLE` from
  // 0031 because the table does not exist until migrations run.
})

afterAll(async () => {
  // Drop the isolated namespaces so they don't accumulate across
  // re-runs and pollute sibling tests' `pg_indexes` queries that
  // don't filter by schema.
  if (realPool) {
    try {
      await realPool.query(`DROP SCHEMA IF EXISTS "${ISOLATED_TESORERIA}" CASCADE`)
    } catch {
      // best-effort cleanup
    }
    try {
      await realPool.query(`DROP SCHEMA IF EXISTS "${ISOLATED_SOCIOS}" CASCADE`)
    } catch {
      // best-effort cleanup
    }
  }
  await realPool?.end()
})

async function applyMigrationsAndSeed(): Promise<{
  movementId: string
  operatorId: string
}> {
  if (!realPool) throw new Error('PostgreSQL pool was not initialized')
  // Apply 0031 (column + partial UNIQUE INDEX) then 0034 (full UNIQUE
  // INDEX). This is the production ordering: 0031 creates the column
  // and a partial index, 0034 replaces that partial index with a full
  // one so bare-column ON CONFLICT inference succeeds.
  await applySql(realPool, '0031_ctacte_movement_notes.sql')
  await applySql(realPool, '0034_ctacte_movement_notes_idempotency_key_full_unique.sql')
  // Reset the parent + child tables so each test starts clean. The
  // migration `CREATE TABLE IF NOT EXISTS` is idempotent and leaves
  // rows from a prior test untouched — these TRUNCATEs wipe them
  // after each test's setup re-runs. CASCADE handles the FK chain
  // (ctacte.socio_id → socios.id).
  await realPool.query(
    `TRUNCATE TABLE "${ISOLATED_SOCIOS}"."ctacte_movement_notes",
                       "${ISOLATED_TESORERIA}"."ctacte",
                       "${ISOLATED_SOCIOS}"."socios"
       RESTART IDENTITY CASCADE`,
  )

  const movementId = '11111111-1111-4111-8111-111111111111'
  const socioId = '22222222-2222-4222-8222-222222222222'
  const operatorId = '00000000-0000-4000-8000-000000000001'
  await realPool.query(
    rewriteSql(
      `INSERT INTO "socios"."socios" (id, numero_socio, nombre, apellido, dni, fecha_alta, estado)
       VALUES ($1, '12345', 'Juan', 'Pérez', '28765432', '2024-01-01', 'activo')`,
    ),
    [socioId],
  )
  await realPool.query(
    rewriteSql(
      `INSERT INTO "tesoreria"."ctacte" (id, socio_id, fecha, tipo, debe, haber)
       VALUES ($1, $2, '2026-07-10', 'CREDITO', '0', '100')`,
    ),
    [movementId, socioId],
  )
  return { movementId, operatorId }
}

describe('ctacte_movement_notes concurrent same-key dedup (S2.b / PR 4)', () => {
  it('two parallel same-key inserts collapse to exactly one row', async () => {
    const { movementId, operatorId } = await applyMigrationsAndSeed()
    const key = 'concurrent-key-2'

    // Two parallel repo invocations simulate the production race:
    // both started, both find no prior row, both try to INSERT — only
    // one wins the index race, the other must surface the existing row.
    const [a, b] = await Promise.all([
      insertNote(db!, {
        ctacteMovementId: movementId,
        authorOperatorId: operatorId,
        body: 'mismo cuerpo',
        idempotencyKey: key,
      }),
      insertNote(db!, {
        ctacteMovementId: movementId,
        authorOperatorId: operatorId,
        body: 'mismo cuerpo',
        idempotencyKey: key,
      }),
    ])

    // Both calls return the persisted note — same row id.
    expect(a.row.id).toBe(b.row.id)
    expect(a.row.body).toBe('mismo cuerpo')
    expect(b.row.body).toBe('mismo cuerpo')
    // Exactly one of the two concurrent calls won the index race.
    expect(a.created !== b.created).toBe(true)
    const winners = [a, b].filter((r) => r.created)
    expect(winners).toHaveLength(1)

    // And the DB only carries ONE row for this key.
    const stored = await findNoteByIdempotencyKey(db!, key)
    expect(stored?.id).toBe(winners[0]!.row.id)

    const rowCount = await realPool!.query<{ count: string }>(
      rewriteSql(
        `SELECT count(*)::text AS count FROM "socios"."ctacte_movement_notes"
          WHERE idempotency_key = $1`,
      ),
      [key],
    )
    expect(rowCount.rows[0]!.count).toBe('1')
  })

  it('burst of 5 parallel same-key inserts still yields exactly one row', async () => {
    const { movementId, operatorId } = await applyMigrationsAndSeed()
    const key = 'concurrent-key-5'

    // Stress the index race harder: 5 simultaneous inserts from the
    // same caller all racing on the same key. The contract is the
    // same — exactly one creator wins, all 5 callers receive the
    // same row.
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        insertNote(db!, {
          ctacteMovementId: movementId,
          authorOperatorId: operatorId,
          body: 'cuerpo burst',
          idempotencyKey: key,
        }),
      ),
    )

    const ids = new Set(results.map((r) => r.row.id))
    expect(ids.size).toBe(1)
    const winners = results.filter((r) => r.created)
    expect(winners).toHaveLength(1)

    const rowCount = await realPool!.query<{ count: string }>(
      rewriteSql(
        `SELECT count(*)::text AS count FROM "socios"."ctacte_movement_notes"
          WHERE idempotency_key = $1`,
      ),
      [key],
    )
    expect(rowCount.rows[0]!.count).toBe('1')
  })

  it('migration 0034 leaves idempotency_key as a FULL UNIQUE INDEX (no WHERE)', async () => {
    await applyMigrationsAndSeed()
    if (!realPool) throw new Error('PostgreSQL pool was not initialized')

    // The post-migration index MUST be unconditional. With the
    // pre-0034 PARTIAL UNIQUE INDEX (`WHERE idempotency_key IS NOT
    // NULL`) the bare-column ON CONFLICT inference raised
    //   "there is no unique or exclusion constraint matching the ON
    //    CONFLICT specification"
    // — the R3 defect #1 5xx. S2.b's schema assertion nails the
    // shape so a future migration cannot regress to a partial index
    // without the test failing.
    const indexRow = await realPool.query<{ indexdef: string }>(
      rewriteSql(
        `SELECT indexdef FROM pg_indexes
           WHERE schemaname = $1
             AND tablename  = 'ctacte_movement_notes'
             AND indexname  = 'ctacte_movement_notes_idempotency_key_unique'`,
      ),
      [ISOLATED_SOCIOS],
    )
    expect(indexRow.rowCount).toBe(1)
    const def = indexRow.rows[0]!.indexdef
    expect(def).toMatch(/UNIQUE INDEX/i)
    expect(def).not.toMatch(/WHERE/i)
  })

  it('raw INSERT ... ON CONFLICT (idempotency_key) DO NOTHING infers the full unique index', async () => {
    const { movementId, operatorId } = await applyMigrationsAndSeed()
    if (!realPool) throw new Error('PostgreSQL pool was not initialized')

    // Seed one row so the second INSERT collides on the key.
    await realPool.query(
      rewriteSql(
        `INSERT INTO "socios"."ctacte_movement_notes"
           (ctacte_movement_id, body, author_operator_id, idempotency_key)
         VALUES ($1, 'primera', $2, 'raw-key')`,
      ),
      [movementId, operatorId],
    )

    // This is the exact clause the repository's `onConflictDoNothing`
    // emits: a bare column reference with no predicate. If the index
    // is partial, PostgreSQL raises "there is no unique or exclusion
    // constraint matching the ON CONFLICT specification". With 0034
    // in place, it succeeds silently and returns 0 rows.
    const conflict = await realPool.query(
      rewriteSql(
        `INSERT INTO "socios"."ctacte_movement_notes"
           (ctacte_movement_id, body, author_operator_id, idempotency_key)
         VALUES ($1, 'segunda', $2, 'raw-key')
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
      ),
      [movementId, operatorId],
    )
    expect(conflict.rowCount).toBe(0)

    const total = await realPool.query<{ count: string }>(
      rewriteSql(
        `SELECT count(*)::text AS count FROM "socios"."ctacte_movement_notes"
          WHERE idempotency_key = 'raw-key'`,
      ),
    )
    expect(total.rows[0]!.count).toBe('1')
  })
})
