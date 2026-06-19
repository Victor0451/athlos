/**
 * grant-data-steward.ts — idempotent DATA_STEWARD permission grant with audit.
 *
 * Usage:
 *   pnpm ops:grant-data-steward --username <u> [--username <u2> ...]
 *   DATA_STEWARD_OPERATOR_IDS=<uuid1>,<uuid2> pnpm ops:grant-data-steward --from-env
 *   pnpm ops:grant-data-steward --username <u> --json
 *
 * Exit codes:
 *   0 — success (all grants processed)
 *   1 — unknown username or invalid UUID
 *   2 — connection error or bad arguments (e.g., --from-env with --username)
 */
import pg from 'pg'
import { emitAudit, type AuditRecord } from '@athlos/audit'
import { createDb } from '../pool.js'
import { makeOperatorsRepo } from '../repositories/operators.js'
import { makePermissionsRepo } from '../repositories/permissions.js'
import { grantDataStewardOutputSchema } from './grant-data-steward.schema.js'

export { grantDataStewardOutputSchema }

// ---------------------------------------------------------------------------
// Pure function — categorises a grant into a result bucket
// ---------------------------------------------------------------------------

/**
 * Bucketize a single operator grant into either `granted` or `alreadyGranted`.
 *
 * - `null` operator → `granted: []` (skip)
 * - `key !== 'data_steward'` → `granted: []` (not a data-steward key, skip)
 * - `hasPermission === true` → `alreadyGranted: [operatorId]`
 * - `hasPermission === false` → `granted: [operatorId]`
 */
export function bucketizeGrant(
  operator: { id: string } | null,
  hasPermission: boolean,
  key: string,
): { granted: string[] } | { alreadyGranted: string[] } {
  if (!operator || key !== 'data_steward') {
    return { granted: [] }
  }
  if (hasPermission) {
    return { alreadyGranted: [operator.id] }
  }
  return { granted: [operator.id] }
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface ParseArgvResult {
  usernames: string[]
  fromEnv: boolean
  json: boolean
}

/**
 * Parse minimal argv (no external deps).
 * --username is repeatable; --from-env and --json are boolean flags.
 */
function parseArgv(argv: string[]): ParseArgvResult {
  const usernames: string[] = []
  let fromEnv = false
  let json = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--username') {
      usernames.push(argv[i + 1])
      i++
    } else if (arg === '--from-env') {
      fromEnv = true
    } else if (arg === '--json') {
      json = true
    }
  }

  return { usernames, fromEnv, json }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function printHuman(granted: string[], alreadyGranted: string[]): void {
  if (granted.length > 0) {
    console.info(`Granted data_steward to: ${granted.join(', ')}`)
  }
  if (alreadyGranted.length > 0) {
    console.info(`Already had data_steward: ${alreadyGranted.join(', ')}`)
  }
  if (granted.length === 0 && alreadyGranted.length === 0) {
    console.info('No operators processed.')
  }
}

function printJson(granted: string[], alreadyGranted: string[], auditIds: string[]): void {
  const output = grantDataStewardOutputSchema.parse({ granted, alreadyGranted, auditIds })
  console.info(JSON.stringify(output, null, 2))
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const { Pool } = pg

export async function main(
  argv: string[],
  dbOverride?: Parameters<typeof createDb>[0] extends { db: infer D } ? D : never,
): Promise<void> {
  const { usernames, fromEnv, json } = parseArgv(argv)

  // Validate: --from-env and --username are mutually exclusive
  if (fromEnv && usernames.length > 0) {
    console.error('Error: --from-env and --username cannot be used together.')
    process.exitCode = 2
    return
  }

  if (!fromEnv && usernames.length === 0) {
    console.error('Usage: grant-data-steward --username <u> [--username <u2> ...]')
    console.error('       DATA_STEWARD_OPERATOR_IDS=<ids> grant-data-steward --from-env')
    process.exitCode = 2
    return
  }

  const connectionString =
    process.env.DATABASE_URL ?? 'postgresql://athlos:athlos@localhost:5432/athlos'

  let pool: pg.Pool | undefined
  const getDb = (): Parameters<typeof makeOperatorsRepo>[0] => {
    if (dbOverride) return dbOverride as Parameters<typeof makeOperatorsRepo>[0]
    if (!pool) {
      pool = new Pool({ connectionString })
    }
    return createDb({ connectionString }).db
  }

  try {
    const db = getDb()
    const operatorsRepo = makeOperatorsRepo(db)
    const permissionsRepo = makePermissionsRepo(db)

    const granted: string[] = []
    const alreadyGranted: string[] = []
    const auditIds: string[] = []

    if (fromEnv) {
      const raw = process.env.DATA_STEWARD_OPERATOR_IDS ?? ''
      if (!raw) {
        console.error('Error: DATA_STEWARD_OPERATOR_IDS env var is empty or not set.')
        process.exitCode = 1
        return
      }
      const ids = raw.split(',').map((id) => id.trim())
      for (const operatorId of ids) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operatorId)) {
          console.error(`Error: Invalid UUID in DATA_STEWARD_OPERATOR_IDS: ${operatorId}`)
          process.exitCode = 1
          return
        }
        const hasPermission = await permissionsRepo.hasPermission(operatorId, 'data_steward')
        const outcome = bucketizeGrant({ id: operatorId }, hasPermission, 'data_steward')
        if ('alreadyGranted' in outcome) {
          alreadyGranted.push(operatorId)
        } else {
          // Grant + audit in a single transaction
          const auditResult = await db.transaction(async (tx) => {
            await permissionsRepo.grant(operatorId, 'data_steward', null)
            const record: AuditRecord = {
              operatorId: null,
              action: 'permission.granted',
              entityType: 'role_permission',
              entityId: operatorId,
              oldValue: null,
              newValue: { permissionKey: 'data_steward', grantedBy: null },
              sourceIp: null,
              payload: { permissionKey: 'data_steward' },
            }
            return emitAudit(tx as Parameters<typeof emitAudit>[0], record)
          })
          if (auditResult.inserted) {
            auditIds.push(auditResult.id)
          }
          granted.push(operatorId)
        }
      }
    } else {
      // Resolve usernames to operator IDs, then grant
      for (const username of usernames) {
        const operator = await operatorsRepo.findByUsername(username)
        if (!operator) {
          console.error(`Error: Unknown operator username: ${username}`)
          process.exitCode = 1
          return
        }

        const hasPermission = await permissionsRepo.hasPermission(operator.id, 'data_steward')
        const outcome = bucketizeGrant(operator, hasPermission, 'data_steward')

        if ('alreadyGranted' in outcome) {
          alreadyGranted.push(operator.id)
        } else {
          // Grant + audit in a single transaction
          const auditResult = await db.transaction(async (tx) => {
            await permissionsRepo.grant(operator.id, 'data_steward', null)
            const record: AuditRecord = {
              operatorId: null,
              action: 'permission.granted',
              entityType: 'role_permission',
              entityId: operator.id,
              oldValue: null,
              newValue: { permissionKey: 'data_steward', grantedBy: null },
              sourceIp: null,
              payload: { permissionKey: 'data_steward' },
            }
            return emitAudit(tx as Parameters<typeof emitAudit>[0], record)
          })
          if (auditResult.inserted) {
            auditIds.push(auditResult.id)
          }
          granted.push(operator.id)
        }
      }
    }

    if (json) {
      printJson(granted, alreadyGranted, auditIds)
    } else {
      printHuman(granted, alreadyGranted)
    }

    process.exitCode = 0
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`Error: ${message}`)
    process.exitCode = 2
  } finally {
    if (pool) {
      await pool.end()
    }
  }
}

main(process.argv.slice(2)).catch((err) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`Unexpected error: ${message}`)
  process.exitCode = 2
})
