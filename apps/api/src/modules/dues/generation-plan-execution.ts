import type { AppliedBenefit } from './benefits.ts'
import { buildBaseExecutionComponents } from './generation-execution-components.ts'
import type { GenerationMember, GenerationPrice } from './generation-plan-fingerprint.ts'
import type { ObligationComponentInput } from './repository.ts'
import { type planAssessmentRange } from './range-planner.ts'

type Range = ReturnType<typeof planAssessmentRange>
type Benefits = {
  totalCents: number
  applied: AppliedBenefit[]
  components: Array<{
    kind: 'BENEFIT'
    componentKey: string
    amountCents: number
    benefitId: string
    calculationInputs: Record<string, unknown>
    eligibilitySnapshot: Record<string, unknown>
    priceSnapshot: Record<string, unknown>
  }>
}
type Json = Record<string, unknown>

type ExecutionComponent = ObligationComponentInput

export type GenerationBenefitAudit = Readonly<{
  id: AppliedBenefit['id']
  requestedAmountCents: AppliedBenefit['requestedAmountCents']
  appliedAmountCents: AppliedBenefit['appliedAmountCents']
  truncatedAmountCents: AppliedBenefit['truncatedAmountCents']
  remainingBeforeCents: AppliedBenefit['remainingBeforeCents']
  remainingAfterCents: AppliedBenefit['remainingAfterCents']
  ruleSnapshot: Readonly<{
    kind: AppliedBenefit['kind']
    socioId: AppliedBenefit['socioId']
    familyGroupId: AppliedBenefit['familyGroupId']
    amountCents: AppliedBenefit['amountCents']
    percentage: AppliedBenefit['percentage']
    currency: AppliedBenefit['currency']
    effectiveFrom: AppliedBenefit['effectiveFrom']
    effectiveTo: AppliedBenefit['effectiveTo']
    priority: AppliedBenefit['priority']
    combinability: AppliedBenefit['combinability']
    exclusiveGroup: AppliedBenefit['exclusiveGroup']
    percentageBasis: AppliedBenefit['percentageBasis']
    reason: AppliedBenefit['reason']
    authorizationEvidence: AppliedBenefit['authorizationEvidence']
  }>
  sourceSnapshot: Readonly<{
    benefitId: AppliedBenefit['id']
    authorizationEvidence: AppliedBenefit['authorizationEvidence']
  }>
}>

export type GenerationExecutionPayload = {
  amountCents: number
  components: ExecutionComponent[]
  benefitAudits: GenerationBenefitAudit[]
  snapshot: Json
}

const benefitAudit = (benefit: AppliedBenefit): GenerationBenefitAudit => ({
  id: benefit.id,
  requestedAmountCents: benefit.requestedAmountCents,
  appliedAmountCents: benefit.appliedAmountCents,
  truncatedAmountCents: benefit.truncatedAmountCents,
  remainingBeforeCents: benefit.remainingBeforeCents,
  remainingAfterCents: benefit.remainingAfterCents,
  ruleSnapshot: {
    kind: benefit.kind,
    socioId: benefit.socioId,
    familyGroupId: benefit.familyGroupId,
    amountCents: benefit.amountCents,
    percentage: benefit.percentage,
    currency: benefit.currency,
    effectiveFrom: benefit.effectiveFrom,
    effectiveTo: benefit.effectiveTo,
    priority: benefit.priority,
    combinability: benefit.combinability,
    exclusiveGroup: benefit.exclusiveGroup,
    percentageBasis: benefit.percentageBasis,
    reason: benefit.reason,
    authorizationEvidence: benefit.authorizationEvidence,
  },
  sourceSnapshot: { benefitId: benefit.id, authorizationEvidence: benefit.authorizationEvidence },
})

export function buildGenerationExecutionPayload(input: {
  period: { start: string; end: string }
  currency: string
  member: GenerationMember
  prices: GenerationPrice[]
  range: Range
  benefits: Benefits
}): GenerationExecutionPayload {
  const base = buildBaseExecutionComponents({ member: input.member, range: input.range })
  const benefits = input.benefits.components.map(
    (component) => ({ ...component }) satisfies ExecutionComponent,
  )
  const benefitAudits = input.benefits.applied.map(benefitAudit)
  return {
    amountCents: input.benefits.totalCents,
    components: [...base, ...benefits],
    benefitAudits,
    snapshot: {
      calculatorVersion: 'generation-plan-v1',
      rounding: 'HALF_UP',
      assessment: {
        period: input.period,
        currency: input.currency,
        input: { grossCents: input.range.totalCents, componentCount: base.length },
      },
      member: {
        id: input.member.id,
        memberNumber: input.member.memberNumber,
        label: input.member.label,
        memberSince: input.member.memberSince,
        baseEligible: input.member.baseEligible ?? true,
        enrollments: input.member.sports.map((sport) => ({ ...sport })),
      },
      sourcePrices: input.prices.map(
        ({ id, kind, disciplineId, amountCents, currency, from, to, rule }) => ({
          id,
          kind,
          disciplineId,
          amountCents,
          currency,
          from,
          to,
          rule,
        }),
      ),
      appliedBenefits: benefitAudits,
    },
  }
}
