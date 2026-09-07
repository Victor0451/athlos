import { describe, expect, it } from 'vitest'
import { buildCashContextHref, parseCashContext } from './collections-cash-context'

const memberId = '00000000-0000-4000-8000-000000000001'
const obligationId = '00000000-0000-4000-8000-000000000002'
const secondObligationId = '00000000-0000-4000-8000-000000000003'

describe('collections cash context', () => {
  it('builds and parses canonical member and obligation IDs only', () => {
    const href = buildCashContextHref('/tesoreria', memberId, [secondObligationId, obligationId])
    expect(href).toBe(
      `/tesoreria?cash_member=${memberId}&cash_obligations=${obligationId},${secondObligationId}`,
    )
    expect(parseCashContext(new URLSearchParams(href!.split('?')[1]))).toEqual({
      memberId,
      obligationIds: [obligationId, secondObligationId],
    })
  })

  it('rejects malformed, duplicate and excessive URL context', () => {
    expect(parseCashContext(new URLSearchParams('cash_member=not-a-uuid'))).toBeNull()
    expect(
      parseCashContext(
        new URLSearchParams(
          `cash_member=${memberId}&cash_obligations=${obligationId},${obligationId}`,
        ),
      ),
    ).toBeNull()
    expect(
      parseCashContext(
        new URLSearchParams(
          `cash_member=${memberId}&cash_obligations=${Array.from({ length: 101 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`).join(',')}`,
        ),
      ),
    ).toBeNull()
  })
})
