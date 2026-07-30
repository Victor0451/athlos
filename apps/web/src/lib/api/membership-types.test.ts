import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }))

const { apiFetch } = await import('@/lib/api')
const apiFetchMock = apiFetch as unknown as ReturnType<typeof vi.fn>
const { getMembershipTypeMembers, getMembershipTypes } = await import('./membership-types')

describe('membership types API', () => {
  beforeEach(() => apiFetchMock.mockReset())

  it('gets the catalog using its paginated search contract', async () => {
    apiFetchMock.mockResolvedValueOnce({ items: [] })

    await getMembershipTypes({ page: 2, limit: 20, q: 'adulto' })

    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/admin/membership-types', {
      query: { page: 2, limit: 20, q: 'adulto' },
    })
  })

  it('gets associated members through the type source-row route', async () => {
    apiFetchMock.mockResolvedValueOnce({ items: [] })

    await getMembershipTypeMembers('type-row-id', { page: 1, limit: 20, q: '12' })

    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/v1/admin/membership-types/type-row-id/members',
      {
        query: { page: 1, limit: 20, q: '12' },
      },
    )
  })
})
