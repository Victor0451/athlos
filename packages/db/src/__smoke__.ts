/**
 * Smoke test for @athlos/db.
 *
 * Run with: `pnpm --filter @athlos/db smoke`
 *
 * Connects to DATABASE_URL (or the local default), runs `SELECT 1`, closes
 * the pool, and logs `db package: OK`. This is NOT a Vitest test — PR 10a
 * adds the test runner and proper assertions. The smoke script exists to
 * catch wiring regressions (env var, pool config, schema barrel) without a
 * test harness dependency.
 *
 * Uses `console.info` which is allowed by the ESLint `no-console` rule.
 */
import { createDb } from './pool'

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://athlos:athlos@localhost:5432/athlos'

const { db, pool } = createDb({ connectionString })

try {
  const result = await db.execute<{ ok: number }>('SELECT 1 AS ok')
  if (!result.rows[0] || result.rows[0].ok !== 1) {
    throw new Error(`unexpected SELECT 1 result: ${JSON.stringify(result.rows)}`)
  }
  console.info('db package: OK')
} catch (err) {
  console.error('db package: FAILED', err)
  process.exitCode = 1
} finally {
  await pool.end()
}
