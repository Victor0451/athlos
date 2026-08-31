import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetchMock = vi.fn()
vi.mock('@/lib/api', () => ({ apiFetch: apiFetchMock, ApiError: class ApiError extends Error {} }))

const { createCondonationRequest, decideCondonationRequest, listCondonationLifecycle } =
  await import('./condonation')

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

  it('strictly decodes persisted lifecycle states and rejects unsafe fields', async () => {
    apiFetchMock.mockResolvedValueOnce({
      items: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          state: 'executed',
          expires_at: '2026-09-01T00:00:00.000Z',
          decided_at: '2026-08-27T00:00:00.000Z',
          used_at: '2026-08-27T01:00:00.000Z',
          execution_id: '00000000-0000-4000-8000-000000000002',
          execution_status: 'executed',
          snapshot: {
            member_id: '00000000-0000-4000-8000-000000000003',
            obligations: [
              {
                obligation_id: '00000000-0000-4000-8000-000000000004',
                currency: 'ARS',
                outstanding_amount_cents: 12500,
              },
            ],
          },
          requester: { operator_id: '00000000-0000-4000-8000-000000000005' },
          approver: { operator_id: '00000000-0000-4000-8000-000000000006' },
          reason: 'Hardship',
          evidence: 'case-1',
          decision: { reason: 'Approved', evidence: 'minutes-1' },
        },
      ],
    })
    await expect(
      listCondonationLifecycle('00000000-0000-4000-8000-000000000003'),
    ).resolves.toMatchObject({ items: [{ state: 'executed' }] })
    apiFetchMock.mockResolvedValueOnce({ items: [{ id: 'bad' }] })
    await expect(
      listCondonationLifecycle('00000000-0000-4000-8000-000000000003'),
    ).rejects.toMatchObject({ kind: 'partial_data' })
  })
})
