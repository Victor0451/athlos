/**
 * Map VFP/projection payload → Drizzle `tesoreria.caja_movimiento` insert.
 *
 * Cash movement header with 4-tuple NK (CAJNUMERO, CAJSECUENC, CAJFECHA, CAJHORA).
 * Scope correction #C3: 4-tuple yields 8145/8145 = 100% unique.
 * The 3-tuple (without CAJHORA) yields 7957 distinct — 188 silent row losses.
 * 122 detail columns (CAJCONCEP1..20, CAJIMPOR1..20, etc.) are discarded (deferred to N7).
 *
 * Source: `public."tesoreria.caja_projection"` (8145 rows, 128 fields).
 * Field names verified against live DB sample (2026-06-25).
 */
import { randomUUID } from 'node:crypto'
import type { NewCajaMovimiento } from '@athlos/db/schema'
import type { TransformHelpers } from '../transform-helpers.ts'

export function transformCaja(
  payload: Record<string, unknown>,
  helpers: TransformHelpers,
): NewCajaMovimiento {
  const { parseFechaVFP, deterministicUuid } = helpers

  const numero = Number(payload['CAJNUMERO'] ?? 0)
  if (!numero) throw new Error('Empty CAJNUMERO')

  const secuencia = Number(payload['CAJSECUENC'] ?? 0)
  const hora = Number(payload['CAJHORA'] ?? 0) // CRITICAL: 4-tuple NK includes hora

  const fecha = parseFechaVFP(payload['CAJFECHA'] ?? null)
  if (!fecha) throw new Error('Unparseable CAJFECHA')

  return {
    id: randomUUID(),
    numero,
    secuencia,
    fecha,
    hora,
    tip: payload['CAJTIP'] ? Number(payload['CAJTIP']) : null,
    descrip: payload['CAJDESCRIP'] ? String(payload['CAJDESCRIP']).trim() || null : null,
    legacyId: deterministicUuid(`caja:${numero}|${secuencia}|${fecha}|${hora}`),
    createdAt: new Date(),
  }
}
