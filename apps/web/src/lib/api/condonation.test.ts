import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetchMock = vi.fn()
vi.mock('@/lib/api', () => ({ apiFetch: apiFetchMock, ApiError: class ApiError extends Error {} }))

const { createCondonationRequest, decideCondonationRequest } = await import('./condonation')

describe('condonation client', () => {
  beforeEach(() => apiFetchMock.mockReset())

  // prettier-ignore
  it('posts authenticated request and decision contracts with caller-owned idempotency keys', async () => {
    apiFetchMock
      .mockResolvedValueOnce({ id: 'request-1', status: 'pending', expires_at: '2026-09-01', decided_at: null })
      .mockResolvedValueOnce({ id: 'request-1', status: 'approved', expires_at: '2026-09-01', decided_at: '2026-08-27' })
    await expect(createCondonationRequest({ member_id: 'member-1', obligation_ids: ['b', 'a'], context: 'Debt review', reason: 'Hardship', evidence: 'Minutes 12' }, 'request-key')).resolves.toMatchObject({ status: 'pending' })
    await expect(decideCondonationRequest('request-1', { decision: 'approved', reason: 'Verified', evidence: 'Minutes 13' }, 'decision-key')).resolves.toMatchObject({ status: 'approved' })
    expect(apiFetchMock).toHaveBeenNthCalledWith(1, '/api/v1/condonation-requests', { method: 'POST', headers: { 'idempotency-key': 'request-key' }, body: expect.objectContaining({ obligation_ids: ['a', 'b'] }) })
    expect(apiFetchMock).toHaveBeenNthCalledWith(2, '/api/v1/condonation-requests/request-1/decision', { method: 'POST', headers: { 'idempotency-key': 'decision-key' }, body: { decision: 'approved', reason: 'Verified', evidence: 'Minutes 13' } })
  })

  // prettier-ignore
  it('fails closed when a successful response is malformed', async () => {
    apiFetchMock.mockResolvedValue({ id: 'request-1', status: 'forgiven' })
    await expect(createCondonationRequest({ member_id: 'member-1', obligation_ids: ['a'], context: 'Debt review', reason: 'Hardship', evidence: 'Minutes 12' }, 'request-key')).rejects.toMatchObject({ kind: 'partial_data' })
  })
})
