import type { GenerationMember } from './generation-plan-fingerprint.ts'
import type { ObligationComponentInput } from './repository.ts'
import { type planAssessmentRange } from './range-planner.ts'

type Range = ReturnType<typeof planAssessmentRange>

export function buildBaseExecutionComponents(input: {
  member: GenerationMember
  range: Range
}): ObligationComponentInput[] {
  return input.range.components.map((component) => {
    const sport = input.member.sports.find(
      (candidate) => `sport:${candidate.id}` === component.componentKey,
    )
    const kind = component.componentKey === 'base' ? 'BASE' : 'SPORT'
    const segments = component.segments.map((segment) => ({
      priceVersionId: segment.priceVersionId,
      rule: segment.rule,
      unitAmountCents: segment.amountCents,
      eligibleFrom: segment.from,
      eligibleTo: segment.to,
      eligibleDays: segment.eligibleDays,
    }))
    return {
      kind,
      componentKey: component.componentKey,
      amountCents: component.amountCents,
      priceVersionId: segments[0]?.priceVersionId ?? null,
      disciplinaId: sport?.disciplineId ?? null,
      enrollmentId: sport?.id ?? null,
      unitAmountCents: segments[0]?.unitAmountCents ?? null,
      rule: segments[0]?.rule ?? null,
      eligibleFrom: component.eligibleFrom,
      eligibleTo: component.eligibleTo,
      eligibleDays: component.eligibleDays,
      periodDays: component.calendarDays,
      calculationInputs: {
        numerator: component.numerator,
        remainder: component.remainder,
        periodDays: component.calendarDays,
        segments,
      },
      eligibilitySnapshot:
        kind === 'BASE'
          ? {
              baseEligible: input.member.baseEligible ?? true,
              memberSince: input.member.memberSince,
              eligibleFrom: component.eligibleFrom,
              eligibleTo: component.eligibleTo,
            }
          : {
              enrollment: sport && {
                id: sport.id,
                disciplineId: sport.disciplineId,
                estado: sport.estado,
                fechaAlta: sport.fechaAlta,
                fechaBaja: sport.fechaBaja,
                eligibleFrom: sport.eligibleFrom,
                eligibleTo: sport.eligibleTo,
              },
            },
      priceSnapshot: {
        periodDays: component.calendarDays,
        sourcePriceVersionIds: segments.map((segment) => segment.priceVersionId),
        segments,
      },
    } satisfies ObligationComponentInput
  })
}
