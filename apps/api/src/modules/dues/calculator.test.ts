import { describe, expect, it } from 'vitest'
import {
  calculateAssessment,
  type AssessmentInput,
  type BaseInput,
  type PriceInput,
} from './calculator.ts'
const price = (
  amountCents: number,
  rule: PriceInput['rule'] = 'FULL_MONTH',
  versionId = 'price-v1',
): PriceInput => ({ amountCents, currency: 'ARS', rule, versionId })

const base = (
  priceInput: PriceInput,
  dates: Pick<BaseInput, 'eligibleFrom' | 'eligibleTo'> = {},
): BaseInput => ({ eligible: true, ...dates, price: priceInput })
const sport = (
  componentKey: string,
  amountCents: number,
  rule: PriceInput['rule'] = 'FULL_MONTH',
  versionId = componentKey,
  dates: Record<string, string> = {},
) => ({
  componentKey,
  active: true,
  ...dates,
  price: price(amountCents, rule, versionId),
})
const input = (overrides: Partial<AssessmentInput> = {}): AssessmentInput => ({
  period: { start: '2024-03-01', end: '2024-04-01' },
  currency: 'ARS',
  base: { eligible: true, price: price(10_000, 'FULL_MONTH', 'base-v1') },
  sports: [],
  ...overrides,
})
function expectValidation(action: () => unknown) {
  try {
    action()
  } catch (error) {
    expect(error).toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 })
    return
  }
  throw new Error('Expected validation error')
}
describe('calculateAssessment', () => {
  it('adds the eligible base and every active sport as snapshot-ready components', () => {
    const result = calculateAssessment(
      input({
        sports: [
          sport('sport:football', 2_500, 'FULL_MONTH', 'sport-v1'),
          sport('sport:tennis', 1_500, 'FULL_MONTH', 'sport-v2'),
        ],
      }),
    )

    expect(result).toMatchObject({ totalCents: 14_000, currency: 'ARS' })
    expect(
      result.components.map(({ componentKey, kind, amountCents, priceVersionId }) => [
        componentKey,
        kind,
        amountCents,
        priceVersionId,
      ]),
    ).toEqual([
      ['base', 'BASE', 10_000, 'base-v1'],
      ['sport:football', 'SPORT', 2_500, 'sport-v1'],
      ['sport:tennis', 'SPORT', 1_500, 'sport-v2'],
    ])
  })

  it('rounds daily proration half-up across leap and non-leap periods', () => {
    const leap = calculateAssessment(
      input({
        period: { start: '2024-02-01', end: '2024-03-01' },
        base: base(price(10_000, 'DAILY_PRORATED', 'leap-v1'), {
          eligibleFrom: '2024-02-10',
          eligibleTo: '2024-02-20',
        }),
      }),
    )
    const nonLeap = calculateAssessment(
      input({
        period: { start: '2023-02-01', end: '2023-03-01' },
        base: base(price(10_000, 'DAILY_PRORATED', 'non-leap-v1'), {
          eligibleFrom: '2023-02-28',
        }),
      }),
    )

    expect(leap).toMatchObject({ totalCents: 3_448 })
    expect(leap.components[0]).toMatchObject({ eligibleDays: 10, periodDays: 29 })
    expect(nonLeap).toMatchObject({ totalCents: 357 })
    expect(nonLeap.components[0]).toMatchObject({ eligibleDays: 1, periodDays: 28 })
  })
  it('treats period boundaries as inclusive start and exclusive end', () => {
    const result = calculateAssessment(
      input({
        base: {
          ...base(price(3_100, 'DAILY_PRORATED', 'boundary-v1')),
          eligibleFrom: '2024-03-01',
          eligibleTo: '2024-04-01',
        },
      }),
    )

    expect(result.totalCents).toBe(3_100)
    expect(result.components[0]).toMatchObject({
      eligibleFrom: '2024-03-01',
      eligibleTo: '2024-04-01',
      eligibleDays: 31,
    })
  })
  it('defers mid-period NEXT_PERIOD additions but charges one effective at the boundary', () => {
    const result = calculateAssessment(
      input({
        sports: [
          sport('sport:mid-period', 2_000, 'NEXT_PERIOD', 'next-v1', {
            eligibleFrom: '2024-03-15',
          }),
          sport('sport:boundary', 3_000, 'NEXT_PERIOD', 'next-v2', {
            eligibleFrom: '2024-03-01',
          }),
        ],
      }),
    )

    expect(result.totalCents).toBe(13_000)
    expect(result.components.map(({ componentKey }) => componentKey)).toEqual([
      'base',
      'sport:boundary',
    ])
  })
  it('rejects invalid money, currency, ranges, duplicate keys, overflow, and impossible days', () => {
    expectValidation(() => calculateAssessment(input({ base: base(price(-1)) })))
    expectValidation(() => calculateAssessment(input({ currency: 'usd' })))
    expectValidation(() =>
      calculateAssessment(
        input({
          base: base({ ...price(10_000), currency: 'USD' }),
        }),
      ),
    )
    expectValidation(() =>
      calculateAssessment(
        input({
          period: { start: '2024-04-01', end: '2024-03-01' },
        }),
      ),
    )
    expectValidation(() =>
      calculateAssessment(
        input({
          sports: [sport('base', 1_000)],
        }),
      ),
    )
    expectValidation(() =>
      calculateAssessment(input({ base: base(price(Number.MAX_SAFE_INTEGER)) })),
    )
    expectValidation(() =>
      calculateAssessment(
        input({
          period: { start: '2024-02-30', end: '2024-03-01' },
        }),
      ),
    )
  })
})
