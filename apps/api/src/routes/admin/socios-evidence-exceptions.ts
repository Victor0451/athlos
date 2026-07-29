import type { FastifyPluginCallback, preHandlerHookHandler } from 'fastify'
import { z } from 'zod'
import { requirePermission, requireRole } from '@athlos/auth'
import { throwIfInvalid } from '@athlos/errors'
import { idSchema } from '@athlos/validation'
import type { AppContainer } from '../../container.ts'
import {
  DrizzleEvidenceExceptionRepository,
  getEvidenceException,
  listEvidenceExceptions,
  resolveEvidenceException,
  type EvidenceException,
  type EvidenceExceptionDetail,
  type EvidenceResolution,
} from '../../modules/socios/evidence-exceptions.ts'

const paramsSchema = z.object({ id: idSchema })
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  kind: z.enum(['unknown_type', 'ambiguous_identity']).optional(),
  status: z.enum(['unresolved', 'resolved']).optional(),
})
const resolutionSchema = z
  .object({
    kind: z.enum(['unknown_type', 'ambiguous_identity']),
    evidence_fingerprint: z.string().length(64),
    reason: z.string().trim().min(1).max(1000),
    selected_member_id: idSchema,
    selected_type_candidate_source_row_id: idSchema.optional(),
  })
  .strict()

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

function exceptionDto(row: EvidenceException) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    fingerprint: row.fingerprint,
    legacy_type_code: row.legacyTypeCode,
    created_at: row.createdAt.toISOString(),
  }
}

function detailDto(row: EvidenceExceptionDetail) {
  return {
    ...exceptionDto(row),
    member_choices: row.memberChoices.map((member) => ({
      id: member.id,
      member_number: member.memberNumber,
    })),
    type_choices: row.typeChoices.map((type) => ({
      source_row_id: type.sourceRowId,
      code: type.code,
      name: type.name,
    })),
    deterministic_type_candidate_source_row_id: row.deterministicTypeCandidateSourceRowId,
  }
}

function resolutionDto(row: EvidenceResolution) {
  return {
    id: row.id,
    evidence_id: row.evidenceId,
    kind: row.kind,
    selected_member_id: row.selectedMemberId,
    selected_type_candidate_source_row_id: row.selectedTypeCandidateSourceRowId,
    application_status: 'pending_application' as const,
    created_at: row.createdAt.toISOString(),
  }
}

export const sociosEvidenceExceptionRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  const container = fastify.container as AppContainer
  const gate = { preHandler: anyOf(requireRole('ADMIN'), requirePermission('data_steward')) }
  const repo = new DrizzleEvidenceExceptionRepository(container.db)

  fastify.get('/api/v1/admin/socios-evidence-exceptions', gate, async (request, reply) => {
    const query = throwIfInvalid(listSchema, request.query, 'query')
    const page = query.page ?? 1
    const limit = query.limit ?? 20
    const result = await listEvidenceExceptions(repo, {
      page,
      limit,
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.status ? { status: query.status } : {}),
    })
    return reply.code(200).send({
      items: result.items.map(exceptionDto),
      total: result.total,
      page,
      limit,
      has_more: page * limit < result.total,
    })
  })

  fastify.get<{ Params: { id: string } }>(
    '/api/v1/admin/socios-evidence-exceptions/:id',
    gate,
    async (request, reply) => {
      const { id } = throwIfInvalid(paramsSchema, request.params, 'params')
      return reply.code(200).send(detailDto(await getEvidenceException(repo, id)))
    },
  )

  fastify.post<{ Params: { id: string } }>(
    '/api/v1/admin/socios-evidence-exceptions/:id/resolutions',
    gate,
    async (request, reply) => {
      const { id } = throwIfInvalid(paramsSchema, request.params, 'params')
      const body = throwIfInvalid(resolutionSchema, request.body ?? {}, 'body')
      const idempotencyKey = throwIfInvalid(
        z.string().trim().min(1).max(128),
        request.headers['idempotency-key'] ?? '',
      )
      const operatorId = request.operator?.sub
      if (!operatorId) throw new Error('authenticated route is missing its operator')
      const resolution = await resolveEvidenceException(repo, {
        evidenceId: id,
        kind: body.kind,
        evidenceFingerprint: body.evidence_fingerprint,
        operatorId,
        idempotencyKey,
        reason: body.reason,
        ...(body.selected_type_candidate_source_row_id
          ? { selectedTypeCandidateSourceRowId: body.selected_type_candidate_source_row_id }
          : {}),
        selectedMemberId: body.selected_member_id,
      })
      return reply.code(201).send(resolutionDto(resolution))
    },
  )
  done()
}
