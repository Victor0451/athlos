import { randomUUID } from 'node:crypto'
import type { NewCtacte1 } from '@athlos/db/schema'
import type { TransformHelpers } from '../transform-helpers.ts'

/**
 * Map VFP/projection payload → Drizzle `tesoreria.ctacte1` insert.
 *
 * ctacte1 is the "payments" sub-ledger of ctacte (one ctacte row may have
 * many ctacte1 rows tracking the payments against it).
 *
 * Field name mapping (verified against
 * `public."tesoreria.ctacte1_projection"` distinct keys, 245370 rows,
 * 2026-06-24):
 * - ctacteId ← FK map lookup by CCTCUENTA (parent ctacte's natural key)
 * - fecha    ← CCTPAGFECH (payment date)
 * - concepto ← CCTPAGTIPC (payment receipt type code as text)
 * - monto    ← CCTPAGOIMP (payment amount)
 *
 * Note: the VFP field prefix is `CCT` (not `CCT1`). The original design's
 * `CCT1NUMERO/CCT1FECHA/CCT1CONCEPT/CCT1IMPORTE` field names do not exist
 * in the projection.
 */
export function transformCtacte1(
  payload: Record<string, unknown>,
  helpers: TransformHelpers,
): NewCtacte1 {
  const { fkMap, parseFechaVFP, parseMonto, deterministicUuid } = helpers

  const cuenta = String(payload['CCTCUENTA'] ?? '')
  const ctacteUuid = fkMap.get(`ctacte:${cuenta}`)
  if (!ctacteUuid) throw new Error('no matching ctacte (CCTCUENTA not found)')

  const fecha = parseFechaVFP(payload['CCTPAGFECH'] ?? null)
  if (!fecha) throw new Error('Unparseable CCTPAGFECH')

  // legacy_id is a deterministic UUID from the 5-tuple natural key —
  // enables cross-run idempotency via UNIQUE INDEX on legacy_id.
  const legacyId = deterministicUuid(
    [
      payload['CCTPAGONRO'] ?? '',
      payload['CCTPAGOSEC'] ?? '',
      payload['CCTPAGOTAL'] ?? '',
      payload['CCTPAGOFAM'] ?? '',
      cuenta,
    ].join('|'),
  )

  return {
    id: randomUUID(),
    ctacteId: ctacteUuid,
    fecha,
    concepto: String(payload['CCTPAGTIPC'] ?? '').trim(),
    monto: parseMonto(payload['CCTPAGOIMP']),
    legacyId,
    createdAt: new Date(),
  }
}
