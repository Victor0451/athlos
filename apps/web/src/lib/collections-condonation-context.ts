export type CollectionsCondonationContext = { memberId: string; requestId: string }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseCondonationContext(
  params: Pick<URLSearchParams, 'getAll'>,
): CollectionsCondonationContext | null {
  const members = params.getAll('condonation_member')
  const requests = params.getAll('condonation_request')
  if (members.length !== 1 || requests.length !== 1) return null
  const memberId = members[0]?.toLowerCase()
  const requestId = requests[0]?.toLowerCase()
  return memberId && requestId && uuid.test(memberId) && uuid.test(requestId)
    ? { memberId, requestId }
    : null
}

export function buildCondonationContextHref(memberId: string, requestId: string): string | null {
  const context = parseCondonationContext(
    new URLSearchParams({ condonation_member: memberId, condonation_request: requestId }),
  )
  return context
    ? `/collections?condonation_member=${context.memberId}&condonation_request=${context.requestId}`
    : null
}

export function buildCondonationContextCleanupHref(
  params: Pick<URLSearchParams, 'forEach'>,
): string {
  const cleaned = new URLSearchParams()
  params.forEach((value, key) => {
    if (key !== 'condonation_member' && key !== 'condonation_request') cleaned.append(key, value)
  })
  const query = cleaned.toString()
  return query ? `/collections?${query}` : '/collections'
}
