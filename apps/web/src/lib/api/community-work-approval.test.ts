import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetchMock = vi.fn()
vi.mock('@/lib/api', () => ({
  apiFetch: apiFetchMock,
  ApiError: class ApiError extends Error {
    constructor(readonly status: number) {
      super('API failure')
    }
  },
}))

const {
  CommunityWorkOperationError,
  createCommunityWorkRequest,
  decideCommunityWorkRequest,
  executeCommunityWorkRequest,
  listCommunityWorkLifecycle,
} = await import('./community-work-approval')

const uuids = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
  '00000000-0000-4000-8000-000000000005',
  '00000000-0000-4000-8000-000000000006',
  '00000000-0000-4000-8000-000000000007',
  '00000000-0000-4000-8000-000000000008',
  '00000000-0000-4000-8000-000000000009',
  '00000000-0000-4000-8000-00000000000a',
]
const requestInput = () => ({
  member_id: uuids[0]!,
  obligation_id: uuids[1]!,
  context: 'Debt review',
  reason: 'Community work plan',
  evidence: 'Minutes 12',
})
const requestDto = () => ({
  id: uuids[2]!,
  status: 'pending',
  expires_at: '2026-09-01T00:00:00.000Z',
  decided_at: null,
})
const lifecycleDto = () => ({
  id: uuids[2]!,
  state: 'pending',
  expires_at: '2026-09-01T00:00:00.000Z',
  decided_at: null,
  execution_id: null,
  execution_status: 'unavailable',
  snapshot: {
    member_id: uuids[0]!,
    obligations: [
      {
        obligation_id: uuids[1]!,
        currency: 'ARS',
        outstanding_amount_cents: 1000,
      },
    ],
  },
})
const executionDto = () => ({
  execution_id: uuids[3]!,
  approval_id: uuids[4]!,
  request_id: uuids[2]!,
  work_id: uuids[5]!,
  settlement_id: uuids[6]!,
  allocation_id: uuids[7]!,
  socio_id: uuids[0]!,
  obligation_id: uuids[1]!,
  amount_cents: 1000,
  currency: 'ARS',
  status: 'executed',
})

describe('community-work approval client', () => {
  beforeEach(() => apiFetchMock.mockReset())

  it('creates a request with the idempotency key header and decodes the response', async () => {
    apiFetchMock.mockResolvedValue(requestDto())
    const result = await createCommunityWorkRequest(requestInput(), 'cw-create-1')
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/community-work-requests', {
      method: 'POST',
      headers: { 'idempotency-key': 'cw-create-1' },
      body: {
        member_id: uuids[0]!,
        obligation_id: uuids[1]!,
        context: 'Debt review',
        reason: 'Community work plan',
        evidence: 'Minutes 12',
      },
    })
    expect(result).toEqual({
      id: uuids[2]!,
      status: 'pending',
      expires_at: '2026-09-01T00:00:00.000Z',
      decided_at: null,
    })
  })

  it('passes the optional agreement context through when provided', async () => {
    apiFetchMock.mockResolvedValue(requestDto())
    await createCommunityWorkRequest({ ...requestInput(), agreement_id: uuids[8]! }, 'cw-create-2')
    const call = apiFetchMock.mock.calls[0]![1] as { body: Record<string, unknown> }
    expect(call.body.agreement_id).toBe(uuids[8]!)
  })

  it.each([
    [
      'missing idempotency key',
      () => createCommunityWorkRequest(requestInput(), ''),
      'partial_data',
    ],
    [
      'invalid member id',
      () => createCommunityWorkRequest({ ...requestInput(), member_id: 'nope' }, 'k'),
      'partial_data',
    ],
    [
      'missing reason',
      () => createCommunityWorkRequest({ ...requestInput(), reason: '   ' }, 'k'),
      'partial_data',
    ],
    [
      'invalid agreement id',
      () => createCommunityWorkRequest({ ...requestInput(), agreement_id: 'nope' }, 'k'),
      'partial_data',
    ],
  ])('rejects %s without fetching', async (_name, run, kind) => {
    await expect(run()).rejects.toMatchObject({ kind })
    expect(apiFetchMock).not.toHaveBeenCalled()
  })

  it('maps authorization failures to the permission kind', async () => {
    const { ApiError } = await import('@/lib/api')
    apiFetchMock.mockRejectedValueOnce(new ApiError(403, 'INSUFFICIENT_PERMISSIONS', 'Forbidden'))
    const failure = await createCommunityWorkRequest(requestInput(), 'k').catch(
      (error: unknown) => error,
    )
    expect((failure as InstanceType<typeof CommunityWorkOperationError>).kind).toBe('permission')
  })

  it('maps conflicts to the conflict kind', async () => {
    const { ApiError } = await import('@/lib/api')
    apiFetchMock.mockRejectedValueOnce(new ApiError(409, 'CONFLICT', 'Conflict'))
    const failure = await createCommunityWorkRequest(requestInput(), 'k').catch(
      (error: unknown) => error,
    )
    expect((failure as InstanceType<typeof CommunityWorkOperationError>).kind).toBe('conflict')
  })

  it('maps other api and unknown failures to the unavailable kind', async () => {
    const { ApiError } = await import('@/lib/api')
    apiFetchMock.mockRejectedValueOnce(new ApiError(404, 'NOT_FOUND', 'Missing'))
    const apiFailure = await createCommunityWorkRequest(requestInput(), 'k').catch(
      (error: unknown) => error,
    )
    expect((apiFailure as InstanceType<typeof CommunityWorkOperationError>).kind).toBe(
      'unavailable',
    )
    apiFetchMock.mockRejectedValueOnce(new Error('network'))
    const unknownFailure = await createCommunityWorkRequest(requestInput(), 'k').catch(
      (error: unknown) => error,
    )
    expect(unknownFailure).toBeInstanceOf(CommunityWorkOperationError)
    expect((unknownFailure as InstanceType<typeof CommunityWorkOperationError>).kind).toBe(
      'unavailable',
    )
  })

  it('decides a request with the exact body and decodes the decision', async () => {
    apiFetchMock.mockResolvedValue({ ...requestDto(), status: 'approved' })
    const result = await decideCommunityWorkRequest(
      uuids[2]!,
      { decision: 'approved', reason: 'Plan accepted', evidence: 'treasury-9' },
      'cw-decide-1',
    )
    expect(apiFetchMock).toHaveBeenCalledWith(
      `/api/v1/community-work-requests/${uuids[2]!}/decision`,
      {
        method: 'POST',
        headers: { 'idempotency-key': 'cw-decide-1' },
        body: { decision: 'approved', reason: 'Plan accepted', evidence: 'treasury-9' },
      },
    )
    expect(result.status).toBe('approved')
  })

  it('executes with the server-generated execution identity and decodes the receipt', async () => {
    apiFetchMock.mockResolvedValue(executionDto())
    const result = await executeCommunityWorkRequest(uuids[2]!, uuids[3]!, 'cw-exec-1')
    expect(apiFetchMock).toHaveBeenCalledWith(
      `/api/v1/community-work-requests/${uuids[2]!}/execution`,
      {
        method: 'POST',
        headers: { 'idempotency-key': 'cw-exec-1' },
        body: { execution_id: uuids[3]! },
      },
    )
    expect(result).toMatchObject({
      execution_id: uuids[3]!,
      request_id: uuids[2]!,
      work_id: uuids[5]!,
      settlement_id: uuids[6]!,
      allocation_id: uuids[7]!,
      status: 'executed',
    })
  })

  it('rejects execution inputs that are not uuids without fetching', async () => {
    await expect(executeCommunityWorkRequest('nope', uuids[3]!, 'k')).rejects.toMatchObject({
      kind: 'partial_data',
    })
    await expect(executeCommunityWorkRequest(uuids[2]!, 'nope', 'k')).rejects.toMatchObject({
      kind: 'partial_data',
    })
    expect(apiFetchMock).not.toHaveBeenCalled()
  })

  it('reads the member lifecycle and decodes every item strictly', async () => {
    apiFetchMock.mockResolvedValue({ items: [lifecycleDto()] })
    const page = await listCommunityWorkLifecycle(uuids[0]!)
    expect(apiFetchMock).toHaveBeenCalledWith(
      `/api/v1/members/${uuids[0]!}/community-work-requests?limit=25`,
    )
    expect(page.items).toHaveLength(1)
    expect(page.items[0]!).toMatchObject({
      id: uuids[2]!,
      state: 'pending',
      snapshot: { member_id: uuids[0]!, obligations: [{ obligation_id: uuids[1]! }] },
    })
  })

  it('rejects the whole lifecycle page when one item is malformed', async () => {
    apiFetchMock.mockResolvedValue({
      items: [lifecycleDto(), { ...lifecycleDto(), id: 'broken', state: 'weird' }],
    })
    await expect(listCommunityWorkLifecycle(uuids[0]!)).rejects.toMatchObject({
      kind: 'partial_data',
    })
  })

  it('maps lifecycle authorization failures to the permission kind', async () => {
    const { ApiError } = await import('@/lib/api')
    apiFetchMock.mockRejectedValueOnce(new ApiError(403, 'INSUFFICIENT_PERMISSIONS', 'Forbidden'))
    const failure = await listCommunityWorkLifecycle(uuids[0]!).catch((error: unknown) => error)
    expect((failure as InstanceType<typeof CommunityWorkOperationError>).kind).toBe('permission')
  })

  it('wraps unknown lifecycle failures as unavailable', async () => {
    apiFetchMock.mockRejectedValueOnce(new Error('network'))
    await expect(listCommunityWorkLifecycle(uuids[0]!)).rejects.toMatchObject({
      kind: 'unavailable',
    })
  })
})
