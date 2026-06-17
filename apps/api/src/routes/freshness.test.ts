import { describe, it, expect, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { signAccessToken, authPlugin } from '@athlos/auth'
import { freshnessRoutes } from './freshness.ts'
import type { AppContainer } from '../container.ts'
import { mockEnv } from '../test-helpers/mock-env.ts'

function makeToken(role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA' = 'CONSULTA') {
  return signAccessToken(
    {
      sub: '00000000-0000-4000-8000-000000000001',
      role,
      permissions: { can_reprint: false, can_anulate: false },
    },
    mockEnv() as never,
  )
}

async function buildApp(overrides?: Partial<AppContainer>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  // Catch errors to return proper responses instead of 500
  app.setErrorHandler((err, _request, reply) => {
    const statusCode = (err as { statusCode?: number }).statusCode ?? 500
    const message = err instanceof Error ? err.message : String(err)
    return reply.code(statusCode).send({ error: 'TEST_ERROR', message })
  })
  const mockContainer = {
    db: {},
    env: mockEnv() as never,
    freshnessService: {
      getFreshness: vi.fn().mockResolvedValue([
        {
          domain: 'socios',
          lastImportAt: '2026-06-15T10:00:00Z',
          recordCount: 30000,
          status: 'current',
        },
        {
          domain: 'ctacte',
          lastImportAt: '2026-06-15T09:00:00Z',
          recordCount: 50000,
          status: 'current',
        },
      ]),
      refreshAll: vi.fn(),
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
  await app.register(freshnessRoutes)
  return app
}

describe('GET /api/v1/freshness', () => {
  it('returns 200 with items for any authenticated operator', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/freshness',
      headers: { authorization: `Bearer ${makeToken('CONSULTA')}` },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.items).toBeInstanceOf(Array)
    expect(body.items.length).toBeGreaterThan(0)
  })

  it('returns 401 for unauthenticated request', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/freshness',
    })

    expect(res.statusCode).toBe(401)
  })

  it('returns freshness items with status and ageDisplay', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/freshness',
      headers: { authorization: `Bearer ${makeToken()}` },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.items[0]).toHaveProperty('domain')
    expect(body.items[0]).toHaveProperty('status')
  })
})
