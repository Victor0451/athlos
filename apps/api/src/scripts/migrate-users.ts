import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Dbf } from 'dbf-reader/dbf'
import type { DataTable } from 'dbf-reader/models/dbf-file'
import type { Db } from '@athlos/db'
import { operators } from '@athlos/db/schema'
import { hashPassword } from '@athlos/auth'

/**
 * Legacy USUARIO.DBF → `operators` table migration.
 *
 * Reads the legacy Visual FoxPro USUARIO.DBF file (one row per legacy
 * operator) and inserts each into the new `operators` table with
 * bcrypt-hashed password. The script is **idempotent**: re-running
 * it on a populated database is a no-op for already-imported usernames
 * (ON CONFLICT DO NOTHING) and exits with a summary.
 *
 * Field mapping (VFP USUARIO.DBF → Athlos operators):
 *   USUCLAVE   → username              (string, unique)
 *   USUCONTR   → passwordHash          (plaintext, bcrypt-hashed at cost 12)
 *   USUTIPO    → role                  (1 char: A|T|O|C → role string)
 *   USUREIMPRE → canReprint            (truthy → true)
 *   USUANULACI → canAnulate            (truthy → true)
 *
 * The dbf-reader library returns rows as `Record<string, unknown>`
 * with field names in the original VFP casing. We do case-insensitive
 * matching to be tolerant of VFP's tendency to store columns in
 * whatever case the developer typed them in.
 *
 * Exit codes:
 *   0 — success (idempotent re-runs are still success)
 *   1 — DB unreachable or fatal read error
 */

export interface MigrateResult {
  read: number
  inserted: number
  skipped: number
  errors: Array<{ username: string; reason: string }>
}

export interface MigrateOptions {
  /** Override the password hash function (used by tests to avoid bcrypt). */
  hashFn?: (plain: string) => Promise<string>
}

const ROLE_MAP: Record<string, 'A' | 'T' | 'O' | 'C'> = {
  A: 'A',
  T: 'T',
  O: 'O',
  C: 'C',
  // Spanish labels the VFP UI sometimes writes instead of the 1-char code
  ADMIN: 'A',
  TESORERO: 'T',
  OPERADOR: 'O',
  CONSULTA: 'C',
}

interface MappedRow {
  username: string
  password: string
  role: 'A' | 'T' | 'O' | 'C'
  canReprint: boolean
  canAnulate: boolean
}

/** Read a USUARIO.DBF file from disk and return the parsed data table. */
export async function readUsuarioDbf(filePath: string): Promise<DataTable> {
  const buffer = await readFile(filePath)
  return Dbf.read(buffer)
}

/**
 * Normalize a USUARIO row to the operators insert shape. Throws on
 * missing required fields with a message that surfaces the VFP column
 * name so the operator can fix the source data.
 */
export function mapUsuarioRow(row: Record<string, unknown>): MappedRow {
  // Find fields case-insensitively (VFP is case-dyslexic)
  const lower: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    lower[k.toUpperCase().trim()] = v
  }
  const username = String(lower['USUCLAVE'] ?? '').trim()
  const password = String(lower['USUCONTR'] ?? '')
  const rawRole = String(lower['USUTIPO'] ?? '')
    .toUpperCase()
    .trim()
  const canReprint = isTruthy(lower['USUREIMPRE'])
  const canAnulate = isTruthy(lower['USUANULACI'])

  if (!username) throw new Error('missing USUCLAVE')
  if (!password) throw new Error('missing USUCONTR (plaintext password)')
  const role = ROLE_MAP[rawRole]
  if (!role) throw new Error(`unknown USUTIPO value: "${rawRole}"`)

  return { username, password, role, canReprint, canAnulate }
}

function isTruthy(v: unknown): boolean {
  if (v === true || v === 'T' || v === 't' || v === 'Y' || v === 'y') return true
  if (
    v === false ||
    v === 'F' ||
    v === 'f' ||
    v === 'N' ||
    v === 'n' ||
    v === null ||
    v === undefined
  )
    return false
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (s === 'true' || s === 'yes' || s === '1' || s === 'si' || s === 'sí') return true
    if (s === '' || s === 'false' || s === 'no' || s === '0') return false
    return s === 't' || s === 'y' || s === 's'
  }
  return Boolean(v)
}

/**
 * Run the migration end-to-end. Public so tests can pass a stand-in
 * `DataTable` (from a tiny synthetic DBF) without touching the disk
 * or paying the bcrypt cost on every test run.
 */
export async function migrateUsuario(
  db: Db,
  table: DataTable,
  options: MigrateOptions = {},
): Promise<MigrateResult> {
  const hashFn = options.hashFn ?? hashPassword
  const result: MigrateResult = {
    read: table.rows.length,
    inserted: 0,
    skipped: 0,
    errors: [],
  }

  for (const rawRow of table.rows) {
    let mapped: MappedRow
    try {
      mapped = mapUsuarioRow(rawRow as Record<string, unknown>)
    } catch (err) {
      const username = String((rawRow as Record<string, unknown>)['USUCLAVE'] ?? '<unknown>')
      result.errors.push({
        username,
        reason: err instanceof Error ? err.message : String(err),
      })
      continue
    }

    try {
      const passwordHash = await hashFn(mapped.password)
      // ON CONFLICT DO NOTHING — skip if the username is already in
      // the operators table. Postgres returns rowCount=0 on conflict.
      const inserted = await db
        .insert(operators)
        .values({
          username: mapped.username,
          passwordHash,
          role: mapped.role,
          canReprint: mapped.canReprint,
          canAnulate: mapped.canAnulate,
        })
        .onConflictDoNothing({ target: operators.username })
        .returning({ id: operators.id })

      if (inserted.length > 0) {
        result.inserted += 1
      } else {
        result.skipped += 1
      }
    } catch (err) {
      result.errors.push({
        username: mapped.username,
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return result
}

/**
 * CLI entry point. Reads LEGACY_DB_PATH (or argv[2]), runs the
 * migration, logs a summary, and returns the exit code.
 *
 * The script is a thin shell around {@link migrateUsuario}: it only
 * adds the I/O concerns (file read, env lookup, exit code) so the
 * pure migration logic stays testable.
 */
export async function runMigrateUsuarioCli(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const basePath = env['LEGACY_DB_PATH'] ?? process.argv[2]
  if (!basePath) {
    console.error('LEGACY_DB_PATH env var or argv[2] is required (e.g. /srv/gorriti/dbf)')
    return 1
  }
  const filePath = join(basePath, 'USUARIO.DBF')
  let table: DataTable
  try {
    table = await readUsuarioDbf(filePath)
  } catch (err) {
    console.error(`Failed to read ${filePath}:`, err instanceof Error ? err.message : err)
    return 1
  }

  // Lazy import the db so the script can be required without a DB
  // connection at module-init time (and so a missing DATABASE_URL
  // surfaces a clean error message).
  const { createDb } = await import('@athlos/db')
  const { loadEnv } = await import('@athlos/config')
  const validated = loadEnv(env)
  const { db, pool } = createDb({ connectionString: validated.DATABASE_URL })

  try {
    const result = await migrateUsuario(db, table)

    console.info(
      `Read ${result.read} records, inserted ${result.inserted}, skipped ${result.skipped} (duplicates)`,
    )
    if (result.errors.length > 0) {
      console.warn(`${result.errors.length} row(s) failed:`)
      for (const e of result.errors) {
        console.warn(`  - ${e.username}: ${e.reason}`)
      }
    }
    return 0
  } catch (err) {
    console.error('Migration failed:', err instanceof Error ? err.message : err)
    return 1
  } finally {
    await pool.end()
  }
}

// Detect "run as script" — only invoke the CLI when this module is
// the entry point. tsx preserves the entry module identity.
const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  runMigrateUsuarioCli().then((code) => {
    process.exit(code)
  })
}
