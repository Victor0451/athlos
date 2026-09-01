import { ApiError, apiFetch } from '@/lib/api'

export interface CondonationRequestInput {
  member_id: string
  obligation_ids: string[]
  context: string
  reason: string
  evidence: string
}
export interface CondonationDecisionInput {
  decision: 'approved' | 'rejected'
  reason: string
  evidence: string
}
export interface CondonationRequest {
  id: string
  status: 'pending' | 'approved' | 'rejected'
  expires_at: string
  decided_at: string | null
}
export type CondonationLifecycleState =
  | 'pending'
  | 'rejected'
  | 'expired'
  | 'approved_awaiting_execution'
  | 'executed'
type CondonationExecutionStatus = 'executed' | 'recoverable' | 'unavailable'
type CondonationLifecycleObligation = {
  obligation_id: string
  currency: string
  outstanding_amount_cents: number
}
export interface CondonationLifecycle {
  id: string
  state: CondonationLifecycleState
  expires_at: string
  decided_at: string | null
  execution_id: string | null
  execution_status: CondonationExecutionStatus
  snapshot: { member_id: string; obligations: CondonationLifecycleObligation[] }
}
export interface CondonationLifecyclePage {
  items: CondonationLifecycle[]
}
export interface CondonationExecution {
  execution_id: string
  approval_id: string
  member_id: string
  currency: string
  approved_amount_cents: number
  treatment_ids: string[]
  status: 'executed' | 'replayed'
}
export class CondonationOperationError extends Error {
  // prettier-ignore
  constructor(readonly kind: 'partial_data' | 'permission' | 'conflict' | 'unavailable', cause?: unknown) {
    super('Condonation operation failed', { cause })
  }
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const exactRecord = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  record(value) &&
  Object.keys(value).every((key) => keys.includes(key)) &&
  keys.every((key) => key in value)
const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)
const time = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value))
const nullableTime = (value: unknown): value is string | null => value === null || time(value)
const nullableUuid = (value: unknown): value is string | null => value === null || uuid(value)
const lifecycleState = (value: unknown): value is CondonationLifecycleState =>
  value === 'pending' ||
  value === 'rejected' ||
  value === 'expired' ||
  value === 'approved_awaiting_execution' ||
  value === 'executed'
const executionStatus = (value: unknown): value is CondonationExecutionStatus =>
  value === 'executed' || value === 'recoverable' || value === 'unavailable'
const lifecycleObligation = (value: unknown): CondonationLifecycleObligation | null => {
  if (
    !exactRecord(value, ['obligation_id', 'currency', 'outstanding_amount_cents']) ||
    !uuid(value.obligation_id) ||
    typeof value.currency !== 'string' ||
    !/^[A-Z]{3}$/.test(value.currency) ||
    typeof value.outstanding_amount_cents !== 'number' ||
    !Number.isSafeInteger(value.outstanding_amount_cents) ||
    value.outstanding_amount_cents <= 0
  )
    return null
  return {
    obligation_id: value.obligation_id,
    currency: value.currency,
    outstanding_amount_cents: value.outstanding_amount_cents,
  }
}
// prettier-ignore
const decode = (value: unknown): CondonationRequest | null => {
  if (!record(value) || typeof value.id !== 'string' || typeof value.status !== 'string' || typeof value.expires_at !== 'string' || (typeof value.decided_at !== 'string' && value.decided_at !== null)) return null
  if (value.status !== 'pending' && value.status !== 'approved' && value.status !== 'rejected')
    return null
  return { id: value.id, status: value.status, expires_at: value.expires_at, decided_at: value.decided_at }
}
// prettier-ignore
const operation = async (run: () => Promise<unknown>) => {
  try {
    const result = decode(await run())
    if (!result) throw new CondonationOperationError('partial_data')
    return result
  } catch (cause) {
    if (cause instanceof CondonationOperationError) throw cause
    if (cause instanceof ApiError)
      throw new CondonationOperationError(
        cause.status === 403 ? 'permission' : cause.status === 409 ? 'conflict' : 'unavailable',
        cause,
      )
    throw new CondonationOperationError('unavailable', cause)
  }
}
const lifecycle = (value: unknown): CondonationLifecycle | null => {
  if (
    !exactRecord(value, [
      'id',
      'state',
      'expires_at',
      'decided_at',
      'execution_id',
      'execution_status',
      'snapshot',
    ]) ||
    !uuid(value.id) ||
    !lifecycleState(value.state) ||
    !time(value.expires_at) ||
    !nullableTime(value.decided_at) ||
    !nullableUuid(value.execution_id) ||
    !executionStatus(value.execution_status) ||
    !exactRecord(value.snapshot, ['member_id', 'obligations']) ||
    !uuid(value.snapshot.member_id) ||
    !Array.isArray(value.snapshot.obligations) ||
    value.snapshot.obligations.length === 0
  )
    return null
  const obligations = value.snapshot.obligations.map(lifecycleObligation)
  if (obligations.some((obligation) => obligation === null)) return null
  return {
    id: value.id,
    state: value.state,
    expires_at: value.expires_at,
    decided_at: value.decided_at,
    execution_id: value.execution_id,
    execution_status: value.execution_status,
    snapshot: {
      member_id: value.snapshot.member_id,
      obligations: obligations.filter(
        (obligation): obligation is CondonationLifecycleObligation => obligation !== null,
      ),
    },
  }
}
export const listCondonationLifecycle = async (
  memberId: string,
  limit = 25,
): Promise<CondonationLifecyclePage> => {
  try {
    if (!uuid(memberId) || !Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new CondonationOperationError('partial_data')
    const value = await apiFetch<unknown>(
      `/api/v1/members/${encodeURIComponent(memberId)}/condonation-requests?limit=${limit}`,
    )
    if (!exactRecord(value, ['items']) || !Array.isArray(value.items))
      throw new CondonationOperationError('partial_data')
    const items = value.items.map(lifecycle)
    if (items.some((item) => item === null)) throw new CondonationOperationError('partial_data')
    return { items: items.filter((item): item is CondonationLifecycle => item !== null) }
  } catch (cause) {
    if (cause instanceof CondonationOperationError) throw cause
    throw new CondonationOperationError('unavailable', cause)
  }
}
const execution = (value: unknown): CondonationExecution | null => {
  if (
    !exactRecord(value, [
      'execution_id',
      'approval_id',
      'member_id',
      'currency',
      'approved_amount_cents',
      'treatment_ids',
      'status',
    ]) ||
    !uuid(value.execution_id) ||
    !uuid(value.approval_id) ||
    !uuid(value.member_id) ||
    typeof value.currency !== 'string' ||
    !/^[A-Z]{3}$/.test(value.currency) ||
    typeof value.approved_amount_cents !== 'number' ||
    !Number.isSafeInteger(value.approved_amount_cents) ||
    value.approved_amount_cents < 0 ||
    !Array.isArray(value.treatment_ids) ||
    value.treatment_ids.length === 0 ||
    !value.treatment_ids.every(uuid) ||
    (value.status !== 'executed' && value.status !== 'replayed')
  )
    return null
  return {
    execution_id: value.execution_id,
    approval_id: value.approval_id,
    member_id: value.member_id,
    currency: value.currency,
    approved_amount_cents: value.approved_amount_cents,
    treatment_ids: value.treatment_ids,
    status: value.status,
  }
}
export const createCondonationRequest = (input: CondonationRequestInput, key: string) =>
  operation(() =>
    apiFetch('/api/v1/condonation-requests', {
      method: 'POST',
      headers: { 'idempotency-key': key },
      body: { ...input, obligation_ids: [...input.obligation_ids].sort() },
    }),
  )
export const decideCondonationRequest = (
  id: string,
  input: CondonationDecisionInput,
  key: string,
) =>
  operation(() =>
    apiFetch(`/api/v1/condonation-requests/${id}/decision`, {
      method: 'POST',
      headers: { 'idempotency-key': key },
      body: input,
    }),
  )
export const executeCondonationRequest = async (id: string, executionId: string, key: string) => {
  try {
    if (!uuid(id) || !uuid(executionId) || !key) throw new CondonationOperationError('partial_data')
    const result = execution(
      await apiFetch<unknown>(`/api/v1/condonation-requests/${id}/execution`, {
        method: 'POST',
        headers: { 'idempotency-key': key },
        body: { execution_id: executionId },
      }),
    )
    if (!result) throw new CondonationOperationError('partial_data')
    return result
  } catch (cause) {
    if (cause instanceof CondonationOperationError) throw cause
    if (cause instanceof ApiError)
      throw new CondonationOperationError(
        cause.status === 403 ? 'permission' : cause.status === 409 ? 'conflict' : 'unavailable',
        cause,
      )
    throw new CondonationOperationError('unavailable', cause)
  }
}
