import { createHash } from 'node:crypto'
import type { ApplicableBenefit } from './benefits.ts'
import type { PriceVersion } from './range-planner.ts'

export type GenerationPrice = Omit<PriceVersion, 'priceVersionId' | 'to'> & {
  id: string
  kind: 'BASE' | 'SPORT'
  disciplineId: string | null
  label: string
  to: string | null
}
export type GenerationMember = {
  id: string
  memberNumber: string
  label: string
  memberSince: string
  baseEligible?: boolean
  sports: Array<{
    id: string
    disciplineId: string
    label: string
    start: string
    end: string | null
    estado?: string
    fechaAlta?: string
    fechaBaja?: string | null
    eligibleFrom?: string
    eligibleTo?: string
  }>
  benefits: ApplicableBenefit[]
  existingObligationId?: string
}
export type GenerationPlanInput = {
  period: { start: string; end: string }
  currency: string
  prices: GenerationPrice[]
  members: GenerationMember[]
}

type FingerprintEntry = { memberId: string }

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).sort().join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export const ordered = <T>(items: T[], key: (item: T) => string) =>
  items.slice().sort((a, b) => key(a).localeCompare(key(b)))

export function generationPlanFingerprintProjection<T extends FingerprintEntry>(input: {
  period: GenerationPlanInput['period']
  currency: string
  prices: GenerationPrice[]
  entries: T[]
}) {
  const prices = ordered(
    input.prices,
    (price) => `${price.kind}|${price.disciplineId ?? ''}|${price.from}|${price.to}|${price.id}`,
  )
  return {
    period: input.period,
    currency: input.currency,
    prices: prices.map(({ label, ...price }) => {
      void label
      return price
    }),
    entries: ordered(input.entries, (entry) => entry.memberId),
  }
}

export function fingerprintGenerationPlan<T extends FingerprintEntry>(input: {
  period: GenerationPlanInput['period']
  currency: string
  prices: GenerationPrice[]
  entries: T[]
}) {
  return createHash('sha256')
    .update(canonical(generationPlanFingerprintProjection(input)))
    .digest('hex')
}
