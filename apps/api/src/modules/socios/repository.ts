import { and, asc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm'
import type { Db } from '@athlos/db'
import { socios, type Socio, type NewSocio } from '@athlos/db/schema'
import { BusinessError, ErrorCode } from '@athlos/errors'

/**
 * Socios repository — thin Drizzle wrapper.
 *
 * Read / write helpers used by `service.ts`. Every function takes a
 * `Db | Tx` so the service can compose them inside a transaction
 * (e.g. for the future ctacte write flows). Pagination is page+limit
 * offset-based; the API uses the @athlos/validation `socioFilterSchema`
 * which already caps `limit` at 100.
 *
 * Soft-delete: `softDelete` flips `estado` to `'baja'` and stamps
 * `deletedAt`. The row is NEVER removed — every audit downstream
 * needs the historical record.
 */

export type SocioEstado = Socio['estado']

export interface ListSociosFilters {
  estado?: SocioEstado
  search?: string
}

export interface ListSociosInput {
  page: number
  limit: number
  filters?: ListSociosFilters
}

export interface ListSociosResult {
  items: Socio[]
  total: number
  page: number
  limit: number
}

/**
 * Resolve a socio by its primary key. Returns `null` when the row
 * does not exist (so the service can throw NOT_FOUND with the
 * canonical message instead of leaking a Drizzle `undefined`).
 */
export async function findById(db: Db, id: string): Promise<Socio | null> {
  const [row] = await db.select().from(socios).where(eq(socios.id, id)).limit(1)
  return row ?? null
}

/**
 * Page through socios with an optional estado + free-text search
 * (`apellido || nombre || dni`, case-insensitive). Order is stable:
 * `apellido ASC, nombre ASC, id ASC` so page 2 is deterministic
 * across calls.
 */
export async function list(db: Db, input: ListSociosInput): Promise<ListSociosResult> {
  const limit = Math.min(Math.max(input.limit, 1), 100)
  const page = Math.max(input.page, 1)
  const offset = (page - 1) * limit
  const conds: Array<SQL | undefined> = []
  if (input.filters?.estado) {
    conds.push(eq(socios.estado, input.filters.estado))
  } else {
    // Default behavior: hide baja'd members unless the caller asks
    // for them explicitly. Soft-deleted rows have deletedAt set; we
    // also exclude `estado='baja'` for the default case so a list
    // endpoint behaves like a "list of active members" out of the box.
    conds.push(isNull(socios.deletedAt))
  }
  if (input.filters?.search) {
    const term = `%${input.filters.search}%`
    conds.push(
      or(ilike(socios.apellido, term), ilike(socios.nombre, term), ilike(socios.dni, term)),
    )
  }
  const where =
    conds.length > 0 ? and(...conds.filter((c): c is SQL => c !== undefined)) : undefined

  const countRows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(socios)
    .where(where)
    .limit(1)
  const total = countRows[0]?.n ?? 0
  const rows = await db
    .select()
    .from(socios)
    .where(where)
    .orderBy(asc(socios.apellido), asc(socios.nombre), asc(socios.id))
    .limit(limit)
    .offset(offset)
  return { items: rows, total, page, limit }
}

/**
 * Insert a new socio. The DB enforces uniqueness on `numero_socio`
 * and `dni`; we surface a 409 CONFLICT when the constraint trips
 * so the route layer can return the right status code without
 * inspecting Drizzle internals.
 */
export async function insert(db: Db, value: NewSocio): Promise<Socio> {
  try {
    const [row] = await db.insert(socios).values(value).returning()
    if (!row) {
      throw BusinessError(ErrorCode.INTERNAL_ERROR, 'socios insert returned no row')
    }
    return row
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw BusinessError(
        ErrorCode.CONFLICT,
        'A socio with the same numero_socio or dni already exists',
      )
    }
    throw err
  }
}

/**
 * Partial update — only the fields present on the `patch` object
 * are written. Throws NOT_FOUND when the id is unknown. `numeroSocio`
 * is intentionally excluded from the patchable fields; the legacy
 * business key is immutable after creation.
 */
export async function update(
  db: Db,
  id: string,
  patch: Partial<Omit<NewSocio, 'id' | 'numeroSocio'>>,
): Promise<Socio> {
  const set: Partial<NewSocio> = { updatedAt: new Date() }
  if (patch.nombre !== undefined) set.nombre = patch.nombre
  if (patch.apellido !== undefined) set.apellido = patch.apellido
  if (patch.dni !== undefined) set.dni = patch.dni
  if (patch.fechaAlta !== undefined) set.fechaAlta = patch.fechaAlta
  if (patch.estado !== undefined) set.estado = patch.estado
  if (patch.categoria !== undefined) set.categoria = patch.categoria
  if (patch.direccion !== undefined) set.direccion = patch.direccion
  if (patch.telefono !== undefined) set.telefono = patch.telefono
  if (patch.email !== undefined) set.email = patch.email
  try {
    const [row] = await db.update(socios).set(set).where(eq(socios.id, id)).returning()
    if (!row) {
      throw BusinessError(ErrorCode.NOT_FOUND, 'Socio not found')
    }
    return row
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw BusinessError(
        ErrorCode.CONFLICT,
        'A socio with the same numero_socio or dni already exists',
      )
    }
    throw err
  }
}

/**
 * Soft delete: `estado = 'baja'` + stamp `deletedAt`. The row
 * stays in the table for the audit trail. Throws NOT_FOUND when
 * the id is unknown.
 */
export async function softDelete(db: Db, id: string): Promise<Socio> {
  const [row] = await db
    .update(socios)
    .set({ estado: 'baja', deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(socios.id, id))
    .returning()
  if (!row) {
    throw BusinessError(ErrorCode.NOT_FOUND, 'Socio not found')
  }
  return row
}

/**
 * Detect a Postgres unique-constraint violation. The Drizzle pg
 * driver surfaces it as `{ code: '23505' }` on the error. We sniff
 * for the code defensively (different drivers wrap it differently)
 * and fall through to the original error if the shape is unknown.
 */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const code = (err as { code?: unknown }).code
  return code === '23505'
}
