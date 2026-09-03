import { describe, expect, it, vi } from 'vitest'
import { listAssessmentFacts, listGenerationMembers, listGenerationPrices } from './repository.ts'

const db = (results: unknown[][]) =>
  ({ execute: vi.fn().mockImplementation(async () => ({ rows: results.shift() ?? [] })) }) as never

describe('assessment fact repository', () => {
  it('loads only the requested member plus interval-overlap prices and existing obligations', async () => {
    const query = db([
      [
        {
          socioId: 'member-1',
          fechaAlta: '2026-01-10',
          enrollmentId: 'sport-1',
          disciplinaId: 'sport-id',
          sportAlta: '2026-01-12',
          sportBaja: null,
        },
      ],
      [
        {
          versionId: 'base-1',
          kind: 'BASE',
          disciplinaId: null,
          amount: '100.00',
          currency: 'ARS',
          rule: 'FULL_MONTH',
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
        },
      ],
      [{ id: 'ob-1', periodStart: '2026-01-01', amount: '100.00' }],
    ])
    const facts = await listAssessmentFacts(query, 'member-1', {
      start: '2026-01-01',
      end: '2026-03-01',
    })
    expect(facts.member).toMatchObject({ socioId: 'member-1', fechaAlta: '2026-01-10' })
    expect(facts.prices[0]).toMatchObject({ versionId: 'base-1', amountCents: 10_000 })
    expect(facts.obligations).toEqual([
      { id: 'ob-1', periodStart: '2026-01-01', amountCents: 10_000 },
    ])
    expect((query as { execute: ReturnType<typeof vi.fn> }).execute).toHaveBeenCalledTimes(3)
  })
})

describe('generation fact repository', () => {
  const period = { start: '2026-02-01', end: '2026-03-01' }

  it('maps period members, discipline labels, and existing obligations in one query', async () => {
    const query = db([
      [
        {
          socioId: 'member-1',
          memberNumber: '42',
          memberLabel: 'Doe, Jane',
          memberSince: '2024-05-10',
          familyGroupId: 'family-1',
          existingObligationId: 'obligation-1',
          enrollmentId: 'enrollment-1',
          disciplinaId: 'discipline-1',
          disciplineLabel: 'Swimming',
          enrollmentStart: '2026-02-04',
          enrollmentEnd: null,
          enrollmentEstado: 'activa',
        },
      ],
    ])

    await expect(listGenerationMembers(query, period)).resolves.toEqual([
      {
        id: 'member-1',
        memberNumber: '42',
        label: 'Doe, Jane',
        memberSince: '2024-05-10',
        familyGroupId: 'family-1',
        baseEligible: true,
        existingObligationId: 'obligation-1',
        sports: [
          {
            id: 'enrollment-1',
            disciplineId: 'discipline-1',
            label: 'Swimming',
            estado: 'activa',
            fechaAlta: '2026-02-04',
            fechaBaja: null,
            eligibleFrom: '2026-02-04',
            eligibleTo: '2026-03-01',
            start: '2026-02-04',
            end: null,
          },
        ],
      },
    ])
    expect((query as { execute: ReturnType<typeof vi.fn> }).execute).toHaveBeenCalledTimes(1)
  })

  it('maps every overlapping non-revoked price version in deterministic order', async () => {
    const query = db([
      [
        {
          versionId: 'price-2',
          kind: 'SPORT',
          disciplinaId: 'discipline-1',
          label: 'Swimming',
          amount: '12.34',
          currency: 'ARS',
          rule: 'DAILY_PRORATED',
          effectiveFrom: '2026-01-15',
          effectiveTo: null,
        },
        {
          versionId: 'price-1',
          kind: 'BASE',
          disciplinaId: null,
          label: 'Membership fee',
          amount: '100.00',
          currency: 'ARS',
          rule: 'FULL_MONTH',
          effectiveFrom: '2026-01-01',
          effectiveTo: '2026-02-15',
        },
      ],
    ])

    await expect(listGenerationPrices(query, period)).resolves.toEqual([
      {
        id: 'price-1',
        kind: 'BASE',
        disciplineId: null,
        label: 'Membership fee',
        amountCents: 10_000,
        currency: 'ARS',
        rule: 'FULL_MONTH',
        from: '2026-01-01',
        to: '2026-02-15',
      },
      {
        id: 'price-2',
        kind: 'SPORT',
        disciplineId: 'discipline-1',
        label: 'Swimming',
        amountCents: 1_234,
        currency: 'ARS',
        rule: 'DAILY_PRORATED',
        from: '2026-01-15',
        to: null,
      },
    ])
    expect((query as { execute: ReturnType<typeof vi.fn> }).execute).toHaveBeenCalledTimes(1)
  })
})
