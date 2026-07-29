import { beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { authPlugin, signAccessToken } from '@athlos/auth'
import { BusinessError, ErrorCode } from '@athlos/errors'
import { errorHandler } from '../../plugins/error-handler.ts'
import { mockEnv } from '../../test-helpers/mock-env.ts'
import type { AppContainer } from '../../container.ts'

const mocks = vi.hoisted(() => ({
  repo: {},
  list: vi.fn(),
  detail: vi.fn(),
  resolve: vi.fn(),
}))

vi.mock('../../modules/socios/evidence-exceptions.ts', () => ({
  DrizzleEvidenceExceptionRepository: class {
    constructor() {
      return mocks.repo
    }
  },
  listEvidenceExceptions: mocks.list,
  getEvidenceException: mocks.detail,
  resolveEvidenceException: mocks.resolve,
}))

import { sociosEvidenceExceptionRoutes } from './socios-evidence-exceptions.ts'

const IDS = {
  evidence: '00000000-0000-4000-8000-000000000010',
  member: '00000000-0000-4000-8000-000000000011',
  type: '00000000-0000-4000-8000-000000000012',
  resolution: '00000000-0000-4000-8000-000000000013',
  admin: '00000000-0000-4000-8000-000000000001',
  steward: '00000000-0000-4000-8000-000000000002',
}
const fingerprint = 'a'.repeat(64)
const resolution = {
  id: IDS.resolution,
  evidenceId: IDS.evidence,
  kind: 'unknown_type' as const,
  selectedMemberId: IDS.member,
  selectedTypeCandidateSourceRowId: IDS.type,
  stewardOperatorId: IDS.admin,
  reason: 'Verified against source register',
  idempotencyKey: 'resolution-1',
  evidenceFingerprint: fingerprint,
  supersedesResolutionId: null,
  createdAt: new Date('2026-07-29T12:00:00.000Z'),
}

function token(sub: string, role: 'ADMIN' | 'CONSULTA' | 'TESORERO') {
  return signAccessToken(
    { sub, role, permissions: { can_reprint: false, can_anulate: false } },
    mockEnv() as never,
  )
}

async function buildApp(steward = false): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.decorate('container', {
    db: {},
    env: mockEnv(),
    permissionsRepo: { hasPermission: vi.fn().mockResolvedValue(steward) },
  } as unknown as AppContainer)
  await app.register(errorHandler)
  await app.register(authPlugin(mockEnv))
  await app.register(sociosEvidenceExceptionRoutes)
  return app
}

function body(overrides = {}) {
  return {
    kind: 'unknown_type',
    evidence_fingerprint: fingerprint,
    reason: 'Verified against source register',
    selected_member_id: IDS.member,
    selected_type_candidate_source_row_id: IDS.type,
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.list.mockResolvedValue({ items: [], total: 0 })
  mocks.detail.mockResolvedValue({
    id: IDS.evidence,
    kind: 'unknown_type',
    status: 'unresolved',
    fingerprint,
    legacyTypeCode: 'A',
    createdAt: new Date('2026-07-29T12:00:00.000Z'),
    memberChoices: [],
    typeChoices: [],
    deterministicTypeCandidateSourceRowId: null,
  })
  mocks.resolve.mockResolvedValue(resolution)
})

describe('socios evidence exception routes', () => {
  it('allows ADMIN and data_steward but rejects an ordinary user', async () => {
    const admin = await buildApp()
    const steward = await buildApp(true)
    const ordinary = await buildApp()

    await expect(
      admin.inject({
        method: 'GET',
        url: '/api/v1/admin/socios-evidence-exceptions',
        headers: { authorization: `Bearer ${token(IDS.admin, 'ADMIN')}` },
      }),
    ).resolves.toMatchObject({ statusCode: 200 })
    await expect(
      steward.inject({
        method: 'GET',
        url: '/api/v1/admin/socios-evidence-exceptions',
        headers: { authorization: `Bearer ${token(IDS.steward, 'TESORERO')}` },
      }),
    ).resolves.toMatchObject({ statusCode: 200 })
    await expect(
      ordinary.inject({
        method: 'GET',
        url: '/api/v1/admin/socios-evidence-exceptions',
        headers: { authorization: `Bearer ${token(IDS.member, 'CONSULTA')}` },
      }),
    ).resolves.toMatchObject({ statusCode: 403 })
  })

  it('uses the authenticated operator and declares application pending without a scheduler', async () => {
    const app = await buildApp()
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/socios-evidence-exceptions/${IDS.evidence}/resolutions`,
      headers: {
        authorization: `Bearer ${token(IDS.admin, 'ADMIN')}`,
        'idempotency-key': 'resolution-1',
      },
      payload: body(),
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ application_status: 'pending_application' })
    expect(mocks.resolve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ operatorId: IDS.admin }),
    )
    expect((app as unknown as { scheduler?: unknown }).scheduler).toBeUndefined()

    const replay = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/socios-evidence-exceptions/${IDS.evidence}/resolutions`,
      headers: {
        authorization: `Bearer ${token(IDS.admin, 'ADMIN')}`,
        'idempotency-key': 'resolution-1',
      },
      payload: body(),
    })
    expect(replay.statusCode).toBe(201)
    expect(replay.json()).toMatchObject({ id: IDS.resolution })
  })

  it('validates pagination, immutable request fields, reason, and idempotency key', async () => {
    const app = await buildApp()
    const auth = { authorization: `Bearer ${token(IDS.admin, 'ADMIN')}` }
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/socios-evidence-exceptions?limit=101',
      headers: auth,
    })
    const invalid = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/socios-evidence-exceptions/${IDS.evidence}/resolutions`,
      headers: auth,
      payload: body({ reason: ' ', steward_operator_id: IDS.steward }),
    })
    const missingKey = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/socios-evidence-exceptions/${IDS.evidence}/resolutions`,
      headers: auth,
      payload: body(),
    })

    expect(list.statusCode).toBe(400)
    expect(invalid.statusCode).toBe(400)
    expect(missingKey.statusCode).toBe(400)
    expect(mocks.resolve).not.toHaveBeenCalled()
  })

  it('maps typed not-found and idempotency conflicts without leaking internals', async () => {
    const app = await buildApp()
    const auth = {
      authorization: `Bearer ${token(IDS.admin, 'ADMIN')}`,
      'idempotency-key': 'used-key',
    }
    mocks.detail.mockRejectedValueOnce(
      BusinessError(ErrorCode.NOT_FOUND, 'Evidence exception not found'),
    )
    mocks.resolve.mockRejectedValueOnce(
      BusinessError(ErrorCode.CONFLICT, 'Idempotency key was already used'),
    )

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/socios-evidence-exceptions/${IDS.evidence}`,
      headers: auth,
    })
    const conflict = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/socios-evidence-exceptions/${IDS.evidence}/resolutions`,
      headers: auth,
      payload: body(),
    })

    expect(detail.statusCode).toBe(404)
    expect(detail.json().error).toBe('NOT_FOUND')
    expect(conflict.statusCode).toBe(409)
    expect(conflict.json().error).toBe('CONFLICT')
    expect(conflict.body).not.toContain('SELECT')
  })
})
