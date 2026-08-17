import { describe, it, expect, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { signAccessToken, authPlugin } from '@athlos/auth'
import { auditRoutes } from './audit.ts'
import { queryAudit } from '@athlos/audit'
import type { AppContainer } from '../container.ts'
import { mockEnv } from '../test-helpers/mock-env.ts'

vi.mock('@athlos/audit', () => ({
  queryAudit: vi.fn(),
}))

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
      listOperatorsWithPermission: vi.fn().mockResolvedValue([]),
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
        listOperatorsWithPermission: vi.fn().mockResolvedValue([]),
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

  const auditItem = (
    action: string,
    metadata: unknown,
    oldValue: unknown = null,
    newValue: unknown = null,
  ) => ({
    id: 'audit-1',
    operatorId: null,
    action,
    entityType: 'job',
    entityId: 'job-1',
    oldValue,
    newValue,
    sourceIp: null,
    metadata,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  })
  const auditPage = (items: unknown[]) =>
    ({ items, total: items.length, page: 1, limit: 100, pages: 1 }) as never
  const auditGet = (app: FastifyInstance) =>
    app.inject({
      method: 'GET',
      url: '/api/v1/audit',
      headers: { authorization: `Bearer ${makeAdminToken()}` },
    })

  it('returns allowlisted dues evidence without arbitrary metadata', async () => {
    const app = await buildApp()
    const actorId = '00000000-0000-4000-8000-000000000001'
    vi.mocked(queryAudit).mockResolvedValueOnce(
      auditPage([
        auditItem('DUES_PERIOD_GENERATED', {
          actorId,
          role: 'ADMIN',
          permissions: ['dues:write'],
          authorizationEvidence: { role: 'ADMIN', permissions: ['dues:write'] },
          callerKey: 'monthly-2026-01',
          requestFingerprint: 'a'.repeat(64),
          time: '2026-01-01T00:00:00.000Z',
          privateNote: 'do-not-return',
        }),
        auditItem('JOB_FAILED', { privateNote: 'do-not-return' }),
        auditItem('DUES_PRICE_CREATED', null),
        auditItem('DUES_PRICE_REVOKED', 'malformed'),
        auditItem('DUES_BENEFIT_APPLIED', { privateNote: 'do-not-return' }),
        ...[
          'DUES_FAMILY_GROUP_CREATED',
          'DUES_FAMILY_MEMBERSHIP_CREATED',
          'DUES_FAMILY_MEMBERSHIP_REVOKED',
        ].map((action) =>
          auditItem(
            action,
            { privateNote: 'do-not-return' },
            { familyGroupId: 'family-secret', socioId: 'socio-secret' },
            { familyGroupId: 'family-secret', socioId: 'socio-secret' },
          ),
        ),
      ]),
    )

    const res = await auditGet(app)

    expect(res.statusCode).toBe(200)
    const item = JSON.parse(res.body).items[0]
    expect(item.dues_evidence).toEqual({
      actor: { id: actorId, role: 'ADMIN', permissions: ['dues:write'] },
      authorization_evidence: { role: 'ADMIN', permissions: ['dues:write'] },
      idempotency: { caller_key: 'monthly-2026-01', request_fingerprint: 'a'.repeat(64) },
      time: '2026-01-01T00:00:00.000Z',
    })
    const items = JSON.parse(res.body).items
    expect(item).not.toHaveProperty('metadata')
    expect(items[1]).toEqual({
      ...auditItem('JOB_FAILED', undefined),
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    expect(items[2].dues_evidence).toBeNull()
    expect(items[3].dues_evidence).toBeNull()
    // prettier-ignore
    expect(items[4]).toMatchObject({ action: 'DUES_BENEFIT_APPLIED', oldValue: null, newValue: null, dues_evidence: null })
    for (const item of items.slice(5)) {
      expect(item).toMatchObject({ oldValue: null, newValue: null, dues_evidence: null })
    }
    expect(res.body).not.toContain('socio-secret')
  })
})
