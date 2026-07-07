import type { FastifyPluginCallback } from 'fastify'
import { requireAuth } from '@athlos/auth'
import { throwIfInvalid } from '@athlos/errors'
import type { AppContainer } from '../container.ts'
import {
  getOperatorByIdsQuerySchema,
  listByIds,
  type OperatorSummary,
} from '../modules/operators/index.ts'

/**
 * Operators routes — `/api/v1/operators`.
 *
 * One endpoint, one purpose: read-only batch lookup of operator
 * summaries (`id`, `username`, `role`) for the AuditTab and
 * SocioNotesCard render surfaces. Mounted at `/api/v1/operators`
 * (NOT under `/admin/`) because any authenticated operator needs
 * to see the actor name alongside the audit row they already see
 * via `/api/v1/socios/:id/audit`.
 *
 *   GET /api/v1/operators?ids=<uuid>,...
 *     - Auth: requireAuth() (any role — design D4).
 *     - Validation: ids must be a non-empty array of UUIDs,
 *       capped at 200 (spec §"Input validation").
 *     - Response: { operators: OperatorSummary[] } where
 *       OperatorSummary = { id, username, role }.
 *
 * SQL projection lives in modules/operators/lookup.ts so PII
 * columns (`password_hash`, `failed_login_attempts`, `is_active`)
 * never leave Postgres (design D5). This route is a thin layer:
 * parse → validate → call listByIds → return shape.
 */

const AUTH = { preHandler: requireAuth() }

export const operatorsRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const container: AppContainer = fastify.container

  fastify.get<{ Querystring: { ids?: string | string[] } }>(
    '/api/v1/operators',
    AUTH,
    async (request, reply) => {
      // Fastify parses repeated `?ids=a&ids=b` as `string[]` and the
      // comma-joined `?ids=a,b` form as `string`. Normalise to array
      // before validation so both shapes work.
      const raw = request.query.ids
      const normalised = (() => {
        if (raw === undefined) return undefined
        if (Array.isArray(raw)) return raw
        return raw.split(',')
      })()

      const q = throwIfInvalid(
        getOperatorByIdsQuerySchema,
        normalised === undefined ? {} : { ids: normalised },
        'query',
      )

      const rows: OperatorSummary[] = await listByIds(container.db, q.ids)
      return reply.code(200).send({ operators: rows })
    },
  )

  done()
}

declare module 'fastify' {
  interface FastifyInstance {
    container: AppContainer
  }
}
