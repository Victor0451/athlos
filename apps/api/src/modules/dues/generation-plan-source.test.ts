import { describe, expect, it } from 'vitest'
import {
  createGenerationPlanSource,
  type GenerationPlanSourceInput,
} from './generation-plan-source.ts'

const member = (overrides: Partial<GenerationPlanSourceInput['member']> = {}) => ({
  id: 'member-id',
  memberNumber: '0001',
  label: 'Ada Lovelace',
  memberSince: '2026-08-01',
  sports: [],
  benefits: [],
  ...overrides,
})
const base = (overrides: Partial<GenerationPlanSourceInput['prices'][number]> = {}) => ({
  id: 'base-price',
  kind: 'BASE' as const,
  disciplineId: null,
  amountCents: 3100,
  currency: 'ARS',
  from: '2026-01-01',
  to: null,
  rule: 'FULL_MONTH' as const,
  label: 'Cuota social',
  ...overrides,
})
const source = (overrides: Partial<GenerationPlanSourceInput> = {}) =>
  createGenerationPlanSource({
    period: { start: '2026-08-01', end: '2026-09-01' },
    prices: [base()],
    member: member(),
    ...overrides,
  })

describe('createGenerationPlanSource', () => {
  it('uses the member start date for a mid-month base assessment', () => {
    const result = source({ member: member({ memberSince: '2026-08-16' }) })
    expect(result.range).toMatchObject({ executable: true, totalCents: 1600 })
    expect(result.range.components[0]).toMatchObject({
      componentKey: 'base',
      eligibleFrom: '2026-08-16',
      eligibleTo: '2026-09-01',
    })
  })

  it('maps segmented and open-ended prices across independent base and sport periods', () => {
    const result = source({
      member: member({
        memberSince: '2026-08-16',
        sports: [
          {
            id: 'sport-id',
            disciplineId: 'swim',
            label: 'Natación',
            start: '2026-08-20',
            end: null,
          },
        ],
      }),
      prices: [
        base({ id: 'base-a', from: '2026-08-01', to: '2026-08-20' }),
        base({ id: 'base-b', amountCents: 6200, from: '2026-08-20' }),
        base({ id: 'swim', kind: 'SPORT', disciplineId: 'swim' }),
      ],
    })
    expect(result.range).toMatchObject({ executable: true, totalCents: 4000 })
    expect(result.range.components.map((component) => component.amountCents)).toEqual([2800, 1200])
    expect(result.range.components[0]!.segments.map((segment) => segment.priceVersionId)).toEqual([
      'base-a',
      'base-b',
    ])
    expect(result.range.components[1]!.segments[0]).toMatchObject({
      priceVersionId: 'swim',
      to: '2026-09-01',
    })
  })

  it('reports missing, gapped, and overlapping price coverage', () => {
    const missing = source({ prices: [] })
    const missingSport = source({
      member: member({
        sports: [
          {
            id: 'enrollment',
            disciplineId: 'tennis',
            label: 'Tenis',
            start: '2026-08-01',
            end: null,
          },
        ],
      }),
    })
    const gap = source({ prices: [base({ from: '2026-08-02', to: '2026-08-20' })] })
    const overlap = source({
      prices: [base(), base({ id: 'second', from: '2026-08-15', to: null })],
    })
    expect(missing.range.issues).toContainEqual(
      expect.objectContaining({ code: 'PRICE_GAP', componentKey: 'base' }),
    )
    expect(missingSport.range.issues).toContainEqual(
      expect.objectContaining({ code: 'PRICE_GAP', componentKey: 'sport:enrollment' }),
    )
    expect(gap.range.issues.map((issue) => issue.code)).toEqual(['PRICE_GAP', 'PRICE_GAP'])
    expect(overlap.range.issues).toContainEqual(
      expect.objectContaining({ code: 'PRICE_OVERLAP', componentKey: 'base' }),
    )
  })

  it('omits an ineligible base without coupling sport or zero-component eligibility', () => {
    const sport = source({
      member: member({
        baseEligible: false,
        sports: [
          {
            id: 'swim-id',
            disciplineId: 'swim',
            label: 'Natación',
            start: '2026-08-01',
            end: null,
          },
        ],
      }),
      prices: [base({ id: 'swim-price', kind: 'SPORT', disciplineId: 'swim' })],
    })
    const none = source({ member: member({ baseEligible: false }) })
    expect(sport.range).toMatchObject({ executable: true, totalCents: 3100 })
    expect(sport.range.components).toEqual([
      expect.objectContaining({ componentKey: 'sport:swim-id' }),
    ])
    expect(none.range).toMatchObject({ executable: true, totalCents: 0, components: [] })
  })
})
