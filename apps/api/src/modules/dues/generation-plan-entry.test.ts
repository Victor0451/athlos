import { describe, expect, it } from 'vitest'
import {
  createGenerationPlanEntry,
  type GenerationPlanEntryInput,
} from './generation-plan-entry.ts'

const uuid = '550e8400-e29b-41d4-a716-446655440000'
const input = (overrides: Partial<GenerationPlanEntryInput> = {}): GenerationPlanEntryInput => ({
  period: { start: '2026-08-01', end: '2026-09-01' },
  currency: 'ARS',
  prices: [
    {
      id: 'base-price',
      kind: 'BASE',
      disciplineId: null,
      amountCents: 3100,
      currency: 'ARS',
      from: '2026-01-01',
      to: null,
      rule: 'FULL_MONTH',
      label: 'Cuota social',
    },
  ],
  member: {
    id: uuid,
    memberNumber: '0001',
    label: 'Ada Lovelace',
    memberSince: '2026-08-01',
    sports: [],
    benefits: [],
  },
  ...overrides,
})
const entry = (overrides: Partial<GenerationPlanEntryInput> = {}) =>
  createGenerationPlanEntry(input(overrides))

const fixedBenefit = (id: string, socioId: string, amountCents: number) => ({
  id,
  kind: 'FIXED_DISCOUNT' as const,
  socioId,
  familyGroupId: null,
  amountCents,
  percentage: null,
  currency: 'ARS',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  priority: 1,
  combinability: 'COMBINABLE' as const,
  exclusiveGroup: null,
  percentageBasis: null,
  reason: 'Beca',
  authorizationEvidence: {},
})

describe('createGenerationPlanEntry', () => {
  it('keeps conflicts ahead of existing-obligation review outcomes', () => {
    const result = entry({
      member: { ...input().member, existingObligationId: 'old' },
      prices: [],
    })
    expect(result).toMatchObject({
      status: 'CONFLICT',
      reviewCodes: ['EXISTING_OBLIGATION', 'ZERO_GROSS', 'ZERO_NET'],
      insertion: { disposition: 'SKIP' },
    })
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'PRICE_GAP' }))
  })

  it('marks otherwise executable existing obligations for review', () => {
    const result = entry({ member: { ...input().member, existingObligationId: 'old' } })
    expect(result).toMatchObject({
      status: 'REVIEW',
      reviewCodes: ['EXISTING_OBLIGATION'],
      insertion: { disposition: 'SKIP' },
    })
  })

  it('marks gross and net zero outcomes for review without insertion', () => {
    const gross = entry({ member: { ...input().member, baseEligible: false } })
    const net = entry({
      member: { ...input().member, benefits: [fixedBenefit('free', uuid, 3100)] },
    })
    expect(gross).toMatchObject({
      status: 'REVIEW',
      reviewCodes: ['ZERO_GROSS', 'ZERO_NET'],
      insertion: { disposition: 'SKIP' },
    })
    expect(net).toMatchObject({
      status: 'REVIEW',
      netCents: 0,
      reviewCodes: ['ZERO_NET'],
      insertion: { disposition: 'SKIP' },
    })
  })

  it('applies benefits and builds an insertion only for ready entries', () => {
    const result = entry({
      member: {
        ...input().member,
        benefits: [
          {
            ...fixedBenefit('half', uuid, 1550),
            kind: 'PERCENT_DISCOUNT',
            amountCents: null,
            percentage: 50,
            currency: null,
            percentageBasis: 'GROSS',
          },
        ],
      },
    })
    expect(result).toMatchObject({
      status: 'READY',
      grossCents: 3100,
      netCents: 1550,
      appliedBenefitIds: ['half'],
      insertion: {
        disposition: 'INSERT',
        payload: {
          amountCents: 1550,
          components: [
            expect.objectContaining({ kind: 'BASE', componentKey: 'base' }),
            expect.objectContaining({ kind: 'BENEFIT', componentKey: 'benefit:half' }),
          ],
        },
      },
    })
  })
})
