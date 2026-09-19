export type CollectionsCashContext = {
  memberId: string
  obligationIds: string[]
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const maxObligations = 100

export function parseCashContext(
  params: Pick<URLSearchParams, 'get' | 'getAll'>,
): CollectionsCashContext | null {
  const memberValues = params.getAll('cash_member')
  const obligationValues = params.getAll('cash_obligations')
  const memberId = memberValues[0]?.toLowerCase()
  const rawObligations = obligationValues[0]
  if (
    memberValues.length !== 1 ||
    obligationValues.length !== 1 ||
    !memberId ||
    !uuid.test(memberId) ||
    rawObligations === undefined
  )
    return null
  const obligationIds = rawObligations
    ? rawObligations.split(',').map((id) => id.toLowerCase())
    : []
  if (
    obligationIds.length > maxObligations ||
    obligationIds.some((id) => !uuid.test(id)) ||
    new Set(obligationIds).size !== obligationIds.length
  )
    return null
  return { memberId, obligationIds: [...obligationIds].sort() }
}

export function buildCashContextHref(
  path: '/collections' | '/tesoreria',
  memberId: string,
  ids: string[],
) {
  const context = parseCashContext(
    new URLSearchParams({ cash_member: memberId, cash_obligations: ids.join(',') }),
  )
  if (!context) return null
  return `${path}?cash_member=${context.memberId}&cash_obligations=${context.obligationIds.join(',')}`
}
