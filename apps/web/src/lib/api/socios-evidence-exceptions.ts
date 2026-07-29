import { apiFetch } from '@/lib/api'

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
  member_choices: { id: string; member_number: number }[]
  type_choices: { source_row_id: string; code: string; name: string }[]
  deterministic_type_candidate_source_row_id: string | null
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
