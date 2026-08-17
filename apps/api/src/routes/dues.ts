import type { FastifyPluginCallback, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { requireRole } from '@athlos/auth'
import { BusinessError, ErrorCode, throwIfInvalid } from '@athlos/errors'
import { createIdempotencyFingerprint, validateIdempotencyKey } from '../lib/idempotency.ts'
import type { AppContainer } from '../container.ts'
import * as repository from '../modules/dues/repository.ts'
import { AssessmentService, PricingService, type AuditContext } from '../modules/dues/service.ts'

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

export interface DuesRouteOptions {
  pricingService?: Pick<PricingService, 'create' | 'revoke'>
  assessmentService?: Pick<AssessmentService, 'generate'>
  listEffectivePrices?: typeof repository.listEffectivePrices
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
