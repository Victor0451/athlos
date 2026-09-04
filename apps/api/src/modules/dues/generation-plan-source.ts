import type { GenerationMember, GenerationPrice } from './generation-plan-fingerprint.ts'
import { ordered } from './generation-plan-fingerprint.ts'
import { planAssessmentRange } from './range-planner.ts'

export type GenerationPlanSourceInput = {
  period: { start: string; end: string }
  prices: GenerationPrice[]
  member: GenerationMember
}

export type GenerationPlanSource = {
  range: ReturnType<typeof planAssessmentRange>
}

export function createGenerationPlanSource(input: GenerationPlanSourceInput): GenerationPlanSource {
  const { member, prices } = input
  const components = [
    ...(member.baseEligible === false
      ? []
      : [
          {
            key: 'base',
            kind: 'BASE' as const,
            alta: member.memberSince,
            baja: null,
            prices: prices.filter((price) => price.kind === 'BASE'),
          },
        ]),
    ...ordered(member.sports, (sport) => sport.id).map((sport) => ({
      key: `sport:${sport.id}`,
      kind: 'SPORT' as const,
      alta: sport.start,
      baja: sport.end,
      prices: prices.filter(
        (price) => price.kind === 'SPORT' && price.disciplineId === sport.disciplineId,
      ),
    })),
  ].map(({ prices: componentPrices, ...component }) => ({
    ...component,
    prices: componentPrices.map(({ id, ...price }) => ({
      ...price,
      to: price.to ?? input.period.end,
      priceVersionId: id,
    })),
  }))

  return { range: planAssessmentRange({ period: input.period, components }) }
}
