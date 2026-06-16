import { and, eq, type SQL } from 'drizzle-orm'
import type { Db } from '@athlos/db'
import { disciplinas, ejercicios, inscripciones, socios } from '@athlos/db/schema'
import { BusinessError, ErrorCode } from '@athlos/errors'

/**
 * Padrones repository — read-only view of "who's enrolled in
 * disciplina X for ejercicio Y".
 *
 * The view joins `inscripciones` ↔ `socios` ↔ `disciplinas` (and
 * the matching `ejercicios` row for the metadata). For PR 5 the
 * output is a flat DTO the routes can return directly. The
 * service does no joining — the repository owns the join shape
 * so callers can ask for "list by disciplina + ejercicio" without
 * knowing the FK graph.
 */

export interface ListByDisciplinaInput {
  disciplinaCodigo: string
  ejercicioAnio: number
  page: number
  limit: number
}

export interface PadronRow {
  inscripcionId: string
  socioId: string
  numeroSocio: string
  nombre: string
  apellido: string
  dni: string
  estado: string
  fechaAlta: string
  disciplinaCodigo: string
  disciplinaNombre: string
  ejercicioAnio: number
}

export interface ListByDisciplinaResult {
  items: PadronRow[]
  total: number
  page: number
  limit: number
}

/**
 * Page through the padron for one disciplina + ejercicio. The
 * filters are required (the route layer rejects missing query
 * params with a 400) so the join is unconditional.
 */
export async function listByDisciplina(
  db: Db,
  input: ListByDisciplinaInput,
): Promise<ListByDisciplinaResult> {
  const limit = Math.min(Math.max(input.limit, 1), 200)
  const page = Math.max(input.page, 1)
  const offset = (page - 1) * limit

  // Resolve the disciplina + ejercicio ids by their natural keys.
  // We do this with two cheap lookups before the join; for the
  // padron query this is the right shape (the operator usually
  // passes a codigo + anio, not an uuid).
  const [discRow] = await db
    .select()
    .from(disciplinas)
    .where(eq(disciplinas.codigo, input.disciplinaCodigo))
    .limit(1)
  if (!discRow) {
    throw BusinessError(
      ErrorCode.NOT_FOUND,
      `Disciplina with codigo "${input.disciplinaCodigo}" not found`,
    )
  }
  const [ejerRow] = await db
    .select()
    .from(ejercicios)
    .where(eq(ejercicios.anio, input.ejercicioAnio))
    .limit(1)
  if (!ejerRow) {
    throw BusinessError(
      ErrorCode.NOT_FOUND,
      `Ejercicio with anio "${input.ejercicioAnio}" not found`,
    )
  }

  const conds: Array<SQL | undefined> = [
    eq(inscripciones.disciplinaId, discRow.id),
    eq(inscripciones.ejercicioId, ejerRow.id),
  ]
  const where = and(...conds.filter((c): c is SQL => c !== undefined))

  const rows = await db
    .select()
    .from(inscripciones)
    .innerJoin(socios, eq(socios.id, inscripciones.socioId))
    .where(where)
    .limit(limit)
    .offset(offset)

  const totalRows = await db.select().from(inscripciones).where(where).limit(10_000)
  const total = totalRows.length

  const items: PadronRow[] = rows.map((row) => {
    const ins = row['inscripciones']
    const soc = row['socios']
    return {
      inscripcionId: ins.id,
      socioId: soc.id,
      numeroSocio: soc.numeroSocio,
      nombre: soc.nombre,
      apellido: soc.apellido,
      dni: soc.dni,
      estado: ins.estado,
      fechaAlta: ins.fechaAlta,
      disciplinaCodigo: discRow.codigo,
      disciplinaNombre: discRow.nombre,
      ejercicioAnio: ejerRow.anio,
    }
  })

  return { items, total, page, limit }
}
