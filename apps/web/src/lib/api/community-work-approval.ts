import { ApiError, apiFetch } from '@/lib/api'

export interface CommunityWorkRequestInput {
  member_id: string
  obligation_id: string
  context: string
  reason: string
  evidence: string
  agreement_id?: string
}
export interface CommunityWorkDecisionInput {
  decision: 'approved' | 'rejected'
  reason: string
  evidence: string
}
export interface CommunityWorkRequest {
  id: string
  status: 'pending' | 'approved' | 'rejected'
  expires_at: string
  decided_at: string | null
}
export type CommunityWorkLifecycleState =
  | 'pending'
  | 'rejected'
  | 'expired'
  | 'approved_awaiting_execution'
  | 'executed'
type CommunityWorkExecutionStatus = 'executed' | 'recoverable' | 'unavailable'
type CommunityWorkLifecycleObligation = {
  obligation_id: string
  currency: string
  outstanding_amount_cents: number
}
export interface CommunityWorkApprovalLifecycle {
  id: string
  state: CommunityWorkLifecycleState
  expires_at: string
  decided_at: string | null
  execution_id: string | null
  execution_status: CommunityWorkExecutionStatus
  snapshot: { member_id: string; obligations: CommunityWorkLifecycleObligation[] }
}
export interface CommunityWorkLifecyclePage {
  items: CommunityWorkApprovalLifecycle[]
}
export interface CommunityWorkExecution {
  execution_id: string
  approval_id: string
  request_id: string
  work_id: string
  settlement_id: string
  allocation_id: string
  socio_id: string
  obligation_id: string
  amount_cents: number
  currency: string
  status: 'executed' | 'replayed'
}
export interface CommunityWorkQueueItem extends CommunityWorkApprovalLifecycle {
  created_at: string
  current_member: { id: string; numero_socio: string; nombre: string; apellido: string }
  requester: { id: string; username: string }
  context: string
  reason: string
  evidence: string
}
export interface CommunityWorkQueuePage {
  items: CommunityWorkQueueItem[]
  next_cursor: string | null
}
export interface CommunityWorkQueueOptions {
  view?: 'all'
  limit?: number
  cursor?: string
}
export class CommunityWorkOperationError extends Error {
  // prettier-ignore
  constructor(readonly kind: 'partial_data' | 'permission' | 'conflict' | 'unavailable', cause?: unknown) {
    super('Community work operation failed', { cause })
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
const lifecycleState = (value: unknown): value is CommunityWorkLifecycleState =>
  value === 'pending' ||
  value === 'rejected' ||
  value === 'expired' ||
  value === 'approved_awaiting_execution' ||
  value === 'executed'
const executionStatus = (value: unknown): value is CommunityWorkExecutionStatus =>
  value === 'executed' || value === 'recoverable' || value === 'unavailable'
const lifecycleObligation = (value: unknown): CommunityWorkLifecycleObligation | null => {
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
const operationError = (cause: unknown): CommunityWorkOperationError => {
  if (cause instanceof ApiError)
    return new CommunityWorkOperationError(
      cause.status === 403 ? 'permission' : cause.status === 409 ? 'conflict' : 'unavailable',
      cause,
    )
  return new CommunityWorkOperationError('unavailable', cause)
}
// prettier-ignore
const request = (value: unknown): CommunityWorkRequest | null => {
  if (!record(value) || typeof value.id !== 'string' || typeof value.status !== 'string' || typeof value.expires_at !== 'string' || (typeof value.decided_at !== 'string' && value.decided_at !== null)) return null
  if (value.status !== 'pending' && value.status !== 'approved' && value.status !== 'rejected')
    return null
  return { id: value.id, status: value.status, expires_at: value.expires_at, decided_at: value.decided_at }
}
const lifecycle = (value: unknown): CommunityWorkApprovalLifecycle | null => {
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
    value.snapshot.obligations.length !== 1
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
        (obligation): obligation is CommunityWorkLifecycleObligation => obligation !== null,
      ),
    },
  }
}
const execution = (value: unknown): CommunityWorkExecution | null => {
  if (
    !exactRecord(value, [
      'execution_id',
      'approval_id',
      'request_id',
      'work_id',
      'settlement_id',
      'allocation_id',
      'socio_id',
      'obligation_id',
      'amount_cents',
      'currency',
      'status',
    ]) ||
    !uuid(value.execution_id) ||
    !uuid(value.approval_id) ||
    !uuid(value.request_id) ||
    !uuid(value.work_id) ||
    !uuid(value.settlement_id) ||
    !uuid(value.allocation_id) ||
    !uuid(value.socio_id) ||
    !uuid(value.obligation_id) ||
    typeof value.amount_cents !== 'number' ||
    !Number.isSafeInteger(value.amount_cents) ||
    value.amount_cents <= 0 ||
    typeof value.currency !== 'string' ||
    !/^[A-Z]{3}$/.test(value.currency) ||
    (value.status !== 'executed' && value.status !== 'replayed')
  )
    return null
  return {
    execution_id: value.execution_id,
    approval_id: value.approval_id,
    request_id: value.request_id,
    work_id: value.work_id,
    settlement_id: value.settlement_id,
    allocation_id: value.allocation_id,
    socio_id: value.socio_id,
    obligation_id: value.obligation_id,
    amount_cents: value.amount_cents,
    currency: value.currency,
    status: value.status,
  }
}
const requestInput = (input: CommunityWorkRequestInput): CommunityWorkRequestInput | null => {
  if (
    !uuid(input.member_id) ||
    !uuid(input.obligation_id) ||
    typeof input.context !== 'string' ||
    !input.context.trim() ||
    input.context.length > 1000 ||
    typeof input.reason !== 'string' ||
    !input.reason.trim() ||
    input.reason.length > 500 ||
    typeof input.evidence !== 'string' ||
    !input.evidence.trim() ||
    input.evidence.length > 1000 ||
    (input.agreement_id !== undefined && !uuid(input.agreement_id))
  )
    return null
  return input
}

const queueText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 1000
const queueCursor = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256
const queueItem = (value: unknown): CommunityWorkQueueItem | null => {
  if (!record(value)) return null
  const { created_at, current_member, requester, context, reason, evidence, ...state } = value
  const item = lifecycle(state)
  if (
    !item ||
    !time(created_at) ||
    !exactRecord(current_member, ['id', 'numero_socio', 'nombre', 'apellido']) ||
    !uuid(current_member.id) ||
    current_member.id.toLowerCase() !== item.snapshot.member_id.toLowerCase() ||
    !queueText(current_member.numero_socio) ||
    !queueText(current_member.nombre) ||
    !queueText(current_member.apellido) ||
    !exactRecord(requester, ['id', 'username']) ||
    !uuid(requester.id) ||
    !queueText(requester.username) ||
    !queueText(context) ||
    !queueText(reason) ||
    !queueText(evidence)
  )
    return null
  return {
    ...item,
    created_at,
    current_member: {
      id: current_member.id,
      numero_socio: current_member.numero_socio,
      nombre: current_member.nombre,
      apellido: current_member.apellido,
    },
    requester: { id: requester.id, username: requester.username },
    context,
    reason,
    evidence,
  }
}
/** Read one authoritative community-work queue page; callers choose when to follow the cursor. */
export const listCommunityWorkQueue = async ({
  view,
  limit = 25,
  cursor,
}: CommunityWorkQueueOptions = {}): Promise<CommunityWorkQueuePage> => {
  try {
    if (
      (view !== undefined && view !== 'all') ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (cursor !== undefined && !queueCursor(cursor))
    )
      throw new CommunityWorkOperationError('partial_data')
    const query = new URLSearchParams({ limit: String(limit) })
    if (view) query.set('view', view)
    if (cursor) query.set('cursor', cursor)
    const value = await apiFetch<unknown>(`/api/v1/community-work-requests?${query}`)
    if (
      !exactRecord(value, ['items', 'next_cursor']) ||
      !Array.isArray(value.items) ||
      (value.next_cursor !== null && !queueCursor(value.next_cursor))
    )
      throw new CommunityWorkOperationError('partial_data')
    const items = value.items.map(queueItem)
    if (
      items.some((item) => item === null) ||
      new Set(items.map((item) => item?.id.toLowerCase())).size !== items.length
    )
      throw new CommunityWorkOperationError('partial_data')
    return {
      items: items.filter((item): item is CommunityWorkQueueItem => item !== null),
      next_cursor: value.next_cursor,
    }
  } catch (cause) {
    if (cause instanceof CommunityWorkOperationError) throw cause
    throw operationError(cause)
  }
}
export const createCommunityWorkRequest = async (
  input: CommunityWorkRequestInput,
  key: string,
): Promise<CommunityWorkRequest> => {
  if (!key) throw new CommunityWorkOperationError('partial_data')
  const valid = requestInput(input)
  if (!valid) throw new CommunityWorkOperationError('partial_data')
  try {
    const body: Record<string, unknown> = {
      member_id: valid.member_id,
      obligation_id: valid.obligation_id,
      context: valid.context,
      reason: valid.reason,
      evidence: valid.evidence,
    }
    if (valid.agreement_id !== undefined) body.agreement_id = valid.agreement_id
    const result = request(
      await apiFetch<unknown>('/api/v1/community-work-requests', {
        method: 'POST',
        headers: { 'idempotency-key': key },
        body,
      }),
    )
    if (!result) throw new CommunityWorkOperationError('partial_data')
    return result
  } catch (cause) {
    if (cause instanceof CommunityWorkOperationError) throw cause
    throw operationError(cause)
  }
}
export const decideCommunityWorkRequest = async (
  id: string,
  input: CommunityWorkDecisionInput,
  key: string,
): Promise<CommunityWorkRequest> => {
  if (!uuid(id) || !key) throw new CommunityWorkOperationError('partial_data')
  try {
    const result = request(
      await apiFetch<unknown>(`/api/v1/community-work-requests/${id}/decision`, {
        method: 'POST',
        headers: { 'idempotency-key': key },
        body: input,
      }),
    )
    if (!result) throw new CommunityWorkOperationError('partial_data')
    return result
  } catch (cause) {
    if (cause instanceof CommunityWorkOperationError) throw cause
    throw operationError(cause)
  }
}
export const executeCommunityWorkRequest = async (
  id: string,
  executionId: string,
  key: string,
): Promise<CommunityWorkExecution> => {
  if (!uuid(id) || !uuid(executionId) || !key) throw new CommunityWorkOperationError('partial_data')
  try {
    const result = execution(
      await apiFetch<unknown>(`/api/v1/community-work-requests/${id}/execution`, {
        method: 'POST',
        headers: { 'idempotency-key': key },
        body: { execution_id: executionId },
      }),
    )
    if (!result) throw new CommunityWorkOperationError('partial_data')
    return result
  } catch (cause) {
    if (cause instanceof CommunityWorkOperationError) throw cause
    throw operationError(cause)
  }
}
export const listCommunityWorkLifecycle = async (
  memberId: string,
  limit = 25,
): Promise<CommunityWorkLifecyclePage> => {
  try {
    if (!uuid(memberId) || !Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new CommunityWorkOperationError('partial_data')
    const value = await apiFetch<unknown>(
      `/api/v1/members/${encodeURIComponent(memberId)}/community-work-requests?limit=${limit}`,
    )
    if (!exactRecord(value, ['items']) || !Array.isArray(value.items))
      throw new CommunityWorkOperationError('partial_data')
    const items = value.items.map(lifecycle)
    if (items.some((item) => item === null)) throw new CommunityWorkOperationError('partial_data')
    return {
      items: items.filter((item): item is CommunityWorkApprovalLifecycle => item !== null),
    }
  } catch (cause) {
    if (cause instanceof CommunityWorkOperationError) throw cause
    throw operationError(cause)
  }
}
