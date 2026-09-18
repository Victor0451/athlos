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
export interface CashMovement {
  id: string
  direction: 'INCOME' | 'EXPENSE'
  tender: string
  amount_cents: number
  source_type: string
  source_id?: string
  created_at: string
  account_code_snapshot?: string
  account_name_snapshot?: string
  description?: string
  /** Present on rows that reverse an earlier manual movement (append-only ledger). */
  reverses_tender_id?: string
  /** Reason stored on the reversal row itself. */
  reason?: string
}

const decodeMovement = (value: unknown): CashMovement | null => {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    (value.direction !== 'INCOME' && value.direction !== 'EXPENSE') ||
    typeof value.tender !== 'string' ||
    typeof value.amount_cents !== 'number' ||
    !Number.isSafeInteger(value.amount_cents) ||
    typeof value.source_type !== 'string' ||
    (value.source_id !== undefined && typeof value.source_id !== 'string') ||
    typeof value.created_at !== 'string' ||
    (value.account_code_snapshot !== undefined &&
      typeof value.account_code_snapshot !== 'string') ||
    (value.account_name_snapshot !== undefined &&
      typeof value.account_name_snapshot !== 'string') ||
    (value.description !== undefined && typeof value.description !== 'string') ||
    (value.reverses_tender_id !== undefined && typeof value.reverses_tender_id !== 'string') ||
    (value.reason !== undefined && typeof value.reason !== 'string')
  )
    return null
  return {
    id: value.id,
    direction: value.direction,
    tender: value.tender,
    amount_cents: value.amount_cents,
    source_type: value.source_type,
    ...(value.source_id === undefined ? {} : { source_id: value.source_id }),
    created_at: value.created_at,
    // prettier-ignore
    ...(value.account_code_snapshot === undefined ? {} : { account_code_snapshot: value.account_code_snapshot, account_name_snapshot: value.account_name_snapshot as string, description: value.description as string }),
    ...(value.reverses_tender_id === undefined
      ? {}
      : { reverses_tender_id: value.reverses_tender_id }),
    ...(value.reason === undefined ? {} : { reason: value.reason }),
  }
}

export interface CashShiftDetail {
  shift: CashShift
  close: CashClose | null
  movements?: CashMovement[]
  expected_tenders?: Record<string, number>
  opening_tenders?: Record<string, number>
}

const isTotals = (value: unknown): value is Record<string, number> =>
  isRecord(value) &&
  Object.values(value).every((amount) => typeof amount === 'number' && Number.isSafeInteger(amount))

export async function getCashShiftDetail(shiftId: string): Promise<CashShiftDetail> {
  const value = await apiFetch<unknown>('/api/v1/treasury/shifts/' + encodeURIComponent(shiftId))
  const invalid = () => new Error('Treasury shift detail response was incomplete')
  if (!isRecord(value)) throw invalid()
  const shift = decodeShift(value.shift)
  if (!shift || shift.id !== shiftId) throw invalid()
  // U9-A additive fields: present for fresh details, absent for legacy shapes; never guessed.
  let extension: Pick<CashShiftDetail, 'movements' | 'expected_tenders' | 'opening_tenders'> = {}
  if (value.movements !== undefined) {
    if (
      !Array.isArray(value.movements) ||
      !isTotals(value.expected_tenders) ||
      !isTotals(value.opening_tenders)
    )
      throw invalid()
    const movements: CashMovement[] = []
    for (const raw of value.movements) {
      const movement = decodeMovement(raw)
      if (!movement || movement.amount_cents < 0) throw invalid()
      movements.push(movement)
    }
    extension = {
      movements,
      expected_tenders: value.expected_tenders,
      opening_tenders: value.opening_tenders,
    }
  }
  if (value.close === null) return { shift, close: null, ...extension }
  const close = value.close
  if (
    !isRecord(close) ||
    typeof close.id !== 'string' ||
    close.shift_id !== shiftId ||
    !isTotals(close.expected_tenders) ||
    !isTotals(close.counted_tenders) ||
    !isTotals(close.discrepancy) ||
    (close.reason !== null && typeof close.reason !== 'string') ||
    typeof close.closed_at !== 'string' ||
    !Number.isFinite(new Date(close.closed_at).getTime()) ||
    (close.force_close !== undefined && typeof close.force_close !== 'boolean')
  )
    throw invalid()
  return {
    shift,
    close: {
      id: close.id,
      shift_id: shiftId,
      expected_tenders: close.expected_tenders,
      counted_tenders: close.counted_tenders,
      discrepancy: close.discrepancy,
      reason: close.reason,
      closed_at: close.closed_at,
      ...(close.force_close === undefined ? {} : { force_close: close.force_close }),
    },
    ...extension,
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
export function closeCashShift(shiftId:string,countedTenders:Record<string,number>,reason:string,key:string,drawerFloatCents?:number){return apiFetch<CashClose>('/api/v1/treasury/shifts/'+shiftId+'/close',{method:'POST',headers:headers(key),body:{counted_tenders:countedTenders,...(reason?{reason}:{}),...(drawerFloatCents===undefined?{}:{drawer_float_cents:drawerFloatCents})}})}
/** P9: idempotent auto-open of the operator's own working period (last close remainder). */
export function ensureOpenCashShift(key: string) {
  return apiFetch<{ shift: CashShift }>('/api/v1/treasury/shifts/ensure-open', {
    method: 'POST',
    headers: headers(key),
    body: {},
  }).then((result) => result.shift)
}
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
/** P6: reverses a MANUAL tender with an opposite-direction reversal (append-only). */
export function reverseCashTender(shiftId: string, tenderId: string, reason: string, key: string) {
  return apiFetch('/api/v1/treasury/shifts/' + shiftId + '/tenders/' + tenderId + '/reverse', {
    method: 'POST',
    headers: headers(key),
    body: { reason },
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
    account_code?: string
    description?: string
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
