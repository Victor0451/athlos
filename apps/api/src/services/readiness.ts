import type { Pool } from 'pg'

export interface ReadinessProbe {
  db: 'ok' | 'down'
  schema: 'ok' | 'down'
}

const READINESS_TIMEOUT_MS = 2000
const REQUIRED_RELATIONS_QUERY =
  "SELECT to_regclass('operators') AS operators, to_regclass('refresh_tokens') AS refresh_tokens, to_regclass('job_runs') AS job_runs"

export async function probeReadiness(pool: Pool): Promise<ReadinessProbe> {
  const probe = (async (): Promise<ReadinessProbe> => {
    try {
      await pool.query('SELECT 1')
      const result = await pool.query(REQUIRED_RELATIONS_QUERY)
      const relations = result.rows[0]
      return {
        db: 'ok',
        schema:
          relations?.operators && relations?.refresh_tokens && relations?.job_runs ? 'ok' : 'down',
      }
    } catch {
      return { db: 'down', schema: 'down' }
    }
  })()
  const timeout = new Promise<ReadinessProbe>((resolve) => {
    setTimeout(() => resolve({ db: 'down', schema: 'down' }), READINESS_TIMEOUT_MS)
  })
  return Promise.race([probe, timeout])
}
