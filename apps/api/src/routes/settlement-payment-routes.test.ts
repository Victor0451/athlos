import { afterEach, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { signAccessToken, authPlugin } from '@athlos/auth'
import { mockEnv } from '../test-helpers/mock-env.ts'
import type { AppContainer } from '../container.ts'
import { errorHandler } from '../plugins/error-handler.ts'
import { duesRoutes, type DuesRouteOptions } from './dues.ts'

const actorId = '00000000-0000-4000-8000-000000000001'
const socioId = '00000000-0000-4000-8000-000000000002'
const obligationId = '00000000-0000-4000-8000-000000000003'
const shiftId = '00000000-0000-4000-8000-000000000004'
const fingerprint = 'a'.repeat(64)
const apps: FastifyInstance[] = []
const headers = (role: 'ADMIN' | 'TESORERO' | 'OPERADOR', key = 'payment-key') => ({
  authorization: `Bearer ${signAccessToken({ sub: actorId, role, permissions: { can_reprint: false, can_anulate: false } }, mockEnv() as never)}`,
  ...(key ? { 'idempotency-key': key } : {}),
})
const payload = {
  socio_id: socioId,
  obligation_ids: [obligationId],
  shift_id: shiftId,
  tender: 'CASH',
  selection_fingerprint: fingerprint,
}
const app = async (settlementService: NonNullable<DuesRouteOptions['settlementService']>) => {
  const env = { ...mockEnv(), DUES_ASSESSMENT_ENABLED: true }
  const fastify = Fastify({ logger: false })
  fastify.decorate('container', { db: {}, env } as unknown as AppContainer)
  await fastify.register(errorHandler)
  await fastify.register(authPlugin(() => env as never))
  await fastify.register(duesRoutes, { settlementService })
  apps.push(fastify)
  return fastify
}
afterEach(async () => Promise.all(apps.splice(0).map((fastify) => fastify.close())))

it('accepts only the strict authenticated idempotent payment DTO', async () => {
  const create = vi.fn().mockResolvedValue({
    settlementId: 'settlement-1',
    kind: 'MONETARY',
    amountCents: 1200,
    currency: 'ARS',
    allocations: [],
  })
  const fastify = await app({ create } as never)
  for (const extra of [
    { amount_cents: 1200 },
    { allocations: [] },
    { currency: 'ARS' },
    { kind: 'MONETARY' },
    { evidence: {} },
    { tender: ['CASH'] },
    { unexpected: true },
  ]) {
    const response = await fastify.inject({
      method: 'POST',
      url: '/api/v1/dues/settlements',
      headers: headers('TESORERO'),
      payload: { ...payload, ...extra },
    })
    expect(response.statusCode).toBe(400)
  }
  for (const tender of ['CASH', 'DEBIT', 'CREDIT', 'TRANSFER']) {
    const response = await fastify.inject({
      method: 'POST',
      url: '/api/v1/dues/settlements',
      headers: headers('TESORERO'),
      payload: { ...payload, tender },
    })
    expect(response.statusCode).toBe(201)
  }
  expect(create).toHaveBeenCalledTimes(4)
})

it('requires finance authorization and an idempotency key before service invocation', async () => {
  const create = vi.fn()
  const fastify = await app({ create } as never)
  expect(
    (
      await fastify.inject({
        method: 'POST',
        url: '/api/v1/dues/settlements',
        headers: headers('OPERADOR'),
        payload,
      })
    ).statusCode,
  ).toBe(403)
  expect(
    (
      await fastify.inject({
        method: 'POST',
        url: '/api/v1/dues/settlements',
        headers: headers('ADMIN', ''),
        payload,
      })
    ).statusCode,
  ).toBe(400)
  expect(create).not.toHaveBeenCalled()
})
