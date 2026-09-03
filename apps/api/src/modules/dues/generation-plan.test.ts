import { describe, expect, it } from 'vitest'
import { createGenerationPlan, type GenerationPlanInput } from './generation-plan.ts'

const uuid = '550e8400-e29b-41d4-a716-446655440000'
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
  members: [
    {
      id: uuid,
      memberNumber: '0001',
      label: 'Ada Lovelace',
      memberSince: '2026-08-16',
      sports: [],
      benefits: [],
    },
  ],
  ...overrides,
})
const plan = (overrides: Partial<GenerationPlanInput> = {}) =>
  createGenerationPlan(input(overrides))

describe('createGenerationPlan', () => {
  it('orders entries deterministically and aggregates member counts and ready totals', () => {
    const result = plan({
      members: [
        {
          id: 'existing',
          memberNumber: '0002',
          label: 'Existente',
          memberSince: '2026-08-01',
          sports: [],
          benefits: [],
          existingObligationId: 'obligation-id',
        },
        {
          id: 'zero',
          memberNumber: '0003',
          label: 'Cero',
          memberSince: '2026-09-01',
          sports: [],
          benefits: [],
        },
        {
          id: uuid,
          memberNumber: '0001',
          label: 'Ada Lovelace',
          memberSince: '2026-08-01',
          sports: [],
          benefits: [
            {
              id: 'half',
              kind: 'PERCENT_DISCOUNT',
              socioId: uuid,
              familyGroupId: null,
              amountCents: null,
              percentage: 50,
              currency: null,
              effectiveFrom: '2026-01-01',
              effectiveTo: null,
              priority: 1,
              combinability: 'COMBINABLE',
              exclusiveGroup: null,
              percentageBasis: 'GROSS',
              reason: 'Beca',
              authorizationEvidence: {},
            },
          ],
        },
      ],
    })
    expect(result.internal.entries.map(({ memberId }) => memberId)).toEqual([
      uuid,
      'existing',
      'zero',
    ])
    expect(result.internal.summary).toMatchObject({
      memberCount: 3,
      readyCount: 1,
      reviewCount: 2,
      conflictCount: 0,
      estimatedNewTotalCents: 1550,
    })
  })

  it('aggregates conflict and review counts without estimating non-ready entries', () => {
    const result = plan({
      members: [
        {
          id: 'missing-base',
          memberNumber: '0004',
          label: 'Sin base',
          memberSince: '2026-08-01',
          sports: [],
          benefits: [],
          existingObligationId: 'old',
        },
        {
          id: 'missing-sport',
          memberNumber: '0005',
          label: 'Sin deporte',
          memberSince: '2026-08-01',
          sports: [
            {
              id: 'enrollment',
              disciplineId: 'tennis',
              label: 'Tenis',
              start: '2026-08-01',
              end: null,
            },
          ],
          benefits: [],
        },
        {
          id: 'existing',
          memberNumber: '0002',
          label: 'Existente',
          memberSince: '2026-08-01',
          sports: [],
          benefits: [],
          existingObligationId: 'old',
        },
        {
          id: 'zero-gross',
          memberNumber: '0006',
          label: 'Cero bruto',
          memberSince: '2026-09-01',
          sports: [],
          benefits: [],
        },
        {
          id: 'zero-net',
          memberNumber: '0007',
          label: 'Cero neto',
          memberSince: '2026-08-01',
          sports: [],
          benefits: [
            {
              id: 'free',
              kind: 'FIXED_DISCOUNT',
              socioId: 'zero-net',
              familyGroupId: null,
              amountCents: 3100,
              percentage: null,
              currency: 'ARS',
              effectiveFrom: '2026-01-01',
              effectiveTo: null,
              priority: 1,
              combinability: 'COMBINABLE',
              exclusiveGroup: null,
              percentageBasis: null,
              reason: 'Beca',
              authorizationEvidence: {},
            },
          ],
        },
      ],
      prices: [
        {
          id: 'partial',
          kind: 'BASE',
          disciplineId: null,
          amountCents: 3100,
          currency: 'ARS',
          from: '2026-08-02',
          to: '2026-08-20',
          rule: 'FULL_MONTH',
          label: 'Cuota social',
        },
      ],
    })
    expect(result.internal.summary).toMatchObject({
      memberCount: 5,
      readyCount: 0,
      reviewCount: 1,
      conflictCount: 4,
      estimatedNewTotalCents: 0,
    })
  })

  it('presents safe labels and messages without exposing identifiers', () => {
    const result = plan({
      members: [
        {
          id: uuid,
          memberNumber: '0001',
          label: 'Ada Lovelace',
          memberSince: '2026-08-01',
          sports: [
            {
              id: 'swim-id',
              disciplineId: 'swim',
              label: 'Natación',
              start: '2026-08-01',
              end: null,
            },
          ],
          benefits: [],
        },
      ],
      prices: [
        ...input().prices,
        {
          id: 'swim-price',
          kind: 'SPORT',
          disciplineId: 'swim',
          amountCents: 3100,
          currency: 'ARS',
          from: '2026-01-01',
          to: null,
          rule: 'FULL_MONTH',
          label: 'Natación',
        },
      ],
    })
    expect(result.presentation).toMatchObject({
      period: 'agosto de 2026',
      currency: 'ARS',
      members: [
        {
          name: 'Ada Lovelace',
          memberNumber: '0001',
          status: 'Listo para generar',
          summary: 'Se generará una nueva obligación por ARS 62,00.',
          details: [],
          configurationLabels: ['Cuota social', 'Natación'],
        },
      ],
    })
    expect(JSON.stringify(result.presentation)).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27}/i)
  })
})
