import { describe, it, expect } from 'vitest'
import { queryLineage } from './query.ts'

/**
 * TASK-063: queryLineage(entityId) — return 5-field LineageResponse
 *
 * RED phase: test that queryLineage returns the correct shape.
 * We mock the @athlos/db/schema import to avoid needing a real DB,
 * then test the function logic with controlled data.
 */

interface MockRow {
  source_table: string
  source_key: string
}

interface MockEventRow {
  content_hash: string
  imported_at: Date
  import_batch: string
}

// Build a minimal Db-like mock that returns controlled data
function makeMockDb(entityRows: MockRow[], eventRows: MockEventRow[]) {
  let callCount = 0
  return {
    db: {
      async execute(query: { queryChunks?: unknown[] }): Promise<unknown[]> {
        callCount++
        const q = JSON.stringify(query.queryChunks ?? [])
        if (q.includes('entity_uuids')) {
          // Return entity rows based on the entityUuid param
          // (param extraction deferred to reduce unused variable warning)
          void query.queryChunks
          // The param value for entityUuid is in the queryChunks as a string
          return entityRows
        }
        if (q.includes('raw_events')) {
          return eventRows.length > 0 ? [eventRows[0]] : []
        }
        return []
      },
    },
    getCallCount: () => callCount,
  }
}

describe('queryLineage', () => {
  it('returns null for unknown entity UUID', async () => {
    const { db } = makeMockDb([], [])
    const result = await queryLineage(db as never, '00000000-0000-4000-8000-000000000001')
    expect(result).toBeNull()
  })

  it('returns 5-field LineageResponse for known entity', async () => {
    const entityId = '00000000-0000-4000-8000-000000000001'
    const { db } = makeMockDb(
      [{ source_table: 'socios', source_key: 'SOC-001' }],
      [
        {
          content_hash: 'abc123',
          imported_at: new Date('2024-06-11T00:00:00Z'),
          import_batch: 'batch-001',
        },
      ],
    )

    const result = await queryLineage(db as never, entityId)

    expect(result).not.toBeNull()
    expect(result!.entity_id).toBe(entityId)
    expect(result!.source_table).toBe('socios')
    expect(result!.source_key).toBe('SOC-001')
    expect(result!.content_hash).toBe('abc123')
    expect(result!.import_batch).toBe('batch-001')
    expect(result!.audit_event_id).toBeNull()
  })

  it('returns all 7 required fields', async () => {
    const entityId = '00000000-0000-4000-8000-000000000002'
    const { db } = makeMockDb(
      [{ source_table: 'ctacte', source_key: 'CTA-001' }],
      [{ content_hash: 'xyz789', imported_at: new Date(), import_batch: 'batch-002' }],
    )

    const result = await queryLineage(db as never, entityId)

    expect(result).toHaveProperty('entity_id')
    expect(result).toHaveProperty('source_table')
    expect(result).toHaveProperty('source_key')
    expect(result).toHaveProperty('content_hash')
    expect(result).toHaveProperty('imported_at')
    expect(result).toHaveProperty('import_batch')
    expect(result).toHaveProperty('audit_event_id')
  })

  it('audit_event_id is null in 7b.1a (no mutations yet)', async () => {
    const entityId = '00000000-0000-4000-8000-000000000003'
    const { db } = makeMockDb(
      [{ source_table: 'deportes', source_key: 'DEP-001' }],
      [{ content_hash: 'hash3', imported_at: new Date(), import_batch: 'batch-003' }],
    )

    const result = await queryLineage(db as never, entityId)
    expect(result!.audit_event_id).toBeNull()
  })
})
