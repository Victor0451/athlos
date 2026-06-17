import { describe, it, expect } from 'vitest'
import { getOrCreateEntityUuid } from './pipeline.ts'

/**
 * TASK-065: UUID lookup-or-create in insertRawEvent
 *
 * RED phase: test that getOrCreateEntityUuid:
 *   1. Creates a new UUID on first call for a (source_table, source_key)
 *   2. Reuses the same UUID on re-import (lookup returns existing)
 *   3. Handles concurrent inserts via ON CONFLICT DO NOTHING + re-read
 *
 * The test mocks the DB at the module level to avoid standin complexity.
 * The concurrent insert race condition is tested via the re-read path.
 */

describe('getOrCreateEntityUuid', () => {
  it('first call generates a new UUID', async () => {
    const mockDb = {
      select() {
        return {
          from() {
            return {
              where() {
                return { limit: () => Promise.resolve([]) }
              },
            }
          },
        }
      },
      insert() {
        return {
          values() {
            return {
              onConflictDoNothing() {
                return { returning: () => Promise.resolve([]) }
              },
            }
          },
        }
      },
    } as unknown as never

    const result = await getOrCreateEntityUuid(mockDb, 'socios', 'SOC-001')
    // Should be a valid UUID v4
    expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('re-import reuses the existing UUID (lookup succeeds)', async () => {
    const existingUuid = '00000000-0000-4000-8000-000000000001'
    const mockDb = {
      select() {
        return {
          from() {
            return {
              where() {
                return { limit: () => Promise.resolve([{ entityUuid: existingUuid }]) }
              },
            }
          },
        }
      },
      insert() {
        return {
          values() {
            return {
              onConflictDoNothing() {
                return { returning: () => Promise.resolve([]) }
              },
            }
          },
        }
      },
    } as unknown as never

    const result = await getOrCreateEntityUuid(mockDb, 'socios', 'SOC-001')
    expect(result).toBe(existingUuid)
    // insert should NOT be called when lookup finds existing
  })

  it('concurrent insert: ON CONFLICT DO NOTHING + re-read returns winner UUID', async () => {
    const winnerUuid = '00000000-0000-4000-8000-000000000002'
    let lookupCount = 0

    const mockDb = {
      select() {
        return {
          from() {
            return {
              where() {
                lookupCount++
                return {
                  limit: () => {
                    // Call 1: initial lookup → not found
                    // Call 2: re-read after conflict → found winner
                    return Promise.resolve(lookupCount === 1 ? [] : [{ entityUuid: winnerUuid }])
                  },
                }
              },
            }
          },
        }
      },
      insert() {
        return {
          values() {
            return {
              onConflictDoNothing() {
                return { returning: () => Promise.resolve([]) }
              },
            }
          },
        }
      },
    } as unknown as never

    const result = await getOrCreateEntityUuid(mockDb, 'ctacte', 'CTA-001')
    // After insert conflict, re-read finds the winner's UUID
    expect(result).toBe(winnerUuid)
  })

  it('different (source_table, source_key) pairs get different UUIDs', async () => {
    const mockDb = {
      select() {
        return {
          from() {
            return {
              where() {
                return { limit: () => Promise.resolve([]) }
              },
            }
          },
        }
      },
      insert() {
        return {
          values() {
            return {
              onConflictDoNothing() {
                return { returning: () => Promise.resolve([]) }
              },
            }
          },
        }
      },
    } as unknown as never

    const uuid1 = await getOrCreateEntityUuid(mockDb, 'socios', 'SOC-001')
    const uuid2 = await getOrCreateEntityUuid(mockDb, 'socios', 'SOC-002')
    expect(uuid1).not.toBe(uuid2)
  })
})
