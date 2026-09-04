import { describe, expect, it } from 'vitest'
import { buildBaseExecutionComponents } from './generation-execution-components.ts'
import { planAssessmentRange } from './range-planner.ts'

const range = planAssessmentRange({
  period: { start: '2026-08-01', end: '2026-09-01' },
  components: [
    {
      key: 'base',
      kind: 'BASE',
      alta: '2026-08-01',
      baja: null,
      prices: [
        {
          priceVersionId: 'base-price',
          amountCents: 3_100,
          currency: 'ARS',
          from: '2026-08-01',
          to: '2026-09-01',
          rule: 'FULL_MONTH',
        },
      ],
    },
    {
      key: 'sport:enrollment',
      kind: 'SPORT',
      alta: '2026-08-04',
      baja: null,
      prices: [
        {
          priceVersionId: 'sport-price',
          amountCents: 1_200,
          currency: 'ARS',
          from: '2026-08-01',
          to: '2026-09-01',
          rule: 'FULL_MONTH',
        },
      ],
    },
  ],
})

const member = {
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
}

describe('buildBaseExecutionComponents', () => {
  it('projects base and sport components with relational discipline identifiers', () => {
    expect(buildBaseExecutionComponents({ member, range })).toMatchObject([
      {
        kind: 'BASE',
        componentKey: 'base',
        amountCents: 3_100,
        disciplinaId: null,
        enrollmentId: null,
        priceVersionId: 'base-price',
        unitAmountCents: 3_100,
        rule: 'FULL_MONTH',
        eligibleFrom: '2026-08-01',
        eligibleTo: '2026-09-01',
        eligibleDays: 31,
        periodDays: 31,
        calculationInputs: {
          numerator: 96_100,
          remainder: 0,
          periodDays: 31,
          segments: [
            {
              priceVersionId: 'base-price',
              rule: 'FULL_MONTH',
              unitAmountCents: 3_100,
              eligibleFrom: '2026-08-01',
              eligibleTo: '2026-09-01',
              eligibleDays: 31,
            },
          ],
        },
        eligibilitySnapshot: {
          memberSince: '2025-01-01',
          baseEligible: true,
          eligibleFrom: '2026-08-01',
          eligibleTo: '2026-09-01',
        },
        priceSnapshot: {
          periodDays: 31,
          sourcePriceVersionIds: ['base-price'],
        },
      },
      {
        kind: 'SPORT',
        componentKey: 'sport:enrollment',
        amountCents: 1_084,
        disciplinaId: 'swim',
        enrollmentId: 'enrollment',
        priceVersionId: 'sport-price',
        unitAmountCents: 1_200,
        rule: 'FULL_MONTH',
        eligibleFrom: '2026-08-04',
        eligibleTo: '2026-09-01',
        eligibleDays: 28,
        periodDays: 31,
        calculationInputs: {
          numerator: 33_600,
          remainder: 27,
          periodDays: 31,
          segments: [
            {
              priceVersionId: 'sport-price',
              rule: 'FULL_MONTH',
              unitAmountCents: 1_200,
              eligibleFrom: '2026-08-01',
              eligibleTo: '2026-09-01',
              eligibleDays: 28,
            },
          ],
        },
        eligibilitySnapshot: {
          enrollment: {
            id: 'enrollment',
            disciplineId: 'swim',
            estado: 'activa',
            fechaAlta: '2026-08-04',
            fechaBaja: null,
            eligibleFrom: '2026-08-04',
            eligibleTo: '2026-09-01',
          },
        },
        priceSnapshot: {
          periodDays: 31,
          sourcePriceVersionIds: ['sport-price'],
        },
      },
    ])
  })
})
