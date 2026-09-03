import { describe, expect, it, vi } from 'vitest'
import {
  loadGenerationPlan,
  type GenerationPlanLoaderRepository,
} from './generation-plan-loader.ts'

const period = { start: '2026-02-01', end: '2026-03-01' }

const repository = (): GenerationPlanLoaderRepository => ({
  listGenerationMembers: vi.fn().mockResolvedValue([
    {
      id: 'member-with-family',
      memberNumber: '0042',
      label: 'Doe, Jane',
      memberSince: '2024-05-10',
      baseEligible: true,
      familyGroupId: 'family-1',
      existingObligationId: 'obligation-1',
      sports: [
        {
          id: 'enrollment-1',
          disciplineId: 'swimming',
          label: 'Swimming',
          estado: 'activa',
          fechaAlta: '2026-02-04',
          fechaBaja: null,
          eligibleFrom: '2026-02-04',
          eligibleTo: '2026-03-01',
          start: '2026-02-04',
          end: null,
        },
      ],
    },
    {
      id: 'member-alone',
      memberNumber: '0043',
      label: 'Roe, John',
      memberSince: '2020-01-01',
      baseEligible: true,
      familyGroupId: null,
      sports: [],
    },
  ]),
  listGenerationPrices: vi.fn().mockResolvedValue([
    {
      id: 'base-first-segment',
      kind: 'BASE',
      disciplineId: null,
      label: 'Membership fee',
      amountCents: 3_000,
      currency: 'ARS',
      rule: 'DAILY_PRORATED',
      from: '2026-02-01',
      to: '2026-02-15',
    },
    {
      id: 'base-open-ended',
      kind: 'BASE',
      disciplineId: null,
      label: 'Membership fee',
      amountCents: 3_100,
      currency: 'ARS',
      rule: 'DAILY_PRORATED',
      from: '2026-02-15',
      to: null,
    },
    {
      id: 'swimming-open-ended',
      kind: 'SPORT',
      disciplineId: 'swimming',
      label: 'Swimming',
      amountCents: 1_200,
      currency: 'ARS',
      rule: 'DAILY_PRORATED',
      from: '2026-02-01',
      to: null,
    },
  ]),
  resolveBenefitRuleCandidates: vi.fn().mockImplementation(async ({ socioId }) =>
    socioId === 'member-with-family'
      ? [
          {
            id: 'family-benefit',
            kind: 'PERCENT_DISCOUNT',
            socioId: null,
            familyGroupId: 'family-1',
            amountCents: null,
            percentage: 10,
            currency: null,
            effectiveFrom: '2026-01-01',
            effectiveTo: null,
            priority: 1,
            combinability: 'COMBINABLE',
            exclusiveGroup: null,
            percentageBasis: 'GROSS',
            reason: 'Family discount',
            authorizationEvidence: { source: 'rule' },
          },
        ]
      : [],
  ),
})

describe('loadGenerationPlan', () => {
  it('loads ordered facts once, resolves each member benefit candidate, and presents the plan', async () => {
    const facts = repository()

    const plan = await loadGenerationPlan(facts, { period, currency: 'ARS' })

    expect(facts.listGenerationMembers).toHaveBeenCalledTimes(1)
    expect(facts.listGenerationMembers).toHaveBeenCalledWith(period)
    expect(facts.listGenerationPrices).toHaveBeenCalledTimes(1)
    expect(facts.listGenerationPrices).toHaveBeenCalledWith(period)
    expect(facts.resolveBenefitRuleCandidates).toHaveBeenCalledTimes(2)
    expect(facts.resolveBenefitRuleCandidates).toHaveBeenNthCalledWith(1, {
      socioId: 'member-with-family',
      familyGroupId: 'family-1',
      period,
    })
    expect(facts.resolveBenefitRuleCandidates).toHaveBeenNthCalledWith(2, {
      socioId: 'member-alone',
      familyGroupId: null,
      period,
    })
    expect(plan.internal.entries).toMatchObject([
      {
        memberId: 'member-alone',
        status: 'READY',
        components: [
          {
            componentKey: 'base',
            eligibleFrom: '2026-02-01',
            eligibleTo: '2026-03-01',
            priceVersionIds: ['base-first-segment', 'base-open-ended'],
          },
        ],
      },
      {
        memberId: 'member-with-family',
        existingObligationId: 'obligation-1',
        status: 'REVIEW',
        components: [
          {
            componentKey: 'base',
            eligibleFrom: '2026-02-01',
            eligibleTo: '2026-03-01',
            priceVersionIds: ['base-first-segment', 'base-open-ended'],
          },
          {
            componentKey: 'sport:enrollment-1',
            enrollmentId: 'enrollment-1',
            disciplineId: 'swimming',
            eligibleFrom: '2026-02-04',
            eligibleTo: '2026-03-01',
            priceVersionIds: ['swimming-open-ended'],
          },
        ],
        appliedBenefitIds: ['family-benefit'],
      },
    ])
    expect(plan.presentation).toMatchObject({
      period: 'febrero de 2026',
      currency: 'ARS',
      members: [
        { name: 'Roe, John', memberNumber: '0043', configurationLabels: ['Cuota social'] },
        {
          name: 'Doe, Jane',
          memberNumber: '0042',
          configurationLabels: ['Cuota social', 'Swimming'],
        },
      ],
    })
    expect(JSON.stringify(plan.presentation)).not.toContain('member-with-family')
    expect(JSON.stringify(plan.presentation)).not.toContain('member-alone')
  })
})
