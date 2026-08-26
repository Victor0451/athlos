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
    settlementService: {
      create: vi.fn(),
      reverse: vi.fn().mockResolvedValue({
        settlementId: '00000000-0000-4000-8000-000000000041',
        kind: 'MONETARY',
        amountCents: 5000,
        currency: 'ARS',
        allocations: [{ id: 'allocation-1', obligationId: 'obligation-1', amountCents: 5000 }],
      }),
    },
    listEffectivePrices: vi.fn().mockResolvedValue({ base: [price], sports: [] }),
    // prettier-ignore
    benefitService: {
      create: vi.fn().mockResolvedValue({ id: price.id, kind: 'FIXED_DISCOUNT', socioId: actorId, familyGroupId: null, amountCents: 500, percentage: null, currency: 'ARS', effectiveFrom: '2026-01-01', effectiveTo: null, priority: 10, combinability: 'COMBINABLE', exclusiveGroup: null, percentageBasis: null }),
      revoke: vi.fn().mockResolvedValue({ id: price.id, kind: 'FIXED_DISCOUNT', socioId: actorId, familyGroupId: null, amountCents: 500, percentage: null, currency: 'ARS', effectiveFrom: '2026-01-01', effectiveTo: null, priority: 10, combinability: 'COMBINABLE', exclusiveGroup: null, percentageBasis: null }),
      list: vi.fn().mockResolvedValue([]),
    },
    familyGroupService: {
      create: vi
        .fn()
        .mockResolvedValue({ id: '00000000-0000-4000-8000-000000000030', reason: 'Approved' }),
      addMembership: vi.fn().mockResolvedValue({
        id: '00000000-0000-4000-8000-000000000031',
        familyGroupId: '00000000-0000-4000-8000-000000000030',
        socioId: actorId,
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        reason: 'Approved',
      }),
      revokeMembership: vi.fn().mockResolvedValue({
        id: '00000000-0000-4000-8000-000000000031',
        familyGroupId: '00000000-0000-4000-8000-000000000030',
        socioId: actorId,
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        reason: 'Approved',
        revokedAt: new Date('2026-01-10'),
      }),
    },
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

  it('keeps pricing creation ADMIN-only', async () => {
    const deniedApp = await buildApp(true)
    const denied = await deniedApp.inject({
      method: 'POST',
      url: '/api/v1/dues/prices',
      headers: auth('TESORERO'),
      payload: {
        kind: 'BASE',
        amount_cents: 12500,
        effective_from: '2026-01-01',
        rule: 'FULL_MONTH',
      },
    })
    expect(denied.statusCode).toBe(403)
  })

  // prettier-ignore
  it('allows ADMIN benefit mutations and finance reads without exposing target evidence', async () => {
    const options = services(), app = await buildApp(true, options)
    const create = await app.inject({ method: 'POST', url: '/api/v1/dues/benefits', headers: auth('ADMIN'), payload: { kind: 'FIXED_DISCOUNT', socio_id: actorId, amount_cents: 500, currency: 'ARS', effective_from: '2026-01-01', priority: 10, combinability: 'COMBINABLE', reason: 'Approved' } })
    const list = await app.inject({ method: 'GET', url: '/api/v1/dues/benefits?period=2026-01', headers: auth('TESORERO') })
    const revoke = await app.inject({ method: 'POST', url: `/api/v1/dues/benefits/${price.id}/revoke`, headers: auth('ADMIN'), payload: { revoke_reason: 'Replaced' } })
    expect(create.statusCode).toBe(201)
    expect(list.statusCode).toBe(200)
    expect(revoke.statusCode).toBe(200)
    expect(create.body).not.toContain('socio_id')
    expect(options.benefitService?.create).toHaveBeenCalledWith(expect.objectContaining({ priority: 10, combinability: 'COMBINABLE', socioId: actorId }))
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

  it('allows only ADMIN family eligibility commands and returns no authorization evidence', async () => {
    const options = services(),
      app = await buildApp(true, options)
    const post = (url: string, payload: object, role: 'ADMIN' | 'TESORERO' = 'ADMIN') =>
      app.inject({ method: 'POST', url, headers: auth(role), payload })
    const [group, membership, revoke, denied] = await Promise.all([
      post('/api/v1/dues/family-groups', {
        id: '00000000-0000-4000-8000-000000000030',
        reason: 'Approved',
      }),
      post('/api/v1/dues/family-groups/00000000-0000-4000-8000-000000000030/memberships', {
        socio_id: actorId,
        effective_from: '2026-01-01',
        reason: 'Approved',
      }),
      post('/api/v1/dues/family-memberships/00000000-0000-4000-8000-000000000031/revoke', {
        revoke_reason: 'Replaced',
      }),
      post('/api/v1/dues/family-groups', { reason: 'Denied' }, 'TESORERO'),
    ])
    expect([group.statusCode, membership.statusCode, revoke.statusCode, denied.statusCode]).toEqual(
      [201, 201, 200, 403],
    )
    expect(`${group.body}${membership.body}${revoke.body}`).not.toContain('authorizationEvidence')
    expect(options.familyGroupService?.addMembership).toHaveBeenCalledWith(
      expect.objectContaining({
        socioId: actorId,
        familyGroupId: '00000000-0000-4000-8000-000000000030',
      }),
    )
  })
})

describe('dues settlement reversal route', () => {
  const settlementId = '00000000-0000-4000-8000-000000000040'

  it('accepts only a settlement-level reason and returns the committed reversal DTO', async () => {
    const options = services(),
      app = await buildApp(true, options)
    const request = {
      method: 'POST',
      url: `/api/v1/dues/settlements/${settlementId}/reverse`,
      headers: auth('TESORERO', 'reverse-1'),
      payload: { reason: 'Cobro duplicado' },
    } as const
    const response = await app.inject(request)
    const replay = await app.inject(request)
    const committed = {
      original_settlement_id: settlementId,
      reversal_settlement_id: '00000000-0000-4000-8000-000000000041',
      kind: 'MONETARY',
      amount_cents: 5000,
      currency: 'ARS',
      allocations: [{ id: 'allocation-1', obligation_id: 'obligation-1', amount_cents: 5000 }],
    }
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(committed)
    expect(replay.json()).toEqual(committed)
    expect(options.settlementService?.reverse).toHaveBeenCalledWith(
      expect.objectContaining({
        settlementId,
        reason: 'Cobro duplicado',
        callerKey: 'reverse-1',
        role: 'TESORERO',
        authorizationEvidence: { role: 'TESORERO', permissions: [] },
      }),
    )
  })

  it.each([
    ['missing idempotency key', auth('ADMIN'), { reason: 'Corrección' }, 400],
    ['blank reason', auth('ADMIN', 'reverse-2'), { reason: '  ' }, 400],
    [
      'legacy allocation payload',
      auth('ADMIN', 'reverse-3'),
      { reason: 'Corrección', allocation_id: 'allocation-1' },
      400,
    ],
    [
      'caller amount payload',
      auth('ADMIN', 'reverse-4'),
      { reason: 'Corrección', amount_cents: 1 },
      400,
    ],
    ['unauthorized role', auth('OPERADOR', 'reverse-5'), { reason: 'Corrección' }, 403],
  ])('rejects %s without calling reversal service', async (_name, headers, payload, status) => {
    const options = services(),
      app = await buildApp(true, options)
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/dues/settlements/${settlementId}/reverse`,
      headers,
      payload,
    })
    expect(response.statusCode).toBe(status)
    expect(options.settlementService?.reverse).not.toHaveBeenCalled()
  })

  it.each([
    [ErrorCode.CONFLICT, 409],
    [ErrorCode.NOT_FOUND, 404],
    [ErrorCode.SERVICE_UNAVAILABLE, 503],
  ])('preserves %s reversal errors', async (code, status) => {
    const options = services()
    vi.mocked(options.settlementService!.reverse!).mockRejectedValueOnce(
      BusinessError(code, 'reversal failed'),
    )
    const app = await buildApp(true, options)
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/dues/settlements/${settlementId}/reverse`,
      headers: auth('ADMIN', `reverse-${status}`),
      payload: { reason: 'Corrección' },
    })
    expect(response.statusCode).toBe(status)
    expect(response.json()).toMatchObject({ error: code })
  })
})
