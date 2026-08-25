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
import { SettlementService } from '../modules/dues/settlements.ts'
import { MAX_MONEY_CENTS } from '../modules/dues/allocations.ts'
import { AgreementService, type Agreement } from '../modules/dues/agreements.ts'
import { CommunityWorkService } from '../modules/dues/community-work.ts'
import { CtacteProjectionService } from '../modules/dues/ctacte-projection.ts'

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
const previewBodySchema = z
  .object({ socio_id: z.string().uuid(), from_period: periodSchema, through_period: periodSchema })
  .strict()
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

// prettier-ignore
const allocationBodySchema=z.object({obligation_id:z.string().uuid(),amount_cents:z.number().int().positive().max(MAX_MONEY_CENTS)}).strict()
// prettier-ignore
const settlementBodySchema=z.object({socio_id:z.string().uuid(),kind:z.enum(['MONETARY','NON_CASH']),amount_cents:z.number().int().positive().max(MAX_MONEY_CENTS),currency:z.string().regex(/^[A-Z]{3}$/).default('ARS'),evidence:z.record(z.string(),z.unknown()).default({}),reason:z.string().trim().min(1).max(500).optional(),allocations:z.array(allocationBodySchema).min(1)}).strict()
// prettier-ignore
const settlementReverseBodySchema=z.object({allocation_id:z.string().uuid(),reason:z.string().trim().min(1).max(500)}).strict()
// prettier-ignore
const installmentTermsSchema = z.object({ amountCents: z.number().int().positive().max(MAX_MONEY_CENTS), dueDate: dateSchema }).strict()
const termsSchema = z
  .object({
    amountCents: z.number().int().positive().max(MAX_MONEY_CENTS),
    installments: z.array(installmentTermsSchema).min(1).max(60),
  })
  .strict()
  .superRefine((value, ctx) => {
    const sum = value.installments.reduce(
      (total, installment) => total + installment.amountCents,
      0,
    )
    if (sum !== value.amountCents)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['installments'],
        message: 'Installment amounts must sum to amountCents',
      })
    for (let index = 1; index < value.installments.length; index += 1)
      if (value.installments[index]!.dueDate <= value.installments[index - 1]!.dueDate)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['installments', index, 'dueDate'],
          message: 'Installment dates must strictly increase',
        })
  })
// prettier-ignore
const legacyAgreementBodySchema = z.object({ socio_id: z.string().uuid(), obligation_id: z.string().uuid(), kind: z.enum(['SIMPLE', 'INSTALLMENT']), terms: termsSchema, reason: z.string().trim().min(1).max(500) }).strict()
const negotiatedTermsBodySchema = z
  .object({ narrative: z.string().trim().min(1).max(4000) })
  .catchall(z.unknown())
const negotiatedAgreementBodySchema = z
  .object({
    socio_id: z.string().uuid(),
    obligation_id: z.string().uuid(),
    kind: z.literal('NEGOTIATED'),
    terms_version: z.literal(1),
    terms: negotiatedTermsBodySchema,
    reason: z.string().trim().min(1).max(500),
  })
  .strict()
const agreementBodySchema = z.union([legacyAgreementBodySchema, negotiatedAgreementBodySchema])
// prettier-ignore
const rescheduleBodySchema = z.object({ terms: termsSchema, reason: z.string().trim().min(1).max(500) }).strict()
const revisionBodySchema = z
  .object({
    terms_version: z.literal(1),
    terms: negotiatedTermsBodySchema,
    reason: z.string().trim().min(1).max(500),
  })
  .strict()
const obligationIdParamSchema = z.object({ obligationId: z.string().uuid() })
// prettier-ignore
const communityWorkBodySchema = z.object({ socio_id: z.string().uuid(), obligation_id: z.string().uuid(), agreement_id: z.string().uuid().optional(), amount_cents: z.number().int().positive().max(MAX_MONEY_CENTS), evidence: z.record(z.string(), z.unknown()).refine((value) => Object.keys(value).length > 0, 'evidence is required'), reason: z.string().trim().min(1).max(500) }).strict()
// prettier-ignore
const projectionBodySchema = z.object({ source_type: z.enum(['OBLIGATION', 'SETTLEMENT']), source_id: z.string().uuid() }).strict()

export interface DuesRouteOptions {
  pricingService?: Pick<PricingService, 'create' | 'revoke'>
  assessmentService?: Pick<AssessmentService, 'generate'> &
    Partial<Pick<AssessmentService, 'preview'>>
  listEffectivePrices?: typeof repository.listEffectivePrices
  benefitService?: Pick<BenefitService, 'create' | 'revoke' | 'list'>
  familyGroupService?: Pick<FamilyGroupService, 'create' | 'addMembership' | 'revokeMembership'>
  settlementService?: Pick<SettlementService, 'create'> &
    Partial<Pick<SettlementService, 'reverse' | 'debt'>>
  agreementService?: Pick<AgreementService, 'create' | 'reschedule' | 'revise' | 'lineage'>
  communityWorkService?: Pick<CommunityWorkService, 'create'>
  ctacteProjectionService?: Pick<CtacteProjectionService, 'project'>
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
// prettier-ignore
function agreementsEnabled(container: AppContainer): void { if (!container.env.DUES_AGREEMENTS_ENABLED) throw BusinessError(ErrorCode.NOT_FOUND, 'Resource not found') }
// prettier-ignore
function toAgreementDTO(row: Agreement, replayed = false) { return { id: row.id, socio_id: row.socioId, obligation_id: row.obligationId, kind: row.kind, status: row.status, revision_number: row.revisionNumber, terms_version: row.termsVersion, terms: row.terms, reason: row.reason, revision_reason: row.revisionReason, agreement_date: row.agreementDate, revision_of_agreement_id: row.revisionOfAgreementId, replayed } }

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

function context(
  request: FastifyRequest,
  key: string,
  payload: unknown,
  command = 'dues-assessment',
): AuditContext {
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
    requestFingerprint: createIdempotencyFingerprint(command, request.url, payload),
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
  const settlementService = options.settlementService ?? new SettlementService(container.db)
  const agreementService = options.agreementService ?? new AgreementService(container.db)
  const communityWorkService =
    options.communityWorkService ?? new CommunityWorkService(container.db)
  const ctacteProjectionService =
    options.ctacteProjectionService ?? new CtacteProjectionService(container.db)

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

  fastify.post('/api/v1/dues/assessments/preview', FINANCE_GATE, async (request, reply) => {
    enabled(container)
    const body = throwIfInvalid(previewBodySchema, request.body ?? {}, 'body'),
      current = container.clock.now().toISOString().slice(0, 7)
    if (body.from_period > body.through_period || body.through_period > current)
      throw BusinessError(ErrorCode.VALIDATION_ERROR, 'El rango de evaluación es inválido o futuro')
    const result = await assessmentService.preview!({
      ...context(request, callerKey(request), body, 'dues-assessment-preview'),
      socioId: body.socio_id,
      fromPeriod: body.from_period,
      throughPeriod: body.through_period,
    })
    return reply.code(200).send({
      ...result,
      socio_id: result.socioId,
      from_period: result.fromPeriod,
      through_period: result.throughPeriod,
    })
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

  if (container.env.DUES_ASSESSMENT_ENABLED) {
    // prettier-ignore
    fastify.post('/api/v1/dues/settlements',FINANCE_GATE,async(request,reply)=>{enabled(container);const body=throwIfInvalid(settlementBodySchema,request.body ?? {},'body'),key=callerKey(request,true),result=await settlementService.create({...context(request,key,body),socioId:body.socio_id,kind:body.kind,amountCents:body.amount_cents,currency:body.currency ?? 'ARS',evidence:body.evidence ?? {},...(body.reason ? {reason:body.reason} : {}),allocations:body.allocations.map(({obligation_id,amount_cents})=>({obligationId:obligation_id,amountCents:amount_cents}))});return reply.code(201).send({settlement_id:result.settlementId,kind:result.kind,amount_cents:result.amountCents,currency:result.currency,allocations:result.allocations.map(({id,obligationId,amountCents})=>({id,obligation_id:obligationId,amount_cents:amountCents}))})})
    // prettier-ignore
    fastify.post<{Params:{id:string}}>('/api/v1/dues/settlements/:id/reverse',FINANCE_GATE,async(request,reply)=>{enabled(container);const params=throwIfInvalid(idParamSchema,request.params,'params'),body=throwIfInvalid(settlementReverseBodySchema,request.body ?? {},'body'),key=callerKey(request,true),result=await settlementService.reverse!({...context(request,key,body),settlementId:params.id,allocationId:body.allocation_id,reason:body.reason});return reply.code(201).send({settlement_id:result.settlementId,kind:result.kind,amount_cents:result.amountCents,currency:result.currency,allocations:result.allocations.map(({id,obligationId,amountCents})=>({id,obligation_id:obligationId,amount_cents:amountCents}))})})
    // prettier-ignore
    fastify.get<{Params:{socioId:string}}>('/api/v1/dues/debt/:socioId',FINANCE_GATE,async(request,reply)=>{enabled(container);const params=throwIfInvalid(idParamSchema,{id:request.params.socioId},'params'),result=await settlementService.debt!({role:request.operator!.role,socioId:params.id}),body={status:result.status,socio_id:result.socioId,currency:result.currency,total_debt_cents:result.totalCents,obligations:result.obligations.map((obligation)=>({id:obligation.id,period_start:obligation.periodStart,period_end:obligation.periodEnd,original_amount_cents:obligation.originalCents,outstanding_cents:obligation.outstandingCents,currency:obligation.currency,status:obligation.status,components:obligation.components.map(({id,kind,componentKey,amountCents})=>({id,kind,component_key:componentKey,amount_cents:amountCents})),benefits:obligation.benefits.map(({id,componentKey,amountCents})=>({id,component_key:componentKey,amount_cents:amountCents})),allocations:obligation.allocations.map(({id,settlementId,settlementKind,settlementAmountCents,currency,amountCents,kind,compensatesAllocationId,reversalEligible})=>({id,settlement_id:settlementId,settlement_kind:settlementKind,settlement_amount_cents:settlementAmountCents,currency,amount_cents:amountCents,kind,compensates_allocation_id:compensatesAllocationId,reversal_eligible:reversalEligible}))}))};return reply.code(result.status === 'not_found' ? 404 : 200).send(body)})
  }

  if (container.env.DUES_AGREEMENTS_ENABLED) {
    // prettier-ignore
    fastify.post('/api/v1/dues/agreements', FINANCE_GATE, async (request, reply) => { agreementsEnabled(container); const body = throwIfInvalid(agreementBodySchema, request.body ?? {}, 'body'), key = callerKey(request, true); const result = await agreementService.create({ ...context(request, key, body), socioId: body.socio_id, obligationId: body.obligation_id, kind: body.kind, termsVersion: body.kind === 'NEGOTIATED' ? 1 : 0, terms: body.terms, reason: body.reason }); return reply.code(201).send(toAgreementDTO(result.agreement, result.outcome === 'replayed')) })
    // prettier-ignore
    fastify.post<{ Params: { id: string } }>('/api/v1/dues/agreements/:id/reschedule', FINANCE_GATE, async (request, reply) => { agreementsEnabled(container); const params = throwIfInvalid(idParamSchema, request.params, 'params'), body = throwIfInvalid(rescheduleBodySchema, request.body ?? {}, 'body'), key = callerKey(request, true); const result = await agreementService.reschedule({ ...context(request, key, body), agreementId: params.id, terms: body.terms, reason: body.reason }); return reply.code(200).send(toAgreementDTO(result.agreement, result.outcome === 'replayed')) })
    // prettier-ignore
    fastify.post<{ Params: { id: string } }>('/api/v1/dues/agreements/:id/revisions', FINANCE_GATE, async (request, reply) => { agreementsEnabled(container); const params = throwIfInvalid(idParamSchema, request.params, 'params'), body = throwIfInvalid(revisionBodySchema, request.body ?? {}, 'body'), key = callerKey(request, true); const result = await agreementService.revise({ ...context(request, key, body), agreementId: params.id, termsVersion: body.terms_version, terms: body.terms, reason: body.reason }); return reply.code(200).send(toAgreementDTO(result.agreement, result.outcome === 'replayed')) })
    // prettier-ignore
    fastify.get<{ Params: { obligationId: string } }>('/api/v1/dues/obligations/:obligationId/agreements', FINANCE_GATE, async (request, reply) => { agreementsEnabled(container); const params = throwIfInvalid(obligationIdParamSchema, request.params, 'params'); const lineage = await agreementService.lineage({ obligationId: params.obligationId }); return reply.code(200).send({ active: lineage.active ? toAgreementDTO(lineage.active) : null, revisions: lineage.revisions.map((agreement) => toAgreementDTO(agreement)) }) })
    // prettier-ignore
    fastify.post('/api/v1/dues/community-work', FINANCE_GATE, async (request, reply) => { agreementsEnabled(container); const body = throwIfInvalid(communityWorkBodySchema, request.body ?? {}, 'body'), key = callerKey(request, true), result = await communityWorkService.create({ ...context(request, key, body), socioId: body.socio_id, obligationId: body.obligation_id, ...(body.agreement_id ? { agreementId: body.agreement_id } : {}), amountCents: body.amount_cents, evidence: body.evidence, reason: body.reason }); return reply.code(201).send({ community_work_id: result.id, settlement_id: result.settlementId, allocation_id: result.allocationId, obligation_id: result.obligationId, agreement_id: result.agreementId, amount_cents: result.amountCents, replayed: result.replayed === true }) })
  }

  // prettier-ignore
  if (container.env.DUES_CTACTE_PROJECTION_ENABLED) { fastify.post('/api/v1/dues/ctacte/projections', FINANCE_GATE, async (request, reply) => { const body = throwIfInvalid(projectionBodySchema, request.body ?? {}, 'body'), key = callerKey(request, true), result = await ctacteProjectionService.project({ ...context(request, key, body, 'dues-ctacte'), sourceType: body.source_type, sourceId: body.source_id }); return reply.code(200).send({ source_type: result.sourceType, source_id: result.sourceId, status: result.status, ctacte_id: result.ctacteId, missing: result.missing, divergent: result.divergent, retry_count: result.retryCount, ...(result.reason ? { reason: result.reason } : {}) }) }) }

  done()
}

declare module 'fastify' {
  interface FastifyInstance {
    container: AppContainer
  }
}
