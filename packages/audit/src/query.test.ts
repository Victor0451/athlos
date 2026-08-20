import { describe, expect, it } from 'vitest'
import { queryAudit } from './query.ts'

function chain(result: unknown[]) {
  const promise = Promise.resolve(result)
  const query = new Proxy(
    {},
    {
      get: (_, key) => (key === 'then' ? promise.then.bind(promise) : () => query),
    },
  )
  return query
}

function fakeDb(rows: Array<Record<string, unknown>>) {
  return {
    select(selection?: Record<string, unknown>) {
      if (selection && 'total' in selection) return chain([{ total: rows.length }])
      const result =
        selection && 'metadata' in selection
          ? rows
          : rows.map(({ metadata: _metadata, ...row }) => row)
      return chain(result)
    },
  }
}

describe('queryAudit', () => {
  it('returns persisted audit metadata for authorized callers', async () => {
    const metadata = {
      actorId: 'operator-1',
      authorizationEvidence: { role: 'ADMIN', permissions: ['dues:write'] },
      callerKey: 'monthly-2026-01',
      requestFingerprint: 'a'.repeat(64),
    }
    const result = await queryAudit(fakeDb([{ id: 'audit-1', metadata }]) as never, {})

    expect(result.items[0]?.metadata).toEqual(metadata)
  })

  it('returns null persisted metadata without inventing evidence', async () => {
    const result = await queryAudit(fakeDb([{ id: 'audit-2', metadata: null }]) as never, {})

    expect(result.items[0]?.metadata).toBeNull()
  })
})
