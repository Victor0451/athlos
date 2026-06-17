import { describe, it, expect, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { signAccessToken, authPlugin } from '@athlos/auth'
import { lineageRoutes } from './lineage.ts'
import { queryLineage } from '@athlos/lineage'
import type { AppContainer } from '../container.ts'
import { mockEnv } from '../test-helpers/mock-env.ts'

vi.mock('@athlos/lineage', () => ({
  queryLineage: vi.fn(),
}))

function makeToken(
  sub = '00000000-0000-4000-8000-000000000001',
  role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA' = 'ADMIN',
): string {
  return signAccessToken(
    { sub, role, permissions: { can_reprint: true, can_anulate: true } },
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
  // Register authPlugin directly (not via app.register) so decorators/hooks
  // apply to the parent scope — matching the pattern used in middleware.test.ts
  authPlugin(mockEnv)(app, {}, () => {})
  await app.register(lineageRoutes)
  return app
}

describe('GET /api/v1/lineage/:entityId', () => {
  it('returns 200 with lineage for known entity', async () => {
    const app = await buildApp()
    const entityId = '00000000-0000-4000-8000-000000000099'
    const mockLineage = {
      entity_id: entityId,
      source_table: 'socios',
      source_key: 'SOC-001',
      content_hash: 'abc123',
      imported_at: '2026-06-15T10:00:00Z',
      import_batch: 'batch-1',
      audit_event_id: null,
    }

    vi.mocked(queryLineage).mockResolvedValueOnce(mockLineage)

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/lineage/${entityId}`,
      headers: { authorization: `Bearer ${makeToken()}` },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.entity_id).toBe(entityId)
    expect(queryLineage).toHaveBeenCalledWith(expect.anything(), entityId)
  })

  it('returns 404 for unknown entity', async () => {
    const app = await buildApp()
    const entityId = '00000000-0000-4000-8000-000000000099'

    vi.mocked(queryLineage).mockResolvedValueOnce(null)

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/lineage/${entityId}`,
      headers: { authorization: `Bearer ${makeToken()}` },
    })

    expect(res.statusCode).toBe(404)
  })

  it('returns 401 for unauthenticated request', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/lineage/00000000-0000-4000-8000-000000000099',
    })

    expect(res.statusCode).toBe(401)
  })

  it('returns 400 for invalid UUID', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/lineage/not-a-uuid',
      headers: { authorization: `Bearer ${makeToken()}` },
    })

    // The auth preHandler fires first (401 if token invalid or missing),
    // then the Zod validation fires (400 if UUID is invalid).
    // With a valid token, we get 400 for the invalid UUID param.
    expect(res.statusCode).toBe(400)
  })
})
