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
export class CondonationOperationError extends Error {
  // prettier-ignore
  constructor(readonly kind: 'partial_data' | 'permission' | 'conflict' | 'unavailable', cause?: unknown) {
    super('Condonation operation failed', { cause })
  }
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
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
