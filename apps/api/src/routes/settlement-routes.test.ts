import { afterEach, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { signAccessToken, authPlugin } from '@athlos/auth'
import { mockEnv } from '../test-helpers/mock-env.ts'
import type { AppContainer } from '../container.ts'
import { errorHandler } from '../plugins/error-handler.ts'
import { duesRoutes, type DuesRouteOptions } from './dues.ts'
import { BusinessError, ErrorCode } from '@athlos/errors'

const actorId = '00000000-0000-4000-8000-000000000001',
  apps: FastifyInstance[] = []
const auth = (role: 'ADMIN' | 'TESORERO' | 'OPERADOR') => ({
  authorization: `Bearer ${signAccessToken({ sub: actorId, role, permissions: { can_reprint: false, can_anulate: false } }, mockEnv() as never)}`,
  'idempotency-key': 'settlement-route-1',
})
const app = async (settlementService: NonNullable<DuesRouteOptions['settlementService']>) => {
  const env = { ...mockEnv(), DUES_ASSESSMENT_ENABLED: true },
    fastify = Fastify({ logger: false })
  fastify.decorate('container', { db: {}, env } as unknown as AppContainer)
  await fastify.register(errorHandler)
  await fastify.register(authPlugin(() => env as never))
  await fastify.register(duesRoutes, { settlementService })
  apps.push(fastify)
  return fastify
}
afterEach(async () => Promise.all(apps.splice(0).map((fastify) => fastify.close())))

// prettier-ignore
it('passes explicit non-cash allocations and hides evidence from the response',async()=>{const settlementService={create:vi.fn().mockResolvedValue({settlementId:'settlement-1',kind:'NON_CASH',amountCents:5_000,currency:'ARS',allocations:[{id:'allocation-1',obligationId:'obligation-2',amountCents:5_000}]})},fastify=await app(settlementService),response=await fastify.inject({method:'POST',url:'/api/v1/dues/settlements',headers:auth('TESORERO'),payload:{socio_id:actorId,kind:'NON_CASH',amount_cents:5_000,evidence:{approval:'private'},allocations:[{obligation_id:'00000000-0000-4000-8000-000000000002',amount_cents:5_000}]}}); expect(response.statusCode).toBe(201); expect(response.json()).toEqual({settlement_id:'settlement-1',kind:'NON_CASH',amount_cents:5_000,currency:'ARS',allocations:[{id:'allocation-1',obligation_id:'obligation-2',amount_cents:5_000}]}); expect(response.body).not.toContain('approval'); expect(settlementService.create).toHaveBeenCalledWith(expect.objectContaining({socioId:actorId,kind:'NON_CASH',amountCents:5_000,allocations:[{obligationId:'00000000-0000-4000-8000-000000000002',amountCents:5_000}]}))})
// prettier-ignore
it('denies non-finance roles before calling the settlement service',async()=>{const settlementService={create:vi.fn()},fastify=await app(settlementService),response=await fastify.inject({method:'POST',url:'/api/v1/dues/settlements',headers:auth('OPERADOR'),payload:{}}); expect(response.statusCode).toBe(403); expect(settlementService.create).not.toHaveBeenCalled()})

it('returns 400 for amounts outside the PostgreSQL numeric(14,2) bound', async () => {
  const settlementService = { create: vi.fn() }
  const fastify = await app(settlementService)
  const response = await fastify.inject({
    method: 'POST',
    url: '/api/v1/dues/settlements',
    headers: auth('TESORERO'),
    payload: {
      socio_id: actorId,
      kind: 'MONETARY',
      amount_cents: 99_999_999_999_999 + 1,
      allocations: [{ obligation_id: actorId, amount_cents: 99_999_999_999_999 + 1 }],
    },
  })
  expect(response.statusCode).toBe(400)
  expect(settlementService.create).not.toHaveBeenCalled()
})

it('accepts the inclusive PostgreSQL numeric(14,2) amount bound', async () => {
  const maxCents = 99_999_999_999_999
  const settlementService = {
    create: vi.fn().mockResolvedValue({
      settlementId: 'settlement-max',
      kind: 'MONETARY',
      amountCents: maxCents,
      currency: 'ARS',
      allocations: [{ id: 'allocation-max', obligationId: actorId, amountCents: maxCents }],
    }),
  }
  const fastify = await app(settlementService)
  const response = await fastify.inject({
    method: 'POST',
    url: '/api/v1/dues/settlements',
    headers: auth('TESORERO'),
    payload: {
      socio_id: actorId,
      kind: 'MONETARY',
      amount_cents: maxCents,
      allocations: [{ obligation_id: actorId, amount_cents: maxCents }],
    },
  })
  expect(response.statusCode).toBe(201)
  expect(settlementService.create).toHaveBeenCalled()
})

it('returns 409 for a duplicate reversal conflict', async () => {
  const settlementService = {
    create: vi.fn(),
    reverse: vi
      .fn()
      .mockRejectedValue(BusinessError(ErrorCode.CONFLICT, 'Allocation was already reversed')),
  }
  const fastify = await app(settlementService)
  const response = await fastify.inject({
    method: 'POST',
    url: `/api/v1/dues/settlements/${actorId}/reverse`,
    headers: auth('TESORERO'),
    payload: { allocation_id: actorId, reason: 'Duplicate correction' },
  })
  expect(response.statusCode).toBe(409)
  expect(response.json().error).toBe(ErrorCode.CONFLICT)
})

it('returns the debt route contract for an authorized finance role', async () => {
  const settlementService = {
    create: vi.fn(),
    debt: vi.fn().mockResolvedValue({
      socioId: actorId,
      totalCents: 2_500,
      obligations: [
        {
          id: 'obligation-1',
          periodStart: '2026-01-01',
          periodEnd: '2026-02-01',
          amountCents: 2_500,
          outstandingCents: 2_500,
        },
      ],
    }),
  }
  const fastify = await app(settlementService)
  const response = await fastify.inject({
    method: 'GET',
    url: `/api/v1/dues/debt/${actorId}`,
    headers: auth('TESORERO'),
  })
  expect(response.statusCode).toBe(200)
  expect(response.json()).toEqual({
    socio_id: actorId,
    total_debt_cents: 2_500,
    obligations: [
      {
        id: 'obligation-1',
        period_start: '2026-01-01',
        period_end: '2026-02-01',
        amount_cents: 2_500,
        outstanding_cents: 2_500,
      },
    ],
  })
})
