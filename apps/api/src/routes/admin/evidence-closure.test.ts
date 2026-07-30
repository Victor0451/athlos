import { beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { authPlugin, signAccessToken } from '@athlos/auth'
import { errorHandler } from '../../plugins/error-handler.ts'
import { mockEnv } from '../../test-helpers/mock-env.ts'
import type { AppContainer } from '../../container.ts'

const mocks = vi.hoisted(() => ({ preview: vi.fn(), confirm: vi.fn(), runNow: vi.fn() }))
vi.mock('../../modules/socios/evidence-closure-boundary.ts', () => ({
  createClosurePreview: mocks.preview,
  confirmClosureReservation: mocks.confirm,
}))
import { evidenceClosureRoutes } from './evidence-closure.ts'

const ids = {
  catalog: '00000000-0000-4000-8000-000000000010',
  socios: '00000000-0000-4000-8000-000000000011',
  preview: '00000000-0000-4000-8000-000000000012',
  admin: '00000000-0000-4000-8000-000000000001',
  steward: '00000000-0000-4000-8000-000000000002',
}
const fingerprint = 'a'.repeat(64)
const token = (sub: string, role: 'ADMIN' | 'TESORERO') =>
  signAccessToken(
    { sub, role, permissions: { can_reprint: false, can_anulate: false } },
    mockEnv() as never,
  )
const body = {
  catalogBatchId: ids.catalog,
  sociosBatchId: ids.socios,
  previewId: ids.preview,
  fingerprint,
  resolutionSetFingerprint: fingerprint,
}

async function app(steward = false) {
  const instance = Fastify({ logger: false })
  instance.decorate('container', {
    pool: {},
    env: mockEnv(),
    permissionsRepo: { hasPermission: vi.fn().mockResolvedValue(steward) },
  } as unknown as AppContainer)
  instance.decorate('scheduler', { runNow: mocks.runNow } as never)
  await instance.register(errorHandler)
  await instance.register(authPlugin(mockEnv))
  await instance.register(evidenceClosureRoutes)
  return instance
}

describe('evidence closure routes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.preview.mockResolvedValue({
      previewId: ids.preview,
      fingerprint,
      resolutionSetFingerprint: fingerprint,
      counts: { catalog: 1, socios: 1, resolutions: 1 },
    })
    mocks.runNow.mockResolvedValue({ jobRunId: 'new-run' })
  })

  it('allows only ADMIN preview and confirmation', async () => {
    const admin = await app(),
      steward = await app(true)
    await expect(
      admin.inject({
        method: 'POST',
        url: '/api/v1/admin/socios-evidence-closures/preview',
        headers: { authorization: `Bearer ${token(ids.admin, 'ADMIN')}` },
        payload: body,
      }),
    ).resolves.toMatchObject({ statusCode: 201 })
    await expect(
      steward.inject({
        method: 'POST',
        url: '/api/v1/admin/socios-evidence-closures/confirm',
        headers: {
          authorization: `Bearer ${token(ids.steward, 'TESORERO')}`,
          'idempotency-key': 'key',
        },
        payload: body,
      }),
    ).resolves.toMatchObject({ statusCode: 403 })
  })

  it('schedules only accepted confirmations with a fresh resolution execution identity', async () => {
    const instance = await app()
    const headers = {
      authorization: `Bearer ${token(ids.admin, 'ADMIN')}`,
      'idempotency-key': 'key',
    }
    mocks.confirm.mockResolvedValueOnce({ outcome: 'accepted', fence: 1 })
    const accepted = await instance.inject({
      method: 'POST',
      url: '/api/v1/admin/socios-evidence-closures/confirm',
      headers,
      payload: body,
    })
    expect(accepted.statusCode).toBe(202)
    expect(mocks.runNow).toHaveBeenCalledWith(
      'socios-evidence-runtime-closure',
      expect.objectContaining({
        resolutionApplication: {
          resolutionSetFingerprint: fingerprint,
          executionIdentity: expect.any(String),
        },
      }),
    )
    expect(
      (mocks.runNow.mock.calls[0]![1] as { resolutionApplication: { executionIdentity: string } })
        .resolutionApplication.executionIdentity,
    ).not.toBe('key')
    for (const outcome of ['replay', 'conflict', 'stale', 'held'] as const) {
      mocks.confirm.mockResolvedValueOnce({ outcome })
      const response = await instance.inject({
        method: 'POST',
        url: '/api/v1/admin/socios-evidence-closures/confirm',
        headers: { ...headers, 'idempotency-key': outcome },
        payload: body,
      })
      expect(response.json()).toMatchObject({ status: outcome })
    }
    mocks.confirm.mockResolvedValueOnce({ outcome: 'cancelled' })
    await expect(
      instance.inject({
        method: 'POST',
        url: '/api/v1/admin/socios-evidence-closures/confirm',
        headers: { ...headers, 'idempotency-key': 'cancelled' },
        payload: body,
      }),
    ).resolves.toMatchObject({ statusCode: 499 })
    expect(mocks.runNow).toHaveBeenCalledTimes(1)
  })
})
