import { apiFetch } from '@/lib/api'
// prettier-ignore
export interface CashShift{id:string;desk_id:string;status:'OPEN'|'CLOSED';business_date?:string;assigned_operator_id?:string;opened_at?:string;closed_at?:string|null}
// prettier-ignore
export interface CashClose{id:string;shift_id:string;expected_tenders:Record<string,number>;counted_tenders:Record<string,number>;discrepancy:Record<string,number>;reason:string|null;closed_at:string;force_close?:boolean}
// prettier-ignore
const headers=(key:string)=>({'idempotency-key':key})
// prettier-ignore
export function getCashShifts(){return apiFetch<{items:CashShift[]}>('/api/v1/treasury/shifts')}
// prettier-ignore
export function openCashShift(deskId:string,openingTenders:Record<string,number>,key:string){return apiFetch<CashShift>('/api/v1/treasury/shifts',{method:'POST',headers:headers(key),body:{desk_id:deskId,opening_tenders:openingTenders}})}
// prettier-ignore
export function closeCashShift(shiftId:string,countedTenders:Record<string,number>,reason:string,key:string){return apiFetch<CashClose>('/api/v1/treasury/shifts/'+shiftId+'/close',{method:'POST',headers:headers(key),body:{counted_tenders:countedTenders,...(reason?{reason}:{})}})}
export function forceCloseCashShift(
  shiftId: string,
  countedTenders: Record<string, number>,
  reason: string,
  key: string,
) {
  return apiFetch<CashClose>('/api/v1/treasury/shifts/' + shiftId + '/close', {
    method: 'POST',
    headers: headers(key),
    body: { counted_tenders: countedTenders, force_close: true, reason },
  })
}
export function recordCashTender(
  shiftId: string,
  input: {
    direction: 'INCOME' | 'EXPENSE'
    tender: string
    amount_cents: number
    source_type: 'SETTLEMENT' | 'MANUAL'
    source_id?: string
    reason?: string
  },
  key: string,
) {
  return apiFetch('/api/v1/treasury/shifts/' + shiftId + '/tenders', {
    method: 'POST',
    headers: headers(key),
    body: input,
  })
}
export function includeCashExpense(shiftId: string, gastoId: string, tender: string, key: string) {
  return apiFetch('/api/v1/treasury/shifts/' + shiftId + '/expenses', {
    method: 'POST',
    headers: headers(key),
    body: { gasto_id: gastoId, tender },
  })
}
