/**
 * Map VFP/projection payload → Drizzle `socios.escuela` insert.
 *
 * Per-school master table (NO socio_id FK per scope correction #C1).
 * Source: `public."socios.escuela_projection"` (66 rows, 14 fields).
 *
 * Field names verified against live DB sample (2026-06-25).
 */
import { randomUUID } from 'node:crypto'
import type { NewEscuela } from '@athlos/db/schema'
import type { TransformHelpers } from '../transform-helpers.ts'

export function transformEscuela(
  payload: Record<string, unknown>,
  helpers: TransformHelpers,
): NewEscuela {
  const { parseFechaVFP, parseMonto, deterministicUuid } = helpers

  const codigo = Number(payload['ESCCODIGO'] ?? 0)
  if (!codigo) throw new Error('Empty ESCCODIGO')

  const nombre = String(payload['ESCNOMBRE'] ?? '').trim()
  if (!nombre) throw new Error('Empty ESCNOMBRE')

  const estadoRaw = String(payload['ESCESTADO'] ?? '').trim()
  if (estadoRaw !== 'S' && estadoRaw !== 'N') throw new Error(`Invalid ESCESTADO: ${estadoRaw}`)

  return {
    id: randomUUID(),
    codigo,
    nombre,
    deporteCodigo: payload['ESCDEPORTE'] ? Number(payload['ESCDEPORTE']) : null,
    estado: estadoRaw,
    cuotaSocial: payload['ESCCUOSOC'] ? parseMonto(payload['ESCCUOSOC']) : null,
    cobertura: payload['ESCCOBERTU'] ? parseMonto(payload['ESCCOBERTU']) : null,
    contribucion: payload['ESCCONTRIB'] ? parseMonto(payload['ESCCONTRIB']) : null,
    importeEscolar: payload['ESCIMPESC'] ? parseMonto(payload['ESCIMPESC']) : null,
    otroContrib: payload['ESCOTRCONT'] ? parseMonto(payload['ESCOTRCONT']) : null,
    claveInscripcion: payload['ESCCLAVINS'] ? parseMonto(payload['ESCCLAVINS']) : null,
    fechaEscolar: payload['ESCFESCAG'] ? parseFechaVFP(payload['ESCFESCAG']) : null,
    entrenadorCodigo: payload['ESCENTRENA'] ? Number(payload['ESCENTRENA']) : null,
    escuelaNumero: payload['ESCESCUELA'] ? Number(payload['ESCESCUELA']) : null,
    instructor: payload['ESCINSTRUC'] ? String(payload['ESCINSTRUC']).trim() || null : null,
    legacyId: deterministicUuid(`escuela:${codigo}`),
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}
