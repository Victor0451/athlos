import { describe, expect, it } from 'vitest'
import { projectLegacyMembershipCandidates, type SqlClient } from './legacy-membership-evidence'

function client(failInsert = false): SqlClient & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async query(text) {
      calls.push(text)
      if (text.startsWith('SELECT')) return { rowCount: 1 }
      if (failInsert && text.startsWith('INSERT')) throw new Error('insert failed')
      return {}
    },
  }
}

describe('projectLegacyMembershipCandidates', () => {
  it('rebuilds candidates from greatest source ordinals and is repeatable', async () => {
    const db = client()
    await projectLegacyMembershipCandidates(db, '00000000-0000-4000-8000-000000000001')
    await projectLegacyMembershipCandidates(db, '00000000-0000-4000-8000-000000000001')

    expect(db.calls.filter((call) => call.startsWith('DELETE'))).toHaveLength(2)
    expect(
      db.calls.filter((call) => call.includes('PARTITION BY code ORDER BY record_ordinal DESC')),
    ).toHaveLength(2)
    expect(db.calls.filter((call) => call === 'COMMIT')).toHaveLength(2)
  })

  it('rolls back the snapshot rebuild when candidate insertion fails', async () => {
    const db = client(true)
    await expect(
      projectLegacyMembershipCandidates(db, '00000000-0000-4000-8000-000000000002'),
    ).rejects.toThrow('insert failed')
    expect(db.calls.at(-1)).toBe('ROLLBACK')
  })
})
