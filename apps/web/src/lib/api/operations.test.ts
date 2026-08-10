import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }))

const { apiFetch } = await import('@/lib/api')
const apiFetchMock = apiFetch as unknown as ReturnType<typeof vi.fn>
const { getOperationalSnapshot } = await import('./operations')

describe('operational snapshot API', () => {
  beforeEach(() => apiFetchMock.mockReset())

  it('requests the bounded ADMIN snapshot endpoint', async () => {
    const snapshot = {
      readiness: { overall: 'ready', db: 'ready', schema: 'ready' },
      freshness: { available: true, items: [] },
      jobs: { available: true, items: [] },
      attention: { available: true, items: [] },
    }
    apiFetchMock.mockResolvedValueOnce(snapshot)

    await expect(getOperationalSnapshot()).resolves.toEqual(snapshot)
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/admin/operations/snapshot')
  })
})
