import type { Db } from '@athlos/db'
import { auditEvents, type Socio } from '@athlos/db/schema'
import { BusinessError, ErrorCode } from '@athlos/errors'
import * as repo from './repository.ts'

/**
 * Socios service layer.
 *
 * Orchestrates the repository, translates validation errors into
 * 404s, and writes an audit_event row on every state change. The
 * audit shape is `{ action, entityType, entityId, oldValue, newValue }`
 * — the consumer of audit_events can reconstruct a timeline by
 * filtering on `entity_type='socio'` and ordering by `created_at`.
 *
 * DTOs: the route layer is the boundary for shaping the response.
 * Service functions return the raw `Socio` row; routes map to the
 * public DTO (which currently has the same shape — a single
 * `id`-renamed to a snake-cased payload would land here if/when
 * the public contract changes).
 */

export type SocioEstado = Socio['estado']

export interface ListSociosInput {
  page: number
  limit: number
  filters?: { estado?: SocioEstado; search?: string }
}

export interface CreateSocioInput {
  numeroSocio: string
  nombre: string
  apellido: string
  dni: string
  fechaAlta: string
  estado?: SocioEstado
  categoria?: string | null
  direccion?: string | null
  telefono?: string | null
  email?: string | null
}

export interface UpdateSocioInput {
  nombre?: string
  apellido?: string
  dni?: string
  fechaAlta?: string
  estado?: SocioEstado
  categoria?: string | null
  direccion?: string | null
  telefono?: string | null
  email?: string | null
}

export interface AuditContext {
  operatorId?: string | null
  sourceIp?: string | null
}

/**
 * Page through socios, returning a flat DTO envelope (items + total +
 * page + limit). The route layer turns this into the
 * `{ items, total, page, limit, has_more }` wire shape.
 */
export async function list(
  db: Db,
  input: ListSociosInput,
  _audit?: AuditContext,
): Promise<{
  items: Socio[]
  total: number
  page: number
  limit: number
}> {
  return repo.list(db, {
    page: input.page,
    limit: input.limit,
    ...(input.filters ? { filters: input.filters } : {}),
  })
}

/**
 * Fetch a single socio by id. Throws NOT_FOUND when the row does
 * not exist — the route layer maps to 404 via the global error
 * handler.
 */
export async function getById(db: Db, id: string): Promise<Socio> {
  const row = await repo.findById(db, id)
  if (!row) {
    throw BusinessError(ErrorCode.NOT_FOUND, 'Socio not found')
  }
  return row
}

/**
 * Create a new socio and emit a `SOCIO_CREATED` audit event. The
 * audit row carries the post-insert row in `new_value` so a future
 * report can show "socio #N created with this snapshot".
 */
export async function create(
  db: Db,
  input: CreateSocioInput,
  audit: AuditContext = {},
): Promise<Socio> {
  const row = await repo.insert(db, {
    numeroSocio: input.numeroSocio,
    nombre: input.nombre,
    apellido: input.apellido,
    dni: input.dni,
    fechaAlta: input.fechaAlta,
    estado: input.estado ?? 'activo',
    categoria: input.categoria ?? null,
    direccion: input.direccion ?? null,
    telefono: input.telefono ?? null,
    email: input.email ?? null,
  })
  await emitAudit(db, {
    action: 'SOCIO_CREATED',
    entityId: row.id,
    newValue: row,
    operatorId: audit.operatorId ?? null,
    sourceIp: audit.sourceIp ?? null,
  })
  return row
}

/**
 * Update a socio and emit a `SOCIO_UPDATED` audit event with both
 * `old_value` (the pre-update snapshot) and `new_value`. The
 * repository throws NOT_FOUND when the id is unknown — we let it
 * propagate so the route layer can return 404.
 */
export async function update(
  db: Db,
  id: string,
  patch: UpdateSocioInput,
  audit: AuditContext = {},
): Promise<Socio> {
  const before = await repo.findById(db, id)
  if (!before) {
    throw BusinessError(ErrorCode.NOT_FOUND, 'Socio not found')
  }
  const row = await repo.update(db, id, {
    ...(patch.nombre !== undefined ? { nombre: patch.nombre } : {}),
    ...(patch.apellido !== undefined ? { apellido: patch.apellido } : {}),
    ...(patch.dni !== undefined ? { dni: patch.dni } : {}),
    ...(patch.fechaAlta !== undefined ? { fechaAlta: patch.fechaAlta } : {}),
    ...(patch.estado !== undefined ? { estado: patch.estado } : {}),
    ...(patch.categoria !== undefined ? { categoria: patch.categoria } : {}),
    ...(patch.direccion !== undefined ? { direccion: patch.direccion } : {}),
    ...(patch.telefono !== undefined ? { telefono: patch.telefono } : {}),
    ...(patch.email !== undefined ? { email: patch.email } : {}),
  })
  await emitAudit(db, {
    action: 'SOCIO_UPDATED',
    entityId: row.id,
    oldValue: before,
    newValue: row,
    operatorId: audit.operatorId ?? null,
    sourceIp: audit.sourceIp ?? null,
  })
  return row
}

/**
 * Soft-delete: stamp `deleted_at`, set `estado='baja'`. The row is
 * preserved for the audit trail. Emits `SOCIO_DELETED` with the
 * pre-delete snapshot.
 */
export async function softDelete(db: Db, id: string, audit: AuditContext = {}): Promise<Socio> {
  const before = await repo.findById(db, id)
  if (!before) {
    throw BusinessError(ErrorCode.NOT_FOUND, 'Socio not found')
  }
  const row = await repo.softDelete(db, id)
  await emitAudit(db, {
    action: 'SOCIO_DELETED',
    entityId: row.id,
    oldValue: before,
    newValue: row,
    operatorId: audit.operatorId ?? null,
    sourceIp: audit.sourceIp ?? null,
  })
  return row
}

/**
 * Insert a row into `audit_events`. Best-effort: a write failure
 * here MUST NOT mask the original operation, so we swallow the
 * error and surface a `console.error`. The audit-events table is
 * append-only and a missed row is recoverable from the operator's
 * own session log; the opposite (a 500 on a successful create)
 * would be a worse outcome.
 */
async function emitAudit(
  db: Db,
  row: {
    action: string
    entityId: string
    oldValue?: unknown
    newValue?: unknown
    operatorId: string | null
    sourceIp: string | null
  },
): Promise<void> {
  try {
    await db.insert(auditEvents).values({
      operatorId: row.operatorId,
      action: row.action,
      entityType: 'socio',
      entityId: row.entityId,
      oldValue: (row.oldValue as Record<string, unknown> | null) ?? null,
      newValue: (row.newValue as Record<string, unknown> | null) ?? null,
      sourceIp: row.sourceIp,
      metadata: null,
      idempotencyKey: null,
    })
  } catch (err) {
    console.error('[socios-service] audit_events insert failed', {
      action: row.action,
      entityId: row.entityId,
      err: err instanceof Error ? err.message : String(err),
    })
  }
}
