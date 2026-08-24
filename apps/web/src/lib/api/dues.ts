import { ApiError, apiFetch } from '@/lib/api'

export interface DuesPrice {
  id: string
  kind: 'BASE' | 'SPORT'
  disciplina_id: string | null
  amount_cents: number
  currency: string
  effective_from: string
  effective_to: string | null
  rule: 'FULL_MONTH' | 'DAILY_PRORATED' | 'NEXT_PERIOD'
  revoked_at: string | null
}
export interface DuesPriceListResponse {
  items: DuesPrice[]
}
export interface DuesPriceInput {
  kind: DuesPrice['kind']
  disciplina_id?: string | null
  amount_cents: number
  currency: string
  effective_from: string
  effective_to: string | null
  rule: DuesPrice['rule']
}
export interface DuesGenerationResult {
  period: string
  obligation_ids: string[]
}
// prettier-ignore
export interface DebtComponent { id:string; kind:'BASE'|'SPORT'|'BENEFIT'|'ADJUSTMENT'; component_key:string; amount_cents:number }
// prettier-ignore
export interface DebtBenefit { id:string; component_key:string; amount_cents:number }
// prettier-ignore
export interface DebtAllocation { id:string; settlement_id:string; settlement_kind:'MONETARY'|'NON_CASH'; settlement_amount_cents:number; currency:string; amount_cents:number; kind:'ALLOCATION'|'COMPENSATION'; compensates_allocation_id:string|null; reversal_eligible:boolean }
// prettier-ignore
export interface DebtObligation { id:string; period_start:string; period_end:string; original_amount_cents:number; outstanding_cents:number; currency:string; status:'OPEN'|'PAID'; components:DebtComponent[]; benefits:DebtBenefit[]; allocations:DebtAllocation[] }
// prettier-ignore
export interface DebtDetail { status:'ready'|'empty'|'not_found'; socio_id:string; currency:string|null; total_debt_cents:number; obligations:DebtObligation[] }
export interface DuesSettlementInput {
  socio_id: string
  kind: 'MONETARY'
  amount_cents: number
  currency: string
  allocations: Array<{ obligation_id: string; amount_cents: number }>
}
export interface DuesSettlementResult {
  settlement_id: string
  kind: 'MONETARY' | 'NON_CASH'
  amount_cents: number
  currency: string
  allocations: Array<{ id: string; obligation_id: string; amount_cents: number }>
}
// prettier-ignore
export interface LegacyAgreementTerms { amountCents?: number; installments?: number }
// prettier-ignore
export interface NegotiatedAgreementTermsV1 { narrative:string; commitments?:unknown[]; evidence?:Record<string, unknown>|undefined }
export type AgreementTerms = LegacyAgreementTerms | NegotiatedAgreementTermsV1
// prettier-ignore
export interface DuesAgreement { id:string; socio_id:string; obligation_id:string; kind:'SIMPLE'|'INSTALLMENT'|'NEGOTIATED'; status:'ACTIVE'|'SUPERSEDED'|'CANCELLED'; revision_number:number; terms_version:0|1; terms:AgreementTerms; reason:string; revision_reason:string|null; agreement_date:string; revision_of_agreement_id:string|null; replayed:boolean }
// prettier-ignore
export interface AgreementLineageResponse { active:DuesAgreement|null; revisions:DuesAgreement[] }
// prettier-ignore
export interface CreateNegotiatedAgreementInput { socio_id:string; obligation_id:string; terms:NegotiatedAgreementTermsV1; reason:string }
// prettier-ignore
export interface ReviseNegotiatedAgreementInput { terms:NegotiatedAgreementTermsV1; reason:string }
// prettier-ignore
export interface CommunityWorkEvidenceInput { socio_id:string; obligation_id:string; agreement_id?:string; amount_cents:number; evidence:Record<string, unknown>; reason:string }
// prettier-ignore
export interface CommunityWorkEvidenceResult { community_work_id:string; settlement_id:string; allocation_id:string; obligation_id:string; agreement_id:string|null; amount_cents:number; currency:string; replayed:boolean }
export type DuesOperationErrorKind =
  | 'validation'
  | 'permission'
  | 'conflict'
  | 'not_found'
  | 'partial_data'
  | 'unavailable'

export class DuesOperationError extends Error {
  constructor(
    readonly kind: DuesOperationErrorKind,
    message: string,
    override readonly cause?: unknown,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'DuesOperationError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}
function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
function decodeTerms(
  kind: DuesAgreement['kind'],
  version: unknown,
  terms: unknown,
): AgreementTerms | null {
  if (!isRecord(terms)) return null
  if (kind === 'NEGOTIATED')
    return version === 1 && isString(terms.narrative)
      ? {
          narrative: terms.narrative,
          commitments:
            Array.isArray(terms.commitments) && terms.commitments.length <= 20
              ? terms.commitments
              : [],
          evidence: isRecord(terms.evidence) ? terms.evidence : undefined,
        }
      : null
  return version === 0 ? terms : null
}
function decodeAgreement(value: unknown): DuesAgreement | null {
  if (!isRecord(value)) return null
  const kind = value.kind
  if (kind !== 'SIMPLE' && kind !== 'INSTALLMENT' && kind !== 'NEGOTIATED') return null
  const terms = decodeTerms(kind, value.terms_version, value.terms)
  if (!terms) return null
  if (
    !isString(value.id) ||
    !isString(value.socio_id) ||
    !isString(value.obligation_id) ||
    !isString(value.status) ||
    !isNumber(value.revision_number) ||
    !isString(value.reason) ||
    !isString(value.agreement_date)
  )
    return null
  return {
    id: value.id,
    socio_id: value.socio_id,
    obligation_id: value.obligation_id,
    kind,
    status: value.status as DuesAgreement['status'],
    revision_number: value.revision_number,
    terms_version: value.terms_version as 0 | 1,
    terms,
    reason: value.reason,
    revision_reason: isString(value.revision_reason) ? value.revision_reason : null,
    agreement_date: value.agreement_date,
    revision_of_agreement_id: isString(value.revision_of_agreement_id)
      ? value.revision_of_agreement_id
      : null,
    replayed: value.replayed === true,
  }
}
function decodeLineage(value: unknown): AgreementLineageResponse | null {
  if (!isRecord(value) || !Array.isArray(value.revisions)) return null
  const active = value.active === null ? null : decodeAgreement(value.active)
  const revisions = value.revisions.map(decodeAgreement)
  return (value.active === null || active) && revisions.every(Boolean)
    ? { active, revisions: revisions as DuesAgreement[] }
    : null
}
function decodeCommunityWork(value: unknown): CommunityWorkEvidenceResult | null {
  if (
    !isRecord(value) ||
    !isString(value.community_work_id) ||
    !isString(value.settlement_id) ||
    !isString(value.allocation_id) ||
    !isString(value.obligation_id) ||
    !isNumber(value.amount_cents) ||
    !isString(value.currency)
  )
    return null
  return {
    community_work_id: value.community_work_id,
    settlement_id: value.settlement_id,
    allocation_id: value.allocation_id,
    obligation_id: value.obligation_id,
    agreement_id: isString(value.agreement_id) ? value.agreement_id : null,
    amount_cents: value.amount_cents,
    currency: value.currency,
    replayed: value.replayed === true,
  }
}
function mapError(error: unknown): DuesOperationError {
  if (error instanceof DuesOperationError) return error
  if (error instanceof ApiError || (isRecord(error) && typeof error.status === 'number')) {
    const status = (error as { status: number }).status,
      details = (error as { details?: unknown }).details
    const kind: DuesOperationErrorKind =
      status === 400
        ? 'validation'
        : status === 403
          ? 'permission'
          : status === 404
            ? 'not_found'
            : status === 409
              ? 'conflict'
              : 'unavailable'
    return new DuesOperationError(kind, 'Dues operation failed', error, details)
  }
  return new DuesOperationError('unavailable', 'Dues operation unavailable', error)
}
async function duesOperation<T>(
  run: () => Promise<unknown>,
  decode: (value: unknown) => T | null,
): Promise<T> {
  try {
    const value = await run()
    const decoded = decode(value)
    if (!decoded)
      throw new DuesOperationError('partial_data', 'Dues response was incomplete', value)
    return decoded
  } catch (error) {
    throw mapError(error)
  }
}

export function getDuesPrices(period: string) {
  return apiFetch<DuesPriceListResponse>('/api/v1/dues/prices', { query: { period } })
}

export function createDuesPrice(input: DuesPriceInput) {
  return apiFetch<DuesPrice>('/api/v1/dues/prices', { method: 'POST', body: input })
}

export function revokeDuesPrice(id: string, reason: string) {
  return apiFetch<DuesPrice>(`/api/v1/dues/prices/${id}/revoke`, {
    method: 'POST',
    body: { revoke_reason: reason },
  })
}

export function generateDuesAssessments(period: string, key: string) {
  return apiFetch<DuesGenerationResult>('/api/v1/dues/assessments/generate', {
    method: 'POST',
    headers: { 'idempotency-key': key },
    body: { period },
  })
}

export function getDebt(socioId: string) {
  return apiFetch<DebtDetail>(`/api/v1/dues/debt/${socioId}`, { query: {} })
}

export function getObligationAgreements(obligationId: string) {
  return duesOperation(
    () => apiFetch(`/api/v1/dues/obligations/${obligationId}/agreements`),
    decodeLineage,
  )
}

export function createNegotiatedAgreement(input: CreateNegotiatedAgreementInput, key: string) {
  return duesOperation(
    () =>
      apiFetch('/api/v1/dues/agreements', {
        method: 'POST',
        headers: { 'idempotency-key': key },
        body: { ...input, kind: 'NEGOTIATED', terms_version: 1 },
      }),
    decodeAgreement,
  )
}

export function reviseNegotiatedAgreement(
  agreementId: string,
  input: ReviseNegotiatedAgreementInput,
  key: string,
) {
  return duesOperation(
    () =>
      apiFetch(`/api/v1/dues/agreements/${agreementId}/revisions`, {
        method: 'POST',
        headers: { 'idempotency-key': key },
        body: { terms_version: 1, ...input },
      }),
    decodeAgreement,
  )
}

export function createCommunityWorkEvidence(input: CommunityWorkEvidenceInput, key: string) {
  return duesOperation(
    () =>
      apiFetch('/api/v1/dues/community-work', {
        method: 'POST',
        headers: { 'idempotency-key': key },
        body: input,
      }),
    decodeCommunityWork,
  )
}

export function createDuesSettlement(input: DuesSettlementInput, key: string) {
  return apiFetch<DuesSettlementResult>('/api/v1/dues/settlements', {
    method: 'POST',
    headers: { 'idempotency-key': key },
    body: input,
  })
}

export function reverseDuesSettlement(
  settlementId: string,
  input: { allocation_id: string; reason: string },
  key: string,
) {
  return apiFetch<DuesSettlementResult>(`/api/v1/dues/settlements/${settlementId}/reverse`, {
    method: 'POST',
    headers: { 'idempotency-key': key },
    body: input,
  })
}
