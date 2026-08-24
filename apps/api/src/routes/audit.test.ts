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
        auditItem(
          'DUES_SETTLEMENT_CREATED',
          {
            actorId,
            role: 'ADMIN',
            permissions: ['dues:write'],
            authorizationEvidence: { role: 'ADMIN', permissions: ['dues:write'] },
            callerKey: 'settlement-1',
            requestFingerprint: 'b'.repeat(64),
            time: '2026-01-01T00:00:00.000Z',
            evidence: { private: 'do-not-return' },
          },
          null,
          {
            settlementId: 'settlement-1',
            amountCents: 1000,
            currency: 'ARS',
            raw: 'do-not-return',
          },
        ),
        auditItem(
          'DUES_ALLOCATION_COMPENSATED',
          {
            actorId,
            role: 'ADMIN',
            permissions: ['dues:write'],
            authorizationEvidence: { role: 'ADMIN', permissions: ['dues:write'] },
            callerKey: 'reversal-1',
            requestFingerprint: 'c'.repeat(64),
            time: '2026-01-01T00:00:00.000Z',
            reason: 'Wrong obligation',
            rawEvidence: 'do-not-return',
          },
          null,
          {
            allocationId: 'allocation-1',
            compensatesAllocationId: 'allocation-0',
            amountCents: 1000,
            reason: 'Wrong obligation',
            raw: 'do-not-return',
          },
        ),
        auditItem(
          'DUES_SETTLEMENT_REVERSED',
          {
            actorId,
            role: 'ADMIN',
            permissions: ['dues:write'],
            authorizationEvidence: { role: 'ADMIN', permissions: ['dues:write'] },
            callerKey: 'reversal-2',
            requestFingerprint: 'd'.repeat(64),
            time: '2026-01-01T00:00:00.000Z',
            reason: 'Wrong obligation',
          },
          { settlementId: 'settlement-1' },
          { settlementId: 'reversal-1', amountCents: 1000, currency: 'ARS' },
        ),
        auditItem(
          'DUES_ALLOCATION_CREATED',
          {
            actorId,
            role: 'ADMIN',
            permissions: ['dues:write'],
            authorizationEvidence: { role: 'ADMIN', permissions: ['dues:write'] },
            callerKey: 'settlement-2',
            requestFingerprint: 'e'.repeat(64),
            time: '2026-01-01T00:00:00.000Z',
          },
          null,
          { allocationId: 'allocation-2', obligationId: 'obligation-1', amountCents: 1000 },
        ),
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
    for (const item of items.slice(9)) {
      expect(item).toMatchObject({ oldValue: null, newValue: null, dues_evidence: null })
    }
    expect(items[5]).toMatchObject({
      action: 'DUES_SETTLEMENT_CREATED',
      newValue: { settlement_id: 'settlement-1', amount_cents: 1000, currency: 'ARS' },
    })
    expect(items[5]).not.toHaveProperty('metadata')
    expect(items[5]).not.toHaveProperty('evidence')
    expect(items[6]).toMatchObject({
      action: 'DUES_ALLOCATION_COMPENSATED',
      newValue: {
        allocation_id: 'allocation-1',
        compensates_allocation_id: 'allocation-0',
        amount_cents: 1000,
      },
      dues_reason: 'Wrong obligation',
    })
    expect(items[7]).toMatchObject({
      action: 'DUES_SETTLEMENT_REVERSED',
      dues_reason: 'Wrong obligation',
    })
    expect(items[8]).toMatchObject({
      action: 'DUES_ALLOCATION_CREATED',
      newValue: { allocation_id: 'allocation-2' },
    })
    expect(JSON.stringify(items[6])).not.toContain('rawEvidence')
    expect(res.body).not.toContain('socio-secret')
  })

  it('redacts agreement and community-work audit values while retaining safe evidence', async () => {
    const app = await buildApp()
    const actorId = '00000000-0000-0000-0000-000000000001'
    const metadata = {
      actorId,
      role: 'ADMIN',
      permissions: ['dues:agreements'],
      authorizationEvidence: { role: 'ADMIN', permissions: ['dues:agreements'] },
      callerKey: 'agreement-1',
      requestFingerprint: 'f'.repeat(64),
      time: '2026-08-18T00:00:00.000Z',
      reason: 'Approved plan',
      privateEvidence: 'must-not-leak',
    }
    vi.mocked(queryAudit).mockResolvedValueOnce(
      auditPage([
        auditItem(
          'DUES_AGREEMENT_CREATED',
          metadata,
          { terms: { amountCents: 1000 } },
          { terms: { amountCents: 1000 } },
        ),
        auditItem(
          'DUES_AGREEMENT_REVISED',
          metadata,
          { obligationId: 'obligation-1' },
          { obligationId: 'obligation-1' },
        ),
        auditItem(
          'DUES_COMMUNITY_WORK_CREATED',
          metadata,
          { evidence: { private: 'secret' } },
          { evidence: { private: 'secret' } },
        ),
      ]),
    )

    const response = await auditGet(app)
    expect(response.statusCode).toBe(200)
    const items = JSON.parse(response.body).items
    expect(items).toHaveLength(3)
    for (const item of items) {
      expect(item).toMatchObject({ oldValue: null, newValue: null, dues_reason: 'Approved plan' })
      expect(item.dues_evidence).toMatchObject({ actor: { id: actorId, role: 'ADMIN' } })
      expect(item).not.toHaveProperty('metadata')
    }
    expect(response.body).not.toContain('must-not-leak')
    expect(response.body).not.toContain('secret')
  })

  it('projects cash audit actions with safe totals and no authorization internals', async () => {
    const app = await buildApp()
    vi.mocked(queryAudit).mockResolvedValueOnce(
      auditPage([
        auditItem(
          'DUES_CASH_SHIFT_CLOSED',
          {
            actorId: '00000000-0000-4000-8000-000000000001',
            role: 'TESORERO',
            permissions: ['treasury:close'],
            authorizationEvidence: { role: 'TESORERO', permissions: ['treasury:close'] },
            callerKey: 'close-1',
            requestFingerprint: 'a'.repeat(64),
            time: '2026-08-19T10:00:00.000Z',
            expected: { CASH: 100 },
            counted: { CASH: 90 },
            discrepancy: { CASH: -10 },
            authorizationSecret: 'must-not-return',
          },
          null,
          { expected: { CASH: 100 }, counted: { CASH: 90 }, discrepancy: { CASH: -10 } },
        ),
      ]),
    )
    const response = await auditGet(app)
    expect(response.statusCode).toBe(200)
    const item = JSON.parse(response.body).items[0]
    expect(item.action).toBe('DUES_CASH_SHIFT_CLOSED')
    expect(item.dues_evidence.idempotency.caller_key).toBe('close-1')
    expect(item.newValue).toBeNull()
    expect(item.cash_evidence).toEqual({
      discrepancy: { CASH: -10 },
      counted: { CASH: 90 },
      expected: { CASH: 100 },
    })
    expect(response.body).not.toContain('authorizationSecret')
  })

  it('projects only allowlisted compensation relationships and reason', async () => {
    const app = await buildApp()
    vi.mocked(queryAudit).mockResolvedValueOnce(
      auditPage([
        auditItem('DUES_CASH_EXPENSE_COMPENSATED', {
          actorId: '00000000-0000-4000-8000-000000000001',
          role: 'ADMIN',
          permissions: ['treasury:write'],
          authorizationEvidence: { role: 'ADMIN', permissions: ['treasury:write'] },
          callerKey: 'comp-1',
          requestFingerprint: 'b'.repeat(64),
          time: '2026-08-19T10:00:00.000Z',
          originalGastoId: '00000000-0000-4000-8000-000000000010',
          compensatingGastoId: '00000000-0000-4000-8000-000000000011',
          reason: 'Corrected closed-period expense',
          rawMetadata: 'must-not-return',
        }),
      ]),
    )
    const response = await auditGet(app)
    const item = JSON.parse(response.body).items[0]
    expect(item.cash_evidence).toEqual({
      original_gasto_id: '00000000-0000-4000-8000-000000000010',
      compensating_gasto_id: '00000000-0000-4000-8000-000000000011',
      reason: 'Corrected closed-period expense',
    })
    expect(response.body).not.toContain('rawMetadata')
  })
})

describe('dues agreement audit projection (1C)', () => {
  const auditItem = (
    action: string,
    metadata: unknown,
    oldValue: unknown = null,
    newValue: unknown = null,
  ) => ({
    id: 'audit-agreement-1',
    operatorId: null,
    action,
    entityType: 'dues_agreement',
    entityId: 'agreement-2',
    oldValue,
    newValue,
    sourceIp: null,
    metadata,
    createdAt: new Date('2026-08-19T00:00:00.000Z'),
  })
  const auditPage = (items: unknown[]) =>
    ({ items, total: items.length, page: 1, limit: 100, pages: 1 }) as never
  const auditGet = (app: FastifyInstance) =>
    app.inject({
      method: 'GET',
      url: '/api/v1/audit',
      headers: { authorization: `Bearer ${makeAdminToken()}` },
    })

  it('projects complete dues evidence for authorized callers while redacting agreement narrative and lineage internals', async () => {
    const app = await buildApp()
    const actorId = '00000000-0000-4000-8000-000000000001'
    const metadata = {
      actorId,
      role: 'TESORERO',
      permissions: ['dues:agreements'],
      authorizationEvidence: { role: 'TESORERO', permissions: ['dues:agreements'] },
      callerKey: 'revision-1',
      requestFingerprint: '9'.repeat(64),
      time: '2026-08-19T00:00:00.000Z',
      reason: 'Renegociación acordada',
      predecessorAgreementId: 'agreement-1',
      successorAgreementId: 'agreement-2',
      revisionReason: 'Renegociación acordada',
      secretMetadata: 'must-not-leak',
    }
    vi.mocked(queryAudit).mockResolvedValueOnce(
      auditPage([
        auditItem(
          'DUES_AGREEMENT_REVISED',
          metadata,
          {
            id: 'agreement-1',
            kind: 'NEGOTIATED',
            termsVersion: 1,
            terms: { narrative: 'Narrativa sensible del acuerdo original' },
            status: 'SUPERSEDED',
            revisionNumber: 1,
          },
          {
            id: 'agreement-2',
            obligationId: 'obligation-1',
            kind: 'NEGOTIATED',
            termsVersion: 1,
            terms: { narrative: 'Narrativa sensible del acuerdo vigente' },
            status: 'ACTIVE',
            revisionNumber: 2,
            reason: 'Renegociación acordada',
          },
        ),
      ]),
    )

    const response = await auditGet(app)
    expect(response.statusCode).toBe(200)
    const item = JSON.parse(response.body).items[0]
    expect(item).toMatchObject({
      action: 'DUES_AGREEMENT_REVISED',
      oldValue: null,
      newValue: null,
      dues_reason: 'Renegociación acordada',
    })
    expect(item.dues_evidence).toEqual({
      actor: { id: actorId, role: 'TESORERO', permissions: ['dues:agreements'] },
      authorization_evidence: { role: 'TESORERO', permissions: ['dues:agreements'] },
      idempotency: { caller_key: 'revision-1', request_fingerprint: '9'.repeat(64) },
      time: '2026-08-19T00:00:00.000Z',
    })
    expect(item).not.toHaveProperty('metadata')
    expect(response.body).not.toContain('Narrativa sensible')
    expect(response.body).not.toContain('must-not-leak')
    expect(response.body).not.toContain('predecessorAgreementId')
  })

  it('denies the audit trail to roles without steward authority', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/audit',
      headers: { authorization: `Bearer ${makeConsultaToken()}` },
    })
    expect(res.statusCode).toBe(403)
  })
})
