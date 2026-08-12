import { describe, expect, it } from 'vitest'
import { buildClubStatus, resolvePeriod } from './service.ts'

const repo = {
  activeMembership: async () => 7,
  finance: async () => ({ debits: '12.50', credits: '3.25', net: '9.25' }),
}
const freshness = [
  {
    domain: 'ctacte',
    lastImportAt: '2026-03-10T12:00:00.000Z',
    recordCount: 1,
    ageDisplay: 'now',
    status: 'current' as const,
  },
]

describe('club status service', () => {
  it('uses Buenos Aires calendar boundaries, including DST-safe day windows', () => {
    expect(resolvePeriod('current-month', new Date('2026-03-01T02:30:00.000Z'))).toEqual({
      period: 'current-month',
      from: '2026-02-01',
      until: '2026-03-01',
    })
    expect(resolvePeriod('last-60-days', new Date('2024-03-10T15:00:00.000Z'))).toMatchObject({
      from: '2024-01-11',
      until: '2024-03-11',
    })
  })

  it('projects non-annulled debe minus haber aggregates only to finance roles', async () => {
    const admin = await buildClubStatus({
      role: 'ADMIN',
      period: 'last-90-days',
      now: new Date('2026-03-10T15:00:00Z'),
      repo,
      freshness,
    })
    const operator = await buildClubStatus({
      role: 'OPERADOR',
      now: new Date('2026-03-10T15:00:00Z'),
      repo,
      freshness,
    })
    expect(admin).toMatchObject({
      period: 'last-90-days',
      membership: { active: 7 },
      finance: { debits: '12.50', credits: '3.25', net: '9.25' },
    })
    expect(operator).not.toHaveProperty('finance')
    expect(operator).toMatchObject({ unavailable: ['regularization.workload'] })
  })

  it('keeps current membership and freshness stable across periods and omits unbacked metrics', async () => {
    const current = await buildClubStatus({
      role: 'TESORERO',
      now: new Date('2026-03-10T15:00:00Z'),
      repo,
      freshness,
    })
    const historical = await buildClubStatus({
      role: 'TESORERO',
      period: 'last-60-days',
      now: new Date('2026-03-10T15:00:00Z'),
      repo,
      freshness,
    })
    expect(historical.membership).toEqual(current.membership)
    expect(historical.freshness).toEqual(current.freshness)
    expect(historical).toHaveProperty('finance')
    expect(historical.unavailable).toContain('delinquency.count')
    expect(historical).not.toHaveProperty('debt')
  })
})
