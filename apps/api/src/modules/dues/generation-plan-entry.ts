import { applyBenefits } from './benefits.ts'
import {
  buildGenerationExecutionPayload,
  type GenerationExecutionPayload,
} from './generation-plan-execution.ts'
import type { GenerationMember, GenerationPrice } from './generation-plan-fingerprint.ts'
import { createGenerationPlanSource } from './generation-plan-source.ts'
import type { PlanIssue } from './range-planner.ts'

export type GenerationStatus = 'CONFLICT' | 'REVIEW' | 'READY'
export type GenerationReviewCode = 'EXISTING_OBLIGATION' | 'ZERO_GROSS' | 'ZERO_NET'
type InternalComponent = {
  kind: 'BASE' | 'SPORT'
  componentKey: string
  enrollmentId: string | null
  disciplineId: string | null
  amountCents: number
  eligibleFrom: string
  eligibleTo: string
  priceVersionIds: string[]
}
type Insertion =
  | { disposition: 'INSERT'; payload: GenerationExecutionPayload }
  | { disposition: 'SKIP' }

export type GenerationPlanEntry = {
  memberId: string
  existingObligationId: string | null
  status: GenerationStatus
  reviewCodes: GenerationReviewCode[]
  issues: PlanIssue[]
  grossCents: number
  netCents: number
  components: InternalComponent[]
  appliedBenefitIds: string[]
  insertion: Insertion
}
export type GenerationPlanEntryInput = {
  period: { start: string; end: string }
  currency: string
  prices: GenerationPrice[]
  member: GenerationMember
}

export function createGenerationPlanEntry(input: GenerationPlanEntryInput): GenerationPlanEntry {
  const { member, prices } = input
  const { range } = createGenerationPlanSource(input)
  const grossCents = range.totalCents ?? 0
  const benefits = range.executable
    ? applyBenefits(grossCents, member.benefits, input.currency)
    : null
  const netCents = benefits?.totalCents ?? grossCents
  const reviewCodes: GenerationReviewCode[] = []
  if (member.existingObligationId) reviewCodes.push('EXISTING_OBLIGATION')
  if (grossCents === 0) reviewCodes.push('ZERO_GROSS')
  if (netCents === 0) reviewCodes.push('ZERO_NET')
  const status: GenerationStatus = range.executable
    ? reviewCodes.length
      ? 'REVIEW'
      : 'READY'
    : 'CONFLICT'
  return {
    memberId: member.id,
    existingObligationId: member.existingObligationId ?? null,
    status,
    reviewCodes,
    issues: range.issues,
    grossCents,
    netCents,
    insertion:
      status === 'READY' && benefits
        ? {
            disposition: 'INSERT',
            payload: buildGenerationExecutionPayload({
              period: input.period,
              currency: input.currency,
              member,
              prices,
              range,
              benefits,
            }),
          }
        : { disposition: 'SKIP' },
    components: range.components.map((component) => {
      const sport = member.sports.find(
        (candidate) => `sport:${candidate.id}` === component.componentKey,
      )
      return {
        kind: component.componentKey === 'base' ? 'BASE' : 'SPORT',
        componentKey: component.componentKey,
        enrollmentId: sport?.id ?? null,
        disciplineId: sport?.disciplineId ?? null,
        amountCents: component.amountCents,
        eligibleFrom: component.eligibleFrom,
        eligibleTo: component.eligibleTo,
        priceVersionIds: component.segments.map((segment) => segment.priceVersionId),
      }
    }),
    appliedBenefitIds: benefits?.applied.map((benefit) => benefit.id) ?? [],
  }
}
