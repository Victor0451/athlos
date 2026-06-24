import { randomUUID } from 'node:crypto'
import type { NewSocio } from '@athlos/db/schema'
import type { TransformHelpers } from '../transform-helpers.ts'

/**
 * Map VFP/projection payload → Drizzle `socios.socios` insert.
 *
 * Field name mapping (verified against `public."socios.socios_projection"`
 * distinct keys, 39357 rows, 2026-06-24):
 * - numeroSocio ← SOCCARNET (PK alternative; UNIQUE)
 * - dni         ← SOCNUMDOCU (document number; UNIQUE)
 * - apellido/nombre ← SOCAPYNOMB (split on whitespace)
 * - fechaAlta   ← SOCFECINGR (ingreso = alta)
 * - categoria   ← SOCCATEGOR (NOT FK)
 * - direccion   ← SOCDIRECCI
 * - telefono    ← SOCTE (teléfono)
 * - deleted_at  ← SOCFECBAJA (when present + non-sentinel)
 *
 * `estado` defaults to 'activo'; promotion to 'baja' is set explicitly when
 * SOCFECBAJA is present and indicates real baja (not the 1925-01-31 sentinel).
 */
export function transformSocio(
  payload: Record<string, unknown>,
  helpers: TransformHelpers,
): NewSocio {
  const { parseFechaVFP, splitApellidoNombre } = helpers

  const carnet = String(payload['SOCCARNET'] ?? payload['SOCNUMERO'] ?? '').trim()
  if (!carnet) throw new Error('Empty SOCCARNET/SOCNUMERO')

  const dni = String(payload['SOCNUMDOCU'] ?? '').trim()
  if (!dni) throw new Error('Empty SOCNUMDOCU')

  const fullName = String(payload['SOCAPYNOMB'] ?? '').trim()
  const { apellido, nombre } = splitApellidoNombre(fullName)

  const fechaAltaRaw =
    payload['SOCFECINGR'] ?? payload['SOCFECALTA'] ?? payload['SOCFECNACI'] ?? null
  const fechaAlta = parseFechaVFP(fechaAltaRaw)
  if (!fechaAlta) throw new Error('Unparseable SOCFECINGR/SOCFECALTA/SOCFECNACI')

  const fechaBajaRaw = payload['SOCFECBAJA']
  const fechaBajaParsed = fechaBajaRaw ? parseFechaVFP(fechaBajaRaw) : null
  // Sentinel value 1925-01-31 (VFP empty date) means "no real baja".
  const SENTINEL = '1925-01-31'
  const isRealBaja = fechaBajaParsed !== null && fechaBajaParsed !== SENTINEL && fechaBajaRaw !== ''
  const estado: 'activo' | 'baja' = isRealBaja ? 'baja' : 'activo'

  return {
    id: randomUUID(),
    numeroSocio: carnet,
    nombre,
    apellido,
    dni,
    fechaAlta,
    estado,
    categoria: payload['SOCCATEGOR'] ? String(payload['SOCCATEGOR']).trim() || null : null,
    direccion: payload['SOCDIRECCI'] ? String(payload['SOCDIRECCI']).trim() || null : null,
    telefono: payload['SOCTE'] ? String(payload['SOCTE']).trim() || null : null,
    email: payload['SOCEMAIL'] ? String(payload['SOCEMAIL']).trim() || null : null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: isRealBaja && fechaBajaParsed ? new Date(fechaBajaParsed) : null,
  }
}
