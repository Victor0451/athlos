export type ApplicableBenefit = {
  id: string
  kind: 'FIXED_DISCOUNT' | 'PERCENT_DISCOUNT' | 'SCHOLARSHIP'
  scope: 'MEMBER' | 'FAMILY'
  amountCents: number | null
  percentage: number | null
  currency: string
  effectiveFrom: string
  effectiveTo: string | null
  reason: string
  authorizationEvidence: Record<string, unknown>
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
// prettier-ignore
export function applyBenefits(grossCents: number, benefits: ApplicableBenefit[], currency: string) {
  if (!Number.isSafeInteger(grossCents) || grossCents < 0) throw new Error('Benefit gross debt must be non-negative')
  const ordered = benefits.slice().sort((a, b) => Number(b.scope === 'MEMBER') - Number(a.scope === 'MEMBER') || a.effectiveFrom.localeCompare(b.effectiveFrom) || a.id.localeCompare(b.id))
  let remaining = grossCents
  const components: BenefitComponent[] = []
  for (const benefit of ordered) {
    if (benefit.currency !== currency) throw new Error('Benefit currency must match the assessment currency')
    const requested = benefit.kind === 'FIXED_DISCOUNT' ? benefit.amountCents : Math.round(grossCents * (benefit.percentage ?? 0) / 100)
    const amount = Math.min(remaining, Math.max(0, requested ?? 0))
    if (!amount) continue
    components.push({ kind: 'BENEFIT', componentKey: `benefit:${benefit.id}`, amountCents: -amount, benefitId: benefit.id, calculationInputs: { benefit: { id: benefit.id, kind: benefit.kind, amountCents: benefit.amountCents, percentage: benefit.percentage, currency: benefit.currency } }, eligibilitySnapshot: { scope: benefit.scope, effectiveFrom: benefit.effectiveFrom, effectiveTo: benefit.effectiveTo }, priceSnapshot: {} })
    remaining -= amount
  }
  return { totalCents: remaining, components, benefits: ordered.filter((benefit) => components.some((component) => component.benefitId === benefit.id)) }
}
