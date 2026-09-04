import { describe, expect, it } from 'vitest'
import { createGenerationPlanPresentation } from './generation-plan-presentation.ts'
import type { GenerationPlanInput } from './generation-plan.ts'

const uuid = '550e8400-e29b-41d4-a716-446655440000'
const input = (overrides: Partial<GenerationPlanInput> = {}): GenerationPlanInput => ({
  period: { start: '2026-09-01', end: '2026-10-01' },
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
      memberSince: '2026-09-01',
      sports: [],
      benefits: [],
    },
  ],
  ...overrides,
})

describe('createGenerationPlanPresentation', () => {
  it('presents safe configurations, Spanish dates, and member summaries', () => {
    const result = createGenerationPlanPresentation(input())

    expect(result).toMatchObject({
      period: 'septiembre de 2026',
      currency: 'ARS',
      configurations: [
        {
          label: 'Cuota social',
          amountCents: 3100,
          rule: 'Mes completo',
          validity: 'Desde el 1 de enero de 2026',
        },
      ],
      summary: {
        eligibleCount: 1,
        readyCount: 1,
        newCount: 1,
        existingCount: 0,
        reviewCount: 0,
        conflictCount: 0,
        estimatedNewTotalCents: 3100,
      },
      members: [
        {
          memberNumber: '0001',
          name: 'Ada Lovelace',
          status: 'Listo para generar',
          grossCents: 3100,
          netCents: 3100,
          configurationLabels: ['Cuota social'],
          summary: 'Se generará una nueva obligación por ARS 31,00.',
          details: [],
        },
      ],
    })
    expect(JSON.stringify(result)).not.toMatch(/550e8400|base-price|FULL_MONTH|BASE|fingerprint/i)
  })

  it('uses the approved missing, partial-gap, and overlap messages', () => {
    const member = input().members[0]!
    const sport = {
      id: 'swim-id',
      disciplineId: 'swim',
      label: 'Natación',
      start: '2026-09-01',
      end: null,
    }
    const missing = createGenerationPlanPresentation(input({ prices: [] }))
    const partial = createGenerationPlanPresentation(
      input({
        prices: [{ ...input().prices[0]!, from: '2026-09-02', to: '2026-09-20' }],
      }),
    )
    const overlap = createGenerationPlanPresentation(
      input({
        members: [{ ...member, sports: [sport] }],
        prices: [
          ...input().prices,
          { ...input().prices[0]!, id: 'base-price-two', from: '2026-09-10' },
          {
            ...input().prices[0]!,
            id: 'swim-price',
            kind: 'SPORT',
            disciplineId: 'swim',
            label: 'Natación',
          },
        ],
      }),
    )

    expect(missing.members[0]!.details).toEqual([
      'Falta configurar un importe para la cuota base durante septiembre de 2026.',
    ])
    expect(partial.members[0]!.details).toEqual([
      'La configuración de cuota base no cubre el período comprendido entre 1 de septiembre de 2026 y 2 de septiembre de 2026.',
      'La configuración de cuota base no cubre el período comprendido entre 20 de septiembre de 2026 y 1 de octubre de 2026.',
    ])
    expect(overlap.members[0]!.details).toContain(
      'Hay más de un importe vigente para cuota base entre 10 de septiembre de 2026 y 1 de octubre de 2026. Revisá las fechas de vigencia.',
    )
  })

  it('uses the discipline template when a sport has no price', () => {
    const result = createGenerationPlanPresentation(
      input({
        members: [
          {
            ...input().members[0]!,
            sports: [
              {
                id: 'swim-id',
                disciplineId: 'swim',
                label: 'Natación',
                start: '2026-09-01',
                end: null,
              },
            ],
          },
        ],
      }),
    )

    expect(result.members[0]!.details).toEqual([
      'Falta configurar un importe para Natación durante septiembre de 2026.',
    ])
  })
})
