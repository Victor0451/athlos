import { sql } from 'drizzle-orm'
import type { Db } from '@athlos/db'

// --- inline cents helpers (same logic as apps/api/src/test-standins/db.ts) ---
function parseCents(s: string): bigint {
  const sign = s.startsWith('-') ? -1n : 1n
  const unsigned = s.replace(/^-/, '')
  const [intPart, fracPart = ''] = unsigned.split('.')
  const intCents = BigInt(intPart ?? '0') * 100n
  const fracCents = BigInt((fracPart + '00').slice(0, 2))
  return sign * (intCents + fracCents)
}

function centsToString(cents: bigint): string {
  const sign = cents < 0n ? '-' : ''
  const abs = cents < 0n ? -cents : cents
  const intPart = abs / 100n
  const fracPart = abs % 100n
  return `${sign}${intPart.toString()}.${fracPart.toString().padStart(2, '0')}`
}

export interface SaldoResult {
  socioEntityId: string
  debe: string
  haber: string
  saldo: string
  as_of: string
}

/**
 * Compute the cuenta-corriente saldo for a socio by entity_uuid.
 *
 * Algorithm:
 *   1. Resolve `socioEntityId` → `socios.id` via entity_uuids lookup
 *   2. Throw if not found
 *   3. Query tesoreria.ctacte rows for that socio (excluding anuladas)
 *   4. Sum debe / haber using bigint-cents arithmetic
 *   5. Return { socioEntityId, debe, haber, saldo, as_of }
 */
export async function computeSaldo(db: Db, socioEntityId: string): Promise<SaldoResult> {
  // Step 1: resolve entity_uuid → socios.id

  const uuidResult = await (
    db.execute as (q: unknown) => Promise<{ rows?: unknown[]; rowCount?: number }>
  )(
    sql`SELECT id FROM socios WHERE id = (
      SELECT source_key FROM entity_uuids
      WHERE entity_uuid = ${socioEntityId}
        AND source_table = 'socios'
    )`,
  )

  if (!uuidResult.rowCount || uuidResult.rowCount === 0) {
    throw new Error(`entity_uuid not found: ${socioEntityId}`)
  }

  const socioId = (uuidResult.rows as { id: string }[])[0].id

  // Step 2: query ctacte for this socio

  const ctacteResult = await (db.execute as (q: unknown) => Promise<{ rows?: Array<unknown> }>)(
    sql`SELECT socio_id, debe, haber, anulado FROM tesoreria.ctacte WHERE socio_id = ${socioId}`,
  )

  const rows = (ctacteResult.rows ?? []) as { debe: string; haber: string; anulado: boolean }[]

  // Step 3: sum debe / haber in cents (exclude anuladas)
  let debeCents = 0n
  let haberCents = 0n
  for (const r of rows) {
    if (r.anulado) continue
    debeCents += parseCents(String(r.debe))
    haberCents += parseCents(String(r.haber))
  }

  const saldoCents = debeCents - haberCents

  return {
    socioEntityId,
    debe: centsToString(debeCents),
    haber: centsToString(haberCents),
    saldo: centsToString(saldoCents),
    as_of: new Date().toISOString(),
  }
}
