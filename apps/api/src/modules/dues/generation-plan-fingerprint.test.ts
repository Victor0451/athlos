import { describe, expect, it } from 'vitest'
import {
  fingerprintGenerationPlan,
  generationPlanFingerprintProjection,
  type GenerationPlanInput,
} from './generation-plan-fingerprint.ts'

const input = (overrides: Partial<GenerationPlanInput> = {}): GenerationPlanInput => ({
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
  members: [],
  ...overrides,
})

const fingerprint = (overrides: Partial<GenerationPlanInput> = {}) => {
  const source = input(overrides)
  return fingerprintGenerationPlan({
    period: source.period,
    currency: source.currency,
    prices: source.prices,
    entries: [
      {
        memberId: 'b',
        memberSince: '2026-08-01',
        existingObligationId: null,
        appliedBenefitIds: [],
      },
      {
        memberId: 'a',
        memberSince: '2026-08-01',
        existingObligationId: null,
        appliedBenefitIds: [],
      },
    ],
  })
}

describe('generation plan fingerprint foundation', () => {
  it('projects canonical sorted financial facts without price labels', () => {
    const source = input({
      prices: [
        { ...input().prices[0]!, id: 'sport-price', kind: 'SPORT', disciplineId: 'swim' },
        input().prices[0]!,
      ],
    })
    const projection = generationPlanFingerprintProjection({
      period: source.period,
      currency: source.currency,
      prices: source.prices,
      entries: [{ memberId: 'b' }, { memberId: 'a' }],
    })

    expect(projection.prices.map((price) => price.id)).toEqual(['base-price', 'sport-price'])
    expect(projection.entries.map((entry) => entry.memberId)).toEqual(['a', 'b'])
    expect(JSON.stringify(projection)).not.toContain('Cuota social')
  })

  it('is stable for input order and sensitive to every planner financial fact', () => {
    const stable = fingerprint()
    expect(
      fingerprint({
        prices: [...input().prices].reverse(),
      }),
    ).toBe(stable)
    expect(fingerprint({ prices: [{ ...input().prices[0]!, amountCents: 3200 }] })).not.toBe(stable)

    const source = input()
    expect(
      fingerprintGenerationPlan({
        period: source.period,
        currency: source.currency,
        prices: source.prices,
        entries: [
          {
            memberId: 'a',
            memberSince: '2026-08-01',
            existingObligationId: 'old',
            appliedBenefitIds: [],
          },
          {
            memberId: 'b',
            memberSince: '2026-08-01',
            existingObligationId: null,
            appliedBenefitIds: [],
          },
        ],
      }),
    ).not.toBe(stable)
    expect(
      fingerprintGenerationPlan({
        period: source.period,
        currency: source.currency,
        prices: source.prices,
        entries: [
          {
            memberId: 'a',
            memberSince: '2026-08-02',
            existingObligationId: null,
            appliedBenefitIds: ['discount'],
          },
          {
            memberId: 'b',
            memberSince: '2026-08-01',
            existingObligationId: null,
            appliedBenefitIds: [],
          },
        ],
      }),
    ).not.toBe(stable)
  })

  it('changes for resolved benefit rule audit terms even when the net total is unchanged', () => {
    const source = input()
    const entry = (authorizationEvidence: Record<string, unknown>) => ({
      memberId: 'a',
      insertion: {
        disposition: 'INSERT' as const,
        payload: {
          amountCents: 1_550,
          components: [],
          snapshot: {
            appliedBenefits: [
              {
                id: 'half',
                requestedAmountCents: 1_550,
                appliedAmountCents: 1_550,
                truncatedAmountCents: 0,
                remainingAmountCents: 0,
                ruleSnapshot: { percentage: 50, authorizationEvidence },
              },
            ],
          },
        },
      },
    })
    const resolve = (audit: Record<string, unknown>) =>
      fingerprintGenerationPlan({
        period: source.period,
        currency: source.currency,
        prices: source.prices,
        entries: [entry(audit)],
      })
    expect(resolve({ ticket: 'A-1' })).not.toBe(resolve({ ticket: 'A-2' }))
  })

  it('binds member evidence and complete benefit audit components while normalizing equivalent arrays', () => {
    const source = input()
    const entry = (memberNumber = '0001', authorizationEvidence = { ticket: 'A-1' }) => ({
      memberId: 'member-id',
      insertion: {
        disposition: 'INSERT' as const,
        payload: {
          amountCents: 1_550,
          components: [
            {
              kind: 'BASE',
              componentKey: 'base',
              amountCents: 3_100,
              calculationInputs: { numerator: 96_100, remainder: 0 },
              eligibilitySnapshot: { baseEligible: true, memberSince: '2025-01-01' },
              priceSnapshot: { sourcePriceVersionIds: ['base-price'] },
            },
            {
              kind: 'BENEFIT',
              componentKey: 'benefit:half',
              amountCents: -1_550,
              calculationInputs: { grossCents: 3_100, percentage: 50 },
              eligibilitySnapshot: { target: { type: 'MEMBER', id: 'member-id' } },
              priceSnapshot: { ruleVersionId: 'half', priority: 1 },
            },
          ],
          snapshot: {
            member: {
              id: 'member-id',
              memberNumber,
              label: 'Ada Lovelace',
              memberSince: '2025-01-01',
              baseEligible: true,
              enrollments: [{ id: 'enrollment', disciplineId: 'swim', label: 'Swimming' }],
            },
            appliedBenefits: [
              { id: 'half', appliedAmountCents: 1_550, ruleSnapshot: { authorizationEvidence } },
              { id: 'other', appliedAmountCents: 0, ruleSnapshot: { authorizationEvidence } },
            ],
          },
        },
      },
    })
    const resolve = (value = entry()) =>
      fingerprintGenerationPlan({
        period: source.period,
        currency: source.currency,
        prices: source.prices,
        entries: [value],
      })
    const stable = resolve()
    const reordered = entry()
    reordered.insertion.payload.components.reverse()
    reordered.insertion.payload.snapshot.appliedBenefits.reverse()

    expect(resolve(reordered)).toBe(stable)
    expect(resolve(entry('0002'))).not.toBe(stable)
    expect(resolve(entry('0001', { ticket: 'A-2' }))).not.toBe(stable)
    const changedComponent = entry()
    changedComponent.insertion.payload.components[1]!.priceSnapshot.priority = 2
    expect(resolve(changedComponent)).not.toBe(stable)
  })
})
