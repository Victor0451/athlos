import { beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { authPlugin, signAccessToken } from '@athlos/auth'
import { errorHandler } from '../../plugins/error-handler.ts'
import { mockEnv } from '../../test-helpers/mock-env.ts'
import type { AppContainer } from '../../container.ts'

const mocks = vi.hoisted(() => ({ catalog: vi.fn(), type: vi.fn(), members: vi.fn() }))
vi.mock('../../modules/socios/membership-type-catalog-repository.ts', () => ({
  listMembershipTypeCatalog: mocks.catalog,
  getCurrentMembershipType: mocks.type,
  listAssociatedMembers: mocks.members,
}))
import { membershipTypeRoutes } from './membership-types.ts'

const ids = {
  type: '00000000-0000-4000-8000-000000000010',
  snapshot: '00000000-0000-4000-8000-000000000011',
  admin: '00000000-0000-4000-8000-000000000001',
  steward: '00000000-0000-4000-8000-000000000002',
}
const token = (sub: string, role: 'ADMIN' | 'TESORERO' | 'CONSULTA') =>
  signAccessToken(
    { sub, role, permissions: { can_reprint: false, can_anulate: false } },
    mockEnv() as never,
  )

async function buildApp(steward = false) {
  const app = Fastify({ logger: false })
  app.decorate('container', {
    db: {},
    env: mockEnv(),
    permissionsRepo: { hasPermission: vi.fn().mockResolvedValue(steward) },
  } as unknown as AppContainer)
  await app.register(errorHandler)
  await app.register(authPlugin(mockEnv))
  await app.register(membershipTypeRoutes)
  return app
}

const catalog = {
  state: 'ready' as const,
  snapshotBatchId: ids.snapshot,
  items: [
    {
      sourceRowId: ids.type,
      snapshotBatchId: ids.snapshot,
      code: 'A',
      name: 'Adulto',
      letter: 'A',
      validatedCount: 2,
      resolvedCount: 1,
      distinctMemberCount: 2,
      rawPayload: 'must not leak',
    },
  ],
  total: 3,
  page: 2,
  limit: 1,
}
const type = {
  sourceRowId: ids.type,
  snapshotBatchId: ids.snapshot,
  code: 'A',
  name: 'Adulto',
  letter: 'A',
}
const headers = { authorization: `Bearer ${token(ids.admin, 'ADMIN')}` }
const unavailable = (state: string) => ({ state, items: [], total: 0, page: 1, limit: 20 })

describe('membership type routes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.catalog.mockResolvedValue(catalog)
    mocks.type.mockResolvedValue({ state: 'ready', item: type })
    mocks.members.mockResolvedValue({
      state: 'ready',
      snapshotBatchId: ids.snapshot,
      items: [
        {
          memberId: 'member-1',
          memberNumber: 12,
          credentialRef: 'credential-12',
          lifecycleState: 'validated',
          associationSources: ['resolved', 'validated'],
          dni: 'must not leak',
          rawPayload: 'must not leak',
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    })
  })

  it('allows ADMIN and live data_steward, but rejects ordinary users', async () => {
    const admin = await buildApp()
    const steward = await buildApp(true)
    const ordinary = await buildApp()
    await expect(
      admin.inject({
        method: 'GET',
        url: '/api/v1/admin/membership-types',
        headers: { authorization: `Bearer ${token(ids.admin, 'ADMIN')}` },
      }),
    ).resolves.toMatchObject({ statusCode: 200 })
    await expect(
      steward.inject({
        method: 'GET',
        url: '/api/v1/admin/membership-types',
        headers: { authorization: `Bearer ${token(ids.steward, 'TESORERO')}` },
      }),
    ).resolves.toMatchObject({ statusCode: 200 })
    await expect(
      ordinary.inject({
        method: 'GET',
        url: '/api/v1/admin/membership-types',
        headers: { authorization: `Bearer ${token(ids.steward, 'CONSULTA')}` },
      }),
    ).resolves.toMatchObject({ statusCode: 403 })
  })

  it('validates bounded pagination, sane search, and source-row identifiers', async () => {
    const app = await buildApp()
    for (const url of [
      '/api/v1/admin/membership-types?page=0',
      '/api/v1/admin/membership-types?limit=101',
      '/api/v1/admin/membership-types?q=__',
      '/api/v1/admin/membership-types/not-a-uuid/members',
    ]) {
      await expect(app.inject({ method: 'GET', url, headers })).resolves.toMatchObject({
        statusCode: 400,
      })
    }
    expect(mocks.catalog).not.toHaveBeenCalled()
    expect(mocks.type).not.toHaveBeenCalled()
  })

  it('maps catalog and member pages to safe DTOs with search and pagination', async () => {
    const app = await buildApp()
    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/membership-types?page=2&limit=1&q=adulto',
      headers,
    })
    const members = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/membership-types/${ids.type}/members?q=12`,
      headers,
    })
    expect(listed.json()).toEqual({
      snapshot: { catalog_state: 'applied', snapshot_batch_id: ids.snapshot },
      items: [
        {
          source_row_id: ids.type,
          snapshot_batch_id: ids.snapshot,
          code: 'A',
          name: 'Adulto',
          letter: 'A',
          catalog_state: 'applied',
          validated_count: 2,
          applied_resolution_count: 1,
          member_count: 2,
        },
      ],
      total: 3,
      page: 2,
      limit: 1,
      has_more: true,
    })
    expect(members.json()).toMatchObject({
      membership_type: {
        source_row_id: ids.type,
        snapshot_batch_id: ids.snapshot,
        code: 'A',
        name: 'Adulto',
        letter: 'A',
      },
      items: [
        {
          member_id: 'member-1',
          member_number: 12,
          credential_ref: 'credential-12',
          lifecycle_state: 'validated',
          association_sources: ['resolved', 'validated'],
        },
      ],
    })
    expect(mocks.catalog).toHaveBeenCalledWith(expect.anything(), {
      page: 2,
      limit: 1,
      search: 'adulto',
    })
    expect(mocks.members).toHaveBeenCalledWith(expect.anything(), ids.type, {
      page: 1,
      limit: 20,
      search: '12',
    })
    expect(`${listed.body}${members.body}`).not.toMatch(/rawPayload|dni|reason|fingerprint|fee/i)
  })

  it('returns an empty unavailable contract when a ready catalog or members batch is absent', async () => {
    const app = await buildApp()
    mocks.catalog.mockResolvedValueOnce(unavailable('no_current_catalog'))
    mocks.type.mockResolvedValueOnce({ state: 'no_current_members_batch', item: null })
    mocks.members.mockResolvedValueOnce(unavailable('no_current_members_batch'))
    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/membership-types',
      headers,
    })
    const members = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/membership-types/${ids.type}/members`,
      headers,
    })
    expect(listed.json()).toMatchObject({
      snapshot: { catalog_state: 'unavailable', reason: 'no_current_catalog' },
      items: [],
      has_more: false,
    })
    expect(members.json()).toMatchObject({
      snapshot: { catalog_state: 'unavailable', reason: 'no_current_members_batch' },
      items: [],
      has_more: false,
    })
  })

  it('rejects historical source rows without leaking repository details', async () => {
    const app = await buildApp()
    mocks.type.mockResolvedValue({ state: 'source_row_not_current', item: null })
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/membership-types/${ids.type}/members`,
      headers,
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'CONFLICT' })
    expect(response.body).not.toMatch(/select|legacy_membership|raw/i)
    expect(mocks.members).not.toHaveBeenCalled()
  })
})
