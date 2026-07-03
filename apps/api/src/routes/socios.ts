import type { FastifyPluginCallback } from 'fastify'
import { z } from 'zod'
import { idSchema, socioEstadoSchema } from '@athlos/validation'
import { throwIfInvalid } from '@athlos/errors'
import { requireAuth, requireRole } from '@athlos/auth'
import { aggregate, create, getById, list, softDelete, update } from '../modules/socios/service.ts'
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
      ...(q.estado || q.search
        ? {
            filters: {
              ...(q.estado ? { estado: q.estado } : {}),
              ...(q.search ? { search: q.search } : {}),
            },
          }
        : {}),
      ...(q.sortBy ? { sortBy: q.sortBy } : {}),
      ...(q.sortDir ? { sortDir: q.sortDir } : {}),
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

  done()
}

declare module 'fastify' {
  interface FastifyInstance {
    container: AppContainer
  }
}
