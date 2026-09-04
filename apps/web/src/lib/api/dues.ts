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
export interface DuesGenerationConfiguration {
  label: string
  amount_cents: number
  rule: string
  validity: string
}
export interface DuesGenerationSummary {
  eligible_count: number
  ready_count: number
  new_count: number
  existing_count: number
  review_count: number
  conflict_count: number
  estimated_new_total_cents: number
}
export interface DuesGenerationMember {
  member_number: string
  name: string
  status: 'READY' | 'REVIEW' | 'CONFLICT'
  gross_cents: number
  net_cents: number
  configuration_labels: string[]
  summary: string
  details: string[]
}
export interface DuesGenerationPlan {
  period: string
  currency: string
  plan_fingerprint: string
  can_generate: boolean
  configurations: DuesGenerationConfiguration[]
  summary: DuesGenerationSummary
  members: DuesGenerationMember[]
}
export interface DuesGenerationResult {
  period: string
  generated_obligation_count: number
  retained_existing_count: number
  review_count: number
  generated_total_cents: number
}
// prettier-ignore
export interface AssessmentPreviewInput { socio_id:string; from_period:string; through_period:string }
// prettier-ignore
export interface AssessmentPreviewSegment { priceVersionId:string; amountCents:number; currency:string; from:string; to:string; rule:'FULL_MONTH'|'DAILY_PRORATED'|'NEXT_PERIOD'; eligibleDays:number; numerator:number }
// prettier-ignore
export interface AssessmentPreviewComponent { componentKey:string; kind:'BASE'|'SPORT'|'BENEFIT'; eligibleFrom:string; eligibleTo:string; eligibleDays:number; calendarDays:number; segments:AssessmentPreviewSegment[]; numerator:number; remainder:number; amountCents:number; status:'PENDING'|'ZERO'|'CONFLICT'|'ALREADY_GENERATED' }
// prettier-ignore
export interface AssessmentPreviewPeriod { period:string; start:string; end:string; calendarDays:number; components:AssessmentPreviewComponent[]; existingObligationId:string|null; pendingAmountCents:number|null }
// prettier-ignore
export interface AssessmentPreviewIssue { code:'NEXT_PERIOD_CONFLICT'|'OVERFLOW'|'PRICE_GAP'|'PRICE_OVERLAP'; componentKey:string; from:string; to:string; period:string }
// prettier-ignore
export interface AssessmentPreview { socio_id:string; from_period:string; through_period:string; executable:boolean; currency:string|null; periods:AssessmentPreviewPeriod[]; issues:AssessmentPreviewIssue[]; fingerprint:string }
export interface AssessmentRangeExecution {
  created_obligation_ids: string[]
  periods: string[]
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
export interface FullSelectionPaymentInput {
  socio_id: string
  obligation_ids: string[]
  shift_id: string
  tender: 'CASH' | 'DEBIT' | 'CREDIT' | 'TRANSFER'
  selection_fingerprint: string
}
export interface FullSelectionPaymentResult {
  settlement_id: string
  amount_cents: number
  currency: string
  allocations: Array<{ id: string; obligation_id: string; amount_cents: number }>
}
export interface DuesSettlementReversalResult {
  original_settlement_id: string
  reversal_settlement_id: string
  kind: 'MONETARY'
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
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
function isCurrency(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value)
}
function isFingerprint(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}
// prettier-ignore
function isNullableString(value: unknown): value is string | null { return value === null || isString(value) }
// prettier-ignore
function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T { return typeof value === 'string' && values.includes(value as T) }
// prettier-ignore
function decodePreviewSegment(value: unknown): AssessmentPreviewSegment | null {
  if (!isRecord(value)) return null
  const { priceVersionId, amountCents, currency, from, to, rule, eligibleDays, numerator } = value
  return isString(priceVersionId) && isNumber(amountCents) && isString(currency) && isString(from) && isString(to) && isOneOf(rule, ['FULL_MONTH', 'DAILY_PRORATED', 'NEXT_PERIOD']) && isNumber(eligibleDays) && isNumber(numerator) ? { priceVersionId, amountCents, currency, from, to, rule, eligibleDays, numerator } : null
}
// prettier-ignore
function decodePreviewComponent(value: unknown): AssessmentPreviewComponent | null {
  if (!isRecord(value) || !Array.isArray(value.segments)) return null
  const { componentKey, kind, eligibleFrom, eligibleTo, eligibleDays, calendarDays, numerator, remainder, amountCents, status } = value, segments = value.segments.map(decodePreviewSegment)
  return isString(componentKey) && isOneOf(kind, ['BASE', 'SPORT', 'BENEFIT']) && isString(eligibleFrom) && isString(eligibleTo) && isNumber(eligibleDays) && isNumber(calendarDays) && isNumber(numerator) && isNumber(remainder) && isNumber(amountCents) && isOneOf(status, ['PENDING', 'ZERO', 'CONFLICT', 'ALREADY_GENERATED']) && segments.every(Boolean) ? { componentKey, kind, eligibleFrom, eligibleTo, eligibleDays, calendarDays, segments: segments as AssessmentPreviewSegment[], numerator, remainder, amountCents, status } : null
}
// prettier-ignore
function decodePreview(value: unknown): AssessmentPreview | null {
  if (!isRecord(value) || !Array.isArray(value.periods) || !Array.isArray(value.issues)) return null
  const { socio_id, from_period, through_period, executable, currency, fingerprint } = value
  const periods = value.periods.map((period) => { if (!isRecord(period) || !Array.isArray(period.components)) return null; const { period: key, start, end, calendarDays, existingObligationId, pendingAmountCents } = period, components = period.components.map(decodePreviewComponent); return isString(key) && isString(start) && isString(end) && isNumber(calendarDays) && isNullableString(existingObligationId) && (isNumber(pendingAmountCents) || pendingAmountCents === null) && components.every(Boolean) ? { period: key, start, end, calendarDays, components: components as AssessmentPreviewComponent[], existingObligationId, pendingAmountCents } : null })
  const issues = value.issues.map((issue) => { if (!isRecord(issue)) return null; const { code, componentKey, from, to, period } = issue; return isOneOf(code, ['NEXT_PERIOD_CONFLICT', 'OVERFLOW', 'PRICE_GAP', 'PRICE_OVERLAP']) && isString(componentKey) && isString(from) && isString(to) && isString(period) ? { code, componentKey, from, to, period } : null })
  return isString(socio_id) && isString(from_period) && isString(through_period) && typeof executable === 'boolean' && isNullableString(currency) && isString(fingerprint) && periods.every(Boolean) && issues.every(Boolean) ? { socio_id, from_period, through_period, executable, currency, periods: periods as AssessmentPreviewPeriod[], issues: issues as AssessmentPreviewIssue[], fingerprint } : null
}
function decodeRangeExecution(value: unknown): AssessmentRangeExecution | null {
  return isRecord(value) &&
    Array.isArray(value.created_obligation_ids) &&
    Array.isArray(value.periods) &&
    value.created_obligation_ids.every(isString) &&
    value.periods.every(isString)
    ? { created_obligation_ids: value.created_obligation_ids, periods: value.periods }
    : null
}
// prettier-ignore
function decodeDebt(value: unknown): DebtDetail | null {
  if (!isRecord(value) || !Array.isArray(value.obligations)) return null
  const { status, socio_id, currency, total_debt_cents } = value
  const obligations = value.obligations.map((obligation) => { if (!isRecord(obligation) || !Array.isArray(obligation.components) || !Array.isArray(obligation.benefits) || !Array.isArray(obligation.allocations)) return null; const { id, period_start, period_end, original_amount_cents, outstanding_cents, currency: obligationCurrency, status: obligationStatus } = obligation; const components = obligation.components.map((component) => isRecord(component) && isString(component.id) && isOneOf(component.kind, ['BASE', 'SPORT', 'BENEFIT', 'ADJUSTMENT']) && isString(component.component_key) && isNumber(component.amount_cents) ? { id: component.id, kind: component.kind, component_key: component.component_key, amount_cents: component.amount_cents } : null), benefits = obligation.benefits.map((benefit) => isRecord(benefit) && isString(benefit.id) && isString(benefit.component_key) && isNumber(benefit.amount_cents) ? { id: benefit.id, component_key: benefit.component_key, amount_cents: benefit.amount_cents } : null), allocations = obligation.allocations.map((allocation) => isRecord(allocation) && isString(allocation.id) && isString(allocation.settlement_id) && isOneOf(allocation.settlement_kind, ['MONETARY', 'NON_CASH']) && isNumber(allocation.settlement_amount_cents) && isString(allocation.currency) && isNumber(allocation.amount_cents) && isOneOf(allocation.kind, ['ALLOCATION', 'COMPENSATION']) && isNullableString(allocation.compensates_allocation_id) && typeof allocation.reversal_eligible === 'boolean' ? { id: allocation.id, settlement_id: allocation.settlement_id, settlement_kind: allocation.settlement_kind, settlement_amount_cents: allocation.settlement_amount_cents, currency: allocation.currency, amount_cents: allocation.amount_cents, kind: allocation.kind, compensates_allocation_id: allocation.compensates_allocation_id, reversal_eligible: allocation.reversal_eligible } : null); return isString(id) && isString(period_start) && isString(period_end) && isNumber(original_amount_cents) && isNumber(outstanding_cents) && isString(obligationCurrency) && isOneOf(obligationStatus, ['OPEN', 'PAID']) && components.every(Boolean) && benefits.every(Boolean) && allocations.every(Boolean) ? { id, period_start, period_end, original_amount_cents, outstanding_cents, currency: obligationCurrency, status: obligationStatus, components: components as DebtComponent[], benefits: benefits as DebtBenefit[], allocations: allocations as DebtAllocation[] } : null })
  return isOneOf(status, ['ready', 'empty', 'not_found']) && isString(socio_id) && isNullableString(currency) && isNumber(total_debt_cents) && obligations.every(Boolean) ? { status, socio_id, currency, total_debt_cents, obligations: obligations as DebtObligation[] } : null
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
function decodeSettlementReversal(value: unknown): DuesSettlementReversalResult | null {
  if (
    !isRecord(value) ||
    !isString(value.original_settlement_id) ||
    !isString(value.reversal_settlement_id) ||
    value.kind !== 'MONETARY' ||
    !isNumber(value.amount_cents) ||
    !isString(value.currency) ||
    !Array.isArray(value.allocations) ||
    !value.allocations.every(
      (allocation) =>
        isRecord(allocation) &&
        isString(allocation.id) &&
        isString(allocation.obligation_id) &&
        isNumber(allocation.amount_cents),
    )
  )
    return null
  return {
    original_settlement_id: value.original_settlement_id,
    reversal_settlement_id: value.reversal_settlement_id,
    kind: 'MONETARY',
    amount_cents: value.amount_cents,
    currency: value.currency,
    allocations: value.allocations.map((allocation) => ({
      id: allocation.id,
      obligation_id: allocation.obligation_id,
      amount_cents: allocation.amount_cents,
    })),
  }
}
function decodeFullSelectionPayment(value: unknown): FullSelectionPaymentResult | null {
  if (
    !isRecord(value) ||
    !isString(value.settlement_id) ||
    !isNumber(value.amount_cents) ||
    !isString(value.currency) ||
    !Array.isArray(value.allocations)
  )
    return null
  const allocations = value.allocations.map((item) =>
    isRecord(item) &&
    isString(item.id) &&
    isString(item.obligation_id) &&
    isNumber(item.amount_cents)
      ? { id: item.id, obligation_id: item.obligation_id, amount_cents: item.amount_cents }
      : null,
  )
  return allocations.every(Boolean)
    ? {
        settlement_id: value.settlement_id,
        amount_cents: value.amount_cents,
        currency: value.currency,
        allocations: allocations as FullSelectionPaymentResult['allocations'],
      }
    : null
}
function decodeGenerationPlan(value: unknown): DuesGenerationPlan | null {
  if (!isRecord(value) || !Array.isArray(value.configurations) || !Array.isArray(value.members))
    return null
  const configurations = value.configurations.map((configuration) =>
    isRecord(configuration) &&
    isString(configuration.label) &&
    isNonNegativeInteger(configuration.amount_cents) &&
    isString(configuration.rule) &&
    isString(configuration.validity)
      ? {
          label: configuration.label,
          amount_cents: configuration.amount_cents,
          rule: configuration.rule,
          validity: configuration.validity,
        }
      : null,
  )
  const summary = value.summary
  const members = value.members.map((member) =>
    isRecord(member) &&
    isString(member.member_number) &&
    isString(member.name) &&
    isOneOf(member.status, ['READY', 'REVIEW', 'CONFLICT']) &&
    isNonNegativeInteger(member.gross_cents) &&
    isNonNegativeInteger(member.net_cents) &&
    Array.isArray(member.configuration_labels) &&
    member.configuration_labels.every(isString) &&
    isString(member.summary) &&
    Array.isArray(member.details) &&
    member.details.every(isString)
      ? {
          member_number: member.member_number,
          name: member.name,
          status: member.status,
          gross_cents: member.gross_cents,
          net_cents: member.net_cents,
          configuration_labels: member.configuration_labels,
          summary: member.summary,
          details: member.details,
        }
      : null,
  )
  return isString(value.period) &&
    isCurrency(value.currency) &&
    isFingerprint(value.plan_fingerprint) &&
    typeof value.can_generate === 'boolean' &&
    isRecord(summary) &&
    isNonNegativeInteger(summary.eligible_count) &&
    isNonNegativeInteger(summary.ready_count) &&
    isNonNegativeInteger(summary.new_count) &&
    isNonNegativeInteger(summary.existing_count) &&
    isNonNegativeInteger(summary.review_count) &&
    isNonNegativeInteger(summary.conflict_count) &&
    isNonNegativeInteger(summary.estimated_new_total_cents) &&
    configurations.every(Boolean) &&
    members.every(Boolean)
    ? {
        period: value.period,
        currency: value.currency,
        plan_fingerprint: value.plan_fingerprint,
        can_generate: value.can_generate,
        configurations: configurations as DuesGenerationConfiguration[],
        summary: {
          eligible_count: summary.eligible_count,
          ready_count: summary.ready_count,
          new_count: summary.new_count,
          existing_count: summary.existing_count,
          review_count: summary.review_count,
          conflict_count: summary.conflict_count,
          estimated_new_total_cents: summary.estimated_new_total_cents,
        },
        members: members as DuesGenerationMember[],
      }
    : null
}
function decodeGenerationResult(value: unknown): DuesGenerationResult | null {
  return isRecord(value) &&
    isString(value.period) &&
    isNonNegativeInteger(value.generated_obligation_count) &&
    isNonNegativeInteger(value.retained_existing_count) &&
    isNonNegativeInteger(value.review_count) &&
    isNonNegativeInteger(value.generated_total_cents)
    ? {
        period: value.period,
        generated_obligation_count: value.generated_obligation_count,
        retained_existing_count: value.retained_existing_count,
        review_count: value.review_count,
        generated_total_cents: value.generated_total_cents,
      }
    : null
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

export function planDuesGeneration(period: string) {
  return duesOperation(
    () =>
      apiFetch('/api/v1/dues/assessments/generation-plan', { method: 'POST', body: { period } }),
    decodeGenerationPlan,
  )
}

export function generateDuesAssessments(period: string, planFingerprint: string, key: string) {
  return duesOperation(
    () =>
      apiFetch('/api/v1/dues/assessments/generate', {
        method: 'POST',
        headers: { 'idempotency-key': key },
        body: { period, plan_fingerprint: planFingerprint },
      }),
    decodeGenerationResult,
  )
}

export function previewDuesAssessments(input: AssessmentPreviewInput) {
  return duesOperation(
    () => apiFetch('/api/v1/dues/assessments/preview', { method: 'POST', body: input }),
    decodePreview,
  )
}
export function executeDuesAssessmentRange(
  input: AssessmentPreviewInput & { preview_fingerprint: string },
  key: string,
) {
  return duesOperation(
    () =>
      apiFetch('/api/v1/dues/assessments/execute', {
        method: 'POST',
        headers: { 'idempotency-key': key },
        body: input,
      }),
    decodeRangeExecution,
  )
}

export function getDebt(socioId: string) {
  return duesOperation(() => apiFetch(`/api/v1/dues/debt/${socioId}`, { query: {} }), decodeDebt)
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

export function createFullSelectionPayment(input: FullSelectionPaymentInput, key: string) {
  return duesOperation(
    () =>
      apiFetch('/api/v1/dues/settlements', {
        method: 'POST',
        headers: { 'idempotency-key': key },
        body: input,
      }),
    decodeFullSelectionPayment,
  )
}

export function reverseDuesSettlement(
  settlementId: string,
  input: { reason: string },
  key: string,
) {
  return duesOperation(
    () =>
      apiFetch(`/api/v1/dues/settlements/${settlementId}/reverse`, {
        method: 'POST',
        headers: { 'idempotency-key': key },
        body: input,
      }),
    decodeSettlementReversal,
  )
}
