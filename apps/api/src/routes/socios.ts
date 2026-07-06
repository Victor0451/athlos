import type { FastifyPluginCallback } from 'fastify'
import { z } from 'zod'
import { idSchema, socioEstadoSchema } from '@athlos/validation'
import { throwIfInvalid } from '@athlos/errors'
import { requireAuth, requireRole } from '@athlos/auth'
import { queryAudit } from '@athlos/audit'
import { aggregate, create, getById, list, softDelete, update } from '../modules/socios/service.ts'
import { createNote, deleteNote, listForSocio, updateNote } from '../modules/socios/notes.ts'
import type { AppContainer } from '../container.ts'

/**
 * Socios routes — `/api/v1/socios`.
 *
 * Five endpoints (all under /api/v1, all returning JSON):
 *
 *   GET    /api/v1/socios                     list (page+limit, search, estado); role: any
 *   GET    /api/v1/socios/:id                 detail; role: any
 *   POST   /api/v1/socios                     create; role: ADMIN
 *   PATCH  /api/v1/socios/:id                 update; role: ADMIN
 *   DELETE /api/v1/socios/:id                 soft-delete; role: ADMIN
 *
 * The route layer is the boundary: it parses / validates the input
 * (Zod), pulls the DI container off the request, calls the service,
 * and shapes the response. Every error path goes through
 * @athlos/errors so the global handler emits the right status code.
 */

// `id` is parsed by Zod as a UUID. The standard `idSchema` does the
// same job — we re-import it for symmetry with the other routes.
const idParamSchema = z.object({ id: idSchema })

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  estado: socioEstadoSchema.optional(),
  search: z.string().min(1).max(80).optional(),
  sortBy: z.enum(['apellido', 'nombre', 'numero_socio', 'dni', 'fecha_alta', 'estado']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  /**
   * `aggregate=1` short-circuits the list query and returns just the
   * count-by-estado summary (`{ activos, suspendidos, baja, total }`).
   * Lets the Socios page populate its summary cards in one round-trip
   * without paying for the full pagination shape.
   */
  aggregate: z.union([z.literal('1'), z.literal('0')]).optional(),
  /** Exact-match filter on `categoria` (free-form, max 40 chars). */
  categoria: z.string().min(1).max(40).optional(),
  /**
   * `fecha_alta` range. Inclusive lower / exclusive upper — matches
   * the convention used elsewhere for date-window queries. YYYY-MM-DD.
   */
  fechaDesde: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'fechaDesde must be YYYY-MM-DD')
    .optional(),
  fechaHasta: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'fechaHasta must be YYYY-MM-DD')
    .optional(),
  /**
   * Boolean filter on the `email` column: `'true'` keeps only
   * rows with a non-null email; `'false'` keeps only null-email rows.
   * Implemented as `'true'`/`'false'` literals (not a plain bool) for
   * parity with the existing `incluir_anuladas` literal in the
   * Ctacte module — the API contract stays literal-string-typed.
   */
  hasEmail: z.union([z.literal('true'), z.literal('false')]).optional(),
})

const createBodySchema = z.object({
  numero_socio: z.union([z.string().min(1).max(20), z.number().int().positive()]),
  nombre: z.string().min(1).max(80),
  apellido: z.string().min(1).max(80),
  dni: z.string().regex(/^\d{7,8}$/, 'DNI must be 7 or 8 digits'),
  fecha_alta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha_alta must be YYYY-MM-DD'),
  estado: socioEstadoSchema.optional(),
  categoria: z.string().max(40).optional(),
  direccion: z.string().max(200).optional(),
  telefono: z.string().max(40).optional(),
  email: z.string().email().max(120).optional(),
})

const updateBodySchema = z
  .object({
    nombre: z.string().min(1).max(80).optional(),
    apellido: z.string().min(1).max(80).optional(),
    dni: z
      .string()
      .regex(/^\d{7,8}$/, 'DNI must be 7 or 8 digits')
      .optional(),
    fecha_alta: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha_alta must be YYYY-MM-DD')
      .optional(),
    estado: socioEstadoSchema.optional(),
    categoria: z.string().max(40).optional(),
    direccion: z.string().max(200).optional(),
    telefono: z.string().max(40).optional(),
    email: z.string().email().max(120).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field must be provided' })

/** Map the DB `Socio` row to a snake-cased wire DTO. */
function toSocioDTO(row: {
  id: string
  numeroSocio: string
  nombre: string
  apellido: string
  dni: string
  fechaAlta: string
  estado: 'activo' | 'baja' | 'suspendido'
  categoria: string | null
  direccion: string | null
  telefono: string | null
  email: string | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}): Record<string, unknown> {
  return {
    id: row.id,
    numero_socio: row.numeroSocio,
    nombre: row.nombre,
    apellido: row.apellido,
    dni: row.dni,
    fecha_alta: row.fechaAlta,
    estado: row.estado,
    categoria: row.categoria,
    direccion: row.direccion,
    telefono: row.telefono,
    email: row.email,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    deleted_at: row.deletedAt ? row.deletedAt.toISOString() : null,
  }
}

const AUTH = { preHandler: requireAuth() }
const ADMIN_GATE = { preHandler: requireRole('ADMIN') }

export const sociosRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const container: AppContainer = fastify.container

  // GET /api/v1/socios
  fastify.get('/api/v1/socios', AUTH, async (request, reply) => {
    const q = throwIfInvalid(listQuerySchema, request.query, 'query')
    if (q.aggregate === '1') {
      const counts = await aggregate(container.db)
      return reply.code(200).send(counts)
    }
    const result = await list(container.db, {
      page: q.page ?? 1,
      limit: q.limit ?? 20,
      ...(q.estado || q.search || q.categoria || q.fechaDesde || q.fechaHasta || q.hasEmail
        ? {
            filters: {
              ...(q.estado ? { estado: q.estado } : {}),
              ...(q.search ? { search: q.search } : {}),
              ...(q.categoria ? { categoria: q.categoria } : {}),
              ...(q.fechaDesde ? { fechaDesde: q.fechaDesde } : {}),
              ...(q.fechaHasta ? { fechaHasta: q.fechaHasta } : {}),
              ...(q.hasEmail ? { hasEmail: q.hasEmail } : {}),
            },
          }
        : {}),
    })
    return reply.code(200).send({
      items: result.items.map(toSocioDTO),
      page: result.page,
      limit: result.limit,
      total: result.total,
      has_more: result.page * result.limit < result.total,
    })
  })

  // GET /api/v1/socios/:id
  fastify.get<{ Params: { id: string } }>('/api/v1/socios/:id', AUTH, async (request, reply) => {
    const params = throwIfInvalid(idParamSchema, request.params, 'params')
    const row = await getById(container.db, params.id)
    return reply.code(200).send(toSocioDTO(row))
  })

  // POST /api/v1/socios
  fastify.post('/api/v1/socios', ADMIN_GATE, async (request, reply) => {
    const body = throwIfInvalid(createBodySchema, request.body, 'body')
    const row = await create(
      container.db,
      {
        numeroSocio: String(body.numero_socio),
        nombre: body.nombre,
        apellido: body.apellido,
        dni: body.dni,
        fechaAlta: body.fecha_alta,
        ...(body.estado ? { estado: body.estado } : {}),
        ...(body.categoria !== undefined ? { categoria: body.categoria } : {}),
        ...(body.direccion !== undefined ? { direccion: body.direccion } : {}),
        ...(body.telefono !== undefined ? { telefono: body.telefono } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
      },
      {
        operatorId: request.operator?.sub ?? null,
        sourceIp: request.ip ?? null,
      },
    )
    return reply.code(201).send(toSocioDTO(row))
  })

  // PATCH /api/v1/socios/:id
  fastify.patch<{ Params: { id: string } }>(
    '/api/v1/socios/:id',
    ADMIN_GATE,
    async (request, reply) => {
      const params = throwIfInvalid(idParamSchema, request.params, 'params')
      const body = throwIfInvalid(updateBodySchema, request.body, 'body')
      const row = await update(
        container.db,
        params.id,
        {
          ...(body.nombre !== undefined ? { nombre: body.nombre } : {}),
          ...(body.apellido !== undefined ? { apellido: body.apellido } : {}),
          ...(body.dni !== undefined ? { dni: body.dni } : {}),
          ...(body.fecha_alta !== undefined ? { fechaAlta: body.fecha_alta } : {}),
          ...(body.estado !== undefined ? { estado: body.estado } : {}),
          ...(body.categoria !== undefined ? { categoria: body.categoria } : {}),
          ...(body.direccion !== undefined ? { direccion: body.direccion } : {}),
          ...(body.telefono !== undefined ? { telefono: body.telefono } : {}),
          ...(body.email !== undefined ? { email: body.email } : {}),
        },
        {
          operatorId: request.operator?.sub ?? null,
          sourceIp: request.ip ?? null,
        },
      )
      return reply.code(200).send(toSocioDTO(row))
    },
  )

  // DELETE /api/v1/socios/:id  (soft delete)
  fastify.delete<{ Params: { id: string } }>(
    '/api/v1/socios/:id',
    ADMIN_GATE,
    async (request, reply) => {
      const params = throwIfInvalid(idParamSchema, request.params, 'params')
      const row = await softDelete(container.db, params.id, {
        operatorId: request.operator?.sub ?? null,
        sourceIp: request.ip ?? null,
      })
      return reply.code(200).send(toSocioDTO(row))
    },
  )

  /* ── Notes (PR 8b.4) ──────────────────────────────────────────── */

  const noteParamSchema = z.object({ id: idSchema, noteId: idSchema })
  const noteBodySchema = z.object({
    body: z.string().min(1, 'Body requerido').max(4000, 'Máx. 4000 caracteres'),
  })

  // GET /api/v1/socios/:id/notes
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/socios/:id/notes',
    AUTH,
    async (request, reply) => {
      const params = throwIfInvalid(idParamSchema, request.params, 'params')
      const items = await listForSocio(container.db, params.id)
      return reply.code(200).send({
        items: items.map(toSocioNoteDTO),
      })
    },
  )

  // POST /api/v1/socios/:id/notes
  fastify.post<{ Params: { id: string } }>(
    '/api/v1/socios/:id/notes',
    AUTH,
    async (request, reply) => {
      const params = throwIfInvalid(idParamSchema, request.params, 'params')
      const body = throwIfInvalid(noteBodySchema, request.body, 'body')
      const operatorId = request.operator?.sub
      if (!operatorId) {
        return reply.code(401).send({ error: 'unauthenticated' })
      }
      const row = await createNote(
        container.db,
        params.id,
        { body: body.body, operatorId },
        {
          operatorId,
          sourceIp: request.ip ?? null,
        },
      )
      return reply.code(201).send(toSocioNoteDTO(row))
    },
  )

  // PATCH /api/v1/socios/:id/notes/:noteId — author OR ADMIN only (enforced in service).
  fastify.patch<{ Params: { id: string; noteId: string } }>(
    '/api/v1/socios/:id/notes/:noteId',
    AUTH,
    async (request, reply) => {
      const params = throwIfInvalid(noteParamSchema, request.params, 'params')
      const body = throwIfInvalid(noteBodySchema, request.body, 'body')
      const callerOperatorId = request.operator?.sub
      const callerRole = request.operator?.role
      if (!callerOperatorId || !callerRole) {
        return reply.code(401).send({ error: 'unauthenticated' })
      }
      const row = await updateNote(
        container.db,
        params.noteId,
        { body: body.body },
        { callerOperatorId, callerRole },
        {
          operatorId: callerOperatorId,
          sourceIp: request.ip ?? null,
        },
      )
      return reply.code(200).send(toSocioNoteDTO(row))
    },
  )

  // DELETE /api/v1/socios/:id/notes/:noteId — author OR ADMIN only.
  fastify.delete<{ Params: { id: string; noteId: string } }>(
    '/api/v1/socios/:id/notes/:noteId',
    AUTH,
    async (request, reply) => {
      const params = throwIfInvalid(noteParamSchema, request.params, 'params')
      const callerOperatorId = request.operator?.sub
      const callerRole = request.operator?.role
      if (!callerOperatorId || !callerRole) {
        return reply.code(401).send({ error: 'unauthenticated' })
      }
      await deleteNote(
        container.db,
        params.noteId,
        { callerOperatorId, callerRole },
        {
          operatorId: callerOperatorId,
          sourceIp: request.ip ?? null,
        },
      )
      return reply.code(204).send()
    },
  )

  /* ── Audit wrapper (PR 8b.4) ────────────────────────────────────── *
   * Returns audit_events rows for THIS socio. The underlying
   * queryAudit() is admin/steward-gated at /api/v1/audit; the
   * wrapper exposes a per-socio view that's accessible to any
   * authenticated operator (they need to see the timeline inside
   * the detail page). */

  // GET /api/v1/socios/:id/audit?page=&limit=
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/socios/:id/audit',
    AUTH,
    async (request, reply) => {
      const params = throwIfInvalid(idParamSchema, request.params, 'params')
      const q = request.query as { page?: string; limit?: string }
      const page = q.page ? Math.max(1, Number(q.page)) : 1
      const limit = q.limit ? Math.min(200, Math.max(1, Number(q.limit))) : 100
      const result = await queryAudit(container.db, {
        entityType: 'socio',
        entityId: params.id,
        page,
        limit,
      })
      return reply.code(200).send({
        items: result.items.map(toAuditEventDTO),
        total: result.total,
        page: result.page,
        limit: result.limit,
      })
    },
  )

  done()
}

/* ── DTOs (snake_case to match the wire contract) ──────────────── */

/** Map a `SocioNote` row to the wire DTO. */
function toSocioNoteDTO(row: {
  id: string
  socioId: string
  operatorId: string
  body: string
  createdAt: Date
  updatedAt: Date
}): Record<string, unknown> {
  return {
    id: row.id,
    socio_id: row.socioId,
    operator_id: row.operatorId,
    body: row.body,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  }
}

/** Map an audit_events row to the wire DTO the timeline UI consumes.
 *  `old_value` / `new_value` are passed through as-is — the UI
 *  renders them as a JSON diff when the action is `SOCIO_UPDATED`. */
function toAuditEventDTO(row: {
  id: string
  operatorId: string | null
  action: string
  entityType: string
  entityId: string
  oldValue: unknown
  newValue: unknown
  sourceIp: string | null
  createdAt: Date
}): Record<string, unknown> {
  return {
    id: row.id,
    operator_id: row.operatorId,
    action: row.action,
    entity_type: row.entityType,
    entity_id: row.entityId,
    old_value: row.oldValue ?? null,
    new_value: row.newValue ?? null,
    source_ip: row.sourceIp,
    created_at: row.createdAt.toISOString(),
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    container: AppContainer
  }
}
