/**
 * migrate:status command.
 *
 * Reads Drizzle's migration ledger, compares it against local migration files,
 * and reports applied, pending, and divergent migrations.
 *
 * Supports --json flag with Zod-validated output.
 * Exit codes: 0 (clean), 1 (pending/divergence), 2 (connection error).
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import pg from 'pg'
export { statusSchema } from './status.schema.ts'
import { statusSchema } from './status.schema.ts'

const { Pool } = pg

/** Pure three-set diff function. */
export function diffMigrations(
  applied: string[],
  local: string[],
): { applied: string[]; pending: string[]; divergence: string[] } {
  const appliedSet = new Set(applied)
  const localSet = new Set(local)

  return {
    applied: applied.filter((migration) => localSet.has(migration)),
    pending: local.filter((migration) => !appliedSet.has(migration)),
    divergence: applied.filter((migration) => !localSet.has(migration)),
  }
}

interface LocalMigration {
  name: string
  hash: string
}

interface MigrationMeta {
  tag: string
  createdAt: Date
}

interface AppliedMigration {
  hash: string
  createdAt: Date
}

export function getDrizzleDir(): string {
  return fileURLToPath(new URL('../../drizzle/', import.meta.url))
}

/** Read migration names and hashes from Drizzle's journal. */
async function getLocalMigrations(drizzleDir: string): Promise<LocalMigration[]> {
  const journal = JSON.parse(await readFile(`${drizzleDir}/meta/_journal.json`, 'utf8')) as {
    entries: Array<{ tag: string }>
  }
  return Promise.all(
    journal.entries.map(async (entry) => ({
      name: entry.tag,
      hash: createHash('sha256')
        .update(await readFile(`${drizzleDir}/${entry.tag}.sql`, 'utf8'))
        .digest('hex'),
    })),
  )
}

function formatDate(date: Date): string {
  return new Date(date).toISOString()
}

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
    const entry = meta.find((migration) => migration.tag === tag)
    stream(`  ${tag}${entry ? ` (${formatDate(entry.createdAt)})` : ''}`)
  }
}

function printHuman(result: ReturnType<typeof diffMigrations>, meta: MigrationMeta[]): void {
  printSection('Applied migrations:', result.applied, meta)
  printSection('Pending migrations (not yet applied):', result.pending, [])
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

function printJson(result: ReturnType<typeof diffMigrations>, exitCode: 0 | 1): void {
  console.info(JSON.stringify(statusSchema.parse({ ...result, exitCode }), null, 2))
}

export async function getAppliedMigrationsWithDates(
  connectionString: string,
): Promise<AppliedMigration[]> {
  const pool = new Pool({ connectionString })
  try {
    await pool.query(`SET statement_timeout = '5s'`)
    const result = await pool.query<{ hash: string; created_at: string | number }>(
      'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id ASC',
    )
    return result.rows.map((row) => ({
      hash: row.hash,
      createdAt: new Date(Number(row.created_at)),
    }))
  } finally {
    await pool.end()
  }
}

export async function main(argv: string[]): Promise<void> {
  const json = argv.includes('--json')
  const connectionString =
    process.env.DATABASE_URL ?? 'postgresql://athlos:athlos@localhost:5432/athlos'
  try {
    const appliedWithDates = await getAppliedMigrationsWithDates(connectionString)
    const localMigrations = await getLocalMigrations(getDrizzleDir())
    const namesByHash = new Map(
      localMigrations.map((migration) => [migration.hash, migration.name]),
    )
    const result = diffMigrations(
      appliedWithDates.map((migration) => migration.hash),
      localMigrations.map((migration) => migration.hash),
    )
    const output = {
      applied: result.applied.map((hash) => namesByHash.get(hash) ?? hash),
      pending: result.pending.map((hash) => namesByHash.get(hash) ?? hash),
      divergence: result.divergence,
    }
    const metadata = appliedWithDates.map(({ hash, createdAt }) => ({
      tag: namesByHash.get(hash) ?? hash,
      createdAt,
    }))
    const exitCode: 0 | 1 = output.pending.length || output.divergence.length ? 1 : 0
    process.exitCode = exitCode
    if (json) printJson(output, exitCode)
    else printHuman(output, metadata)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`db package: cannot connect to <redacted>: ${message}`)
    process.exitCode = 2
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`db package: unexpected error: ${message}`)
    process.exitCode = 2
  })
}
