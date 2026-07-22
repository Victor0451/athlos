import { sql } from 'drizzle-orm'
import type { Db } from '@athlos/db'
import { createIdempotencyFingerprint } from '../../lib/idempotency.ts'

const receiptRetry = { attempts: 3, delayMs: 10, claimLockTimeoutMs: 100 }

export type ReceiptTx = Parameters<Parameters<Db['transaction']>[0]>[0]

export interface ReceiptCommand {
  operatorId: string
  callerKey: string
  command: string
  endpoint: string
  payload: unknown
}

export type ReceiptExecution<T> = { inscripcionId?: string; result: T }
export type ReceiptOutcome<T> =
  | { outcome: 'executed' | 'replayed'; result: T }
  | { outcome: 'conflict' | 'unavailable' }

interface ReceiptRow {
  command: string
  request_fingerprint: string
  result: unknown
}
export async function executeInscriptionReceipt<T>(
  db: Db,
  table: string,
  command: ReceiptCommand,
  execute: (tx: ReceiptTx) => Promise<ReceiptExecution<T>>,
): Promise<ReceiptOutcome<T>> {
  const fingerprint = createIdempotencyFingerprint(
    command.command,
    command.endpoint,
    command.payload,
  )
  let claimed: ReceiptExecution<T> | false = false
  try {
    claimed = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SET LOCAL lock_timeout = '${sql.raw(String(receiptRetry.claimLockTimeoutMs))}ms'`,
      )
      const inserted = await tx.execute(sql`INSERT INTO ${sql.raw(table)}
        (operator_id, caller_key, command, request_fingerprint)
        VALUES (${command.operatorId}, ${command.callerKey}, ${command.command}, ${fingerprint})
        ON CONFLICT (operator_id, caller_key) DO NOTHING RETURNING operator_id`)
      if (!rows(inserted)[0]) return false

      const receipt = await execute(tx)
      await tx.execute(sql`UPDATE ${sql.raw(table)} SET inscripcion_id = ${receipt.inscripcionId ?? null},
        result = ${JSON.stringify(receipt.result)}::jsonb
        WHERE operator_id = ${command.operatorId} AND caller_key = ${command.callerKey}`)
      return receipt
    })
  } catch (error) {
    if (!isClaimLockTimeout(error)) throw error
  }
  if (claimed) return { outcome: 'executed', result: claimed.result }

  for (let attempt = 0; attempt < receiptRetry.attempts; attempt++) {
    const receipt = await db.transaction(async (tx) => {
      const selected = await tx.execute(sql`SELECT command, request_fingerprint, result
        FROM ${sql.raw(table)} WHERE operator_id = ${command.operatorId}
        AND caller_key = ${command.callerKey} FOR UPDATE`)
      return rows(selected)[0] as ReceiptRow | undefined
    })
    if (!receipt) {
      await delay(receiptRetry.delayMs)
      continue
    }
    const outcome = mapReceipt<T>(receipt, command.command, fingerprint)
    if (outcome) return outcome
    await delay(receiptRetry.delayMs)
  }
  return { outcome: 'unavailable' }
}

function mapReceipt<T>(
  receipt: ReceiptRow,
  command: string,
  fingerprint: string,
): ReceiptOutcome<T> | undefined {
  if (receipt.command !== command || receipt.request_fingerprint !== fingerprint) {
    return { outcome: 'conflict' }
  }
  return receipt.result === null ? undefined : { outcome: 'replayed', result: receipt.result as T }
}

function rows(result: unknown): Array<Record<string, unknown>> {
  return (result as { rows?: Array<Record<string, unknown>> }).rows ?? []
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isClaimLockTimeout(error: unknown): boolean {
  return (error as { code?: string })?.code === '55P03'
}
