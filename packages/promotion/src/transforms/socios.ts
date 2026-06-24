import { randomUUID } from 'node:crypto'
import type { NewSocio } from '@athlos/db/schema'
import type { TransformHelpers } from '../transform-helpers.ts'

export function transformSocio(
  payload: Record<string, unknown>,
  helpers: TransformHelpers,
): NewSocio {
  const { parseFechaVFP, splitApellidoNombre } = helpers

  const carnet = String(payload.SOCCARNET ?? payload.SOCNUMERO ?? '').trim()
  if (!carnet) throw new Error('Empty SOCCARNET/SOCNUMERO')

  const dni = String(payload.SOCDNI ?? '').trim()
  if (!dni) throw new Error('Empty SOCDNI')

  const fullName = String(payload.SOCAPYNOMB ?? '').trim()
  const { apellido, nombre } = splitApellidoNombre(fullName)

  const fechaAlta = parseFechaVFP(payload.SOCFECALTA ?? payload.SOCFECNACI ?? null)
  if (!fechaAlta) throw new Error('Unparseable SOCFECALTA/SOCFECNACI')

  return {
    id: randomUUID(),
    numeroSocio: carnet,
    nombre,
    apellido,
    dni,
    fechaAlta,
    estado: 'activo',
    categoria: payload.SOCCATEGO ? String(payload.SOCCATEGO).trim() || null : null,
    direccion: payload.SOCDIRECC ? String(payload.SOCDIRECC).trim() || null : null,
    telefono: payload.SOCTELEFO ? String(payload.SOCTELEFO).trim() || null : null,
    email: payload.SOCEMAIL ? String(payload.SOCEMAIL).trim() || null : null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}
