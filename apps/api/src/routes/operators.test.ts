import { beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { signAccessToken, authPlugin } from '@athlos/auth'
import { errorHandler } from '../plugins/error-handler.ts'
import { operatorsRoutes } from './operators.ts'
import type { AppContainer } from '../container.ts'
import { mockEnv } from '../test-helpers/mock-env.ts'

/**
 * Route tests for GET /api/v1/operators.
 *
 * Spec (openspec/changes/athlos-audit-operator-display/specs/
 * operator-lookup/spec.md) pins seven behaviors:
 *
 *   - No JWT → 401
 *   - All ids present, all active → 200 with the wire shape
 *   - 1 nonexistent id → 200 with the unknown silently omitted
 *   - All ids unknown → 200 with `{ operators: [] }` (NOT 404)
 *   - Empty ids → 400 VALIDATION_ERROR
 *   - Non-uuid string → 400 VALIDATION_ERROR
 *   - 201 ids → 400 VALIDATION_ERROR
 *
 * The repository (`listByIds`) is mocked at the module boundary so
 * the route test owns the wire contract without needing the standin.
 * The repository test in modules/operators/lookup.test.ts covers the
 * SQL roundtrip; this file covers the route wiring (auth gate,
 * validation, response shape).
 */

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

const listByIds = vi.fn()

vi.mock('../modules/operators/index.ts', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    listByIds: (...args: unknown[]) => listByIds(...args),
  }
})

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  const mockContainer = {
    db: {},
    env: mockEnv() as never,
    permissionsRepo: {
      hasPermission: vi.fn().mockResolvedValue(false),
      grant: vi.fn(),
      revoke: vi.fn(),
      listOperatorsWithPermission: vi.fn().mockResolvedValue([]),
    },
  } as unknown as AppContainer
  app.decorate('container', mockContainer)
  // Register the error handler so BusinessError(VALIDATION_ERROR)
  // is mapped to the project's standard { error, details } envelope
  // instead of Fastify's default "Bad Request".
  await app.register(errorHandler)
  authPlugin(mockEnv)(app, {}, () => {})
  await app.register(operatorsRoutes)
  return app
}

const ID_A = '00000000-0000-4000-8000-000000000001'
const ID_B = '00000000-0000-4000-8000-000000000002'
const ID_C = '00000000-0000-4000-8000-000000000003'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/v1/operators', () => {
  it('returns 401 without an Authorization header', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/operators?ids=${ID_A}`,
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 200 with the { operators: [...] } shape when all ids resolve', async () => {
    listByIds.mockResolvedValueOnce([
      { id: ID_A, username: 'vlongo', role: 'ADMIN' },
      { id: ID_B, username: 'laura', role: 'TESORERO' },
    ])
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/operators?ids=${ID_A},${ID_B}`,
      headers: { authorization: `Bearer ${makeAdminToken()}` },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.operators).toHaveLength(2)
    expect(body.operators[0]).toEqual({ id: ID_A, username: 'vlongo', role: 'ADMIN' })
    expect(body.operators[1]).toEqual({ id: ID_B, username: 'laura', role: 'TESORERO' })
  })

  it('silently omits ids that have no matching row', async () => {
    const MISSING = '00000000-0000-4000-8000-000000000099'
    listByIds.mockResolvedValueOnce([{ id: ID_A, username: 'vlongo', role: 'ADMIN' }])
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/operators?ids=${ID_A},${MISSING}`,
      headers: { authorization: `Bearer ${makeAdminToken()}` },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.operators).toHaveLength(1)
    expect(body.operators[0]?.id).toBe(ID_A)
  })

  it('returns 200 with { operators: [] } when every id is unknown', async () => {
    listByIds.mockResolvedValueOnce([])
    const app = await buildApp()
    const MISSING_1 = '00000000-0000-4000-8000-000000000097'
    const MISSING_2 = '00000000-0000-4000-8000-000000000098'
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/operators?ids=${MISSING_1},${MISSING_2}`,
      headers: { authorization: `Bearer ${makeAdminToken()}` },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.operators).toEqual([])
  })

  it('returns 200 for a CONSULTA-role operator (no role gate)', async () => {
    listByIds.mockResolvedValueOnce([])
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/operators?ids=${ID_A}`,
      headers: { authorization: `Bearer ${makeConsultaToken()}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('returns 400 VALIDATION_ERROR when ids is empty', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/operators?ids=',
      headers: { authorization: `Bearer ${makeAdminToken()}` },
    })
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error).toBe('VALIDATION_ERROR')
  })

  it('returns 400 VALIDATION_ERROR when a non-uuid is in ids', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/operators?ids=${ID_A},not-a-uuid`,
      headers: { authorization: `Bearer ${makeAdminToken()}` },
    })
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error).toBe('VALIDATION_ERROR')
  })

  it('returns 400 VALIDATION_ERROR when 201 ids are sent', async () => {
    const ids = Array.from(
      { length: 201 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    ).join(',')
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/operators?ids=${ids}`,
      headers: { authorization: `Bearer ${makeAdminToken()}` },
    })
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error).toBe('VALIDATION_ERROR')
  })

  it('forwards the parsed ids array to listByIds', async () => {
    listByIds.mockResolvedValueOnce([])
    const app = await buildApp()
    await app.inject({
      method: 'GET',
      url: `/api/v1/operators?ids=${ID_A},${ID_B},${ID_C}`,
      headers: { authorization: `Bearer ${makeAdminToken()}` },
    })
    expect(listByIds).toHaveBeenCalledWith(expect.anything(), [ID_A, ID_B, ID_C])
  })

  it('returns 200 at the 200-id boundary', async () => {
    listByIds.mockResolvedValueOnce([])
    const ids = Array.from(
      { length: 200 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    ).join(',')
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/operators?ids=${ids}`,
      headers: { authorization: `Bearer ${makeAdminToken()}` },
    })
    expect(res.statusCode).toBe(200)
  })
})
