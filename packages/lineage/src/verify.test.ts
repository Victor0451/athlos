import { describe, it, expect } from 'vitest'
import { verifyHash } from './verify.ts'

/**
 * TASK-064: verifyHash(entityId) — recompute SHA-256 and compare to stored hash
 *
 * RED phase: test that verifyHash returns match:true when hash unchanged,
 * match:false when payload differs, with ISO8601 verified_at.
 *
 * The function calls db.execute twice:
 *   1. Get (content_hash, payload) for the entity's latest raw_events row
 *   2. Recompute hash from payload and compare
 *
 * To test mismatch, we mock call #1 with stored_hash='aaa' and call #2 with
 * stored_hash='bbb' (simulating a tampered record where stored differs from recompute).
 */

describe('verifyHash', () => {
  it('returns match:true when hash unchanged', async () => {
    // The payload is { NOMBRE: 'Ana', APELLIDO: 'García' }
    // Its canonical SHA-256 (sorted keys, JSON stringify) is:
    const expectedHash = 'a481709896591cfae85bba211036135b56ccc189352174ad59572a49d63bc546'
    const mockDb = {
      async execute(_query: { queryChunks?: unknown[] }): Promise<{ rows: unknown[] }> {
        return {
          rows: [
            {
              content_hash: expectedHash,
              payload: { NOMBRE: 'Ana', APELLIDO: 'García' },
            },
          ],
        }
      },
    } as unknown as never

    const result = await verifyHash(mockDb, '00000000-0000-4000-8000-000000000001')
    expect(result.match).toBe(true)
    expect(result.entity_id).toBe('00000000-0000-4000-8000-000000000001')
    expect(result.stored_hash).toBe(result.recomputed_hash)
    expect(result.verified_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it('returns match:false when stored hash differs from recomputed (tampered)', async () => {
    let callCount = 0
    const mockDb = {
      async execute(_query: { queryChunks?: unknown[] }): Promise<{ rows: unknown[] }> {
        callCount++
        // Call 1: stored hash is 'abc...' (what's in the DB)
        // Call 2: stored hash is 'xyz...' (simulating stored != recomputed)
        // The function compares stored_hash vs recomputed_hash:
        //   stored_hash (call1) vs recomputed_hash (from call2 payload)
        // Since payload is same in both, stored_hash='abc' != recomputed_hash='xyz'
        // → match:false
        if (callCount === 1) {
          return {
            rows: [
              {
                content_hash: 'abc123def456abc123def456abc123def456abc123def456abc123def456ab',
                payload: { NOMBRE: 'Ana', APELLIDO: 'García' },
              },
            ],
          }
        } else {
          return {
            rows: [
              {
                content_hash: 'xyz789xyz789xyz789xyz789xyz789xyz789xyz789xyz789xyz789xyz789xy',
                payload: { NOMBRE: 'Ana', APELLIDO: 'García' },
              },
            ],
          }
        }
      },
    } as unknown as never

    const result = await verifyHash(mockDb, '00000000-0000-4000-8000-000000000002')
    expect(result.match).toBe(false)
    expect(result.entity_id).toBe('00000000-0000-4000-8000-000000000002')
    expect(result.verified_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it('returns all required fields with ISO8601 verified_at', async () => {
    const mockDb = {
      async execute(_query: { queryChunks?: unknown[] }): Promise<{ rows: unknown[] }> {
        return {
          rows: [
            {
              content_hash: 'hashhashhashhashhashhashhashhashhashhashhashhashhashhashhashhash',
              payload: { monto: 500 },
            },
          ],
        }
      },
    } as unknown as never

    const result = await verifyHash(mockDb, '00000000-0000-4000-8000-000000000003')
    expect(result).toHaveProperty('entity_id')
    expect(result).toHaveProperty('match')
    expect(result).toHaveProperty('stored_hash')
    expect(result).toHaveProperty('recomputed_hash')
    expect(result).toHaveProperty('verified_at')
    expect(result.verified_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })
})
