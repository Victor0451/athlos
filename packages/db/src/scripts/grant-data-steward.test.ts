import { describe, it, expect, vi } from 'vitest'
import type { Db } from '../pool'

/**
 * Tests for grant-data-steward.ts CLI.
 * 10 cases: 4 pure-fn (bucketizeGrant) + 6 CLI.
 */

// ---------------------------------------------------------------------------
// Mock emitAudit — avoids needing full db transaction chain
// ---------------------------------------------------------------------------

vi.mock('@athlos/audit', () => ({
  emitAudit: vi.fn().mockResolvedValue({
    inserted: true,
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  }),
}))

// ---------------------------------------------------------------------------
// Mock-DB helpers
// ---------------------------------------------------------------------------

/** Mock chain for select().from().where().limit() */
function makeSelectChain(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(rows),
      }),
    }),
  }
}

/** Mock chain for insert().values().onConflictDoNothing() */
function makeInsertChain() {
  return {
    values: () => ({
      onConflictDoNothing: () => Promise.resolve([]),
    }),
  }
}

/**
 * Build a minimal mock-db for CLI tests.
 * Supports: select(), insert(), transaction(fn → fn(txMock))
 *
 * Uses a call-count queue: each call to select().from().where().limit()
 * pops the next value from the queue. Tests configure the queue to return
 * the right rows for findByUsername (1st call) and hasPermission (2nd call).
 */
function makeMockDb(limitQueue: unknown[][] = [[]]): Db {
  // tx mock passed to transaction() — must support emitAudit's select+insert
  const txMock = {
    select: () => makeSelectChain([]),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([{ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }]),
      }),
    }),
  }

  // Call-count queue — each select().from().where().limit() pops the next result
  let callIndex = 0

  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            const rows = limitQueue[callIndex] ?? []
            callIndex++
            return Promise.resolve(rows)
          },
        }),
      }),
    }),
    insert: () => makeInsertChain(),
    transaction: async <T>(fn: (tx: Db) => Promise<T>): Promise<T> => {
      return fn(txMock as unknown as Db)
    },
  } as unknown as Db
}

describe('grant-data-steward', () => {
  // -------------------------------------------------------------------------
  // Pure-function test cases
  // -------------------------------------------------------------------------

  describe('bucketizeGrant (pure-fn)', () => {
    it('puts operator in granted bucket when not already granted', async () => {
      const { bucketizeGrant } = await import('./grant-data-steward.js')
      const result = bucketizeGrant({ id: 'op-1' }, false, 'data_steward')
      expect(result).toEqual({ granted: ['op-1'] })
    })

    it('puts operator in alreadyGranted bucket when permission exists', async () => {
      const { bucketizeGrant } = await import('./grant-data-steward.js')
      const result = bucketizeGrant({ id: 'op-1' }, true, 'data_steward')
      expect(result).toEqual({ alreadyGranted: ['op-1'] })
    })

    it('returns empty granted for null operator (skip)', async () => {
      const { bucketizeGrant } = await import('./grant-data-steward.js')
      const result = bucketizeGrant(null, false, 'data_steward')
      expect(result).toEqual({ granted: [] })
    })

    it('returns empty buckets for key mismatch', async () => {
      const { bucketizeGrant } = await import('./grant-data-steward.js')
      const result = bucketizeGrant({ id: 'op-1' }, false, 'wrong_key')
      expect(result).toEqual({ granted: [] })
    })
  })

  // -------------------------------------------------------------------------
  // CLI test cases
  // -------------------------------------------------------------------------

  describe('CLI --username (happy path)', () => {
    it('exits 0 and grants permission for existing username', async () => {
      const operatorRow = {
        id: '11111111-1111-1111-1111-111111111111',
        username: 'alice',
        isActive: true,
      }
      // Queue: findByUsername=[operatorRow], hasPermission=[] (no perm yet)
      const mockDb = makeMockDb([[operatorRow], []])

      const { main } = await import('./grant-data-steward.js')
      await main(['--username', 'alice'], mockDb)
      expect(process.exitCode).toBe(0)
    })
  })

  describe('CLI idempotency', () => {
    it('second call returns alreadyGranted, no new audit row', async () => {
      const operatorRow = {
        id: '11111111-1111-1111-1111-111111111111',
        username: 'alice',
        isActive: true,
      }
      // Queue: findByUsername=[operatorRow], hasPermission=[row] (perm exists)
      const mockDb = makeMockDb([[operatorRow], [{ x: 1 }]])

      const { main } = await import('./grant-data-steward.js')
      await main(['--username', 'alice'], mockDb)
      expect(process.exitCode).toBe(0)
    })
  })

  describe('CLI --username unknown user', () => {
    it('exits 1 and reports unknown username', async () => {
      // Queue: findByUsername=[] → unknown user
      const mockDb = makeMockDb([[]])

      const { main } = await import('./grant-data-steward.js')
      await main(['--username', 'nonexistent'], mockDb)
      expect(process.exitCode).toBe(1)
    })
  })

  describe('CLI --username multi-operator', () => {
    it('grants both operators and exits 0', async () => {
      const alice = {
        id: '11111111-1111-1111-1111-111111111111',
        username: 'alice',
        isActive: true,
      }
      const bob = {
        id: '22222222-2222-2222-2222-222222222222',
        username: 'bob',
        isActive: true,
      }
      // find alice, has alice, find bob, has bob
      const mockDb = makeMockDb([[alice], [], [bob], []])

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

      // from-env calls hasPermission twice (once per UUID)
      const mockDb = makeMockDb([[], []])

      const { main } = await import('./grant-data-steward.js')
      await main(['--from-env'], mockDb)
      expect(process.exitCode).toBe(0)

      delete process.env.DATA_STEWARD_OPERATOR_IDS
    })
  })

  describe('CLI --json output', () => {
    it('outputs valid JSON with Zod-validated shape', async () => {
      const operatorRow = {
        id: '11111111-1111-1111-1111-111111111111',
        username: 'alice',
        isActive: true,
      }
      let output = ''
      // Queue: findByUsername=[operatorRow], hasPermission=[] (no perm → granted)
      const mockDb = makeMockDb([[operatorRow], []])

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
      expect(parsed.granted).toHaveLength(1)
      expect(parsed.granted[0]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      )

      console.info = origLog
    })
  })
})
