import { randomUUID } from 'node:crypto'
import type { NewCtacte } from '@athlos/db/schema'
import type { TransformHelpers } from '../transform-helpers.ts'

export function transformCtacte(
  payload: Record<string, unknown>,
  helpers: TransformHelpers,
): NewCtacte {
  const { fkMap, parseFechaVFP, parseMonto, splitDebeHaber, deterministicUuid } = helpers

  const cuenta = String(payload.CCTCUENTA ?? '')
  const socioUuid = fkMap.get(`socio:${cuenta}`)
  if (!socioUuid) throw new Error('no matching socio')

  const tipoRaw = Number(payload.CCTDEBEHAB)
  const tipo: 'DEBITO' | 'CREDITO' = tipoRaw >= 0 ? 'DEBITO' : 'CREDITO'

  const monto = parseMonto(payload.CCTIMPORTE)
  const { debe, haber } = splitDebeHaber(monto, tipo)

  const fecha = parseFechaVFP(payload.CCTFECHA ?? null)
  if (!fecha) throw new Error('Unparseable CCTFECHA')

  // legacy_id is a deterministic UUID from the natural key — enables
  // cross-run idempotency via UNIQUE INDEX on legacy_id.
  // IMPORTANT: Use raw payload value (not parsed fecha) to match migration 0018's
  // SQL: SELECT promotion_deterministic_uuid(payload->>'CCTCUENTA' || '|' || payload->>'CCTFECHA' || ...)
  const legacyId = deterministicUuid(
    [
      cuenta,
      String(payload.CCTFECHA ?? ''),
      payload.CCTNROCOMP ?? '',
      payload.CCTMES ?? '',
      payload.CCTTALONAR ?? '',
    ].join('|'),
  )

  return {
    id: randomUUID(),
    socioId: socioUuid,
    fecha,
    tipo,
    concepto: String(payload.CCTCONCEPT ?? '').trim(),
    debe,
    haber,
    anulado: false,
    cctcuenta: cuenta,
    legacyId,
    createdAt: new Date(),
  }
}
