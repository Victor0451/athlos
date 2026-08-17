import { describe, expect, it } from 'vitest'
import { applyBenefits, type ApplicableBenefit } from './benefits.ts'

const benefit = (overrides: Partial<ApplicableBenefit> = {}): ApplicableBenefit => ({
  id: 'benefit-1',
  kind: 'FIXED_DISCOUNT',
  socioId: 'member-1',
  familyGroupId: null,
  amountCents: 1_000,
  percentage: null,
  currency: 'ARS',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  priority: 10,
  combinability: 'COMBINABLE',
  exclusiveGroup: null,
  percentageBasis: null,
  reason: 'Approved rule',
  authorizationEvidence: { ticket: 'BEN-1' },
  ...overrides,
})

describe('configured dues benefit application', () => {
  // prettier-ignore
  it('applies fixed, gross percentage, remaining percentage, and scholarship rules in priority order', () => {
    const result = applyBenefits(
      10_000,
      [
        benefit({ id: 'fixed', amountCents: 1_000, priority: 10 }),
        benefit({ id: 'gross', kind: 'PERCENT_DISCOUNT', amountCents: null, percentage: 20, currency: null, percentageBasis: 'GROSS', priority: 20 }),
        benefit({ id: 'remaining', kind: 'SCHOLARSHIP', amountCents: null, percentage: 50, currency: null, percentageBasis: 'REMAINING', priority: 30 }),
      ],
      'ARS',
    )

    expect(result.totalCents).toBe(3_500)
    expect(result.components.map(({ benefitId, amountCents }) => [benefitId, amountCents])).toEqual([
      ['fixed', -1_000],
      ['gross', -2_000],
      ['remaining', -3_500],
    ])
  })

  // prettier-ignore
  it('uses configured priority and stable id tie-breakers without member precedence', () => {
    const result = applyBenefits(
      10_000,
      [
        benefit({ id: 'member-rule', socioId: 'member-1', priority: 20, amountCents: 2_000 }),
        benefit({ id: 'family-rule', socioId: null, familyGroupId: 'family-1', priority: 10, amountCents: 3_000 }),
        benefit({ id: 'same-priority-b', priority: 30, amountCents: 500 }),
        benefit({ id: 'same-priority-a', priority: 30, amountCents: 500 }),
      ],
      'ARS',
    )

    expect(result.components.map(({ benefitId }) => benefitId)).toEqual([
      'family-rule',
      'member-rule',
      'same-priority-a',
      'same-priority-b',
    ])
  })

  // prettier-ignore
  it('selects one exclusive rule per group, keeps combinable rules, and floors with truncation evidence', () => {
    const result = applyBenefits(
      10_000,
      [
        benefit({ id: 'exclusive-late', priority: 20, amountCents: 1_000, combinability: 'EXCLUSIVE', exclusiveGroup: 'scholarship' }),
        benefit({ id: 'exclusive-first', priority: 10, amountCents: 9_000, combinability: 'EXCLUSIVE', exclusiveGroup: 'scholarship' }),
        benefit({ id: 'truncated', priority: 30, amountCents: 5_000 }),
      ],
      'ARS',
    )

    expect(result.totalCents).toBe(0)
    expect(result.components.map(({ benefitId }) => benefitId)).toEqual(['exclusive-first', 'truncated'])
    expect(result.applied[1]).toMatchObject({ requestedAmountCents: 5_000, appliedAmountCents: 1_000, truncatedAmountCents: 4_000 })
  })
})
