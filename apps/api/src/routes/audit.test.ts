import { describe, it, expect, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { signAccessToken, authPlugin } from '@athlos/auth'
import { auditRoutes } from './audit.ts'
import { queryAudit } from '@athlos/audit'
import type { AppContainer } from '../container.ts'

vi.mock('@athlos/audit', () => ({
  queryAudit: vi.fn(),
}))

const PLACEHOLDER_SECRET = 'test-secret-please-rotate-32chars-minimum'

const mockEnv = () => ({
  JWT_SECRET: PLACEHOLDER_SECRET,
  JWT_ACCESS_TTL_SECONDS: 900,
})

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
    permissionsRepo: {
      hasPermission: vi.fn().mockResolvedValue(false),
      grant: vi.fn(),
      revoke: vi.fn(),
    },
    ...overrides,
  } as unknown as AppContainer
  app.decorate('container', mockContainer)
  authPlugin(mockEnv)(app, {}, () => {})
  await app.register(auditRoutes)
  return app
}

describe('GET /api/v1/audit', () => {
  it('returns 200 for ADMIN', async () => {
    const app = await buildApp()

    vi.mocked(queryAudit).mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      limit: 100,
      pages: 0,
    })

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/audit',
      headers: { authorization: `Bearer ${makeAdminToken()}` },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.items).toBeInstanceOf(Array)
    expect(body.total).toBe(0)
  })

  it('returns 200 for data_steward', async () => {
    const app = await buildApp({
      permissionsRepo: {
        hasPermission: vi.fn().mockResolvedValue(true),
        grant: vi.fn(),
        revoke: vi.fn(),
      },
    })

    vi.mocked(queryAudit).mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      limit: 100,
      pages: 0,
    })

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/audit',
      headers: { authorization: `Bearer ${makeDataStewardToken()}` },
    })

    expect(res.statusCode).toBe(200)
  })

  it('returns 403 for CONSULTA', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/audit',
      headers: { authorization: `Bearer ${makeConsultaToken()}` },
    })

    expect(res.statusCode).toBe(403)
  })

  it('returns 401 for unauthenticated', async () => {
    const app = await buildApp()

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/audit',
    })

    expect(res.statusCode).toBe(401)
  })

  it('passes pagination params to queryAudit', async () => {
    const app = await buildApp()

    vi.mocked(queryAudit).mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 2,
      limit: 50,
      pages: 0,
    })

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/audit?page=2&limit=50',
      headers: { authorization: `Bearer ${makeAdminToken()}` },
    })

    expect(res.statusCode).toBe(200)
    expect(queryAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ page: 2, limit: 50 }),
    )
  })

  it('passes filter params to queryAudit', async () => {
    const app = await buildApp()

    vi.mocked(queryAudit).mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      limit: 100,
      pages: 0,
    })

    const operatorId = '00000000-0000-4000-8000-000000000099'
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/audit?operator=${operatorId}`,
      headers: { authorization: `Bearer ${makeAdminToken()}` },
    })

    expect(res.statusCode).toBe(200)
    expect(queryAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ operatorId }),
    )
  })
})
