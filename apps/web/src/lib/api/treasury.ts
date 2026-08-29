import { apiFetch } from '@/lib/api'
// prettier-ignore
export interface CashShift{id:string;desk_id:string;status:'OPEN'|'CLOSED';business_date:string;assigned_operator_id:string;opened_at:string;closed_at:string|null}
// prettier-ignore
export interface CashClose{id:string;shift_id:string;expected_tenders:Record<string,number>;counted_tenders:Record<string,number>;discrepancy:Record<string,number>;reason:string|null;closed_at:string;force_close?:boolean}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const decodeShift = (value: unknown): CashShift | null => {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.desk_id !== 'string' ||
    (value.status !== 'OPEN' && value.status !== 'CLOSED') ||
    typeof value.business_date !== 'string' ||
    typeof value.assigned_operator_id !== 'string' ||
    typeof value.opened_at !== 'string' ||
    (value.closed_at !== null && typeof value.closed_at !== 'string')
  )
    return null
  return {
    id: value.id,
    desk_id: value.desk_id,
    status: value.status,
    business_date: value.business_date,
    assigned_operator_id: value.assigned_operator_id,
    opened_at: value.opened_at,
    closed_at: value.closed_at,
  }
}
// prettier-ignore
const headers=(key:string)=>({'idempotency-key':key})
// prettier-ignore
export function getCashShifts(){return apiFetch<{items:CashShift[]}>('/api/v1/treasury/shifts')}
export async function getOpenCashShifts(): Promise<CashShift[]> {
  const value = await apiFetch<unknown>('/api/v1/treasury/shifts')
  if (!isRecord(value) || !Array.isArray(value.items))
    throw new Error('Treasury shift response was incomplete')
  const shifts: CashShift[] = []
  for (const item of value.items) {
    const shift = decodeShift(item)
    if (!shift) throw new Error('Treasury shift response was incomplete')
    shifts.push(shift)
  }
  return shifts.filter(({ status }) => status === 'OPEN')
}
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
