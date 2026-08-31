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
  used_at: string | null
  execution_id: string | null
  execution_status: CondonationExecutionStatus
  snapshot: { member_id: string; obligations: CondonationLifecycleObligation[] }
  requester: { operator_id: string }
  approver?: { operator_id: string }
  reason: string | null
  evidence: string | null
  decision: { reason: string | null; evidence: string | null } | null
}
export interface CondonationLifecyclePage {
  items: CondonationLifecycle[]
}
export class CondonationOperationError extends Error {
  // prettier-ignore
  constructor(readonly kind: 'partial_data' | 'permission' | 'conflict' | 'unavailable', cause?: unknown) {
    super('Condonation operation failed', { cause })
  }
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)
const time = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value))
const nullableString = (value: unknown): value is string | null =>
  typeof value === 'string' || value === null
const nonNegativeCents = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Number.isSafeInteger(value) && value >= 0
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
    !record(value) ||
    !uuid(value.obligation_id) ||
    typeof value.currency !== 'string' ||
    !/^[A-Z]{3}$/.test(value.currency) ||
    !nonNegativeCents(value.outstanding_amount_cents)
  )
    return null
  return {
    obligation_id: value.obligation_id,
    currency: value.currency,
    outstanding_amount_cents: value.outstanding_amount_cents,
  }
}
const lifecycleDecision = (
  value: unknown,
): { reason: string | null; evidence: string | null } | null => {
  if (!record(value) || !nullableString(value.reason) || !nullableString(value.evidence))
    return null
  return { reason: value.reason, evidence: value.evidence }
}
const lifecycleOperator = (value: unknown): { operator_id: string } | null => {
  if (!record(value) || !uuid(value.operator_id)) return null
  return { operator_id: value.operator_id }
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
    !record(value) ||
    !uuid(value.id) ||
    !lifecycleState(value.state) ||
    !time(value.expires_at) ||
    !nullableString(value.decided_at) ||
    !nullableString(value.used_at) ||
    !nullableString(value.execution_id) ||
    !executionStatus(value.execution_status) ||
    !record(value.snapshot) ||
    !uuid(value.snapshot.member_id) ||
    !Array.isArray(value.snapshot.obligations) ||
    !record(value.requester) ||
    !uuid(value.requester.operator_id) ||
    !nullableString(value.reason) ||
    !nullableString(value.evidence)
  )
    return null
  const obligations = value.snapshot.obligations.map(lifecycleObligation)
  if (obligations.some((obligation) => obligation === null)) return null
  const approver = value.approver === undefined ? undefined : lifecycleOperator(value.approver)
  if (approver === null) return null
  const decision = value.decision === null ? null : lifecycleDecision(value.decision)
  if (value.decision !== null && decision === null) return null
  return {
    id: value.id,
    state: value.state,
    expires_at: value.expires_at,
    decided_at: value.decided_at,
    used_at: value.used_at,
    execution_id: value.execution_id,
    execution_status: value.execution_status,
    snapshot: {
      member_id: value.snapshot.member_id,
      obligations: obligations.filter(
        (obligation): obligation is CondonationLifecycleObligation => obligation !== null,
      ),
    },
    requester: { operator_id: value.requester.operator_id },
    ...(approver === undefined ? {} : { approver }),
    reason: value.reason,
    evidence: value.evidence,
    decision,
  }
}
export const listCondonationLifecycle = async (
  memberId: string,
  limit = 25,
): Promise<CondonationLifecyclePage> => {
  try {
    const value = await apiFetch<unknown>(
      `/api/v1/members/${encodeURIComponent(memberId)}/condonation-requests?limit=${limit}`,
    )
    if (!record(value) || !Array.isArray(value.items))
      throw new CondonationOperationError('partial_data')
    const items = value.items.map(lifecycle)
    if (items.some((item) => !item)) throw new CondonationOperationError('partial_data')
    return { items: items.filter((item): item is CondonationLifecycle => item !== null) }
  } catch (cause) {
    if (cause instanceof CondonationOperationError) throw cause
    throw new CondonationOperationError('unavailable', cause)
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
