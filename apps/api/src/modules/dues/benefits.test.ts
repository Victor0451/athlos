import { describe, expect, it } from 'vitest'
import { applyBenefits, type ApplicableBenefit } from './benefits.ts'

// prettier-ignore
const benefit = (overrides: Partial<ApplicableBenefit> = {}): ApplicableBenefit => ({
  id: 'benefit-1', kind: 'FIXED_DISCOUNT', scope: 'MEMBER', amountCents: 2_000, percentage: null,
  currency: 'ARS', effectiveFrom: '2026-01-01', effectiveTo: null, reason: 'approved',
  authorizationEvidence: { approval: 'ticket-1' }, ...overrides,
})

describe('dues benefit application', () => {
  it('applies fixed discounts as immutable negative components', () => {
    expect(applyBenefits(10_000, [benefit()], 'ARS')).toMatchObject({
      totalCents: 8_000,
      components: [{ kind: 'BENEFIT', amountCents: -2_000, componentKey: 'benefit:benefit-1' }],
    })
  })

  it('stacks member before family percentage scholarships and caps at gross debt', () => {
    // prettier-ignore
    const result = applyBenefits(10_000, [
      benefit({ id: 'family', scope: 'FAMILY', kind: 'SCHOLARSHIP', amountCents: null, percentage: 60 }),
      benefit({ id: 'member', scope: 'MEMBER', kind: 'PERCENT_DISCOUNT', amountCents: null, percentage: 50 }),
    ], 'ARS')
    expect(result.totalCents).toBe(0)
    expect(result.components.map((item) => item.amountCents)).toEqual([-5_000, -5_000])
  })
})
