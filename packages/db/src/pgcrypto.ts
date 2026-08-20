import type { Pool } from 'pg'

const ADVISORY_LOCK_SQL = "SELECT pg_advisory_lock(hashtext('athlos:test:pgcrypto-extension'))"
const ADVISORY_UNLOCK_SQL = "SELECT pg_advisory_unlock(hashtext('athlos:test:pgcrypto-extension'))"

type QueryConnection = {
  query: (text: string) => Promise<{ rowCount?: number | null }>
}

type PgcryptoPool = Pick<Pool, 'query'> & Partial<Pick<Pool, 'connect'>>

async function ensurePgcryptoOnConnection(connection: QueryConnection): Promise<void> {
  await connection.query(ADVISORY_LOCK_SQL)
  try {
    try {
      await connection.query('CREATE EXTENSION IF NOT EXISTS pgcrypto')
    } catch (error) {
      if ((error as { code?: string }).code !== '23505') throw error
    }

    const extension = await connection.query(
      "SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto'",
    )
    if (extension.rowCount !== 1) throw new Error('pgcrypto extension was not installed')
  } finally {
    await connection.query(ADVISORY_UNLOCK_SQL)
  }
}

/**
 * PostgreSQL's CREATE EXTENSION IF NOT EXISTS can still raise 23505 when
 * another session creates the same extension concurrently.
 */
export async function ensurePgcrypto(pool: PgcryptoPool): Promise<void> {
  if (pool.connect) {
    const client = await pool.connect()
    try {
      await ensurePgcryptoOnConnection(client)
    } finally {
      client.release()
    }
    return
  }

  await ensurePgcryptoOnConnection(pool)
}
