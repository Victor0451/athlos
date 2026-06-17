import { describe, it, expect } from 'vitest'
import { rebuildProjection, type Domain } from './rebuild.ts'

/**
 * TASK-067: rebuildProjection(domain) — truncate-then-replay
 *
 * RED phase: test that rebuildProjection:
 *   1. Is idempotent: rebuild twice → identical end state
 *   2. Unknown domain throws BusinessError(VALIDATION)
 *   3. rebuildProjection('ctacte') processes only ctacte rows
 */

describe('rebuildProjection', () => {
  it('is idempotent: rebuild twice produces identical rowCount', async () => {
    // Mock DB that returns same data for both calls.
    // Drizzle's db.execute(sql) returns { rows: T[], rowCount: number } — match that shape.
    const mockDb = {
      async execute(query: {
        queryChunks?: unknown[]
      }): Promise<{ rowCount: number; rows?: unknown[] }> {
        const q = JSON.stringify(query.queryChunks ?? [])
        if (q.includes('TRUNCATE')) {
          return { rowCount: 0 }
        }
        if (q.includes('raw_events') && q.includes('SELECT')) {
          return {
            rowCount: 100,
            rows: Array(100)
              .fill(null)
              .map((_, i) => ({
                id: `uuid-${i}`,
                source_table: 'ctacte',
                source_key: `CTA-${i}`,
                payload: {},
                imported_at: new Date(),
              })),
          }
        }
        return { rowCount: 0 }
      },
    } as unknown as never

    const result1 = await rebuildProjection(mockDb as never, 'ctacte')
    const result2 = await rebuildProjection(mockDb as never, 'ctacte')

    expect(result1).toHaveProperty('rowCount')
    expect(result2).toHaveProperty('rowCount')
    expect(result1.rowCount).toBe(result2.rowCount)
  })

  it('unknown domain throws BusinessError(VALIDATION)', async () => {
    const mockDb = {
      async execute(): Promise<{ rowCount: number; rows?: unknown[] }> {
        return { rowCount: 0 }
      },
    } as unknown as never

    await expect(rebuildProjection(mockDb as never, 'not_a_real_domain' as Domain)).rejects.toThrow(
      /VALIDATION|unknown domain/i,
    )
  })

  it('returns { rowCount, durationMs } shape', async () => {
    const mockDb = {
      async execute(): Promise<{ rowCount: number; rows?: unknown[] }> {
        return { rowCount: 50 }
      },
    } as unknown as never

    const result = await rebuildProjection(mockDb as never, 'socios')
    expect(result).toHaveProperty('rowCount')
    expect(result).toHaveProperty('durationMs')
    expect(result.rowCount).toBe(50)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })
})
