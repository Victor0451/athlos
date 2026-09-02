import { describe, expect, it } from 'vitest'
import { applyBenefits } from './benefits.ts'
import {
  buildGenerationExecutionPayload,
  type GenerationBenefitAudit,
} from './generation-plan-execution.ts'
import { planAssessmentRange } from './range-planner.ts'

const price = {
  id: 'base-price',
  kind: 'BASE' as const,
  disciplineId: null,
  amountCents: 3_100,
  currency: 'ARS',
  from: '2026-08-01',
  to: null,
  rule: 'FULL_MONTH' as const,
  label: 'Cuota social',
}
const sportPrice = {
  ...price,
  id: 'sport-price',
  kind: 'SPORT' as const,
  disciplineId: 'swim',
  amountCents: 1_200,
}

describe('buildGenerationExecutionPayload', () => {
  it('creates immutable repository-ready component and audit snapshots', () => {
    const benefit = {
      id: 'grant',
      kind: 'FIXED_DISCOUNT' as const,
      socioId: 'member',
      familyGroupId: null,
      amountCents: 3_500,
      percentage: null,
      currency: 'ARS',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      priority: 1,
      combinability: 'COMBINABLE' as const,
      exclusiveGroup: null,
      percentageBasis: null,
      reason: 'Scholarship',
      authorizationEvidence: { ticket: 'A-1' },
    }
    const range = planAssessmentRange({
      period: { start: '2026-08-01', end: '2026-09-01' },
      components: [
        {
          key: 'base',
          kind: 'BASE',
          alta: '2026-08-01',
          baja: null,
          prices: [{ ...price, priceVersionId: price.id, to: '2026-09-01' }],
        },
        {
          key: 'sport:enrollment',
          kind: 'SPORT',
          alta: '2026-08-04',
          baja: null,
          prices: [{ ...sportPrice, priceVersionId: sportPrice.id, to: '2026-09-01' }],
        },
      ],
    })
    const payload = buildGenerationExecutionPayload({
      period: { start: '2026-08-01', end: '2026-09-01' },
      currency: 'ARS',
      member: {
        id: 'member',
        memberNumber: '0001',
        label: 'Member',
        memberSince: '2025-01-01',
        baseEligible: true,
        sports: [
          {
            id: 'enrollment',
            disciplineId: 'swim',
            label: 'Swimming',
            start: '2026-08-04',
            end: null,
            estado: 'activa',
            fechaAlta: '2026-08-04',
            fechaBaja: null,
            eligibleFrom: '2026-08-04',
            eligibleTo: '2026-09-01',
          },
        ],
        benefits: [],
      },
      prices: [price, sportPrice],
      range,
      benefits: applyBenefits(4_184, [benefit], 'ARS'),
    })

    const benefitAudits: GenerationBenefitAudit[] = payload.benefitAudits

    expect(benefitAudits).toEqual([
      expect.objectContaining({
        id: 'grant',
        requestedAmountCents: 3_500,
        appliedAmountCents: 3_500,
        truncatedAmountCents: 0,
        remainingBeforeCents: 4_184,
        remainingAfterCents: 684,
        ruleSnapshot: expect.objectContaining({ authorizationEvidence: { ticket: 'A-1' } }),
        sourceSnapshot: { benefitId: 'grant', authorizationEvidence: { ticket: 'A-1' } },
      }),
    ])
    expect(payload.snapshot.appliedBenefits).toBe(benefitAudits)

    expect(payload.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'BENEFIT',
          componentKey: 'benefit:grant',
          amountCents: -3_500,
          calculationInputs: {
            grossCents: 4_184,
            remainingBeforeCents: 4_184,
            requestedAmountCents: 3_500,
            appliedAmountCents: 3_500,
            truncatedAmountCents: 0,
            basis: null,
            percentage: null,
          },
          eligibilitySnapshot: {
            target: { type: 'MEMBER', id: 'member' },
            effectiveFrom: '2026-01-01',
            effectiveTo: null,
          },
          priceSnapshot: {
            ruleVersionId: 'grant',
            kind: 'FIXED_DISCOUNT',
            priority: 1,
            combinability: 'COMBINABLE',
            exclusiveGroup: null,
            percentageBasis: null,
          },
        }),
      ]),
    )
    expect(payload).toMatchObject({
      amountCents: 684,
      snapshot: {
        calculatorVersion: 'generation-plan-v1',
        rounding: 'HALF_UP',
        assessment: { period: { start: '2026-08-01', end: '2026-09-01' }, currency: 'ARS' },
        member: {
          id: 'member',
          memberNumber: '0001',
          label: 'Member',
          baseEligible: true,
          memberSince: '2025-01-01',
          enrollments: [
            {
              id: 'enrollment',
              disciplineId: 'swim',
              label: 'Swimming',
              start: '2026-08-04',
              end: null,
              estado: 'activa',
              fechaAlta: '2026-08-04',
              fechaBaja: null,
              eligibleFrom: '2026-08-04',
              eligibleTo: '2026-09-01',
            },
          ],
        },
        sourcePrices: [
          { id: 'base-price', amountCents: 3_100, disciplineId: null },
          { id: 'sport-price', amountCents: 1_200, disciplineId: 'swim' },
        ],
        appliedBenefits: [
          {
            id: 'grant',
            requestedAmountCents: 3_500,
            appliedAmountCents: 3_500,
            truncatedAmountCents: 0,
            remainingBeforeCents: 4_184,
            remainingAfterCents: 684,
            ruleSnapshot: { authorizationEvidence: { ticket: 'A-1' } },
          },
        ],
      },
    })
  })
})
