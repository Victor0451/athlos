/**
 * promote.test.ts — Admin promotion trigger endpoint tests.
 *
 * Tests POST /api/v1/promote/trigger and GET /api/v1/promote/status.
 * Uses mock container pattern (no real DB write — mirrors import.test.ts).
 *
 * E1b2a LESSON: real DB tests were broken by TRUNCATE bug.
 * verify-slice.sh is the REAL gate for idempotency.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { signAccessToken, authPlugin } from '@athlos/auth'
import { promoteRoutes } from './promote.ts'
import type { AppContainer } from '../container.ts'
import { mockEnv } from '../test-helpers/mock-env.ts'

// Mock @athlos/audit — provides emitAudit so the route handler doesn't call
// the real function with mock db (would throw). All @athlos/audit exports
// are mocked to avoid breaking other tests that import from @athlos/audit.
vi.mock('@athlos/audit', () => ({
  emitAudit: vi.fn().mockResolvedValue({ inserted: true, id: 'audit-001' }),
  queryAudit: vi.fn(),
  auditPlugin: vi.fn(),
}))

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

// Mock container — db chain returns empty arrays for status queries
const mockEmitAudit = vi.fn().mockResolvedValue({ inserted: true, id: 'audit-001' })

const mockContainer = {
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
  },
  promotionInFlight: false,
  emitAudit: mockEmitAudit,
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
  authPlugin(mockEnv)(app, {}, () => {})
  await app.register(promoteRoutes)
  return app
}

describe('POST /api/v1/promote/trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('T1: returns 200 with PromotionResult[] for ADMIN', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/promote/trigger',
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      payload: {},
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.status).toBe('completed')
    expect(body.inserted).toBeDefined()
    expect(body.skipped).toBeDefined()
    expect(body.failed).toBeDefined()
    expect(body.durationMs).toBeDefined()
    expect(body.domains).toBeInstanceOf(Array)
    expect(body.domains.length).toBeGreaterThan(0)
  })

  it('T2: returns 403 for CONSULTA role', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/promote/trigger',
      headers: { authorization: `Bearer ${makeConsultaToken()}` },
      payload: {},
    })

    expect(res.statusCode).toBe(403)
  })

  it('T3: returns 401 for unauthenticated request', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/promote/trigger',
    })

    expect(res.statusCode).toBe(401)
  })

  // T4: Rate-limit test — skipped in unit tests (requires @fastify/rate-limit
  // plugin + custom keyGenerator to be fully wired in test Fastify instance).
  // Rate-limit behavior is verified at the integration/API level.
  it.skip('T4: returns 429 when rate-limited (per-operator) — integration only', async () => {
    const app = await buildApp()
    // First request should succeed
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/v1/promote/trigger',
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      payload: {},
    })
    expect(res1.statusCode).toBe(200)

    // Second request within 1 minute should be rate-limited
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/v1/promote/trigger',
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      payload: {},
    })
    expect(res2.statusCode).toBe(429)
    expect(res2.headers['retry-after']).toBeDefined()
  })

  it('T5: returns 200 with already_running when promotionInFlight=true', async () => {
    const app = await buildApp({ promotionInFlight: true })
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/promote/trigger',
      headers: { authorization: `Bearer ${makeAdminToken()}` },
      payload: {},
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.status).toBe('already_running')
  })
})

describe('GET /api/v1/promote/status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('T6: returns 200 with last 20 promotion runs for ADMIN', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/promote/status',
      headers: { authorization: `Bearer ${makeAdminToken()}` },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.runs).toBeInstanceOf(Array)
  })

  it('T6b: returns 403 for CONSULTA on GET /status', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/promote/status',
      headers: { authorization: `Bearer ${makeConsultaToken()}` },
    })

    expect(res.statusCode).toBe(403)
  })

  it('T6c: returns 401 for unauthenticated GET /status', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/promote/status',
    })

    expect(res.statusCode).toBe(401)
  })
})
