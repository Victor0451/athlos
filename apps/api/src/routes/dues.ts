import type { FastifyPluginCallback, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { requireRole } from '@athlos/auth'
import { BusinessError, ErrorCode, throwIfInvalid } from '@athlos/errors'
import { createIdempotencyFingerprint, validateIdempotencyKey } from '../lib/idempotency.ts'
import type { AppContainer } from '../container.ts'
import * as repository from '../modules/dues/repository.ts'
import { AssessmentService, PricingService, type AuditContext } from '../modules/dues/service.ts'
import { BenefitService } from '../modules/dues/dues-benefits.ts'
import { FamilyGroupService } from '../modules/dues/dues-family-groups.ts'

const ADMIN_GATE = { preHandler: requireRole('ADMIN') }
const FINANCE_GATE = { preHandler: requireRole('ADMIN', 'TESORERO') }
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const periodPattern = /^\d{4}-(0[1-9]|1[0-2])$/
const dateSchema = z
  .string()
  .regex(datePattern)
  .refine((value) => validDate(value), 'Invalid date')
const periodSchema = z.string().regex(periodPattern, 'period must be YYYY-MM')
const idParamSchema = z.object({ id: z.string().uuid() })
const periodQuerySchema = z.object({ period: periodSchema })
const generationBodySchema = z.object({ period: periodSchema }).strict()
const revokeBodySchema = z.object({ revoke_reason: z.string().trim().min(1).max(500) }).strict()
const priceBodySchema = z
  .object({
    kind: z.enum(['BASE', 'SPORT']),
    disciplina_id: z.string().uuid().nullable().optional(),
    amount_cents: z.number().int().nonnegative(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default('ARS'),
    effective_from: dateSchema,
    effective_to: dateSchema.nullable().optional(),
    rule: z.enum(['FULL_MONTH', 'DAILY_PRORATED', 'NEXT_PERIOD']),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === 'BASE' && value.disciplina_id !== undefined && value.disciplina_id !== null)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['disciplina_id'],
        message: 'BASE prices cannot name a discipline',
      })
    if (value.kind === 'SPORT' && !value.disciplina_id)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['disciplina_id'],
        message: 'SPORT prices require a discipline',
      })
  })

// prettier-ignore
const benefitBodySchema = z.object({
  kind: z.enum(['FIXED_DISCOUNT', 'PERCENT_DISCOUNT', 'SCHOLARSHIP']),
  socio_id: z.string().uuid().nullable().optional(),
  family_group_id: z.string().uuid().nullable().optional(),
  amount_cents: z.number().int().positive().nullable().optional(),
  percentage: z.number().positive().max(100).nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  effective_from: dateSchema,
  effective_to: dateSchema.nullable().optional(),
  priority: z.number().int().nonnegative(),
  combinability: z.enum(['COMBINABLE', 'EXCLUSIVE']),
  exclusive_group: z.string().trim().min(1).max(100).nullable().optional(),
  percentage_basis: z.enum(['GROSS', 'REMAINING']).nullable().optional(),
  reason: z.string().trim().min(1).max(500),
}).strict().superRefine((value, ctx) => {
  if ((value.socio_id ? 1 : 0) + (value.family_group_id ? 1 : 0) !== 1) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['socio_id'], message: 'Exactly one benefit target is required' })
  if (value.combinability === 'EXCLUSIVE' ? !value.exclusive_group : value.exclusive_group != null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['exclusive_group'], message: 'Exclusive group does not match combinability' })
  if (value.kind === 'FIXED_DISCOUNT') {
    if (value.amount_cents == null || value.percentage != null || value.percentage_basis != null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amount_cents'], message: 'Fixed benefit requires amount only' })
  } else if (value.amount_cents != null || value.percentage == null || value.percentage_basis == null || value.currency != null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['percentage'], message: 'Percentage benefit requires basis and no fixed currency' })
  }
})
// prettier-ignore
const benefitQuerySchema = z.object({ period: periodSchema })
const familyGroupBodySchema = z
  .object({ id: z.string().uuid().optional(), reason: z.string().trim().min(1).max(500) })
  .strict()
const familyMembershipBodySchema = z
  .object({
    socio_id: z.string().uuid(),
    effective_from: dateSchema,
    effective_to: dateSchema.nullable().optional(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.effective_to && value.effective_to <= value.effective_from)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['effective_to'],
        message: 'effective_to must be after effective_from',
      })
  })

export interface DuesRouteOptions {
  pricingService?: Pick<PricingService, 'create' | 'revoke'>
  assessmentService?: Pick<AssessmentService, 'generate'>
  listEffectivePrices?: typeof repository.listEffectivePrices
  benefitService?: Pick<BenefitService, 'create' | 'revoke' | 'list'>
  familyGroupService?: Pick<FamilyGroupService, 'create' | 'addMembership' | 'revokeMembership'>
}

type PriceLike = {
  id?: string
  versionId?: string
  kind: 'BASE' | 'SPORT'
  disciplinaId: string | null
  amountCents: number
  currency: string
  effectiveFrom: string
  effectiveTo: string | null
  rule: 'FULL_MONTH' | 'DAILY_PRORATED' | 'NEXT_PERIOD'
  revokedAt?: Date | string | null
}

function validDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function periodBounds(period: string): repository.Period {
  const [year, month] = period.split('-').map(Number)
  return {
    start: `${period}-01`,
    end: new Date(Date.UTC(year!, month!, 1)).toISOString().slice(0, 10),
  }
}

function toPriceDTO(row: PriceLike) {
  const revokedAt = row.revokedAt
  return {
    id: row.id ?? row.versionId,
    kind: row.kind,
    disciplina_id: row.disciplinaId,
    amount_cents: row.amountCents,
    currency: row.currency,
    effective_from: row.effectiveFrom,
    effective_to: row.effectiveTo,
    rule: row.rule,
    revoked_at: revokedAt instanceof Date ? revokedAt.toISOString() : (revokedAt ?? null),
  }
}

// prettier-ignore
function toBenefitDTO(row: { id: string; kind: string; socioId: string | null; amountCents: number | null; percentage: number | null; currency: string | null; effectiveFrom: string; effectiveTo: string | null; priority: number; combinability: string; exclusiveGroup: string | null; percentageBasis: string | null; revokedAt?: Date | string | null }) {
  return { id: row.id, kind: row.kind, target_type: row.socioId ? 'MEMBER' : 'FAMILY', amount_cents: row.amountCents, percentage: row.percentage, currency: row.currency, effective_from: row.effectiveFrom, effective_to: row.effectiveTo, priority: row.priority, combinability: row.combinability, exclusive_group: row.exclusiveGroup, percentage_basis: row.percentageBasis, revoked_at: row.revokedAt instanceof Date ? row.revokedAt.toISOString() : (row.revokedAt ?? null) }
}
function toFamilyGroupDTO(row: { id: string; reason: string; createdAt?: Date | string }) {
  return {
    id: row.id,
    reason: row.reason,
    created_at:
      row.createdAt instanceof Date ? row.createdAt.toISOString() : (row.createdAt ?? null),
  }
}
function toFamilyMembershipDTO(row: {
  id: string
  familyGroupId: string
  socioId: string
  effectiveFrom: string
  effectiveTo: string | null
  reason: string
  revokedAt?: Date | string | null
}) {
  return {
    id: row.id,
    family_group_id: row.familyGroupId,
    socio_id: row.socioId,
    effective_from: row.effectiveFrom,
    effective_to: row.effectiveTo,
    reason: row.reason,
    revoked_at:
      row.revokedAt instanceof Date ? row.revokedAt.toISOString() : (row.revokedAt ?? null),
  }
}

function enabled(container: AppContainer): void {
  if (!container.env.DUES_ASSESSMENT_ENABLED)
    throw BusinessError(ErrorCode.NOT_FOUND, 'Resource not found')
}

function callerKey(request: FastifyRequest, required = false): string {
  const header = request.headers['idempotency-key']
  const key = typeof header === 'string' ? header : undefined
  if (required && !validateIdempotencyKey(key))
    throw BusinessError(
      ErrorCode.VALIDATION_ERROR,
      key === undefined
        ? 'Idempotency-Key header is required'
        : 'Idempotency-Key header must be 1–128 characters',
    )
  return key ?? request.id
}

function context(request: FastifyRequest, key: string, payload: unknown): AuditContext {
  const operator = request.operator
  if (!operator) throw BusinessError(ErrorCode.TOKEN_INVALID, 'Authentication required')
  const permissions = Object.entries(operator.permissions)
    .filter(([, granted]) => granted)
    .map(([permission]) => permission)
  return {
    actorId: operator.sub,
    role: operator.role,
    permissions,
    sourceIp: request.ip ?? null,
    callerKey: key,
    requestFingerprint: createIdempotencyFingerprint('dues-assessment', request.url, payload),
    authorizationEvidence: { role: operator.role, permissions },
  }
}

export const duesRoutes: FastifyPluginCallback<DuesRouteOptions> = (fastify, options, done) => {
  const container: AppContainer = fastify.container
  const pricingService = options.pricingService ?? new PricingService(container.db)
  const assessmentService = options.assessmentService ?? new AssessmentService(container.db)
  const listEffectivePrices = options.listEffectivePrices ?? repository.listEffectivePrices
  const benefitService = options.benefitService ?? new BenefitService(container.db)
  const familyGroupService = options.familyGroupService ?? new FamilyGroupService(container.db)

  // prettier-ignore
  fastify.post('/api/v1/dues/benefits', ADMIN_GATE, async (request, reply) => {
    enabled(container)
    const body = throwIfInvalid(benefitBodySchema, request.body ?? {}, 'body')
    const result = await benefitService.create({ ...context(request, callerKey(request), body), kind: body.kind, socioId: body.socio_id ?? null, familyGroupId: body.family_group_id ?? null, amountCents: body.amount_cents ?? null, percentage: body.percentage ?? null, currency: body.currency ?? (body.kind === 'FIXED_DISCOUNT' ? 'ARS' : null), effectiveFrom: body.effective_from, effectiveTo: body.effective_to ?? null, priority: body.priority, combinability: body.combinability, exclusiveGroup: body.exclusive_group ?? null, percentageBasis: body.percentage_basis ?? null, reason: body.reason })
    return reply.code(201).send(toBenefitDTO(result))
  })
  // prettier-ignore
  fastify.post<{ Params: { id: string } }>('/api/v1/dues/benefits/:id/revoke', ADMIN_GATE, async (request, reply) => {
    enabled(container)
    const params = throwIfInvalid(idParamSchema, request.params, 'params'), body = throwIfInvalid(revokeBodySchema, request.body ?? {}, 'body')
    const result = await benefitService.revoke({ ...context(request, callerKey(request), body), benefitRuleId: params.id, revokeReason: body.revoke_reason })
    return reply.code(200).send(toBenefitDTO(result))
  })
  // prettier-ignore
  fastify.get('/api/v1/dues/benefits', FINANCE_GATE, async (request, reply) => {
    enabled(container)
    const query = throwIfInvalid(benefitQuerySchema, request.query, 'query')
    const result = await benefitService.list({ role: request.operator!.role, period: periodBounds(query.period) })
    return reply.code(200).send({ items: result.map(toBenefitDTO) })
  })

  fastify.post('/api/v1/dues/family-groups', ADMIN_GATE, async (request, reply) => {
    enabled(container)
    const body = throwIfInvalid(familyGroupBodySchema, request.body ?? {}, 'body')
    const result = await familyGroupService.create({
      ...context(request, callerKey(request), body),
      ...(body.id ? { id: body.id } : {}),
      reason: body.reason,
    })
    return reply.code(201).send(toFamilyGroupDTO(result))
  })
  fastify.post<{ Params: { id: string } }>(
    '/api/v1/dues/family-groups/:id/memberships',
    ADMIN_GATE,
    async (request, reply) => {
      enabled(container)
      const params = throwIfInvalid(idParamSchema, request.params, 'params')
      const body = throwIfInvalid(familyMembershipBodySchema, request.body ?? {}, 'body')
      const result = await familyGroupService.addMembership({
        ...context(request, callerKey(request), body),
        familyGroupId: params.id,
        socioId: body.socio_id,
        effectiveFrom: body.effective_from,
        effectiveTo: body.effective_to ?? null,
        reason: body.reason,
      })
      return reply.code(201).send(toFamilyMembershipDTO(result))
    },
  )
  fastify.post<{ Params: { id: string } }>(
    '/api/v1/dues/family-memberships/:id/revoke',
    ADMIN_GATE,
    async (request, reply) => {
      enabled(container)
      const params = throwIfInvalid(idParamSchema, request.params, 'params')
      const body = throwIfInvalid(revokeBodySchema, request.body ?? {}, 'body')
      const result = await familyGroupService.revokeMembership({
        ...context(request, callerKey(request), body),
        membershipId: params.id,
        revokeReason: body.revoke_reason,
      })
      return reply.code(200).send(toFamilyMembershipDTO(result))
    },
  )

  fastify.post('/api/v1/dues/prices', ADMIN_GATE, async (request, reply) => {
    enabled(container)
    const body = throwIfInvalid(priceBodySchema, request.body ?? {}, 'body')
    const result = await pricingService.create({
      ...context(request, callerKey(request), body),
      kind: body.kind,
      disciplinaId: body.disciplina_id ?? null,
      amountCents: body.amount_cents,
      currency: body.currency ?? 'ARS',
      effectiveFrom: body.effective_from,
      effectiveTo: body.effective_to ?? null,
      rule: body.rule,
    })
    return reply.code(201).send(toPriceDTO(result))
  })

  fastify.post<{ Params: { id: string } }>(
    '/api/v1/dues/prices/:id/revoke',
    ADMIN_GATE,
    async (request, reply) => {
      enabled(container)
      const params = throwIfInvalid(idParamSchema, request.params, 'params')
      const body = throwIfInvalid(revokeBodySchema, request.body ?? {}, 'body')
      const result = await pricingService.revoke({
        ...context(request, callerKey(request), body),
        priceVersionId: params.id,
        revokeReason: body.revoke_reason,
      })
      return reply.code(200).send(toPriceDTO(result))
    },
  )

  fastify.get('/api/v1/dues/prices', FINANCE_GATE, async (request, reply) => {
    enabled(container)
    const query = throwIfInvalid(periodQuerySchema, request.query, 'query')
    const prices = await listEffectivePrices(container.db, periodBounds(query.period))
    return reply.code(200).send({ items: [...prices.base, ...prices.sports].map(toPriceDTO) })
  })

  fastify.post('/api/v1/dues/assessments/generate', FINANCE_GATE, async (request, reply) => {
    enabled(container)
    const body = throwIfInvalid(generationBodySchema, request.body ?? {}, 'body')
    const key = callerKey(request, true)
    const result = await assessmentService.generate({
      ...context(request, key, body),
      period: periodBounds(body.period),
    })
    return reply.code(200).send({ period: body.period, obligation_ids: result.obligationIds })
  })

  done()
}

declare module 'fastify' {
  interface FastifyInstance {
    container: AppContainer
  }
}
