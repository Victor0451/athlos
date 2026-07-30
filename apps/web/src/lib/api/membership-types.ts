import { apiFetch } from '@/lib/api'

export type MembershipTypeCatalogState = 'applied' | 'unavailable'

export interface MembershipTypeSnapshot {
  catalog_state: MembershipTypeCatalogState
  snapshot_batch_id?: string
  reason?: 'no_current_catalog' | 'no_current_members_batch'
}

export interface MembershipTypeCatalogItem {
  source_row_id: string
  snapshot_batch_id: string
  code: string
  name: string
  letter: string
  catalog_state: 'applied'
  validated_count: number
  applied_resolution_count: number
  member_count: number
}

export interface MembershipTypeCatalogResponse {
  snapshot: MembershipTypeSnapshot
  items: MembershipTypeCatalogItem[]
  total: number
  page: number
  limit: number
  has_more: boolean
}

export interface MembershipTypeAssociatedMember {
  member_id: string
  member_number: number
  credential_ref: string | null
  lifecycle_state: 'imported' | 'validated' | 'review_required'
  association_sources: Array<'validated' | 'resolved'>
}

export interface MembershipTypeMembersResponse {
  snapshot: MembershipTypeSnapshot
  membership_type?: Pick<
    MembershipTypeCatalogItem,
    'source_row_id' | 'snapshot_batch_id' | 'code' | 'name' | 'letter' | 'catalog_state'
  >
  items: MembershipTypeAssociatedMember[]
  total: number
  page: number
  limit: number
  has_more: boolean
}

export interface MembershipTypeListParams {
  page?: number
  limit?: number
  q?: string
}

const BASE_PATH = '/api/v1/admin/membership-types'

export function getMembershipTypes(
  params: MembershipTypeListParams = {},
): Promise<MembershipTypeCatalogResponse> {
  return apiFetch<MembershipTypeCatalogResponse>(BASE_PATH, {
    query: { page: params.page, limit: params.limit, q: params.q },
  })
}

export function getMembershipTypeMembers(
  sourceRowId: string,
  params: MembershipTypeListParams = {},
): Promise<MembershipTypeMembersResponse> {
  return apiFetch<MembershipTypeMembersResponse>(`${BASE_PATH}/${sourceRowId}/members`, {
    query: { page: params.page, limit: params.limit, q: params.q },
  })
}
