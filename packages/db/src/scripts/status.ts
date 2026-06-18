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

interface MigrationMeta {
  tag: string
  createdAt: Date
}

function formatDate(date: Date): string {
  return new Date(date).toISOString()
}

/**
 * Print a section header and list of migrations to the given output stream.
 */
function printSection(
  label: string,
  migrations: string[],
  meta: MigrationMeta[],
  isError = false,
): void {
  if (migrations.length === 0) return
  const stream = isError ? console.error.bind(console) : console.info.bind(console)
  stream(`\n${label}`)
  for (const tag of migrations) {
    if (meta.length > 0) {
      const entry = meta.find((m) => m.tag === tag)
      const date = entry ? formatDate(entry.createdAt) : 'unknown'
      stream(`  ${tag} (${date})`)
    } else {
      stream(`  ${tag}`)
    }
  }
}

/**
 * Print human-readable status output.
 */
function printHuman(result: diffMigrationsResult, meta: MigrationMeta[]): void {
  printSection('Applied migrations:', result.applied, meta, false)
  printSection('Pending migrations (not yet applied):', result.pending, [], false)
  printSection(
    'Divergence detected (DB has migrations not in filesystem):',
    result.divergence,
    [],
    true,
  )

  if (
    result.applied.length === 0 &&
    result.pending.length === 0 &&
    result.divergence.length === 0
  ) {
    console.info('No migrations found.')
  }
}

type diffMigrationsResult = { applied: string[]; pending: string[]; divergence: string[] }

/**
 * Print JSON output (Zod-validated).
 */
function printJson(result: diffMigrationsResult, exitCode: 0 | 1): void {
  const output = statusSchema.parse({
    applied: result.applied,
    pending: result.pending,
    divergence: result.divergence,
    exitCode,
  })
  console.info(JSON.stringify(output, null, 2))
}

/**
 * Parse minimal argv (no external deps).
 */
function parseArgv(argv: string[]): { json: boolean } {
  return { json: argv.includes('--json') }
}

/**
 * Get applied migrations with their creation timestamps.
 */
async function getAppliedMigrationsWithDates(connectionString: string): Promise<MigrationMeta[]> {
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

/**
 * Main CLI entry point.
 */
async function main(argv: string[]): Promise<void> {
  const { json } = parseArgv(argv)
  const connectionString =
    process.env.DATABASE_URL ?? 'postgresql://athlos:athlos@localhost:5432/athlos'
  const drizzleDir = join(__dirname, '..', '..', 'drizzle')

  let appliedWithDates: MigrationMeta[] = []

  try {
    appliedWithDates = await getAppliedMigrationsWithDates(connectionString)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`db package: cannot connect to <redacted>: ${message}`)
    process.exitCode = 2
    return
  }

  const applied = appliedWithDates.map((m) => m.tag)
  const local = await getLocalMigrations(drizzleDir)
  const result = diffMigrations(applied, local)

  if (result.pending.length > 0 || result.divergence.length > 0) {
    process.exitCode = 1
  }

  if (json) {
    printJson(result, process.exitCode as 0 | 1)
  } else {
    printHuman(result, appliedWithDates)
  }
}

main(process.argv.slice(2)).catch((err) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`db package: unexpected error: ${message}`)
  process.exitCode = 2
})
