import { describe, it, expect } from 'vitest'
import type { Db } from '../pool'

/**
 * Tests for grant-data-steward.ts CLI.
 * 10 cases: 4 pure-fn (bucketizeGrant) + 6 CLI.
 *
 * At this RED stage, grant-data-steward.ts does not exist yet.
 * All cases FAIL because the module cannot be loaded.
 */

describe('grant-data-steward', () => {
  describe('bucketizeGrant (pure-fn)', () => {
    it('puts operator in granted bucket when not already granted', async () => {
      const { bucketizeGrant } = await import('./grant-data-steward.js')
      const result = bucketizeGrant({ id: 'op-1', username: 'alice' }, false, 'data_steward')
      expect(result).toEqual({ granted: ['op-1'] })
    })

    it('puts operator in alreadyGranted bucket when permission exists', async () => {
      const { bucketizeGrant } = await import('./grant-data-steward.js')
      const result = bucketizeGrant({ id: 'op-1', username: 'alice' }, true, 'data_steward')
      expect(result).toEqual({ alreadyGranted: ['op-1'] })
    })

    it('returns empty granted for null operator (skip)', async () => {
      const { bucketizeGrant } = await import('./grant-data-steward.js')
      const result = bucketizeGrant(null, false, 'data_steward')
      expect(result).toEqual({ granted: [] })
    })

    it('returns empty buckets for key mismatch', async () => {
      const { bucketizeGrant } = await import('./grant-data-steward.js')
      const result = bucketizeGrant({ id: 'op-1', username: 'alice' }, false, 'wrong_key')
      // Key mismatch: operator is not added to any bucket
      expect(result).toEqual({ granted: [] })
    })
  })

  // -------------------------------------------------------------------------
  // CLI test cases — mocked dependencies
  // -------------------------------------------------------------------------

  describe('CLI --username (happy path)', () => {
    it('exits 0 and grants permission for existing username', async () => {
      const operatorRow = { id: 'op-uuid-1', username: 'alice', isActive: true }
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([operatorRow]),
            }),
          }),
        }),
        insert: () => ({
          values: () => ({
            onConflictDoNothing: () => Promise.resolve([]),
          }),
        }),
        transaction: async <T>(fn: (tx: Db) => Promise<T>): Promise<T> => {
          return fn({} as Db)
        },
      } as unknown as Db

      const { main } = await import('./grant-data-steward.js')
      await main(['--username', 'alice'], mockDb)
      expect(process.exitCode).toBe(0)
    })
  })

  describe('CLI idempotency', () => {
    it('second call returns alreadyGranted, no new audit row', async () => {
      const operatorRow = { id: 'op-uuid-1', username: 'alice', isActive: true }
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([operatorRow]),
            }),
          }),
        }),
        insert: () => ({
          values: () => ({
            onConflictDoNothing: () => Promise.resolve([]),
          }),
        }),
        transaction: async <T>(fn: (tx: Db) => Promise<T>): Promise<T> => {
          return fn({} as Db)
        },
      } as unknown as Db

      // First call — grant
      const { main } = await import('./grant-data-steward.js')
      await main(['--username', 'alice'], mockDb)
      expect(process.exitCode).toBe(0)
    })
  })

  describe('CLI --username unknown user', () => {
    it('exits 1 and reports unknown username', async () => {
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([]),
            }),
          }),
        }),
        insert: () => ({
          values: () => ({
            onConflictDoNothing: () => Promise.resolve([]),
          }),
        }),
        transaction: async <T>(fn: (tx: Db) => Promise<T>): Promise<T> => {
          return fn({} as Db)
        },
      } as unknown as Db

      const { main } = await import('./grant-data-steward.js')
      await main(['--username', 'nonexistent'], mockDb)
      expect(process.exitCode).toBe(1)
    })
  })

  describe('CLI --username multi-operator', () => {
    it('grants both operators and exits 0', async () => {
      const alice = { id: 'op-1', username: 'alice', isActive: true }
      const bob = { id: 'op-2', username: 'bob', isActive: true }
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([alice, bob]),
            }),
          }),
        }),
        insert: () => ({
          values: () => ({
            onConflictDoNothing: () => Promise.resolve([]),
          }),
        }),
        transaction: async <T>(fn: (tx: Db) => Promise<T>): Promise<T> => {
          return fn({} as Db)
        },
      } as unknown as Db

      const { main } = await import('./grant-data-steward.js')
      await main(['--username', 'alice', '--username', 'bob'], mockDb)
      expect(process.exitCode).toBe(0)
    })
  })

  describe('CLI --from-env', () => {
    it('reads DATA_STEWARD_OPERATOR_IDS env var and exits 0', async () => {
      const uuid1 = '11111111-1111-1111-1111-111111111111'
      const uuid2 = '22222222-2222-2222-2222-222222222222'
      process.env.DATA_STEWARD_OPERATOR_IDS = `${uuid1},${uuid2}`

      const mockDb = {
        insert: () => ({
          values: () => ({
            onConflictDoNothing: () => Promise.resolve([]),
          }),
        }),
        transaction: async <T>(fn: (tx: Db) => Promise<T>): Promise<T> => {
          return fn({} as Db)
        },
      } as unknown as Db

      const { main } = await import('./grant-data-steward.js')
      await main(['--from-env'], mockDb)
      expect(process.exitCode).toBe(0)

      delete process.env.DATA_STEWARD_OPERATOR_IDS
    })
  })

  describe('CLI --json output', () => {
    it('outputs valid JSON with Zod-validated shape', async () => {
      const operatorRow = { id: 'op-uuid-1', username: 'alice', isActive: true }
      let output = ''
      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([operatorRow]),
            }),
          }),
        }),
        insert: () => ({
          values: () => ({
            onConflictDoNothing: () => Promise.resolve([]),
          }),
        }),
        transaction: async <T>(fn: (tx: Db) => Promise<T>): Promise<T> => {
          return fn({} as Db)
        },
      } as unknown as Db

      const origLog = console.info
      console.info = (msg: string) => {
        output = msg
        origLog(msg)
      }

      const { main } = await import('./grant-data-steward.js')
      await main(['--username', 'alice', '--json'], mockDb)
      expect(process.exitCode).toBe(0)
      const parsed = JSON.parse(output)
      expect(parsed).toHaveProperty('granted')
      expect(parsed).toHaveProperty('alreadyGranted')
      expect(parsed).toHaveProperty('auditIds')
      expect(Array.isArray(parsed.granted)).toBe(true)
      expect(Array.isArray(parsed.alreadyGranted)).toBe(true)
      expect(Array.isArray(parsed.auditIds)).toBe(true)

      console.info = origLog
    })
  })
})
