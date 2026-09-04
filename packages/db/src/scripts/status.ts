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
import { collectionsCompatibilityHashes } from './collections-migration-identities.ts'

const { Pool } = pg

interface TimestampedMigration {
  hash: string
  createdAt: Date
}

/** Pure Drizzle migrator frontier diff with ledger divergence detection. */
export function diffMigrations(
  applied: TimestampedMigration[],
  local: TimestampedMigration[],
): { applied: string[]; pending: string[]; divergence: string[] } {
  const localHashes = new Set(local.map((migration) => migration.hash))
  const frontier = applied.reduce(
    (latest, migration) => Math.max(latest, migration.createdAt.getTime()),
    Number.NEGATIVE_INFINITY,
  )

  return {
    applied: local
      .filter((migration) => migration.createdAt.getTime() <= frontier)
      .map((migration) => migration.hash),
    pending: local
      .filter((migration) => migration.createdAt.getTime() > frontier)
      .map((migration) => migration.hash),
    divergence: applied
      .filter((migration) => !localHashes.has(migration.hash))
      .map((migration) => migration.hash),
  }
}

interface LocalMigration extends TimestampedMigration {
  name: string
}

interface MigrationMeta {
  tag: string
  createdAt: Date
}

type AppliedMigration = TimestampedMigration

const DRIZZLE_LEDGER = 'drizzle.__drizzle_migrations'
const PUBLIC_LEDGER = 'public.__drizzle_migrations'

class MigrationLedgerMissingError extends Error {
  constructor() {
    super(`migration ledger not found (checked ${DRIZZLE_LEDGER} and ${PUBLIC_LEDGER})`)
  }
}

export function getDrizzleDir(): string {
  return fileURLToPath(new URL('../../drizzle/', import.meta.url))
}

/** Read migration names and hashes from Drizzle's journal. */
async function getLocalMigrations(drizzleDir: string): Promise<LocalMigration[]> {
  const journal = JSON.parse(await readFile(`${drizzleDir}/meta/_journal.json`, 'utf8')) as {
    entries: Array<{ tag: string; when: number }>
  }
  return Promise.all(
    journal.entries.map(async (entry) => ({
      name: entry.tag,
      createdAt: new Date(entry.when),
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
    // Drizzle Kit 0.30 creates the drizzle ledger. Retain public as a
    // deterministic fallback for databases created by older tooling.
    const ledgers = await pool.query<{ drizzle: string | null; public: string | null }>(
      'SELECT to_regclass($1)::text AS drizzle, to_regclass($2)::text AS public',
      [DRIZZLE_LEDGER, PUBLIC_LEDGER],
    )
    const ledger = ledgers.rows[0]?.drizzle
      ? DRIZZLE_LEDGER
      : ledgers.rows[0]?.public
        ? PUBLIC_LEDGER
        : null
    if (!ledger) throw new MigrationLedgerMissingError()
    const result = await pool.query<{ hash: string; created_at: string | number }>(
      ledger === DRIZZLE_LEDGER
        ? 'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id ASC'
        : 'SELECT hash, created_at FROM public.__drizzle_migrations ORDER BY id ASC',
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
    const currentCompatibilityHash = localMigrations.find(
      (migration) => migration.name === '0059_collections_inscription_compatibility',
    )?.hash
    const namesByHash = new Map(
      localMigrations.map((migration) => [migration.hash, migration.name]),
    )
    for (const hash of collectionsCompatibilityHashes)
      namesByHash.set(hash, '0059_collections_inscription_compatibility')
    const normalizedApplied = appliedWithDates.map((migration) =>
      currentCompatibilityHash && collectionsCompatibilityHashes.has(migration.hash)
        ? { ...migration, hash: currentCompatibilityHash }
        : migration,
    )
    const result = diffMigrations(normalizedApplied, localMigrations)
    const output = {
      applied: result.applied.map((hash) => namesByHash.get(hash) ?? hash),
      pending: result.pending.map((hash) => namesByHash.get(hash) ?? hash),
      divergence: result.divergence,
    }
    const metadata = localMigrations.map(({ name, createdAt }) => ({
      tag: name,
      createdAt,
    }))
    const exitCode: 0 | 1 = output.pending.length || output.divergence.length ? 1 : 0
    process.exitCode = exitCode
    if (json) printJson(output, exitCode)
    else printHuman(output, metadata)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof MigrationLedgerMissingError) {
      console.error(`db package: ${message}; run migrate before migrate:status`)
    } else {
      console.error(`db package: cannot read migration ledger from <redacted>: ${message}`)
    }
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
