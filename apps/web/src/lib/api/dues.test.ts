import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetchMock = vi.fn()
class MockApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message = 'API error',
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
vi.mock('@/lib/api', () => ({ apiFetch: apiFetchMock, ApiError: MockApiError }))
const {
  DuesOperationError,
  createCommunityWorkEvidence,
  createDuesPrice,
  createDuesSettlement,
  createNegotiatedAgreement,
  generateDuesAssessments,
  getDuesPrices,
  getDebt,
  getObligationAgreements,
  reviseNegotiatedAgreement,
  reverseDuesSettlement,
  revokeDuesPrice,
} = await import('./dues')

const legacyAgreement = {
  id: 'agreement-1',
  socio_id: 'socio-1',
  obligation_id: 'obligation-1',
  kind: 'INSTALLMENT',
  status: 'ACTIVE',
  revision_number: 1,
  terms_version: 0,
  terms: { amountCents: 5000, installments: 2 },
  reason: 'Plan aprobado',
  revision_reason: null,
  agreement_date: '2026-08-19',
  revision_of_agreement_id: null,
  replayed: false,
}
const negotiatedTerms = {
  narrative: 'El socio se compromete a regularizar la deuda.',
  commitments: [{ label: 'Trabajo comunitario', due_date: '2026-09-01' }],
  evidence: { note: 'Conversado en secretaría' },
}
const negotiatedAgreement = {
  ...legacyAgreement,
  id: 'agreement-2',
  kind: 'NEGOTIATED',
  terms_version: 1,
  terms: negotiatedTerms,
  reason: 'Condiciones acordadas',
  revision_reason: 'Renegociación',
  replayed: false,
}

describe('typed native dues client', () => {
  beforeEach(() => apiFetchMock.mockReset())
  it('uses the prices wire query', async () => {
    await getDuesPrices('2026-01')
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/dues/prices', {
      query: { period: '2026-01' },
    })
  })
  it('sends the stable generation key', async () => {
    await generateDuesAssessments('2026-01', 'retry-key-1')
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/dues/assessments/generate', {
      method: 'POST',
      headers: { 'idempotency-key': 'retry-key-1' },
      body: { period: '2026-01' },
    })
  })

  it('sends ADMIN pricing creation and revocation through the native routes', async () => {
    await createDuesPrice({
      kind: 'BASE',
      amount_cents: 12500,
      currency: 'ARS',
      effective_from: '2026-01-01',
      effective_to: null,
      rule: 'FULL_MONTH',
    })
    await revokeDuesPrice('price-1', 'Correction')
    expect(apiFetchMock).toHaveBeenNthCalledWith(1, '/api/v1/dues/prices', {
      method: 'POST',
      body: {
        kind: 'BASE',
        amount_cents: 12500,
        currency: 'ARS',
        effective_from: '2026-01-01',
        effective_to: null,
        rule: 'FULL_MONTH',
      },
    })
    expect(apiFetchMock).toHaveBeenNthCalledWith(2, '/api/v1/dues/prices/price-1/revoke', {
      method: 'POST',
      body: { revoke_reason: 'Correction' },
    })
  })

  it('uses the typed debt detail read for the selected socio', async () => {
    await getDebt('socio-1')
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/dues/debt/socio-1', { query: {} })
  })

  // prettier-ignore
  it('sends explicit monetary allocations with a stable key',async()=>{await createDuesSettlement({socio_id:'socio-1',kind:'MONETARY',amount_cents:5_000,currency:'ARS',allocations:[{obligation_id:'obligation-1',amount_cents:2_000},{obligation_id:'obligation-2',amount_cents:3_000}]},'settlement-key-1');expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/dues/settlements',{method:'POST',headers:{'idempotency-key':'settlement-key-1'},body:expect.objectContaining({amount_cents:5_000})})})
  // prettier-ignore
  it('sends only a settlement-level reversal reason and decodes the committed response',async()=>{apiFetchMock.mockResolvedValueOnce({original_settlement_id:'settlement-1',reversal_settlement_id:'settlement-2',kind:'MONETARY',amount_cents:5_000,currency:'ARS',allocations:[{id:'allocation-2',obligation_id:'obligation-1',amount_cents:5_000}]});await expect(reverseDuesSettlement('settlement-1',{reason:'Incorrect allocation'},'reversal-key-1')).resolves.toMatchObject({original_settlement_id:'settlement-1',reversal_settlement_id:'settlement-2'});expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/dues/settlements/settlement-1/reverse',{method:'POST',headers:{'idempotency-key':'reversal-key-1'},body:{reason:'Incorrect allocation'}})})
  it('rejects an incomplete reversal response instead of reporting a reversal as confirmed', async () => {
    apiFetchMock.mockResolvedValueOnce({ reversal_settlement_id: 'settlement-2' })
    await expect(
      reverseDuesSettlement('settlement-1', { reason: 'Correction' }, 'reversal-key-2'),
    ).rejects.toMatchObject({ kind: 'partial_data' })
  })
  it('rejects a reversal response with an invalid allocation', async () => {
    apiFetchMock.mockResolvedValueOnce({
      original_settlement_id: 'settlement-1',
      reversal_settlement_id: 'settlement-2',
      kind: 'MONETARY',
      amount_cents: 5_000,
      currency: 'ARS',
      allocations: [{ id: 'allocation-2', obligation_id: 'obligation-1', amount_cents: '5_000' }],
    })
    await expect(
      reverseDuesSettlement('settlement-1', { reason: 'Correction' }, 'reversal-key-3'),
    ).rejects.toMatchObject({ kind: 'partial_data' })
  })
})

describe('negotiated agreement client contract', () => {
  beforeEach(() => apiFetchMock.mockReset())
  it('decodes the agreement lineage read without an idempotency key', async () => {
    apiFetchMock.mockResolvedValueOnce({
      active: negotiatedAgreement,
      revisions: [legacyAgreement, negotiatedAgreement],
    })
    await expect(getObligationAgreements('obligation-1')).resolves.toMatchObject({
      active: { id: 'agreement-2', terms_version: 1, replayed: false },
      revisions: [{ kind: 'INSTALLMENT' }, { kind: 'NEGOTIATED' }],
    })
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/dues/obligations/obligation-1/agreements')
  })

  it('creates and revises negotiated agreements with stable idempotency keys', async () => {
    apiFetchMock
      .mockResolvedValueOnce({ ...negotiatedAgreement, replayed: true })
      .mockResolvedValueOnce({ ...negotiatedAgreement, id: 'agreement-3', replayed: false })
    await expect(
      createNegotiatedAgreement(
        {
          socio_id: 'socio-1',
          obligation_id: 'obligation-1',
          terms: negotiatedTerms,
          reason: 'Condiciones acordadas',
        },
        'agreement-key-1',
      ),
    ).resolves.toMatchObject({ replayed: true })
    await expect(
      reviseNegotiatedAgreement(
        'agreement-2',
        { terms: negotiatedTerms, reason: 'Renegociación' },
        'revision-key-1',
      ),
    ).resolves.toMatchObject({ id: 'agreement-3', replayed: false })
    expect(apiFetchMock).toHaveBeenNthCalledWith(1, '/api/v1/dues/agreements', {
      method: 'POST',
      headers: { 'idempotency-key': 'agreement-key-1' },
      body: {
        socio_id: 'socio-1',
        obligation_id: 'obligation-1',
        kind: 'NEGOTIATED',
        terms_version: 1,
        terms: negotiatedTerms,
        reason: 'Condiciones acordadas',
      },
    })
    expect(apiFetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/dues/agreements/agreement-2/revisions',
      {
        method: 'POST',
        headers: { 'idempotency-key': 'revision-key-1' },
        body: { terms_version: 1, terms: negotiatedTerms, reason: 'Renegociación' },
      },
    )
  })

  it('creates community-work evidence with the active agreement id and replay flag', async () => {
    apiFetchMock.mockResolvedValueOnce({
      community_work_id: 'work-1',
      settlement_id: 'settlement-1',
      allocation_id: 'allocation-1',
      obligation_id: 'obligation-1',
      agreement_id: 'agreement-2',
      amount_cents: 4000,
      currency: 'ARS',
      replayed: true,
    })
    await expect(
      createCommunityWorkEvidence(
        {
          socio_id: 'socio-1',
          obligation_id: 'obligation-1',
          agreement_id: 'agreement-2',
          amount_cents: 4000,
          evidence: { note: 'Pintura' },
          reason: 'Trabajo aprobado',
        },
        'work-key-1',
      ),
    ).resolves.toMatchObject({ replayed: true, agreement_id: 'agreement-2' })
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/dues/community-work', {
      method: 'POST',
      headers: { 'idempotency-key': 'work-key-1' },
      body: expect.objectContaining({ agreement_id: 'agreement-2', amount_cents: 4000 }),
    })
  })

  it('normalizes malformed 2xx payloads and transport errors', async () => {
    apiFetchMock
      .mockResolvedValueOnce({
        active: { ...negotiatedAgreement, terms_version: 99 },
        revisions: [],
      })
      .mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(getObligationAgreements('obligation-1')).rejects.toMatchObject({
      kind: 'partial_data',
    })
    await expect(getObligationAgreements('obligation-1')).rejects.toMatchObject({
      kind: 'unavailable',
    })
  })

  it.each([
    [400, 'validation'],
    [403, 'permission'],
    [404, 'not_found'],
    [409, 'conflict'],
    [500, 'unavailable'],
  ] as const)('normalizes HTTP %i as %s', async (status, kind) => {
    apiFetchMock.mockRejectedValueOnce(
      new MockApiError(status, 'DUES_ERROR', 'Rejected', { field: 'terms' }),
    )
    await expect(getObligationAgreements('obligation-1')).rejects.toMatchObject({
      name: 'DuesOperationError',
      kind,
      cause: expect.any(MockApiError),
    })
  })

  it('exposes normalized errors for UI-only copy mapping', async () => {
    expect(new DuesOperationError('conflict', 'Conflict').kind).toBe('conflict')
  })
})
