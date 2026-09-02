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
  createFullSelectionPayment,
  createNegotiatedAgreement,
  generateDuesAssessments,
  getDuesPrices,
  planDuesGeneration,
  getDebt,
  getObligationAgreements,
  previewDuesAssessments,
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
  it('plans without an idempotency key and generates with the reviewed fingerprint', async () => {
    const fingerprint = 'a'.repeat(64)
    const plan = {
      period: '2026-01',
      currency: 'ARS',
      plan_fingerprint: fingerprint,
      can_generate: true,
      configurations: [
        {
          label: 'Cuota social',
          amount_cents: 12_500,
          rule: 'Mes completo',
          validity: 'Desde el 1 de enero de 2026',
        },
      ],
      summary: {
        eligible_count: 2,
        ready_count: 1,
        new_count: 1,
        existing_count: 0,
        review_count: 1,
        conflict_count: 0,
        estimated_new_total_cents: 12_500,
      },
      members: [
        {
          member_number: '0001',
          name: 'Ada Lovelace',
          status: 'READY',
          gross_cents: 12_500,
          net_cents: 12_500,
          configuration_labels: ['Cuota social'],
          summary: 'Cuota social mensual',
          details: ['Cuota social: $125,00'],
        },
      ],
    }
    apiFetchMock.mockResolvedValueOnce(plan).mockResolvedValueOnce({
      period: '2026-01',
      generated_obligation_count: 1,
      retained_existing_count: 0,
      review_count: 1,
      generated_total_cents: 12_500,
      obligation_ids: ['must-not-expose'],
    })

    await expect(planDuesGeneration('2026-01')).resolves.toEqual(plan)
    await expect(generateDuesAssessments('2026-01', fingerprint, 'retry-key-1')).resolves.toEqual({
      period: '2026-01',
      generated_obligation_count: 1,
      retained_existing_count: 0,
      review_count: 1,
      generated_total_cents: 12_500,
    })
    expect(apiFetchMock).toHaveBeenNthCalledWith(1, '/api/v1/dues/assessments/generation-plan', {
      method: 'POST',
      body: { period: '2026-01' },
    })
    expect(apiFetchMock).toHaveBeenNthCalledWith(2, '/api/v1/dues/assessments/generate', {
      method: 'POST',
      headers: { 'idempotency-key': 'retry-key-1' },
      body: { period: '2026-01', plan_fingerprint: fingerprint },
    })
  })

  it('rejects malformed successful generation DTOs and does not expose obligation ids', async () => {
    const malformedPlan = {
      period: '2026-01',
      currency: 'ARS',
      plan_fingerprint: 'a'.repeat(64),
      can_generate: true,
      configurations: [
        {
          label: 'Cuota social',
          amount_cents: 12_500,
          rule: 'Mes completo',
          validity: 'Desde el 1 de enero de 2026',
        },
      ],
      summary: {
        eligible_count: 1,
        ready_count: 1,
        new_count: 1,
        existing_count: 0,
        review_count: 0,
        conflict_count: 0,
        estimated_new_total_cents: 12_500,
      },
      members: [
        {
          member_number: '0001',
          name: 'Ada Lovelace',
          status: 'UNKNOWN',
          gross_cents: 12_500,
          net_cents: 12_500,
          configuration_labels: ['Cuota social'],
          summary: 'Cuota social mensual',
          details: [],
        },
      ],
    }
    apiFetchMock.mockResolvedValueOnce(malformedPlan)
    await expect(planDuesGeneration('2026-01')).rejects.toMatchObject({ kind: 'partial_data' })

    for (const plan of [
      { ...malformedPlan, currency: 'ars' },
      { ...malformedPlan, plan_fingerprint: 'invalid' },
      { ...malformedPlan, summary: { ...malformedPlan.summary, ready_count: -1 } },
    ]) {
      apiFetchMock.mockResolvedValueOnce(plan)
      await expect(planDuesGeneration('2026-01')).rejects.toMatchObject({ kind: 'partial_data' })
    }

    apiFetchMock.mockResolvedValueOnce({
      period: '2026-01',
      generated_obligation_count: 1,
      retained_existing_count: 0,
      review_count: 0,
      generated_total_cents: '12500',
      obligation_ids: ['must-not-exist'],
    })
    await expect(
      generateDuesAssessments('2026-01', 'a'.repeat(64), 'retry-key-1'),
    ).rejects.toMatchObject({ kind: 'partial_data' })
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
    apiFetchMock.mockResolvedValueOnce({
      status: 'empty',
      socio_id: 'socio-1',
      currency: null,
      total_debt_cents: 0,
      obligations: [],
    })
    await getDebt('socio-1')
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/dues/debt/socio-1', { query: {} })
  })

  // prettier-ignore
  it('maps a preview request and rejects malformed nested preview data', async () => {
    apiFetchMock.mockResolvedValueOnce({
      socio_id: 'socio-1', from_period: '2026-01', through_period: '2026-01', executable: true,
      currency: 'ARS', fingerprint: 'fingerprint', periods: [{ period: '2026-01', start: '2026-01-01', end: '2026-02-01', calendarDays: 31, existingObligationId: null, pendingAmountCents: 1000, components: [{ componentKey: 'base', kind: 'BASE', eligibleFrom: '2026-01-01', eligibleTo: '2026-02-01', eligibleDays: 31, calendarDays: 31, segments: [{ priceVersionId: 'price-1', amountCents: 1000, currency: 'ARS', from: '2026-01-01', to: '2026-02-01', rule: 'FULL_MONTH', eligibleDays: 31, numerator: 31000 }], numerator: 31000, remainder: 0, amountCents: 1000, status: 'PENDING' }], }], issues: [],
    })
    await expect(previewDuesAssessments({ socio_id: 'socio-1', from_period: '2026-01', through_period: '2026-01' })).resolves.toMatchObject({ executable: true, periods: [{ components: [{ status: 'PENDING' }] }] })
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/dues/assessments/preview', { method: 'POST', body: { socio_id: 'socio-1', from_period: '2026-01', through_period: '2026-01' } })
    apiFetchMock.mockResolvedValueOnce({ socio_id: 'socio-1', from_period: '2026-01', through_period: '2026-01', executable: true, currency: 'ARS', fingerprint: 'fingerprint', periods: [{ components: [] }], issues: [] })
    await expect(previewDuesAssessments({ socio_id: 'socio-1', from_period: '2026-01', through_period: '2026-01' })).rejects.toMatchObject({ kind: 'partial_data' })
  })

  // prettier-ignore
  it('rejects malformed nested debt data instead of casting it', async () => {
    apiFetchMock.mockResolvedValueOnce({ status: 'ready', socio_id: 'socio-1', currency: 'ARS', total_debt_cents: 1000, obligations: [{ id: 'obligation-1', period_start: '2026-01-01', period_end: '2026-02-01', original_amount_cents: 1000, outstanding_cents: 1000, currency: 'ARS', status: 'OPEN', components: [], benefits: [], allocations: [{ id: 'allocation-1', settlement_id: 'settlement-1', settlement_kind: 'MONETARY', settlement_amount_cents: 1000, currency: 'ARS', amount_cents: 1000, kind: 'ALLOCATION', compensates_allocation_id: null, reversal_eligible: 'true' }] }] })
    await expect(getDebt('socio-1')).rejects.toMatchObject({ kind: 'partial_data' })
  })

  // prettier-ignore
  it('posts only strict full-selection payment fields and rejects an incomplete committed response',async()=>{const input={socio_id:'socio-1',obligation_ids:['obligation-2','obligation-1'],shift_id:'shift-1',tender:'CASH' as const,selection_fingerprint:'fingerprint'};apiFetchMock.mockResolvedValueOnce({settlement_id:'settlement-1',amount_cents:5_000,currency:'ARS',allocations:[{id:'allocation-1',obligation_id:'obligation-1',amount_cents:2_000}]});await expect(createFullSelectionPayment(input,'payment-key-1')).resolves.toMatchObject({settlement_id:'settlement-1'});expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/dues/settlements',{method:'POST',headers:{'idempotency-key':'payment-key-1'},body:input});apiFetchMock.mockResolvedValueOnce({settlement_id:'settlement-1',amount_cents:5_000,currency:'ARS',allocations:[{id:'allocation-1',obligation_id:'obligation-1',amount_cents:'2_000'}]});await expect(createFullSelectionPayment(input,'payment-key-1')).rejects.toMatchObject({kind:'partial_data'})})
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
