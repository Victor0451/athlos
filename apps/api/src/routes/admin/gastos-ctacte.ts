import type { FastifyPluginCallback } from 'fastify'
import { z } from 'zod'
import { idSchema } from '@athlos/validation'
import { throwIfInvalid } from '@athlos/errors'
import { requireRole } from '@athlos/auth'
import { emitAudit } from '@athlos/audit'
import type { AppContainer } from '../../container.ts'
import {
  anularLink,
  createLink,
  deleteLink,
  findCandidates,
  findCtacteById,
  findGastoById,
  findLinkById,
  findLinksByCtacteCuenta,
  findLinksForGasto,
  type GastosCtacteLink,
} from '../../modules/gastos/repository.ts'

/**
 * Admin gastos ↔ ctacte mapping routes — `/api/v1/gastos-ctacte*` (N16).
 *
 * Six endpoints, all gated by `requireRole('ADMIN')`:
 *
 *   GET    /api/v1/gastos/:id/ctacte-links          — list links for a gasto
 *   POST   /api/v1/gastos/:id/ctacte-links          — create link (validates monto + 409 on duplicate)
 *   DELETE /api/v1/gastos-ctacte-links/:linkId      — hard delete
 *   PATCH  /api/v1/gastos-ctacte-links/:linkId/anular — soft delete (re-link allowed)
 *   GET    /api/v1/ctacte/:cuenta/gastos-links      — joined: ctacte cuenta → gastos
 *   GET    /api/v1/admin/gastos-ctacte-candidates   — heuristic discovery (never persists)
 *
 * The partial UNIQUE INDEX `(gasto_id, ctacte_id) WHERE anulado = false`
 * allows re-linking after annulment (spec §Re-link scenario).
 *
 * Every mutation emits an `audit_events` row via `emitAudit`. The 409
 * conflict maps to LINK_ALREADY_EXISTS; 400 on `monto_cubierto` >
 * `gasto.importe` maps to MONTO_EXCEEDS_GASTO.
 */

const ADMIN_GATE = { preHandler: requireRole('ADMIN') }

const idParamSchema = z.object({ id: idSchema })
const linkIdParamSchema = z.object({ linkId: idSchema })
const cuentaParamSchema = z.object({ cuenta: z.string().min(1).max(20) })

const createLinkBodySchema = z.object({
  ctacte_id: idSchema,
  monto_cubierto: z.string().regex(/^\d+(\.\d{1,2})?$/),
  motivo: z.enum(['manual', 'heuristic-pending', 'auto']),
})

const anularBodySchema = z.object({
  motivo: z.string().min(1).max(500),
})

const candidatesQuerySchema = z.object({
  gasto_id: idSchema,
  limit: z.coerce.number().int().min(1).max(50).default(50),
})

interface LinkDTO {
  id: string
  gastoId: string
  ctacteId: string
  montoCubierto: string
  motivo: 'manual' | 'heuristic-pending' | 'auto'
  anulado: boolean
  anuladoAt: string | null
  anuladoMotivo: string | null
  createdBy: string | null
  createdAt: string
}

function toLinkDTO(row: GastosCtacteLink): LinkDTO {
  return {
    id: row.id,
    gastoId: row.gastoId,
    ctacteId: row.ctacteId,
    montoCubierto: String(row.montoCubierto),
    motivo: row.motivo,
    anulado: row.anulado,
    anuladoAt: row.anuladoAt ? row.anuladoAt.toISOString() : null,
    anuladoMotivo: row.anuladoMotivo,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  }
}

function operatorId(req: { operator?: { sub: string } | null }): string {
  return req.operator?.sub ?? 'unknown'
}

export const gastosCtacteAdminRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const container: AppContainer = fastify.container

  // GET /api/v1/gastos/:id/ctacte-links
  fastify.get<{ Params: { id: string }; Querystring: { active?: string } }>(
    '/api/v1/gastos/:id/ctacte-links',
    ADMIN_GATE,
    async (request, reply) => {
      const { id } = throwIfInvalid(idParamSchema, request.params, 'params')
      const gasto = await findGastoById(container.db, id)
      if (!gasto) return reply.code(404).send({ error: 'GASTO_NOT_FOUND' })
      const all = await findLinksForGasto(container.db, id)
      const onlyActive = request.query.active === 'true'
      const filtered = onlyActive ? all.filter((l) => !l.anulado) : all
      return reply.code(200).send({ items: filtered.map(toLinkDTO) })
    },
  )

  // POST /api/v1/gastos/:id/ctacte-links
  fastify.post<{ Params: { id: string } }>(
    '/api/v1/gastos/:id/ctacte-links',
    ADMIN_GATE,
    async (request, reply) => {
      const { id } = throwIfInvalid(idParamSchema, request.params, 'params')
      const body = throwIfInvalid(createLinkBodySchema, request.body ?? {}, 'body')
      const opId = operatorId(request)

      const gasto = await findGastoById(container.db, id)
      if (!gasto) return reply.code(404).send({ error: 'GASTO_NOT_FOUND' })
      const ctacteRow = await findCtacteById(container.db, body.ctacte_id)
      if (!ctacteRow) return reply.code(404).send({ error: 'CTACTE_NOT_FOUND' })

      // Validate monto_cubierto <= gasto.importe (strict less-or-equal
      // because NUMERIC(14,2) allows exact equality; partial payments
      // < importe are fine).
      const gastoImporte = Number(gasto.importe)
      const montoCubierto = Number(body.monto_cubierto)
      if (montoCubierto > gastoImporte) {
        return reply.code(400).send({ error: 'MONTO_EXCEEDS_GASTO' })
      }

      try {
        const link = await createLink(container.db, {
          gastoId: id,
          ctacteId: body.ctacte_id,
          montoCubierto: body.monto_cubierto,
          motivo: body.motivo,
          createdBy: opId,
        })
        await emitAudit(container.db, {
          operatorId: opId,
          action: 'GASTOS_CTACTE_LINK_CREATE',
          entityType: 'gastos_ctacte_link',
          entityId: link.id,
          oldValue: null,
          newValue: {
            gastoId: id,
            ctacteId: body.ctacte_id,
            montoCubierto: body.monto_cubierto,
            motivo: body.motivo,
          },
          sourceIp: request.ip ?? null,
          payload: undefined,
        })
        return reply.code(201).send(toLinkDTO(link))
      } catch (e: unknown) {
        if ((e as { code?: string })?.code === '23505') {
          return reply.code(409).send({ error: 'LINK_ALREADY_EXISTS' })
        }
        throw e
      }
    },
  )

  // DELETE /api/v1/gastos-ctacte-links/:linkId
  fastify.delete<{ Params: { linkId: string } }>(
    '/api/v1/gastos-ctacte-links/:linkId',
    ADMIN_GATE,
    async (request, reply) => {
      const { linkId } = throwIfInvalid(linkIdParamSchema, request.params, 'params')
      const opId = operatorId(request)
      const existing = await findLinkById(container.db, linkId)
      if (!existing) return reply.code(404).send({ error: 'LINK_NOT_FOUND' })
      const removed = await deleteLink(container.db, linkId)
      if (!removed) return reply.code(404).send({ error: 'LINK_NOT_FOUND' })
      await emitAudit(container.db, {
        operatorId: opId,
        action: 'GASTOS_CTACTE_LINK_DELETE',
        entityType: 'gastos_ctacte_link',
        entityId: linkId,
        oldValue: { gastoId: existing.gastoId, ctacteId: existing.ctacteId },
        newValue: { deleted: true },
        sourceIp: request.ip ?? null,
        payload: undefined,
      })
      return reply.code(200).send({ ok: true })
    },
  )

  // PATCH /api/v1/gastos-ctacte-links/:linkId/anular
  fastify.patch<{ Params: { linkId: string } }>(
    '/api/v1/gastos-ctacte-links/:linkId/anular',
    ADMIN_GATE,
    async (request, reply) => {
      const { linkId } = throwIfInvalid(linkIdParamSchema, request.params, 'params')
      const body = throwIfInvalid(anularBodySchema, request.body ?? {}, 'body')
      const opId = operatorId(request)
      const anulado = await anularLink(container.db, linkId, body.motivo)
      if (!anulado) return reply.code(404).send({ error: 'LINK_NOT_FOUND' })
      await emitAudit(container.db, {
        operatorId: opId,
        action: 'GASTOS_CTACTE_LINK_ANULAR',
        entityType: 'gastos_ctacte_link',
        entityId: linkId,
        oldValue: null,
        newValue: { motivo: body.motivo },
        sourceIp: request.ip ?? null,
        payload: undefined,
      })
      return reply.code(200).send(toLinkDTO(anulado))
    },
  )

  // GET /api/v1/ctacte/:cuenta/gastos-links
  fastify.get<{ Params: { cuenta: string } }>(
    '/api/v1/ctacte/:cuenta/gastos-links',
    ADMIN_GATE,
    async (request, reply) => {
      const { cuenta } = throwIfInvalid(cuentaParamSchema, request.params, 'params')
      const rows = await findLinksByCtacteCuenta(container.db, cuenta)
      return reply.code(200).send({ items: rows })
    },
  )

  // GET /api/v1/admin/gastos-ctacte-candidates
  fastify.get('/api/v1/admin/gastos-ctacte-candidates', ADMIN_GATE, async (request, reply) => {
    const q = throwIfInvalid(candidatesQuerySchema, request.query, 'query')
    const candidates = await findCandidates(container.db, q.gasto_id, q.limit)
    return reply.code(200).send({ items: candidates })
  })

  done()
}

declare module 'fastify' {
  interface FastifyInstance {
    container: AppContainer
  }
}
