import { createGenerationPlanEntry, type GenerationPlanEntry } from './generation-plan-entry.ts'
import {
  fingerprintGenerationPlan,
  ordered,
  type GenerationPlanInput,
} from './generation-plan-fingerprint.ts'
import {
  createGenerationPlanPresentation,
  type GenerationPlanPresentation,
} from './generation-plan-presentation.ts'

export type {
  GenerationMember,
  GenerationPlanInput,
  GenerationPrice,
} from './generation-plan-fingerprint.ts'
export type { GenerationReviewCode, GenerationStatus } from './generation-plan-entry.ts'

type Summary = {
  memberCount: number
  readyCount: number
  reviewCount: number
  conflictCount: number
  estimatedNewTotalCents: number
}
export type GenerationPlan = {
  internal: {
    period: { start: string; end: string }
    currency: string
    entries: GenerationPlanEntry[]
    summary: Summary
    fingerprint: string
  }
  presentation: GenerationPlanPresentation
}

export function createGenerationPlan(input: GenerationPlanInput): GenerationPlan {
  const prices = ordered(
    input.prices,
    (price) => `${price.kind}|${price.disciplineId ?? ''}|${price.from}|${price.to}|${price.id}`,
  )
  const members = ordered(input.members, (member) => member.id)
  const entries = members.map((member) =>
    createGenerationPlanEntry({ period: input.period, currency: input.currency, prices, member }),
  )
  const summary = entries.reduce<Summary>(
    (result, entry) => ({
      memberCount: result.memberCount + 1,
      readyCount: result.readyCount + Number(entry.status === 'READY'),
      reviewCount: result.reviewCount + Number(entry.status === 'REVIEW'),
      conflictCount: result.conflictCount + Number(entry.status === 'CONFLICT'),
      estimatedNewTotalCents:
        result.estimatedNewTotalCents + (entry.status === 'READY' ? entry.netCents : 0),
    }),
    { memberCount: 0, readyCount: 0, reviewCount: 0, conflictCount: 0, estimatedNewTotalCents: 0 },
  )
  const fingerprint = fingerprintGenerationPlan({
    period: input.period,
    currency: input.currency,
    prices,
    entries,
  })
  return {
    internal: { period: input.period, currency: input.currency, entries, summary, fingerprint },
    presentation: createGenerationPlanPresentation(input, entries),
  }
}
