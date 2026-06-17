import { describe, it, expect, vi, beforeEach } from 'vitest'

// The getFreshness function we're implementing
import { getFreshness } from './api.js'

// Mock standin for Drizzle's db.execute
function makeMockDb(executeResults: unknown[]) {
  return {
    execute: vi.fn().mockImplementation(() => Promise.resolve(executeResults.shift())),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe('freshness.getFreshness', () => {
  /**
   * RED STEP: Write failing tests first.
   *
   * The tests exercise getFreshness({ domain? }) which:
   * 1. Reads domain_freshness cache table
   * 2. Applies ageToStatus to compute status per row
   * 3. Applies ageDisplay to compute human-readable age
   */

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('single domain filter', () => {
    it('returns only the requested domain', async () => {
      const now = new Date()
      const lastImport = new Date(now.getTime() - 30 * 60 * 1000) // 30 min ago

      const db = makeMockDb([
        {
          rows: [
            {
              domain: 'ctacte',
              last_import_at: lastImport,
              record_count: 50000,
              refreshed_at: now,
            },
          ],
          rowCount: 1,
        },
      ])

      const results = await getFreshness(db, { domain: 'ctacte' })

      expect(results).toHaveLength(1)
      expect(results[0]!.domain).toBe('ctacte')
      expect(results[0]!.recordCount).toBe(50000)
      expect(results[0]!.status).toBe('current') // 30min < 1h threshold
      expect(results[0]!.ageDisplay).toMatch(/^hace/)
    })
  })

  describe('all domains (no filter)', () => {
    it('returns all 11 domains', async () => {
      const db = makeMockDb([
        {
          rows: [
            { domain: 'socios', last_import_at: null, record_count: 0, refreshed_at: new Date() },
            {
              domain: 'ctacte',
              last_import_at: new Date(),
              record_count: 50000,
              refreshed_at: new Date(),
            },
            {
              domain: 'ctacte1',
              last_import_at: new Date(),
              record_count: 12000,
              refreshed_at: new Date(),
            },
            {
              domain: 'contable',
              last_import_at: new Date(),
              record_count: 8000,
              refreshed_at: new Date(),
            },
            {
              domain: 'contabl1',
              last_import_at: new Date(),
              record_count: 3000,
              refreshed_at: new Date(),
            },
            {
              domain: 'catastros',
              last_import_at: new Date(),
              record_count: 2000,
              refreshed_at: new Date(),
            },
            {
              domain: 'escuela',
              last_import_at: new Date(),
              record_count: 1500,
              refreshed_at: new Date(),
            },
            {
              domain: 'deportes',
              last_import_at: new Date(),
              record_count: 3000,
              refreshed_at: new Date(),
            },
            {
              domain: 'locacion',
              last_import_at: new Date(),
              record_count: 200,
              refreshed_at: new Date(),
            },
            {
              domain: 'caja',
              last_import_at: new Date(),
              record_count: 500,
              refreshed_at: new Date(),
            },
            {
              domain: 'gastos',
              last_import_at: new Date(),
              record_count: 1000,
              refreshed_at: new Date(),
            },
          ],
          rowCount: 11,
        },
      ])

      const results = await getFreshness(db, {})

      expect(results).toHaveLength(11)
    })

    it('null last_import_at produces status unknown', async () => {
      const db = makeMockDb([
        {
          rows: [
            { domain: 'socios', last_import_at: null, record_count: 0, refreshed_at: new Date() },
          ],
          rowCount: 1,
        },
      ])

      const results = await getFreshness(db, {})

      expect(results[0]!.status).toBe('unknown')
      expect(results[0]!.ageDisplay).toBe('nunca')
    })

    it('stale domain (old import) produces status stale', async () => {
      const oldImport = new Date(Date.now() - 48 * 60 * 60 * 1000) // 48 hours ago
      const db = makeMockDb([
        {
          rows: [
            {
              domain: 'socios',
              last_import_at: oldImport,
              record_count: 1000,
              refreshed_at: new Date(),
            },
          ],
          rowCount: 1,
        },
      ])

      const results = await getFreshness(db, {})

      expect(results[0]!.status).toBe('stale') // 48h > 1.5 * 1h threshold
    })
  })

  describe('domain field', () => {
    it('echoes back the domain argument when filtering', async () => {
      const db = makeMockDb([
        {
          rows: [
            {
              domain: 'socios',
              last_import_at: new Date(),
              record_count: 100,
              refreshed_at: new Date(),
            },
          ],
          rowCount: 1,
        },
      ])

      const results = await getFreshness(db, { domain: 'socios' })

      expect(results[0]!.domain).toBe('socios')
    })
  })

  describe('unknown domain filter (no rows)', () => {
    it('returns empty array for unknown domain', async () => {
      const db = makeMockDb([
        {
          rows: [],
          rowCount: 0,
        },
      ])

      const results = await getFreshness(db, { domain: 'unknown_domain' })

      expect(results).toHaveLength(0)
    })
  })
})
