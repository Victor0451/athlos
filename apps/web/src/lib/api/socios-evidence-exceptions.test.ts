import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }))

const { apiFetch } = await import('@/lib/api')
const apiFetchMock = apiFetch as unknown as ReturnType<typeof vi.fn>
const {
  confirmSociosEvidenceClosure,
  getSociosEvidenceExceptions,
  previewSociosEvidenceClosure,
  resolveSociosEvidenceException,
} = await import('./socios-evidence-exceptions')

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

  it('posts the trusted resolution shape with its idempotency key', async () => {
    const input = {
      kind: 'unknown_type' as const,
      evidence_fingerprint: 'a'.repeat(64),
      reason: 'Verified',
      selected_member_id: 'member-id',
      selected_type_candidate_source_row_id: 'type-id',
    }
    apiFetchMock.mockResolvedValueOnce({ application_status: 'pending_application' })
    await resolveSociosEvidenceException('evidence-id', input, 'attempt-key')
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/v1/admin/socios-evidence-exceptions/evidence-id/resolutions',
      {
        method: 'POST',
        body: input,
        headers: { 'Idempotency-Key': 'attempt-key' },
      },
    )
  })

  it('keeps preview and confirmation payloads resolution-aware', async () => {
    const reference = {
      catalogBatchId: '00000000-0000-4000-8000-000000000010',
      sociosBatchId: '00000000-0000-4000-8000-000000000011',
    }
    const preview = {
      previewId: '00000000-0000-4000-8000-000000000012',
      fingerprint: 'a'.repeat(64),
      resolutionSetFingerprint: 'b'.repeat(64),
    }
    await previewSociosEvidenceClosure(reference)
    await confirmSociosEvidenceClosure({ ...reference, ...preview }, 'confirm-once')
    expect(apiFetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/admin/socios-evidence-closures/preview',
      { method: 'POST', body: reference },
    )
    expect(apiFetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/admin/socios-evidence-closures/confirm',
      {
        method: 'POST',
        body: { ...reference, ...preview },
        headers: { 'Idempotency-Key': 'confirm-once' },
      },
    )
  })
})
