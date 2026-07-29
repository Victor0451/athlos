import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }))

const { apiFetch } = await import('@/lib/api')
const apiFetchMock = apiFetch as unknown as ReturnType<typeof vi.fn>
const { getSociosEvidenceException, getSociosEvidenceExceptions } =
  await import('./socios-evidence-exceptions')

describe('socios evidence exceptions API', () => {
  beforeEach(() => apiFetchMock.mockReset())

  it('gets the paginated inbox with supported filters', async () => {
    apiFetchMock.mockResolvedValueOnce({ items: [], total: 0, page: 1, limit: 20, has_more: false })
    await getSociosEvidenceExceptions({
      page: 1,
      limit: 20,
      kind: 'unknown_type',
      status: 'unresolved',
    })
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/admin/socios-evidence-exceptions', {
      query: { page: 1, limit: 20, kind: 'unknown_type', status: 'unresolved' },
    })
  })

  it('gets one exception detail', async () => {
    apiFetchMock.mockResolvedValueOnce({ id: 'evidence-id' })
    await getSociosEvidenceException('evidence-id')
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/v1/admin/socios-evidence-exceptions/evidence-id',
    )
  })
})
