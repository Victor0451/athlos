import { afterEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { signAccessToken, authPlugin } from '@athlos/auth'
import { BusinessError, ErrorCode } from '@athlos/errors'
import { mockEnv } from '../test-helpers/mock-env.ts'
import type { AppContainer } from '../container.ts'
import { errorHandler } from '../plugins/error-handler.ts'
import { duesRoutes, type DuesRouteOptions } from './dues.ts'

const actorId = '00000000-0000-4000-8000-000000000001'
// prettier-ignore
const price = {
  id: '00000000-0000-4000-8000-000000000010', kind: 'BASE' as const, disciplinaId: null, amountCents: 12500, currency: 'ARS',
  effectiveFrom: '2026-01-01', effectiveTo: null, rule: 'FULL_MONTH' as const, authorizationEvidence: { secret: 'not for the wire' },
}
const auth = (role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA', key?: string) => ({
  authorization: `Bearer ${signAccessToken({ sub: actorId, role, permissions: { can_reprint: false, can_anulate: false } }, mockEnv() as never)}`,
  ...(key ? { 'idempotency-key': key } : {}),
})
function services(): DuesRouteOptions {
  return {
    pricingService: {
      create: vi.fn().mockResolvedValue(price),
      revoke: vi.fn().mockResolvedValue({ ...price, revokedAt: new Date('2026-01-10') }),
    },
    assessmentService: {
      generate: vi.fn().mockResolvedValue({
        period: { start: '2026-01-01', end: '2026-02-01' },
        obligationIds: ['ob-1'],
      }),
    },
    listEffectivePrices: vi.fn().mockResolvedValue({ base: [price], sports: [] }),
  }
}
const apps: FastifyInstance[] = []
async function buildApp(enabled: boolean, options = services()): Promise<FastifyInstance> {
  const env = { ...mockEnv(), DUES_ASSESSMENT_ENABLED: enabled }
  const app = Fastify({ logger: false })
  app.decorate('container', { db: {}, env } as unknown as AppContainer)
  await app.register(errorHandler)
  await app.register(authPlugin(() => env as never))
  await app.register(duesRoutes, options)
  apps.push(app)
  return app
}
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())))

describe('dues assessment routes', () => {
  it('hides dues routes without data or downstream surfaces when disabled', async () => {
    const options = services(),
      app = await buildApp(false, options)
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/dues/prices?period=2026-01',
      headers: auth('ADMIN'),
    })
    const generate = await app.inject({
      method: 'POST',
      url: '/api/v1/dues/assessments/generate',
      headers: auth('ADMIN', 'off-1'),
      payload: { period: '2026-01' },
    })
    expect(list.statusCode).toBe(404)
    expect(generate.statusCode).toBe(404)
    expect(options.listEffectivePrices).not.toHaveBeenCalled()
    expect(options.assessmentService?.generate).not.toHaveBeenCalled()
    expect(app.printRoutes()).not.toMatch(/ctacte|obligation|settlement|cash|late-fee|projection/i)
  })

  it.each([
    ['missing key', undefined, '2026-01'],
    ['empty key', '', '2026-01'],
    ['oversized key', 'x'.repeat(129), '2026-01'],
    ['invalid period', 'key-1', '2026-13'],
  ])('rejects %s before generation', async (_name, key, period) => {
    const options = services(),
      app = await buildApp(true, options)
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/dues/assessments/generate',
      headers: auth('TESORERO', key),
      payload: { period },
    })
    expect(response.statusCode).toBe(400)
    expect(options.assessmentService?.generate).not.toHaveBeenCalled()
  })

  it.each(['OPERADOR', 'CONSULTA'] as const)(
    'denies %s from financial dues routes',
    async (role) => {
      const app = await buildApp(true)
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/dues/prices?period=2026-01',
        headers: auth(role),
      })
      expect(response.statusCode).toBe(403)
    },
  )

  it('maps DTOs and passes authorized create, revoke, list, and generation inputs', async () => {
    const options = services(),
      app = await buildApp(true, options)
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/dues/prices',
      headers: auth('ADMIN'),
      payload: {
        kind: 'SPORT',
        disciplina_id: '00000000-0000-4000-8000-000000000020',
        amount_cents: 3500,
        effective_from: '2026-01-01',
        rule: 'DAILY_PRORATED',
      },
    })
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/dues/prices?period=2026-01',
      headers: auth('TESORERO'),
    })
    await app.inject({
      method: 'POST',
      url: `/api/v1/dues/prices/${price.id}/revoke`,
      headers: auth('ADMIN'),
      payload: { revoke_reason: 'Correction' },
    })
    const generate = await app.inject({
      method: 'POST',
      url: '/api/v1/dues/assessments/generate',
      headers: auth('TESORERO', 'assessment-1'),
      payload: { period: '2026-01' },
    })
    expect(create.json()).toMatchObject({
      id: price.id,
      amount_cents: 12500,
      disciplina_id: null,
      revoked_at: null,
    })
    expect(create.body).not.toContain('authorizationEvidence')
    expect(list.json().items[0]).toMatchObject({ amount_cents: 12500 })
    expect(generate.json()).toEqual({ period: '2026-01', obligation_ids: ['ob-1'] })
    expect(options.pricingService?.create).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId,
        role: 'ADMIN',
        kind: 'SPORT',
        amountCents: 3500,
        disciplinaId: '00000000-0000-4000-8000-000000000020',
      }),
    )
    expect(options.pricingService?.revoke).toHaveBeenCalledWith(
      expect.objectContaining({
        priceVersionId: price.id,
        revokeReason: 'Correction',
        role: 'ADMIN',
      }),
    )
    expect(options.assessmentService?.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId,
        role: 'TESORERO',
        callerKey: 'assessment-1',
        period: { start: '2026-01-01', end: '2026-02-01' },
      }),
    )
  })

  it.each([
    [ErrorCode.CONFLICT, 409, 'price', 'price conflict'],
    [ErrorCode.SERVICE_UNAVAILABLE, 503, 'assessment', 'assessment still in flight'],
  ])('preserves %s taxonomy', async (code, status, route, message) => {
    const options = services()
    if (route === 'price')
      vi.mocked(options.pricingService!.create).mockRejectedValueOnce(BusinessError(code, message))
    else
      vi.mocked(options.assessmentService!.generate).mockRejectedValueOnce(
        BusinessError(code, message),
      )
    const app = await buildApp(true, options)
    const response = await app.inject({
      method: 'POST',
      url: route === 'price' ? '/api/v1/dues/prices' : '/api/v1/dues/assessments/generate',
      headers: auth('ADMIN', route === 'assessment' ? 'taxonomy-1' : undefined),
      payload:
        route === 'price'
          ? { kind: 'BASE', amount_cents: 1, effective_from: '2026-01-01', rule: 'FULL_MONTH' }
          : { period: '2026-01' },
    })
    expect(response.statusCode).toBe(status)
    expect(response.json()).toMatchObject({ error: code })
    expect(response.body).not.toContain('authorizationEvidence')
  })
})
