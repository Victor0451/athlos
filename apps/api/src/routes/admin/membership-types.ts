import type { FastifyPluginCallback, preHandlerHookHandler } from 'fastify'
import { z } from 'zod'
import { requirePermission, requireRole } from '@athlos/auth'
import { BusinessError, ErrorCode, throwIfInvalid } from '@athlos/errors'
import { idSchema } from '@athlos/validation'
import type { AppContainer } from '../../container.ts'
import {
  getCurrentMembershipType,
  listAssociatedMembers,
  listMembershipTypeCatalog,
  type CatalogPage,
  type MembershipTypeCatalogItem,
} from '../../modules/socios/membership-type-catalog-repository.ts'

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/[a-z0-9]/i)
    .optional(),
})
const paramsSchema = z.object({ sourceRowId: idSchema })

function anyOf(...handlers: preHandlerHookHandler[]): preHandlerHookHandler {
  const wrapper = async (request: unknown, reply: unknown): Promise<void> => {
    let lastError: unknown
    for (const handler of handlers) {
      try {
        await (handler as unknown as (r: unknown, s: unknown) => Promise<unknown>)(request, reply)
        return
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  }
  const marker = (handlers[0] as unknown as Record<symbol, unknown>)[
    Symbol.for('@athlos/auth/gate')
  ]
  if (marker)
    (wrapper as unknown as Record<symbol, unknown>)[Symbol.for('@athlos/auth/gate')] = marker
  return wrapper as unknown as preHandlerHookHandler
}

function catalogDto(item: MembershipTypeCatalogItem) {
  return {
    source_row_id: item.sourceRowId,
    snapshot_batch_id: item.snapshotBatchId,
    code: item.code,
    name: item.name,
    letter: item.letter,
    catalog_state: 'applied' as const,
    validated_count: item.validatedCount,
    applied_resolution_count: item.resolvedCount,
    member_count: item.distinctMemberCount,
  }
}

function unavailable<T>(result: CatalogPage<T>) {
  return {
    snapshot: { catalog_state: 'unavailable' as const, reason: result.state },
    items: [],
    total: 0,
    page: result.page,
    limit: result.limit,
    has_more: false,
  }
}

function rejectUnavailable(state: string): void {
  if (state === 'source_row_not_current')
    throw BusinessError(ErrorCode.CONFLICT, 'Membership type source row is not current')
}

export const membershipTypeRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const container = fastify.container as AppContainer
  const gate = { preHandler: anyOf(requireRole('ADMIN'), requirePermission('data_steward')) }

  fastify.get('/api/v1/admin/membership-types', gate, async (request, reply) => {
    const query = throwIfInvalid(querySchema, request.query, 'query')
    const page = query.page ?? 1
    const limit = query.limit ?? 20
    const result = await listMembershipTypeCatalog(container.db, {
      page,
      limit,
      ...(query.q ? { search: query.q } : {}),
    })
    if (result.state !== 'ready') return reply.code(200).send(unavailable(result))
    return reply.code(200).send({
      snapshot: { catalog_state: 'applied' as const, snapshot_batch_id: result.snapshotBatchId },
      items: result.items.map(catalogDto),
      total: result.total,
      page: result.page,
      limit: result.limit,
      has_more: result.page * result.limit < result.total,
    })
  })

  fastify.get<{ Params: { sourceRowId: string } }>(
    '/api/v1/admin/membership-types/:sourceRowId/members',
    gate,
    async (request, reply) => {
      const { sourceRowId } = throwIfInvalid(paramsSchema, request.params, 'params')
      const query = throwIfInvalid(querySchema, request.query, 'query')
      const page = query.page ?? 1
      const limit = query.limit ?? 20
      const type = await getCurrentMembershipType(container.db, sourceRowId)
      rejectUnavailable(type.state)
      if (!type.item) {
        const result = await listAssociatedMembers(container.db, sourceRowId, {
          page,
          limit,
          ...(query.q ? { search: query.q } : {}),
        })
        return reply.code(200).send(unavailable(result))
      }
      const result = await listAssociatedMembers(container.db, sourceRowId, {
        page,
        limit,
        ...(query.q ? { search: query.q } : {}),
      })
      rejectUnavailable(result.state)
      if (result.state !== 'ready') return reply.code(200).send(unavailable(result))
      return reply.code(200).send({
        snapshot: {
          catalog_state: 'applied' as const,
          snapshot_batch_id: type.item.snapshotBatchId,
        },
        membership_type: {
          source_row_id: type.item.sourceRowId,
          snapshot_batch_id: type.item.snapshotBatchId,
          code: type.item.code,
          name: type.item.name,
          letter: type.item.letter,
          catalog_state: 'applied' as const,
        },
        items: result.items.map((member) => ({
          member_id: member.memberId,
          member_number: member.memberNumber,
          credential_ref: member.credentialRef,
          lifecycle_state: member.lifecycleState,
          association_sources: member.associationSources,
        })),
        total: result.total,
        page: result.page,
        limit: result.limit,
        has_more: result.page * result.limit < result.total,
      })
    },
  )
  done()
}
