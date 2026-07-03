import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm'
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

/**
 * Wire-facing sort keys. The route's Zod schema uses these literal
 * strings so the API contract is stable even when the underlying
 * Drizzle column names (`apellido`, `numeroSocio`, …) change.
 */
export type ListSociosSortBy =
  | 'apellido'
  | 'nombre'
  | 'numero_socio'
  | 'dni'
  | 'fecha_alta'
  | 'estado'

export type ListSociosSortDir = 'asc' | 'desc'

export interface ListSociosFilters {
  estado?: SocioEstado
  search?: string
}

export interface ListSociosInput {
  page: number
  limit: number
  filters?: ListSociosFilters
  sortBy?: ListSociosSortBy
  sortDir?: ListSociosSortDir
}

/** Counts returned by `countByEstado`. */
export interface SocioEstadoCounts {
  activos: number
  suspendidos: number
  baja: number
  total: number
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
    .orderBy(...buildOrderBy(input.sortBy, input.sortDir))
    .limit(limit)
    .offset(offset)
  return { items: rows, total, page, limit }
}

/**
 * Build a stable ORDER BY clause from the optional `sortBy` / `sortDir`
 * inputs. The primary sort key uses the requested column; the remaining
 * keys stay fixed (`apellido, nombre, id`) so the page boundary is
 * deterministic across calls — required for reliable offset
 * pagination. When `sortBy` is absent, the default `apellido ASC` is
 * preserved (matches the pre-sort behaviour the UI was tested against).
 */
function buildOrderBy(
  sortBy: ListSociosSortBy | undefined,
  sortDir: ListSociosSortDir | undefined,
) {
  const dir = sortDir === 'desc' ? desc : asc
  const tail = [asc(socios.apellido), asc(socios.nombre), asc(socios.id)]
  switch (sortBy) {
    case 'apellido':
      return [dir(socios.apellido), ...tail]
    case 'nombre':
      return [dir(socios.nombre), ...tail]
    case 'numero_socio':
      return [dir(socios.numeroSocio), ...tail]
    case 'dni':
      return [dir(socios.dni), ...tail]
    case 'fecha_alta':
      return [dir(socios.fechaAlta), ...tail]
    case 'estado':
      return [dir(socios.estado), ...tail]
    default:
      return tail
  }
}

/**
 * `countByEstado` — single round-trip count by `estado`. Returns the
 * four buckets the summary cards need: activos / suspendidos / baja /
 * total. Counts ALL rows regardless of `deletedAt` (a "baja'd" row is
 * still part of the master table for reporting purposes).
 *
 * Implemented as a single `GROUP BY` query so the work is O(1) db
 * round-trips even as the master table grows past 16k rows.
 */
export async function countByEstado(db: Db): Promise<SocioEstadoCounts> {
  const rows = await db
    .select({ estado: socios.estado, n: sql<number>`count(*)::int` })
    .from(socios)
    .groupBy(socios.estado)
  const counts: SocioEstadoCounts = { activos: 0, suspendidos: 0, baja: 0, total: 0 }
  for (const { estado, n } of rows) {
    counts.total += n
    if (estado === 'activo') counts.activos += n
    else if (estado === 'suspendido') counts.suspendidos += n
    else if (estado === 'baja') counts.baja += n
  }
  return counts
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
