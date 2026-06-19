import { describe, it, expect } from 'vitest'
import type { Db } from '../pool'
import { operators } from '../schema/operators.js'

/**
 * Tests for OperatorsRepo.findByUsername.
 * Uses the in-memory Drizzle standin pattern from permissions.test.ts:14-30.
 *
 * At this RED stage, OperatorsRepo.findByUsername does not exist yet.
 * These tests fail because the import will throw a module-not-found error
 * or the repo will not have the findByUsername method.
 */

// Mock-DB standin matching permissions.test.ts:14-30 pattern
// Extended to support .limit(1) used by findByUsername
function makeMockDb(rows: Array<{ id: string; username: string | null; isActive: boolean }>) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(rows),
        }),
      }),
    }),
  } as unknown as Db
}

describe('OperatorsRepo', () => {
  describe('findByUsername', () => {
    it('returns the Operator row for an existing username', async () => {
      const operatorRow = { id: 'op-uuid-1', username: 'alice', isActive: true }
      const db = makeMockDb([operatorRow])
      // This import will fail until operators.ts is created (RED phase)
      const { makeOperatorsRepo } = await import('./operators.js')
      const repo = makeOperatorsRepo(db)
      const result = await repo.findByUsername('alice')
      expect(result).toEqual({ id: 'op-uuid-1', username: 'alice', isActive: true })
    })

    it('returns null for a missing username', async () => {
      const db = makeMockDb([])
      const { makeOperatorsRepo } = await import('./operators.js')
      const repo = makeOperatorsRepo(db)
      const result = await repo.findByUsername('nonexistent')
      expect(result).toBeNull()
    })

    it('returns null for an empty string username', async () => {
      const db = makeMockDb([])
      const { makeOperatorsRepo } = await import('./operators.js')
      const repo = makeOperatorsRepo(db)
      const result = await repo.findByUsername('')
      expect(result).toBeNull()
    })
  })

  describe('schema references', () => {
    it('references operators table from schema', () => {
      expect(operators).toBeDefined()
    })
  })
})
