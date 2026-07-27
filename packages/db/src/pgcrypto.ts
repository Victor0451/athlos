import type { Pool } from 'pg'

const ADVISORY_LOCK_SQL = "SELECT pg_advisory_lock(hashtext('athlos:test:pgcrypto-extension'))"
const ADVISORY_UNLOCK_SQL = "SELECT pg_advisory_unlock(hashtext('athlos:test:pgcrypto-extension'))"

/**
 * PostgreSQL's CREATE EXTENSION IF NOT EXISTS can still raise 23505 when
 * another session creates the same extension concurrently.
 */
export async function ensurePgcrypto(pool: Pick<Pool, 'query'>): Promise<void> {
  await pool.query(ADVISORY_LOCK_SQL)
  try {
    try {
      await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto')
    } catch (error) {
      if ((error as { code?: string }).code !== '23505') throw error
    }

    const extension = await pool.query("SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto'")
    if (extension.rowCount !== 1) throw new Error('pgcrypto extension was not installed')
  } finally {
    await pool.query(ADVISORY_UNLOCK_SQL)
  }
}
