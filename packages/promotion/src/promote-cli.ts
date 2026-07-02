/**
 * promote-cli.ts — CLI runner for the promotion pipeline.
 *
 * Usage: pnpm db:promote
 * Requires DATABASE_URL env var (defaults to 100.78.95.34/athlos).
 */
import { createDb } from '@athlos/db'
import { promoteAll } from './promote.ts'

const connStr = process.env['DATABASE_URL'] ?? 'postgresql://athlos:athlos@100.78.95.34:5432/athlos'

const { db, pool } = createDb({ connectionString: connStr })

console.info(`[promote] starting (conn=${connStr.replace(/:[^:@]+@/, ':***@')})`)
const t0 = Date.now()
const results = await promoteAll(db)

for (const r of results) {
  console.info(
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
  (acc, r) => ({
    inserted: acc.inserted + r.inserted,
    skipped: acc.skipped + r.skipped,
    failed: acc.failed + r.failed,
  }),
  { inserted: 0, skipped: 0, failed: 0 },
)
console.info(
  `[promote] DONE total=${totals.inserted} inserted, ${totals.skipped} skipped, ${totals.failed} failed, ${Date.now() - t0}ms`,
)

await pool.end()
process.exit(totals.failed > 0 ? 1 : 0)
