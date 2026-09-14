import { describe, expect, it } from 'vitest'
import {
  buildCondonationContextCleanupHref,
  buildCondonationContextHref,
  parseCondonationContext,
} from './collections-condonation-context'

const memberId = '00000000-0000-4000-8000-000000000001'
const requestId = '00000000-0000-4000-8000-000000000002'

describe('collections condonation context', () => {
  it('builds and parses one canonical member/request pair', () => {
    const href = buildCondonationContextHref(memberId.toUpperCase(), requestId.toUpperCase())
    expect(href).toBe(
      `/collections?condonation_member=${memberId}&condonation_request=${requestId}`,
    )
    expect(parseCondonationContext(new URLSearchParams(href!.split('?')[1]))).toEqual({
      memberId,
      requestId,
    })
  })

  it.each([
    '',
    `condonation_member=${memberId}`,
    `condonation_request=${requestId}`,
    `condonation_member=invalid&condonation_request=${requestId}`,
    `condonation_member=${memberId}&condonation_request=invalid`,
    `condonation_member=${memberId}&condonation_member=${memberId}&condonation_request=${requestId}`,
    `condonation_member=${memberId}&condonation_request=${requestId}&condonation_request=${requestId}`,
  ])('rejects an incomplete, duplicate or malformed pair: %s', (query) => {
    expect(parseCondonationContext(new URLSearchParams(query))).toBeNull()
  })

  it('removes only handoff fields while preserving unrelated order and duplicates', () => {
    const params = new URLSearchParams(
      `before=one&condonation_member=${memberId}&tag=first&tag=second&condonation_request=${requestId}&after=two`,
    )
    expect(buildCondonationContextCleanupHref(params)).toBe(
      '/collections?before=one&tag=first&tag=second&after=two',
    )
  })
})
