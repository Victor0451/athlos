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
  CondonationOperationError,
  createCondonationRequest,
  decideCondonationRequest,
  executeCondonationRequest,
  listCondonationLifecycle,
  listCondonationQueue,
} = await import('./condonation')

describe('condonation client', () => {
  beforeEach(() => apiFetchMock.mockReset())

  const queueItem = () => ({
    id: '00000000-0000-4000-8000-000000000001',
    state: 'pending',
    created_at: '2026-08-27T00:00:00.000Z',
    expires_at: '2026-09-01T00:00:00.000Z',
    decided_at: null,
    execution_id: null,
    execution_status: 'unavailable',
    current_member: {
      id: '00000000-0000-4000-8000-000000000003',
      numero_socio: '0042',
      nombre: 'Ana',
      apellido: 'Gorriti',
    },
    requester: { id: '00000000-0000-4000-8000-000000000005', username: 'operator' },
    context: 'Debt review',
    reason: 'Hardship',
    evidence: 'Minutes 12',
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
  })
  it('reads one queue page without automatically following the opaque cursor', async () => {
    const item = queueItem()
    apiFetchMock.mockResolvedValue({ items: [item], next_cursor: 'opaque_cursor' })
    await expect(listCondonationQueue()).resolves.toEqual({
      items: [item],
      next_cursor: 'opaque_cursor',
    })
    expect(apiFetchMock).toHaveBeenCalledOnce()
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/condonation-requests?limit=25')
    apiFetchMock.mockResolvedValue({ items: [], next_cursor: null })
    await expect(
      listCondonationQueue({ view: 'all', limit: 1, cursor: 'opaque_cursor' }),
    ).resolves.toEqual({ items: [], next_cursor: null })
    expect(apiFetchMock).toHaveBeenLastCalledWith(
      '/api/v1/condonation-requests?limit=1&view=all&cursor=opaque_cursor',
    )
  })
  it('rejects incomplete or inconsistent decision context rather than showing a partial queue', async () => {
    const item = queueItem()
    for (const broken of [
      { ...item, reason: '' },
      { ...item, created_at: 'invalid' },
      { ...item, requester: { id: 'invalid', username: 'operator' } },
      { ...item, current_member: { ...item.current_member, id: item.id } },
      { ...item, token_hash: 'must-not-be-displayed' },
      {
        ...item,
        snapshot: {
          ...item.snapshot,
          obligations: [...item.snapshot.obligations, ...item.snapshot.obligations],
        },
      },
      {
        ...item,
        snapshot: {
          ...item.snapshot,
          obligations: [
            ...item.snapshot.obligations,
            { ...item.snapshot.obligations[0], obligation_id: item.id, currency: 'USD' },
          ],
        },
      },
    ]) {
      apiFetchMock.mockResolvedValue({ items: [item, broken], next_cursor: null })
      await expect(listCondonationQueue()).rejects.toMatchObject({ kind: 'partial_data' })
    }
    for (const page of [
      { items: [item] },
      { items: [], next_cursor: '' },
      { items: [item, item], next_cursor: null },
    ]) {
      apiFetchMock.mockResolvedValue(page)
      await expect(listCondonationQueue()).rejects.toMatchObject({ kind: 'partial_data' })
    }
  })
  it('validates queue options before making a request and reports transport failures', async () => {
    for (const options of [
      { limit: 0 },
      { limit: 101 },
      { limit: 1.5 },
      { cursor: '' },
      { cursor: 'bad=' },
      { cursor: 'a'.repeat(257) },
    ])
      await expect(listCondonationQueue(options)).rejects.toMatchObject({ kind: 'partial_data' })
    expect(apiFetchMock).not.toHaveBeenCalled()
    const transportError = new Error('offline')
    apiFetchMock.mockRejectedValueOnce(transportError)
    const failure = await listCondonationQueue().catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(CondonationOperationError)
    expect((failure as InstanceType<typeof CondonationOperationError>).kind).toBe('unavailable')
    expect((failure as Error).cause).toBe(transportError)
  })

  it('keeps authorization failures distinct from unavailable queue data', async () => {
    const { ApiError } = await import('@/lib/api')
    apiFetchMock.mockRejectedValueOnce(new ApiError(403, 'INSUFFICIENT_PERMISSIONS', 'Forbidden'))
    const failure = await listCondonationQueue().catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(CondonationOperationError)
    expect((failure as InstanceType<typeof CondonationOperationError>).kind).toBe('permission')
  })

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

  it('executes only the persisted execution identity with its caller-owned idempotency key', async () => {
    const requestId = '00000000-0000-4000-8000-000000000001'
    const executionId = '00000000-0000-4000-8000-000000000002'
    const memberId = '00000000-0000-4000-8000-000000000003'
    apiFetchMock.mockResolvedValue({
      execution_id: executionId,
      approval_id: requestId,
      member_id: memberId,
      currency: 'ARS',
      approved_amount_cents: 12_500,
      treatment_ids: ['00000000-0000-4000-8000-000000000004'],
      status: 'replayed',
    })

    await expect(
      executeCondonationRequest(requestId, executionId, 'execution-key'),
    ).resolves.toMatchObject({
      status: 'replayed',
    })
    expect(apiFetchMock).toHaveBeenCalledWith(
      `/api/v1/condonation-requests/${requestId}/execution`,
      {
        method: 'POST',
        headers: { 'idempotency-key': 'execution-key' },
        body: { execution_id: executionId },
      },
    )

    apiFetchMock.mockResolvedValue({ execution_id: 'bad' })
    await expect(
      executeCondonationRequest(requestId, executionId, 'execution-key'),
    ).rejects.toMatchObject({
      kind: 'partial_data',
    })
  })

  it('strictly decodes persisted lifecycle states and rejects unsafe fields', async () => {
    const memberId = '00000000-0000-4000-8000-000000000003'
    apiFetchMock.mockResolvedValueOnce({
      items: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          state: 'executed',
          expires_at: '2026-09-01T00:00:00.000Z',
          decided_at: '2026-08-27T00:00:00.000Z',
          execution_id: '00000000-0000-4000-8000-000000000002',
          execution_status: 'executed',
          snapshot: {
            member_id: memberId,
            obligations: [
              {
                obligation_id: '00000000-0000-4000-8000-000000000004',
                currency: 'ARS',
                outstanding_amount_cents: 12500,
              },
            ],
          },
        },
      ],
    })
    await expect(listCondonationLifecycle(memberId)).resolves.toMatchObject({
      items: [{ state: 'executed' }],
    })
    apiFetchMock.mockResolvedValueOnce({
      items: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          state: 'executed',
          expires_at: '2026-09-01T00:00:00.000Z',
          decided_at: '2026-08-27T00:00:00.000Z',
          execution_id: '00000000-0000-4000-8000-000000000002',
          execution_status: 'executed',
          snapshot: { member_id: memberId, obligations: [] },
          evidence: 'must not reach the UI',
        },
      ],
    })
    await expect(listCondonationLifecycle(memberId)).rejects.toMatchObject({ kind: 'partial_data' })
  })
})
