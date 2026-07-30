import { ApiError, apiFetch } from '@/lib/api'

export type EvidenceExceptionKind = 'unknown_type' | 'ambiguous_identity'
export type EvidenceExceptionStatus = 'unresolved' | 'resolved'

/** Wire DTO for the administrative Socios evidence exception inbox. */
export interface SociosEvidenceException {
  id: string
  kind: EvidenceExceptionKind
  status: EvidenceExceptionStatus
  fingerprint: string
  legacy_type_code: string
  created_at: string
}

export interface SociosEvidenceExceptionListResponse {
  items: SociosEvidenceException[]
  total: number
  page: number
  limit: number
  has_more: boolean
}

export interface SociosEvidenceExceptionParams {
  page?: number
  limit?: number
  kind?: EvidenceExceptionKind
  status?: EvidenceExceptionStatus
}

export interface SociosEvidenceExceptionDetail extends SociosEvidenceException {
  socios_batch_id: string
  catalog_batch_id: string | null
  deterministic_type_candidate_source_row_id: string | null
  known_member: MemberOption | null
  current_resolution: (EvidenceResolution & { applied_at: string | null }) | null
}

export interface MemberOption {
  id: string
  member_number: number
  credential_ref: string | null
  lifecycle_state: string
}

export interface MembershipTypeOption {
  source_row_id: string
  snapshot_batch_id: string
  code: string
  name: string
  letter: string | null
}

export interface ResolutionInput {
  kind: EvidenceExceptionKind
  evidence_fingerprint: string
  reason: string
  selected_member_id: string
  selected_type_candidate_source_row_id?: string
}

export interface EvidenceResolution {
  id: string
  evidence_id: string
  kind: EvidenceExceptionKind
  selected_member_id: string
  selected_type_candidate_source_row_id: string | null
  application_status: 'pending_application' | 'applied'
  created_at: string
}

export interface ClosurePreview {
  previewId: string
  fingerprint: string
  resolutionSetFingerprint: string
  counts: { catalog: number; socios: number; resolutions: number }
}

export type ClosureConfirmation =
  | { status: 'accepted'; jobRunId: string }
  | { status: 'replay' }
  | { status: 'conflict' | 'stale' | 'held' }
  | { status: 'cancelled' }

export interface ClosureReference {
  catalogBatchId: string
  sociosBatchId: string
}

const BASE_PATH = '/api/v1/admin/socios-evidence-exceptions'

export function getSociosEvidenceExceptions(
  params: SociosEvidenceExceptionParams = {},
): Promise<SociosEvidenceExceptionListResponse> {
  return apiFetch<SociosEvidenceExceptionListResponse>(BASE_PATH, {
    query: {
      page: params.page,
      limit: params.limit,
      kind: params.kind,
      status: params.status,
    },
  })
}

export function getSociosEvidenceException(id: string): Promise<SociosEvidenceExceptionDetail> {
  return apiFetch<SociosEvidenceExceptionDetail>(`${BASE_PATH}/${id}`)
}

export function searchMemberOptions(q: string): Promise<{ items: MemberOption[] }> {
  return apiFetch(`${BASE_PATH}/options/members`, { query: { q } })
}

export function searchMembershipTypeOptions(q: string): Promise<{ items: MembershipTypeOption[] }> {
  return apiFetch(`${BASE_PATH}/options/membership-types`, { query: { q } })
}

export function resolveSociosEvidenceException(
  id: string,
  input: ResolutionInput,
  idempotencyKey: string,
): Promise<EvidenceResolution> {
  return apiFetch(`${BASE_PATH}/${id}/resolutions`, {
    method: 'POST',
    body: input,
    headers: { 'Idempotency-Key': idempotencyKey },
  })
}

export function previewSociosEvidenceClosure(input: ClosureReference): Promise<ClosurePreview> {
  return apiFetch('/api/v1/admin/socios-evidence-closures/preview', { method: 'POST', body: input })
}

export async function confirmSociosEvidenceClosure(
  input: ClosureReference &
    Pick<ClosurePreview, 'previewId' | 'fingerprint' | 'resolutionSetFingerprint'>,
  idempotencyKey: string,
): Promise<ClosureConfirmation> {
  try {
    return await apiFetch('/api/v1/admin/socios-evidence-closures/confirm', {
      method: 'POST',
      body: input,
      headers: { 'Idempotency-Key': idempotencyKey },
    })
  } catch (error) {
    if (error instanceof ApiError && error.status === 499) return { status: 'cancelled' }
    throw error
  }
}
