/**
 * Map VFP/projection payload → Drizzle `socios.locacion` insert.
 *
 * Per-socio address with composite NK (LCNCTAPRIN, LCNNUMERO).
 * 89 distinct composite values = 100% unique NK.
 * 15/89 rows have empty LCNCTAPRIN promoted as '' sentinel (no FK constraint).
 *
 * Source: `public."socios.locacion_projection"` (89 rows, 18 fields).
 * Field names verified against live DB sample (2026-06-25).
 */
import { randomUUID } from 'node:crypto'
import type { NewLocacion } from '@athlos/db/schema'
import type { TransformHelpers } from '../transform-helpers.ts'

export function transformLocacion(
  payload: Record<string, unknown>,
  helpers: TransformHelpers,
): NewLocacion {
  const { parseFechaVFP, parseMonto, deterministicUuid } = helpers

  const cuentaPrincipal = String(payload['LCNCTAPRIN'] ?? '').trim()
  // Empty '' is allowed (15/89 rows have empty LCNCTAPRIN) — promoted as '' sentinel

  const numero = Number(payload['LCNNUMERO'] ?? 0)
  if (!numero) throw new Error('Empty LCNNUMERO')

  const nombre = String(payload['LCNNOMBRE'] ?? '').trim()
  if (!nombre) throw new Error('Empty LCNNOMBRE')

  return {
    id: randomUUID(),
    cuentaPrincipal,
    cuentaSecundaria: payload['LCNCTASECU'] ? String(payload['LCNCTASECU']).trim() || null : null,
    numero,
    calle: payload['LCNCALLE'] ? String(payload['LCNCALLE']).trim() || null : null,
    barrio: payload['LCNBARRIO'] ? Number(payload['LCNBARRIO']) : null,
    piso: payload['LCNPISO'] ? String(payload['LCNPISO']).trim() || null : null,
    puerta: payload['LCNPUERTA'] ? Number(payload['LCNPUERTA']) : null,
    departamento: payload['LCNDEPARTA'] ? String(payload['LCNDEPARTA']).trim() || null : null,
    anexo1: payload['LCNANEXO1'] ? Number(payload['LCNANEXO1']) : null,
    anexo2: payload['LCNANEXO2'] ? Number(payload['LCNANEXO2']) : null,
    nombre,
    dni: payload['LCNDNI'] ? Number(payload['LCNDNI']) : null,
    cuit: payload['LCNCUIT'] ? Number(payload['LCNCUIT']) : null,
    telefono: payload['LCNTE'] ? Number(payload['LCNTE']) : null,
    fechaNacimiento: payload['LCNFECNACI'] ? parseFechaVFP(payload['LCNFECNACI']) : null,
    fechaBaja: payload['LCNFECBAJA'] ? parseFechaVFP(payload['LCNFECBAJA']) : null,
    situacionIva: payload['LCNSITUIVA'] ? Number(payload['LCNSITUIVA']) : null,
    cuota: payload['LCNCUOTA'] ? parseMonto(payload['LCNCUOTA']) : null,
    legacyId: deterministicUuid(`locacion:${cuentaPrincipal}|${numero}`),
    createdAt: new Date(),
  }
}
