import { randomUUID } from 'node:crypto'
import type { NewCtacte1 } from '@athlos/db/schema'
import type { TransformHelpers } from '../transform-helpers.ts'

export function transformCtacte1(
  payload: Record<string, unknown>,
  helpers: TransformHelpers,
): NewCtacte1 {
  const { fkMap, parseFechaVFP, parseMonto } = helpers

  const cct1Numero = String(payload.CCT1NUMERO ?? '')
  const ctacteUuid = fkMap.get(`ctacte:${cct1Numero}`)
  if (!ctacteUuid) throw new Error('no matching ctacte')

  const fecha = parseFechaVFP(payload.CCT1FECHA ?? null)
  if (!fecha) throw new Error('Unparseable CCT1FECHA')

  return {
    id: randomUUID(),
    ctacteId: ctacteUuid,
    fecha,
    concepto: String(payload.CCT1CONCEPT ?? '').trim(),
    monto: parseMonto(payload.CCT1IMPORTE),
    createdAt: new Date(),
  }
}
