export type AssessmentRule = 'FULL_MONTH' | 'DAILY_PRORATED' | 'NEXT_PERIOD'
export type PriceVersion = {
  priceVersionId: string
  amountCents: number
  currency: string
  from: string
  to: string
  rule: AssessmentRule
}
export type PlanComponent = {
  key: string
  kind: 'BASE' | 'SPORT'
  alta: string
  baja: string | null
  prices: PriceVersion[]
}
type Interval = { from: string; to: string }
type Period = { start: string; end: string }
export type PlanIssue = {
  code: 'NEXT_PERIOD_CONFLICT' | 'OVERFLOW' | 'PRICE_GAP' | 'PRICE_OVERLAP'
  componentKey: string
  from: string
  to: string
}
type Segment = PriceVersion & { eligibleDays: number; numerator: number }
type ComponentResult = {
  componentKey: string
  eligibleFrom: string
  eligibleTo: string
  eligibleDays: number
  calendarDays: number
  segments: Segment[]
  numerator: number
  remainder: number
  amountCents: number
  status: 'PENDING' | 'ZERO' | 'CONFLICT'
}
export type AssessmentRangePlan = {
  executable: boolean
  totalCents: number | null
  components: ComponentResult[]
  issues: PlanIssue[]
}

const day = 86_400_000
const date = (value: string) => new Date(`${value}T00:00:00Z`)
const days = (from: string, to: string) => (date(to).getTime() - date(from).getTime()) / day
const max = (a: string, b: string) => (a > b ? a : b)
const min = (a: string, b: string) => (a < b ? a : b)
const overlap = (a: Interval, b: Interval): Interval | null => {
  const from = max(a.from, b.from),
    to = min(a.to, b.to)
  return from < to ? { from, to } : null
}
const rounded = (numerator: number, denominator: number) =>
  Math.floor(numerator / denominator) + ((numerator % denominator) * 2 >= denominator ? 1 : 0)

export function planAssessmentRange(input: {
  period: Period
  components: PlanComponent[]
}): AssessmentRangePlan {
  const calendarDays = days(input.period.start, input.period.end)
  const issues: PlanIssue[] = [],
    components: ComponentResult[] = []
  for (const component of input.components) {
    const period = { from: input.period.start, to: input.period.end }
    const lifecycle = { from: component.alta, to: component.baja ?? input.period.end }
    const eligible = overlap(period, lifecycle)
    if (!eligible) {
      components.push({
        componentKey: component.key,
        eligibleFrom: input.period.start,
        eligibleTo: input.period.start,
        eligibleDays: 0,
        calendarDays,
        segments: [],
        numerator: 0,
        remainder: 0,
        amountCents: 0,
        status: 'ZERO',
      })
      continue
    }
    const candidates = component.prices
      .filter((price) => overlap(eligible, price))
      .sort(
        (a, b) => a.from.localeCompare(b.from) || a.priceVersionId.localeCompare(b.priceVersionId),
      )
    const boundaries = [
      ...new Set([
        eligible.from,
        eligible.to,
        ...candidates.flatMap((price) => [
          max(eligible.from, price.from),
          min(eligible.to, price.to),
        ]),
      ]),
    ].sort()
    const segments: Segment[] = []
    let invalid = false
    for (let index = 1; index < boundaries.length; index++) {
      const interval = { from: boundaries[index - 1]!, to: boundaries[index]! }
      if (interval.from === interval.to) continue
      const covering = candidates.filter((price) => overlap(interval, price))
      if (covering.length !== 1) {
        issues.push({
          code: covering.length ? 'PRICE_OVERLAP' : 'PRICE_GAP',
          componentKey: component.key,
          ...interval,
        })
        invalid = true
        continue
      }
      const price = covering[0]!
      if (price.rule === 'NEXT_PERIOD') {
        issues.push({ code: 'NEXT_PERIOD_CONFLICT', componentKey: component.key, ...interval })
        invalid = true
        continue
      }
      const eligibleDays = days(interval.from, interval.to),
        numerator = price.amountCents * eligibleDays
      if (Number.isSafeInteger(numerator)) {
        segments.push({ ...price, eligibleDays, numerator })
      } else {
        issues.push({ code: 'OVERFLOW', componentKey: component.key, ...interval })
        invalid = true
      }
    }
    const numerator = segments.reduce((sum, segment) => sum + segment.numerator, 0)
    const remainder = numerator % calendarDays
    const amountCents = rounded(numerator, calendarDays)
    if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(amountCents)) {
      issues.push({ code: 'OVERFLOW', componentKey: component.key, ...eligible })
      invalid = true
    }
    const status = invalid ? 'CONFLICT' : amountCents ? 'PENDING' : 'ZERO'
    components.push({
      componentKey: component.key,
      eligibleFrom: eligible.from,
      eligibleTo: eligible.to,
      eligibleDays: days(eligible.from, eligible.to),
      calendarDays,
      segments,
      numerator,
      remainder,
      amountCents,
      status,
    })
  }
  if (issues.length) return { executable: false, totalCents: null, components, issues }
  const totalCents = components.reduce((sum, component) => sum + component.amountCents, 0)
  if (Number.isSafeInteger(totalCents)) return { executable: true, totalCents, components, issues }
  return {
    executable: false,
    totalCents: null,
    components,
    issues: [
      { code: 'OVERFLOW', componentKey: 'total', from: input.period.start, to: input.period.end },
    ],
  }
}
