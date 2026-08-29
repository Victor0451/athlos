import { describe, expect, it } from 'vitest'
import { planAssessmentRange, type PlanComponent, type PriceVersion } from './range-planner.ts'

const price = (
  id: string,
  amountCents: number,
  from: string,
  to = '2026-09-01',
  rule: PriceVersion['rule'] = 'FULL_MONTH',
): PriceVersion => ({ priceVersionId: id, amountCents, currency: 'ARS', from, to, rule })
const component = (overrides: Partial<PlanComponent> = {}): PlanComponent => ({
  key: 'NATACION',
  kind: 'SPORT',
  alta: '2026-08-01',
  baja: null,
  prices: [price('p1', 3_100, '2026-08-01')],
  ...overrides,
})
const plan = (components: PlanComponent[], period = { start: '2026-08-01', end: '2026-09-01' }) =>
  planAssessmentRange({ period, components })

describe('planAssessmentRange', () => {
  it('uses [alta,baja), actual month days, and boundary proration over FULL_MONTH', () => {
    const result = plan(
      [
        component({
          alta: '2024-02-10',
          baja: '2024-02-20',
          prices: [price('p1', 2_900, '2024-02-01', '2024-03-01')],
        }),
      ],
      { start: '2024-02-01', end: '2024-03-01' },
    )
    expect(result).toMatchObject({ executable: true, totalCents: 1_000 })
    expect(result.components[0]).toMatchObject({
      eligibleFrom: '2024-02-10',
      eligibleTo: '2024-02-20',
      eligibleDays: 10,
      calendarDays: 29,
    })
  })

  it('keeps an explicitly zero-priced eligible component covered and executable', () => {
    const result = plan([
      component({ alta: '2026-08-12', prices: [price('zero', 0, '2026-08-01')] }),
    ])
    expect(result).toMatchObject({ executable: true, totalCents: 0, issues: [] })
    expect(result.components[0]).toMatchObject({
      status: 'ZERO',
      eligibleDays: 20,
      numerator: 0,
      remainder: 0,
      amountCents: 0,
    })
    expect(result.components[0]!.segments).toEqual([
      expect.objectContaining({ priceVersionId: 'zero', eligibleDays: 20, amountCents: 0 }),
    ])
    expect(result.issues).not.toContainEqual(expect.objectContaining({ code: 'PRICE_GAP' }))
  })

  it('blocks the complete plan for NEXT_PERIOD, gaps, overlaps, and QA-001 uncovered days', () => {
    const result = plan([
      component({
        key: 'next',
        prices: [price('next', 100, '2026-08-01', '2026-09-01', 'NEXT_PERIOD')],
      }),
      component({ key: 'gap', prices: [price('gap', 100, '2026-08-02', '2026-09-01')] }),
      component({
        key: 'overlap',
        prices: [price('a', 100, '2026-08-01'), price('b', 100, '2026-08-20')],
      }),
    ])
    expect(result).toMatchObject({ executable: false, totalCents: null })
    expect(
      result.issues.map((issue) => [issue.code, issue.componentKey, issue.from, issue.to]),
    ).toEqual([
      ['NEXT_PERIOD_CONFLICT', 'next', '2026-08-01', '2026-09-01'],
      ['PRICE_GAP', 'gap', '2026-08-01', '2026-08-02'],
      ['PRICE_OVERLAP', 'overlap', '2026-08-20', '2026-09-01'],
    ])
  })

  it('blocks QA-001 NATACION uncovered days from 2026-07-25 through 2026-08-23 without backcharge', () => {
    const natacion = component({
      alta: '2026-07-25',
      prices: [price('qa-price', 2_500, '2026-08-24')],
    })
    const july = plan([natacion], { start: '2026-07-01', end: '2026-08-01' })
    const august = plan([natacion])
    expect(july.issues).toContainEqual(
      expect.objectContaining({ code: 'PRICE_GAP', from: '2026-07-25', to: '2026-08-01' }),
    )
    expect(august.issues).toContainEqual(
      expect.objectContaining({ code: 'PRICE_GAP', from: '2026-08-01', to: '2026-08-24' }),
    )
    expect([july, august].every((result) => !result.executable && result.totalCents === null)).toBe(
      true,
    )
  })

  it('aggregates successive segment numerators and rounds once, exact halves up', () => {
    const result = plan([
      component({
        prices: [price('a', 1, '2026-08-01', '2026-08-16'), price('b', 2, '2026-08-16')],
      }),
    ])
    expect(result.components[0]!).toMatchObject({
      calendarDays: 31,
      numerator: 47,
      remainder: 16,
      amountCents: 2,
    })
    expect(
      result.components[0]!.segments.map((s) => [s.priceVersionId, s.eligibleDays, s.numerator]),
    ).toEqual([
      ['a', 15, 15],
      ['b', 16, 32],
    ])
  })

  it('retains an exact-half rounding snapshot', () => {
    const result = plan([component({ prices: [price('half', 3, '2026-09-01', '2026-09-16')] })], {
      start: '2026-09-01',
      end: '2026-10-01',
    })
    expect(result.components[0]).toMatchObject({
      calendarDays: 30,
      numerator: 45,
      remainder: 15,
      amountCents: 2,
    })
  })

  it('fails closed on unsafe numerators and does not offer a partial executable result', () => {
    const result = plan([
      component({ key: 'valid' }),
      component({
        key: 'overflow',
        prices: [price('huge', Number.MAX_SAFE_INTEGER, '2026-08-01')],
      }),
    ])
    expect(result).toMatchObject({ executable: false, totalCents: null })
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'OVERFLOW', componentKey: 'overflow' }),
    )
  })
})
