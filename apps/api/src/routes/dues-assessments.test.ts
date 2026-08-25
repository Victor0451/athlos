import { afterEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { signAccessToken, authPlugin } from '@athlos/auth'
import { mockEnv } from '../test-helpers/mock-env.ts'
import type { AppContainer } from '../container.ts'
import { errorHandler } from '../plugins/error-handler.ts'
import { duesRoutes } from './dues.ts'

const memberId = '00000000-0000-4000-8000-000000000002'
const auth = (role: 'ADMIN' | 'TESORERO' | 'OPERADOR') => ({
  authorization: `Bearer ${signAccessToken({ sub: memberId, role, permissions: { can_reprint: false, can_anulate: false } }, mockEnv() as never)}`,
})
const preview = {
  socioId: memberId,
  fromPeriod: '2026-01',
  throughPeriod: '2026-02',
  executable: false,
  currency: 'ARS',
  periods: [
    { period: '2026-01', existingObligationId: 'ob-1', pendingAmountCents: 0, components: [] },
  ],
  issues: [{ code: 'PRICE_GAP', componentKey: 'base', from: '2026-02-01', to: '2026-03-01' }],
  fingerprint: 'a'.repeat(64),
  sourceSnapshot: { prices: [] },
}
const apps: FastifyInstance[] = []
async function app(service = { preview: vi.fn().mockResolvedValue(preview), generate: vi.fn() }) {
  const value = Fastify()
  const env = { ...mockEnv(), DUES_ASSESSMENT_ENABLED: true }
  value.decorate('container', {
    db: {},
    env,
    clock: { now: () => new Date('2026-02-15T12:00:00Z') },
  } as unknown as AppContainer)
  await value.register(errorHandler)
  await value.register(authPlugin(() => env as never))
  await value.register(duesRoutes, { assessmentService: service })
  apps.push(value)
  return { value, service }
}
afterEach(async () => Promise.all(apps.splice(0).map((value) => value.close())))

describe('dues assessment preview route', () => {
  it('returns the complete deterministic read-only plan to finance actors', async () => {
    const { value, service } = await app()
    const response = await value.inject({
      method: 'POST',
      url: '/api/v1/dues/assessments/preview',
      headers: auth('TESORERO'),
      payload: { socio_id: memberId, from_period: '2026-01', through_period: '2026-02' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(
      expect.objectContaining({
        socio_id: memberId,
        fingerprint: preview.fingerprint,
        issues: preview.issues,
        periods: expect.any(Array),
      }),
    )
    expect(service.preview).toHaveBeenCalledWith(
      expect.objectContaining({
        socioId: memberId,
        fromPeriod: '2026-01',
        throughPeriod: '2026-02',
        role: 'TESORERO',
      }),
    )
  })
  it.each([
    { from_period: '2026-03', through_period: '2026-02' },
    { from_period: '2026-01', through_period: '2026-03' },
  ])('rejects invalid or future inclusive ranges without calling preview', async (payload) => {
    const { value, service } = await app()
    const response = await value.inject({
      method: 'POST',
      url: '/api/v1/dues/assessments/preview',
      headers: auth('ADMIN'),
      payload: { socio_id: memberId, ...payload },
    })
    expect(response.statusCode).toBe(400)
    expect(service.preview).not.toHaveBeenCalled()
  })
  it('denies non-finance actors and never exposes an execution endpoint', async () => {
    const { value, service } = await app()
    const denied = await value.inject({
      method: 'POST',
      url: '/api/v1/dues/assessments/preview',
      headers: auth('OPERADOR'),
      payload: { socio_id: memberId, from_period: '2026-01', through_period: '2026-02' },
    })
    expect(denied.statusCode).toBe(403)
    expect(service.preview).not.toHaveBeenCalled()
    expect(value.printRoutes()).not.toContain('/api/v1/dues/assessments/execute')
  })
})
