export type ApplicableBenefit = {
  id: string
  kind: 'FIXED_DISCOUNT' | 'PERCENT_DISCOUNT' | 'SCHOLARSHIP'
  socioId: string | null
  familyGroupId: string | null
  amountCents: number | null
  percentage: number | null
  currency: string | null
  effectiveFrom: string
  effectiveTo: string | null
  priority: number
  combinability: 'COMBINABLE' | 'EXCLUSIVE'
  exclusiveGroup: string | null
  percentageBasis: 'GROSS' | 'REMAINING' | null
  reason: string
  authorizationEvidence: Record<string, unknown>
}

export type AppliedBenefit = ApplicableBenefit & {
  requestedAmountCents: number
  appliedAmountCents: number
  truncatedAmountCents: number
  remainingBeforeCents: number
  remainingAfterCents: number
}

export type BenefitComponent = {
  kind: 'BENEFIT'
  componentKey: string
  amountCents: number
  benefitId: string
  calculationInputs: Record<string, unknown>
  eligibilitySnapshot: Record<string, unknown>
  priceSnapshot: Record<string, unknown>
}

const target = (benefit: ApplicableBenefit) =>
  benefit.socioId
    ? { type: 'MEMBER', id: benefit.socioId }
    : { type: 'FAMILY', id: benefit.familyGroupId }

// prettier-ignore
export function applyBenefits(grossCents: number, benefits: ApplicableBenefit[], currency: string) {
  if (!Number.isSafeInteger(grossCents) || grossCents < 0)
    throw new Error('Benefit gross debt must be non-negative')
  const ordered = benefits
    .slice()
    .sort((a, b) => a.priority - b.priority || a.effectiveFrom.localeCompare(b.effectiveFrom) || a.id.localeCompare(b.id))
  let remaining = grossCents
  const groups = new Set<string>(), applied: AppliedBenefit[] = [], components: BenefitComponent[] = []
  for (const benefit of ordered) {
    if (benefit.combinability === 'EXCLUSIVE' && benefit.exclusiveGroup && groups.has(benefit.exclusiveGroup)) continue
    if (benefit.combinability === 'EXCLUSIVE' && benefit.exclusiveGroup) groups.add(benefit.exclusiveGroup)
    if (benefit.kind === 'FIXED_DISCOUNT' && benefit.currency !== currency)
      throw new Error('Fixed benefit currency must match the assessment currency')
    const basis = benefit.kind === 'FIXED_DISCOUNT' ? null : benefit.percentageBasis
    if (benefit.kind !== 'FIXED_DISCOUNT' && (basis === null || benefit.percentage === null))
      throw new Error('Percentage benefit basis is required')
    const base = basis === 'GROSS' ? grossCents : remaining
    const requested = benefit.kind === 'FIXED_DISCOUNT' ? benefit.amountCents ?? 0 : Math.round((base * (benefit.percentage ?? 0)) / 100)
    const appliedAmountCents = Math.min(remaining, Math.max(0, requested))
    const appliedBenefit: AppliedBenefit = { ...benefit, requestedAmountCents: requested, appliedAmountCents, truncatedAmountCents: requested - appliedAmountCents, remainingBeforeCents: remaining, remainingAfterCents: remaining - appliedAmountCents }
    if (appliedAmountCents > 0) {
      applied.push(appliedBenefit)
      components.push({ kind: 'BENEFIT', componentKey: `benefit:${benefit.id}`, amountCents: -appliedAmountCents, benefitId: benefit.id, calculationInputs: { grossCents, remainingBeforeCents: remaining, requestedAmountCents: requested, appliedAmountCents, truncatedAmountCents: requested - appliedAmountCents, basis, percentage: benefit.percentage }, eligibilitySnapshot: { target: target(benefit), effectiveFrom: benefit.effectiveFrom, effectiveTo: benefit.effectiveTo }, priceSnapshot: { ruleVersionId: benefit.id, kind: benefit.kind, priority: benefit.priority, combinability: benefit.combinability, exclusiveGroup: benefit.exclusiveGroup, percentageBasis: benefit.percentageBasis } })
      remaining -= appliedAmountCents
    }
  }
  return { totalCents: remaining, applied, components }
}
