import { BusinessError, ErrorCode } from '@athlos/errors'
export type AssessmentRule = 'FULL_MONTH' | 'DAILY_PRORATED' | 'NEXT_PERIOD'
export type AssessmentComponentKind = 'BASE' | 'SPORT'
export interface PriceInput {
  amountCents: number
  currency: string
  rule: AssessmentRule
  versionId: string
}
type EligibilityInput = {
  eligibleFrom?: string
  eligibleTo?: string
}
export interface BaseInput extends EligibilityInput {
  componentKey?: string
  eligible: boolean
  price: PriceInput
}
export interface SportInput extends EligibilityInput {
  active: boolean
  componentKey: string
  price: PriceInput
}
export interface AssessmentInput {
  period: { start: string; end: string }
  currency: string
  base?: BaseInput
  sports: SportInput[]
}
export interface AssessmentComponent {
  amountCents: number
  componentKey: string
  eligibleDays: number
  eligibleFrom: string
  eligibleTo: string
  kind: AssessmentComponentKind
  periodDays: number
  priceVersionId: string
  rule: AssessmentRule
  unitAmountCents: number
}
type DateValue = { value: string; day: number }
type AssessmentPeriod = { start: DateValue; end: DateValue; days: number }

export interface AssessmentResult {
  components: AssessmentComponent[]
  currency: string
  totalCents: number
}

const dayInMilliseconds = 86_400_000
const maxMoneyCents = 99_999_999_999_999
const currencyPattern = /^[A-Z]{3}$/
function invalid(message: string, field?: string): never {
  throw BusinessError(ErrorCode.VALIDATION_ERROR, message, field ? { field } : undefined)
}
function parseDate(value: unknown, field: string): DateValue {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return invalid(`${field} must be an ISO calendar date`, field)
  }
  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  const date = new Date(`${value}T00:00:00Z`)
  if (
    year < 1 ||
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return invalid(`${field} is not a valid calendar date`, field)
  }
  return { value, day: date.getTime() / dayInMilliseconds }
}
function validateCurrency(value: unknown, field: string): string {
  if (typeof value !== 'string' || !currencyPattern.test(value)) {
    return invalid(`${field} must be a three-letter uppercase currency`, field)
  }
  return value
}
function validatePrice(price: PriceInput, currency: string, field: string) {
  if (
    !price ||
    !Number.isSafeInteger(price.amountCents) ||
    price.amountCents < 0 ||
    price.amountCents > maxMoneyCents
  ) {
    invalid(`${field}.amountCents must be a non-negative integer within money limits`, field)
  }
  if (validateCurrency(price.currency, `${field}.currency`) !== currency) {
    invalid(`${field}.currency must match the assessment currency`, field)
  }
  if (!['FULL_MONTH', 'DAILY_PRORATED', 'NEXT_PERIOD'].includes(price.rule)) {
    invalid(`${field}.rule is not supported`, field)
  }
  if (typeof price.versionId !== 'string' || price.versionId.trim() === '') {
    invalid(`${field}.versionId is required`, field)
  }
}
function validateKey(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') invalid(`${field} is required`, field)
  return value as string
}
function boundedEligibility(
  periodStart: { value: string; day: number },
  periodEnd: { value: string; day: number },
  bounds: EligibilityInput,
  field: string,
) {
  const from = bounds.eligibleFrom
    ? parseDate(bounds.eligibleFrom, `${field}.eligibleFrom`)
    : periodStart
  const to = bounds.eligibleTo ? parseDate(bounds.eligibleTo, `${field}.eligibleTo`) : periodEnd
  if (to.day <= from.day) invalid(`${field} eligibility range must be positive`, field)
  const start = from.day > periodStart.day ? from : periodStart
  const end = to.day < periodEnd.day ? to : periodEnd
  const days = Math.max(0, end.day - start.day)
  if (!Number.isSafeInteger(days)) invalid(`${field} has an impossible day count`, field)
  return { start, end, days, sourceStart: from }
}
/** Daily proration rounds to the nearest cent, with exact halves rounded up. */
function proratedCents(
  amountCents: number,
  eligibleDays: number,
  periodDays: number,
  field: string,
) {
  const numerator = amountCents * eligibleDays
  if (!Number.isSafeInteger(numerator)) invalid(`${field} proration overflowed`, field)
  const whole = Math.floor(numerator / periodDays)
  const remainder = numerator % periodDays
  const amount = whole + (remainder * 2 >= periodDays ? 1 : 0)
  if (!Number.isSafeInteger(amount) || amount > maxMoneyCents) {
    invalid(`${field} calculated amount exceeds money limits`, field)
  }
  return amount
}
function calculateComponent(
  kind: AssessmentComponentKind,
  key: string,
  active: boolean,
  price: PriceInput,
  bounds: EligibilityInput,
  period: AssessmentPeriod,
  field: string,
): AssessmentComponent | undefined {
  const eligibility = boundedEligibility(period.start, period.end, bounds, field)
  if (!active || eligibility.days === 0) return undefined
  if (price.rule === 'NEXT_PERIOD' && eligibility.sourceStart.day > period.start.day)
    return undefined
  const amountCents =
    price.rule === 'DAILY_PRORATED'
      ? proratedCents(price.amountCents, eligibility.days, period.days, field)
      : price.amountCents
  return {
    amountCents,
    componentKey: key,
    eligibleDays: eligibility.days,
    eligibleFrom: eligibility.start.value,
    eligibleTo: eligibility.end.value,
    kind,
    periodDays: period.days,
    priceVersionId: price.versionId,
    rule: price.rule,
    unitAmountCents: price.amountCents,
  }
}
export function calculateAssessment(input: AssessmentInput): AssessmentResult {
  const currency = validateCurrency(input.currency, 'currency')
  const start = parseDate(input.period?.start, 'period.start')
  const end = parseDate(input.period?.end, 'period.end')
  const periodDays = end.day - start.day
  if (!Number.isSafeInteger(periodDays) || periodDays <= 0) {
    invalid('period must be a non-empty date range', 'period')
  }
  if (!Array.isArray(input.sports)) invalid('sports must be an array', 'sports')

  const keys = new Set<string>()
  const components: AssessmentComponent[] = []
  const addKey = (key: string, field: string) => {
    if (keys.has(key)) invalid(`duplicate component key: ${key}`, field)
    keys.add(key)
  }
  const period: AssessmentPeriod = { start, end, days: periodDays }
  if (input.base) {
    const base = input.base
    const key = validateKey(base.componentKey ?? 'base', 'base.componentKey')
    addKey(key, 'base.componentKey')
    validatePrice(base.price, currency, 'base.price')
    const component = calculateComponent(
      'BASE',
      key,
      base.eligible,
      base.price,
      base,
      period,
      'base',
    )
    if (component) components.push(component)
  }

  for (const [index, sport] of input.sports.entries()) {
    const field = `sports[${index}]`
    const key = validateKey(sport.componentKey, `${field}.componentKey`)
    addKey(key, `${field}.componentKey`)
    validatePrice(sport.price, currency, `${field}.price`)
    const component = calculateComponent(
      'SPORT',
      key,
      sport.active,
      sport.price,
      sport,
      period,
      field,
    )
    if (component) components.push(component)
  }

  let totalCents = 0
  for (const component of components) {
    if (component.amountCents > maxMoneyCents - totalCents) {
      invalid('assessment total exceeds money limits', 'totalCents')
    }
    totalCents += component.amountCents
  }
  return {
    components,
    currency,
    totalCents,
  }
}
