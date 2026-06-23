import { describe, it, expect, vi } from 'vitest'

// The detect function we're implementing
import { detect } from './detect.ts'

// Minimal mock DB that satisfies the Db interface
function makeMockDb(executeResults: { rows: unknown[]; rowCount: number }[]) {
  const mock = {
    execute: vi.fn().mockImplementation(() => Promise.resolve(executeResults.shift()!)),
  }
  return mock as any // eslint-disable-line @typescript-eslint/no-explicit-any
}

describe('drift.detect', () => {
  /**
   * RED STEP: Write failing tests first.
   *
   * The tests exercise detect({ domain }) which:
   * 1. Runs a DISTINCT ON query joining raw_events + entity_uuids + drift_snapshots
   * 2. Returns a DriftReport with scanned count, driftCount, and drifts array
   */

  describe('when no drift exists (hashes match)', () => {
    it('returns drift_count 0 and empty drifts array', async () => {
      // Mock: no rows returned (hashes match)
      const db = makeMockDb([{ rows: [], rowCount: 0 }])

      const report = await detect(db, { domain: 'ctacte' })

      expect(report.driftCount).toBe(0)
      expect(report.drifts).toHaveLength(0)
      expect(report.domain).toBe('ctacte')
    })
  })

  describe('when hash differs (drift detected)', () => {
    it('returns drift entry with entityUuid, oldHash, newHash', async () => {
      const uuid1 = '11111111-1111-1111-1111-111111111111'
      const uuid2 = '22222222-2222-2222-2222-222222222222'
      const importedAt = new Date('2024-06-11T14:30:00Z')

      const db = makeMockDb([
        {
          rows: [
            {
              entity_uuid: uuid1,
              source_table: 'ctacte',
              new_hash: 'newhash123',
              imported_at: importedAt,
              old_hash: 'oldhash456',
            },
            {
              entity_uuid: uuid2,
              source_table: 'ctacte',
              new_hash: 'newxyz789',
              imported_at: importedAt,
              old_hash: 'oldabc000',
            },
          ],
          rowCount: 2,
        },
      ])

      const report = await detect(db, { domain: 'ctacte' })

      expect(report.driftCount).toBe(2)
      expect(report.drifts).toHaveLength(2)

      // First drift entry
      expect(report.drifts[0]!).toMatchObject({
        entityUuid: uuid1,
        oldHash: 'oldhash456',
        newHash: 'newhash123',
      })
      expect(report.drifts[0]!.lastImportedAt).toBeInstanceOf(Date)

      // Second drift entry
      expect(report.drifts[1]!).toMatchObject({
        entityUuid: uuid2,
        oldHash: 'oldabc000',
        newHash: 'newxyz789',
      })
    })
  })

  describe('scanned count', () => {
    it('reports the total number of entities scanned', async () => {
      const db = makeMockDb([{ rows: [], rowCount: 0 }])

      const report = await detect(db, { domain: 'ctacte' })

      expect(report.scanned).toBe(0)
    })
  })

  describe('domain field', () => {
    it('echoes back the domain argument', async () => {
      const db = makeMockDb([{ rows: [], rowCount: 0 }])

      const report = await detect(db, { domain: 'socios' })

      expect(report.domain).toBe('socios')
    })
  })

  describe('with no domain argument (all domains)', () => {
    it('scans all domains without filtering', async () => {
      const db = makeMockDb([{ rows: [], rowCount: 0 }])

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const report = await detect(db as any, {})

      expect(report.domain).toBeNull()
      expect(report.scanned).toBe(0)
      expect(report.driftCount).toBe(0)
    })
  })
})
