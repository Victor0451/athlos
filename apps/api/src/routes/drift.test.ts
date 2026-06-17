import { describe, it, expect, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { signAccessToken, authPlugin } from '@athlos/auth'
import { driftRoutes } from './drift.ts'
import type { AppContainer } from '../container.ts'
import { mockEnv } from '../test-helpers/mock-env.ts'

function makeAdminToken(sub = '00000000-0000-4000-8000-000000000001') {
  return signAccessToken(
    { sub, role: 'ADMIN', permissions: { can_reprint: true, can_anulate: true } },
    mockEnv() as never,
  )
}

function makeDataStewardToken(sub = '00000000-0000-4000-8000-000000000002') {
  return signAccessToken(
    { sub, role: 'TESORERO', permissions: { can_reprint: true, can_anulate: true } },
    mockEnv() as never,
  )
}

function makeConsultaToken(sub = '00000000-0000-4000-8000-000000000003') {
  return signAccessToken(
    { sub, role: 'CONSULTA', permissions: { can_reprint: false, can_anulate: false } },
    mockEnv() as never,
  )
}

async function buildApp(overrides?: Partial<AppContainer>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  const mockContainer = {
    db: {},
    env: mockEnv() as never,
    driftService: {
      detect: vi.fn().mockResolvedValue({ domain: null, scanned: 0, driftCount: 0, drifts: [] }),
      detectAll: vi.fn().mockResolvedValue({ domain: null, scanned: 0, driftCount: 0, drifts: [] }),
      emitDriftAlert: vi.fn(),
    },
    permissionsRepo: {
      hasPermission: vi.fn().mockResolvedValue(false),
      grant: vi.fn(),
      revoke: vi.fn(),
    },
    ...overrides,
  } as unknown as AppContainer
  app.decorate('container', mockContainer)
  authPlugin(mockEnv)(app, {}, () => {})
  await app.register(driftRoutes)
  return app
}

describe('GET /api/v1/drift', () => {
  it('returns 200 for ADMIN', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/drift',
      headers: { authorization: `Bearer ${makeAdminToken()}` },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveProperty('domain')
    expect(body).toHaveProperty('driftCount')
  })

  it('returns 200 for data_steward (permission granted)', async () => {
    const app = await buildApp({
      permissionsRepo: {
        hasPermission: vi.fn().mockResolvedValue(true),
        grant: vi.fn(),
        revoke: vi.fn(),
      },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/drift',
      headers: { authorization: `Bearer ${makeDataStewardToken()}` },
    })

    expect(res.statusCode).toBe(200)
  })

  it('returns 403 for CONSULTA (no permission)', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/drift',
      headers: { authorization: `Bearer ${makeConsultaToken()}` },
    })

    expect(res.statusCode).toBe(403)
  })

  it('returns 401 for unauthenticated request', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/drift',
    })

    expect(res.statusCode).toBe(401)
  })
})
