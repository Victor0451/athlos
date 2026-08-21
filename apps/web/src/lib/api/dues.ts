import { apiFetch } from '@/lib/api'

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
