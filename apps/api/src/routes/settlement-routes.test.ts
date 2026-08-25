import { afterEach, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { signAccessToken, authPlugin } from '@athlos/auth'
import { mockEnv } from '../test-helpers/mock-env.ts'
import type { AppContainer } from '../container.ts'
import { errorHandler } from '../plugins/error-handler.ts'
import { duesRoutes, type DuesRouteOptions } from './dues.ts'

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
it('returns 404 for legacy settlement creation, including non-cash payloads',async()=>{const settlementService={create:vi.fn()},fastify=await app(settlementService),response=await fastify.inject({method:'POST',url:'/api/v1/dues/settlements',headers:auth('TESORERO'),payload:{socio_id:actorId,kind:'NON_CASH',amount_cents:5_000,evidence:{approval:'private'},allocations:[{obligation_id:'00000000-0000-4000-8000-000000000002',amount_cents:5_000}]}});expect(response.statusCode).toBe(404);expect(settlementService.create).not.toHaveBeenCalled()})
// prettier-ignore
it('returns 404 for legacy settlement creation before authorization',async()=>{const settlementService={create:vi.fn()},fastify=await app(settlementService),response=await fastify.inject({method:'POST',url:'/api/v1/dues/settlements',headers:auth('OPERADOR'),payload:{}});expect(response.statusCode).toBe(404);expect(settlementService.create).not.toHaveBeenCalled()})

it('returns 404 for oversized legacy settlement creation', async () => {
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
  expect(response.statusCode).toBe(404)
  expect(settlementService.create).not.toHaveBeenCalled()
})

it('returns 404 for in-range legacy settlement creation', async () => {
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
  expect(response.statusCode).toBe(404)
  expect(settlementService.create).not.toHaveBeenCalled()
})

it('returns 404 for legacy reversal', async () => {
  const settlementService = { create: vi.fn(), reverse: vi.fn() }
  const fastify = await app(settlementService)
  const response = await fastify.inject({
    method: 'POST',
    url: `/api/v1/dues/settlements/${actorId}/reverse`,
    headers: auth('TESORERO'),
    payload: { allocation_id: actorId, reason: 'Duplicate correction' },
  })
  expect(response.statusCode).toBe(404)
  expect(settlementService.reverse).not.toHaveBeenCalled()
})

// prettier-ignore
it('returns 404 for stale legacy settlement creation',async()=>{const settlementService={create:vi.fn()},fastify=await app(settlementService),response=await fastify.inject({method:'POST',url:'/api/v1/dues/settlements',headers:auth('TESORERO'),payload:{socio_id:actorId,kind:'MONETARY',amount_cents:2_000,allocations:[{obligation_id:actorId,amount_cents:2_000}]}});expect(response.statusCode).toBe(404);expect(settlementService.create).not.toHaveBeenCalled()})
// prettier-ignore
it('returns 404 for legacy reversal before validation',async()=>{const settlementService={create:vi.fn(),reverse:vi.fn()},fastify=await app(settlementService),response=await fastify.inject({method:'POST',url:`/api/v1/dues/settlements/${actorId}/reverse`,headers:auth('TESORERO'),payload:{allocation_id:actorId,reason:'   '}});expect(response.statusCode).toBe(404);expect(settlementService.reverse).not.toHaveBeenCalled()})

it('returns the debt route contract for an authorized finance role', async () => {
  const settlementService = {
    create: vi.fn(),
    debt: vi.fn().mockResolvedValue({
      status: 'ready',
      socioId: actorId,
      currency: 'ARS',
      totalCents: 2_500,
      obligations: [
        {
          id: 'obligation-1',
          periodStart: '2026-01-01',
          periodEnd: '2026-02-01',
          originalCents: 2_500,
          outstandingCents: 2_500,
          currency: 'ARS',
          status: 'OPEN',
          components: [
            { id: 'component-1', kind: 'BASE', componentKey: 'base', amountCents: 2_500 },
          ],
          benefits: [],
          allocations: [],
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
    status: 'ready',
    currency: 'ARS',
    total_debt_cents: 2_500,
    obligations: [
      {
        id: 'obligation-1',
        period_start: '2026-01-01',
        period_end: '2026-02-01',
        original_amount_cents: 2_500,
        outstanding_cents: 2_500,
        currency: 'ARS',
        status: 'OPEN',
        components: [
          { id: 'component-1', kind: 'BASE', component_key: 'base', amount_cents: 2_500 },
        ],
        benefits: [],
        allocations: [],
      },
    ],
  })
})

it('denies unauthorized debt reads and returns not-found without member evidence', async () => {
  const settlementService = { create: vi.fn(), debt: vi.fn() }
  const fastify = await app(settlementService)
  const denied = await fastify.inject({
    method: 'GET',
    url: `/api/v1/dues/debt/${actorId}`,
    headers: auth('OPERADOR'),
  })
  expect(denied.statusCode).toBe(403)
  expect(settlementService.debt).not.toHaveBeenCalled()

  vi.mocked(settlementService.debt).mockResolvedValueOnce({
    status: 'not_found',
    socioId: actorId,
    currency: null,
    totalCents: 0,
    obligations: [],
  })
  const notFound = await fastify.inject({
    method: 'GET',
    url: `/api/v1/dues/debt/${actorId}`,
    headers: auth('TESORERO'),
  })
  expect(notFound.statusCode).toBe(404)
  expect(notFound.json()).toEqual({
    status: 'not_found',
    socio_id: actorId,
    currency: null,
    total_debt_cents: 0,
    obligations: [],
  })
  expect(notFound.body).not.toMatch(/audit|authorization|evidence/i)
})
