import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { hashPassword } from '@athlos/auth'
import pg from 'pg'

const ADVISORY_LOCK_KEY = 'athlos:controlled-administrator-bootstrap'
const SERIALIZATION_FAILURE = '40001'

type QueryResult = { rows: Record<string, unknown>[] }
type Transaction = { query: (sql: string, values?: unknown[]) => Promise<QueryResult> }

export interface BootstrapDatabase {
  transaction: <T>(callback: (transaction: Transaction) => Promise<T>) => Promise<T>
}

export type BootstrapResult =
  | { outcome: 'created'; operatorId: string }
  | { outcome: 'refused'; reason: 'approval_required' | 'recoverable_operator_exists' }

export interface BootstrapInput {
  username: string
  approvalId: string
  password: string
}

export function parseBootstrapArgs(argv: string[]): {
  username: string
  approvalId: string
  passwordFd: number
} {
  const values = new Map<string, string>()
  const supported = new Set(['--username', '--approval-id', '--password-fd'])

  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!flag || !supported.has(flag)) throw new Error(`unsupported argument: ${flag ?? ''}`)
    if (!value) throw new Error(`${flag} requires a value`)
    values.set(flag, value)
  }

  const username = values.get('--username')
  const approvalId = values.get('--approval-id')
  const passwordFd = Number(values.get('--password-fd'))
  if (!username || !approvalId || !Number.isInteger(passwordFd) || passwordFd < 0) {
    throw new Error(
      'usage: bootstrap-admin --username <username> --approval-id <reference> --password-fd <fd>',
    )
  }
  return { username, approvalId, passwordFd }
}

async function writeAudit(
  transaction: Transaction,
  action: string,
  metadata: Record<string, string>,
): Promise<void> {
  await transaction.query(
    `INSERT INTO audit_events (operator_id, action, entity_type, entity_id, metadata)
     VALUES (NULL, $1, 'operator', 'administrator-bootstrap', $2::jsonb)`,
    [action, JSON.stringify(metadata)],
  )
}

async function bootstrapOnce(
  input: BootstrapInput,
  database: BootstrapDatabase,
): Promise<BootstrapResult> {
  return database.transaction(async (transaction) => {
    await transaction.query('SELECT pg_advisory_xact_lock(hashtext($1))', [ADVISORY_LOCK_KEY])

    if (!input.approvalId) {
      await writeAudit(transaction, 'ADMIN_BOOTSTRAP_REFUSED', { reason: 'approval_required' })
      return { outcome: 'refused', reason: 'approval_required' }
    }

    const recoverable = await transaction.query(
      `SELECT id FROM operators
       WHERE is_active = true AND (locked_until IS NULL OR locked_until < now())
       LIMIT 1`,
    )
    if (recoverable.rows.length > 0) {
      await writeAudit(transaction, 'ADMIN_BOOTSTRAP_REFUSED', {
        approvalId: input.approvalId,
        reason: 'recoverable_operator_exists',
      })
      return { outcome: 'refused', reason: 'recoverable_operator_exists' }
    }

    const passwordHash = await hashPassword(input.password)
    const inserted = await transaction.query(
      `INSERT INTO operators (username, password_hash, role, can_reprint, can_anulate, is_active)
       VALUES ($1, $2, 'A', true, true, true)
       RETURNING id`,
      [input.username, passwordHash],
    )
    const operatorId = String(inserted.rows[0]?.['id'])
    await writeAudit(transaction, 'ADMIN_BOOTSTRAPPED', {
      approvalId: input.approvalId,
      outcome: 'created',
    })
    return { outcome: 'created', operatorId }
  })
}

export async function bootstrapAdministrator(
  input: BootstrapInput,
  database: BootstrapDatabase,
): Promise<BootstrapResult> {
  try {
    return await bootstrapOnce(input, database)
  } catch (error) {
    if ((error as { code?: string }).code !== SERIALIZATION_FAILURE) throw error
    return bootstrapOnce(input, database)
  }
}

function createDatabase(connectionString: string): {
  database: BootstrapDatabase
  close: () => Promise<void>
} {
  const pool = new pg.Pool({ connectionString })
  return {
    database: {
      transaction: async <T>(callback: (transaction: Transaction) => Promise<T>): Promise<T> => {
        const client = await pool.connect()
        try {
          await client.query('BEGIN')
          const result = await callback(client)
          await client.query('COMMIT')
          return result
        } catch (error) {
          await client.query('ROLLBACK')
          throw error
        } finally {
          client.release()
        }
      },
    },
    close: () => pool.end(),
  }
}

export async function main(argv: string[]): Promise<void> {
  const { username, approvalId, passwordFd } = parseBootstrapArgs(argv)
  const password = readFileSync(passwordFd, 'utf8').replace(/\r?\n$/, '')
  if (!password) throw new Error('password file descriptor produced an empty password')

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required')
  const { database, close } = createDatabase(connectionString)
  try {
    const result = await bootstrapAdministrator({ username, approvalId, password }, database)
    console.info(JSON.stringify(result))
  } finally {
    await close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
