/**
 * migrate:status command.
 *
 * Reads __drizzle_migrations table, compares against drizzle/*.sql filesystem entries,
 * and reports applied, pending, and divergent migrations.
 *
 * Supports --json flag with Zod-validated output.
 * Exit codes: 0 (clean), 1 (pending/divergence), 2 (connection error).
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import pg from 'pg'
export { statusSchema } from './status.schema.js'
import { statusSchema } from './status.schema.js'

const { Pool } = pg

/**
 * Pure three-set diff function.
 *
 * - applied: migrations in DB that are also in the local set
 * - pending: migrations in local but not yet applied to DB
 * - divergence: migrations applied to DB but missing from local filesystem
 */
export function diffMigrations(
  applied: string[],
  local: string[],
): { applied: string[]; pending: string[]; divergence: string[] } {
  const appliedSet = new Set(applied)
  const localSet = new Set(local)

  const inBoth = applied.filter((m) => localSet.has(m))
  const onlyLocal = local.filter((m) => !appliedSet.has(m))
  const onlyApplied = applied.filter((m) => !localSet.has(m))

  return {
    applied: inBoth,
    pending: onlyLocal,
    divergence: onlyApplied,
  }
}

/**
 * Scan drizzle/ directory for migration files.
 * Matches pattern NNNN_<adjective>_<noun>.sql (e.g., 0000_quick_wraith.sql).
 */
async function getLocalMigrations(drizzleDir: string): Promise<string[]> {
  const entries = await readdir(drizzleDir, { withFileTypes: true })
  const migrations: string[] = []

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.sql')) {
      // Match pattern: 4 digits underscore name .sql
      const match = entry.name.match(/^(\d{4}_.+)\.sql$/)
      if (match) {
        migrations.push(match[1])
      }
    }
  }

  return migrations.sort()
}

/**
 * Print human-readable status output.
 */
function printHuman(
  result: { applied: string[]; pending: string[]; divergence: string[] },
  appliedMigrations: Array<{ tag: string; createdAt: Date }>,
): void {
  if (result.applied.length > 0) {
    console.info('\nApplied migrations:')
    for (const tag of result.applied) {
      const meta = appliedMigrations.find((m) => m.tag === tag)
      const date = meta ? new Date(meta.createdAt).toISOString() : 'unknown'
      console.info(`  ${tag} (${date})`)
    }
  }

  if (result.pending.length > 0) {
    console.info('\nPending migrations (not yet applied):')
    for (const tag of result.pending) {
      console.info(`  ${tag}`)
    }
  }

  if (result.divergence.length > 0) {
    console.error('\nDivergence detected (DB has migrations not in filesystem):')
    for (const tag of result.divergence) {
      console.error(`  ${tag}`)
    }
  }

  if (
    result.applied.length === 0 &&
    result.pending.length === 0 &&
    result.divergence.length === 0
  ) {
    console.info('No migrations found.')
  }
}

/**
 * Print JSON output (Zod-validated).
 */
function printJson(
  result: { applied: string[]; pending: string[]; divergence: string[] },
  exitCode: 0 | 1,
): void {
  const output = statusSchema.parse({
    applied: result.applied,
    pending: result.pending,
    divergence: result.divergence,
    exitCode,
  })
  console.info(JSON.stringify(output, null, 2))
}

/**
 * Main CLI entry point.
 */
async function main() {
  const args = process.argv.slice(2)
  const jsonFlag = args.includes('--json')

  const connectionString =
    process.env.DATABASE_URL ?? 'postgresql://athlos:athlos@localhost:5432/athlos'

  // Determine drizzle directory (script is at src/scripts/status.ts)
  const drizzleDir = join(__dirname, '..', '..', 'drizzle')

  let applied: string[] = []
  let appliedWithDates: Array<{ tag: string; createdAt: Date }> = []

  try {
    appliedWithDates = await getAppliedMigrationsWithDates(connectionString)
    applied = appliedWithDates.map((m) => m.tag)
  } catch (err) {
    console.error(
      `db package: cannot connect to <redacted>: ${err instanceof Error ? err.message : String(err)}`,
    )
    process.exitCode = 2
    return
  }

  const local = await getLocalMigrations(drizzleDir)
  const result = diffMigrations(applied, local)

  if (result.pending.length > 0 || result.divergence.length > 0) {
    process.exitCode = 1
  }

  if (jsonFlag) {
    printJson(result, process.exitCode as 0 | 1)
  } else {
    printHuman(result, appliedWithDates)
  }
}

/**
 * Get applied migrations with their creation timestamps.
 */
async function getAppliedMigrationsWithDates(
  connectionString: string,
): Promise<Array<{ tag: string; createdAt: Date }>> {
  const pool = new Pool({ connectionString })

  try {
    const result = await pool.query<{ tag: string; created_at: Date }>(
      `SET LOCAL statement_timeout = '5s';
       SELECT tag, created_at FROM __drizzle_migrations ORDER BY id ASC`,
    )
    return result.rows.map((row) => ({ tag: row.tag, createdAt: row.created_at }))
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(`db package: unexpected error: ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 2
})
