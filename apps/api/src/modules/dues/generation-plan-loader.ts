import type { ApplicableBenefit } from './benefits.ts'
import { createGenerationPlan, type GenerationPlan } from './generation-plan.ts'
import type { GenerationMemberFact, GenerationPriceFact, Period } from './repository.ts'

export type GenerationPlanLoaderRepository = {
  listGenerationMembers(period: Period): Promise<GenerationMemberFact[]>
  listGenerationPrices(period: Period): Promise<GenerationPriceFact[]>
  resolveBenefitRuleCandidates(input: {
    socioId: string
    familyGroupId?: string | null
    period: Period
  }): Promise<ApplicableBenefit[]>
}

export type LoadGenerationPlanInput = {
  period: Period
  currency: string
}

export async function loadGenerationPlan(
  repository: GenerationPlanLoaderRepository,
  input: LoadGenerationPlanInput,
): Promise<GenerationPlan> {
  const members = await repository.listGenerationMembers(input.period)
  const prices = await repository.listGenerationPrices(input.period)
  const plannedMembers = await Promise.all(
    members.map(async ({ familyGroupId, ...member }) => ({
      ...member,
      benefits: await repository.resolveBenefitRuleCandidates({
        socioId: member.id,
        familyGroupId,
        period: input.period,
      }),
    })),
  )

  return createGenerationPlan({
    period: input.period,
    currency: input.currency,
    prices,
    members: plannedMembers,
  })
}
