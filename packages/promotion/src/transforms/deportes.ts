/**
 * Map VFP/projection payload → Drizzle `deportes.disciplinas` insert.
 *
 * Table EXISTS in schema (deportes.ts:28-39). Promotion populates the empty table.
 * codigo is TEXT (NOT integer) per schema definition — VFP DEPCODIGO is numeric.
 *
 * Source: `public."deportes.deportes_projection"` (32 rows, 8 fields).
 * Field names verified against live DB sample (2026-06-25).
 */
import { randomUUID } from 'node:crypto'
import type { NewDisciplina } from '@athlos/db/schema'
import type { TransformHelpers } from '../transform-helpers.ts'

export function transformDeportes(
  payload: Record<string, unknown>,
  helpers: TransformHelpers,
): NewDisciplina {
  const { deterministicUuid } = helpers

  // VFP DEPCODIGO is numeric; schema disciplinas.codigo is text. Coerce.
  const codigo = String(payload['DEPCODIGO'] ?? '').trim()
  if (!codigo) throw new Error('Empty DEPCODIGO')

  const nombre = String(payload['DEPNOMBRE'] ?? '').trim()
  if (!nombre) throw new Error('Empty DEPNOMBRE')

  return {
    id: randomUUID(),
    codigo,
    nombre,
    legacyId: deterministicUuid(`deporte:${codigo}`),
    createdAt: new Date(),
  }
}
