/**
 * Map VFP/projection payload → Drizzle `tesoreria.gastos` insert.
 *
 * Flat expense ledger with 5-tuple NK (GASTIPGAST, GASCTAPRIN, GASSECUENC, GASFECHA, GASCOMPROB).
 * Scope correction #C2: 5-tuple verified 2114/2114 = 100% unique (3-tuple yields 346 distinct
 * — 1,768 silent row losses via legacy_id UNIQUE collision).
 *
 * NO ctacte FK in v1 (verified live: 0 of 165 distinct GASCTAPRIN match any ctacte.cctcuenta).
 * NO socio_id FK in v1 (no source field; socio_id column reserved for future N16 backfill).
 *
 * Source: `public."tesoreria.gastos_projection"` (2,114 rows, 11 fields).
 * Field names verified against live DB sample 2026-06-25.
 */
import { randomUUID } from 'node:crypto'
import type { NewGastos } from '@athlos/db/schema'
import type { TransformHelpers } from '../transform-helpers.ts'

export function transformGastos(
  payload: Record<string, unknown>,
  helpers: TransformHelpers,
): NewGastos {
  const { parseFechaVFP, parseMonto, deterministicUuid } = helpers

  const tipo = Number(payload['GASTIPGAST'] ?? 0)
  if (!tipo) throw new Error('Empty GASTIPGAST')

  const tipoCuenta = Number(payload['GASTIPCTA'] ?? 0)

  const cuentaPrincipal = String(payload['GASCTAPRIN'] ?? '')
  if (!cuentaPrincipal) throw new Error('Empty GASCTAPRIN')

  const cuentaAuxiliar = payload['GASCTAAUXI'] ? Number(payload['GASCTAAUXI']) : null

  const secuencia = Number(payload['GASSECUENC'] ?? 0)

  const comprobante = String(payload['GASCOMPROB'] ?? '').trim()
  // 1/2114 rows have empty string (sentinel); '' is a valid value

  const fecha = parseFechaVFP(payload['GASFECHA'] ?? null)
  if (!fecha) throw new Error('Unparseable GASFECHA')

  // 5-tuple natural key (verified 100% unique; 3-tuple had 1,768 duplicates)
  const legacyId = deterministicUuid(
    `gastos:${tipo}|${cuentaPrincipal}|${secuencia}|${fecha}|${comprobante}`,
  )

  return {
    id: randomUUID(),
    tipo,
    tipoCuenta,
    cuentaPrincipal,
    cuentaAuxiliar,
    secuencia,
    comprobante,
    fecha,
    concepto: String(payload['GASCONCEPT'] ?? '').trim() || null,
    importe: parseMonto(payload['GASIMPORTE']),
    iva: payload['GASIVA'] != null ? parseMonto(payload['GASIVA']) : '0.00',
    ingresoBruto: payload['GASINGBRUT'] ? String(payload['GASINGBRUT']).trim() || null : null,
    socioId: null, // NULL in v1 (no source field; N16 backfill future)
    legacyId,
    createdAt: new Date(),
  }
}
