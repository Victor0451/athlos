import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema/index'

/**
 * Typed Drizzle client bound to the {@link schema} barrel. Repositories and
 * services MUST accept `Db | Tx` (transactions pass `PgTransaction` and share
 * the same query surface) and MUST NOT instantiate their own pool.
 */
export type Db = NodePgDatabase<typeof schema>

/**
 * Connection pool + pool-tuning knobs. Defaults come from the
 * data-access-layer spec §5 (max=20, idle=30s, connect=5s). All fields are
 * overridable so dev, test, and production can tune the pool without forking
 * this module.
 */
export interface DbConfig {
  /** PostgreSQL connection string. Required. */
  connectionString: string
  /** Max concurrent connections. Default 20. */
  poolMax?: number
  /** Idle connection close timeout in ms. Default 30_000. */
  idleTimeoutMs?: number
  /** Connection acquisition timeout in ms. Default 5_000. */
  connectionTimeoutMs?: number
}

/**
 * Build a single shared {@link Pool} + Drizzle client. The API process calls
 * this exactly once at boot (see PR 4 server bootstrap) and threads the
 * resulting `db` through repositories. Tests call it per-fixture.
 *
 * Callers own the returned `pool` and MUST call `pool.end()` on shutdown
 * (SIGTERM/SIGINT) — see data-access-layer spec §5 connection lifecycle.
 */
export function createDb(config: DbConfig): { db: Db; pool: Pool } {
  const pool = new Pool({
    connectionString: config.connectionString,
    max: config.poolMax ?? 20,
    idleTimeoutMillis: config.idleTimeoutMs ?? 30_000,
    connectionTimeoutMillis: config.connectionTimeoutMs ?? 5_000,
  })
  const db = drizzle(pool, { schema })
  return { db, pool }
}
