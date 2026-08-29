import { describe, expect, it, vi } from 'vitest'
import { listAssessmentFacts } from './repository.ts'

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
