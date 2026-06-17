import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { signAccessToken, authPlugin } from '@athlos/auth'
import { importRoutes } from './import.ts'
import type { AppContainer } from '../container.ts'
import { mockEnv } from '../test-helpers/mock-env.ts'

function makeAdminToken(sub = '00000000-0000-4000-8000-000000000001'): string {
  return signAccessToken(
    { sub, role: 'ADMIN', permissions: { can_reprint: true, can_anulate: true } },
    mockEnv() as never,
  )
}

function makeConsultaToken(sub = '00000000-0000-4000-8000-000000000002'): string {
  return signAccessToken(
    { sub, role: 'CONSULTA', permissions: { can_reprint: false, can_anulate: false } },
    mockEnv() as never,
  )
}

// Mock scheduler
const mockScheduler = {
  runNow: vi.fn().mockResolvedValue('batch-00001-0000-4000-8000-000000000099'),
  start: vi.fn(),
  stop: vi.fn(),
}

// Mock container
const mockContainer = {
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
  },
  permissionsRepo: {
    hasPermission: vi.fn().mockResolvedValue(false),
    grant: vi.fn(),
    revoke: vi.fn(),
  },
  env: mockEnv() as never,
} as unknown as AppContainer

async function buildApp(overrides?: Partial<AppContainer>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.decorate('container', { ...mockContainer, ...overrides })
  app.decorate('scheduler', mockScheduler as never)
  authPlugin(mockEnv)(app, {}, () => {})
  await app.register(importRoutes)
  return app
}

describe('POST /api/v1/import/trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 202 with batchId for ADMIN', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/import/trigger',
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      payload: { domain: 'all' },
    })

    expect(res.statusCode).toBe(202)
    const body = JSON.parse(res.body)
    expect(body.batchId).toBeDefined()
    expect(body.status).toBe('queued')
    expect(body.estimatedTables).toBe(14)
  })

  it('returns 403 for CONSULTA role', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/import/trigger',
      headers: { authorization: `Bearer ${makeConsultaToken()}` },
      payload: { domain: 'all' },
    })

    expect(res.statusCode).toBe(403)
  })

  it('returns 401 for unauthenticated request', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/import/trigger',
    })

    expect(res.statusCode).toBe(401)
  })
})

describe('DELETE /api/v1/import/trigger/:batchId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 200 when cancelling a queued batch', async () => {
    const app = await buildApp()
    const batchId = '00000000-0000-4000-8000-000000000010'

    // Mock finding the queued job
    vi.mocked(mockContainer.db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          id: batchId,
          jobName: 'scheduled-import',
          status: 'queued',
          triggeredBy: 'manual',
          metadata: {},
          scheduledAt: new Date(),
          startedAt: null,
          finishedAt: null,
          errorMessage: null,
          attempt: 1,
        },
      ]),
    } as never)

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/import/trigger/${batchId}`,
      headers: { authorization: `Bearer ${makeAdminToken()}` },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.status).toBe('cancelled')
  })

  it('returns 409 when cancelling a running batch', async () => {
    const app = await buildApp()
    const batchId = '00000000-0000-4000-8000-000000000011'

    vi.mocked(mockContainer.db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          id: batchId,
          jobName: 'scheduled-import',
          status: 'running',
          triggeredBy: 'manual',
          metadata: {},
          scheduledAt: new Date(),
          startedAt: new Date(),
          finishedAt: null,
          errorMessage: null,
          attempt: 1,
        },
      ]),
    } as never)

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/import/trigger/${batchId}`,
      headers: { authorization: `Bearer ${makeAdminToken()}` },
    })

    expect(res.statusCode).toBe(409)
  })

  it('returns 404 when batch not found', async () => {
    const app = await buildApp()
    const batchId = '00000000-0000-4000-8000-000000000012'

    vi.mocked(mockContainer.db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    } as never)

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/import/trigger/${batchId}`,
      headers: { authorization: `Bearer ${makeAdminToken()}` },
    })

    expect(res.statusCode).toBe(404)
  })

  it('returns 200 (idempotent) when batch is already cancelled', async () => {
    const app = await buildApp()
    const batchId = '00000000-0000-4000-8000-000000000013'

    vi.mocked(mockContainer.db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          id: batchId,
          jobName: 'scheduled-import',
          status: 'cancelled',
          triggeredBy: 'manual',
          metadata: {},
          scheduledAt: new Date(),
          startedAt: null,
          finishedAt: new Date(),
          errorMessage: 'cancelled by admin',
          attempt: 1,
        },
      ]),
    } as never)

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/import/trigger/${batchId}`,
      headers: { authorization: `Bearer ${makeAdminToken()}` },
    })

    expect(res.statusCode).toBe(200)
  })
})

describe('GET /api/v1/import/status', () => {
  it('returns last 20 runs for ADMIN', async () => {
    const app = await buildApp()

    vi.mocked(mockContainer.db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          id: 'batch-1',
          jobName: 'scheduled-import',
          status: 'succeeded',
          triggeredBy: 'scheduler',
          metadata: { imported_tables: 14 },
          scheduledAt: new Date(),
          startedAt: new Date(),
          finishedAt: new Date(),
          attempt: 1,
          errorMessage: null,
        },
      ]),
    } as never)

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/import/status',
      headers: { authorization: `Bearer ${makeAdminToken()}` },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.runs).toBeInstanceOf(Array)
  })

  it('returns 403 for CONSULTA', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/import/status',
      headers: { authorization: `Bearer ${makeConsultaToken()}` },
    })

    expect(res.statusCode).toBe(403)
  })
})
