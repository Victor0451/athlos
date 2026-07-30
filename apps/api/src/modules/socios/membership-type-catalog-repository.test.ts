import { describe, expect, it } from 'vitest'
import {
  listAssociatedMembers,
  listMembershipTypeCatalog,
} from './membership-type-catalog-repository.ts'

function db(results: unknown[][]) {
  let call = 0
  return { execute: async () => ({ rows: results[call++] ?? [] }) }
}

describe('membership type catalog repository', () => {
  it('reports a missing receipt instead of falling back to an older catalog', async () => {
    await expect(
      listMembershipTypeCatalog(db([[{ state: 'no_current_catalog' }]]) as never, {
        page: 0,
        limit: 500,
      }),
    ).resolves.toMatchObject({
      state: 'no_current_catalog',
      items: [],
      total: 0,
      page: 1,
      limit: 100,
    })
  })

  it('returns the current catalog page and source plus distinct counts', async () => {
    const result = await listMembershipTypeCatalog(
      db([
        [{ state: 'ready' }],
        [
          {
            sourceRowId: 'type-1',
            code: 'A',
            name: 'Activo',
            letter: 'A',
            validatedCount: 2,
            resolvedCount: 1,
            distinctMemberCount: 2,
            total: 1,
          },
        ],
      ]) as never,
      { page: 1, limit: 10, search: 'act' },
    )
    expect(result).toMatchObject({
      state: 'ready',
      total: 1,
      items: [{ sourceRowId: 'type-1', distinctMemberCount: 2 }],
    })
  })

  it('does not query historical type members and exposes the truthful state', async () => {
    const query = db([[{ state: 'source_row_not_current' }]])
    await expect(
      listAssociatedMembers(query as never, 'old-type', { page: 1, limit: 10 }),
    ).resolves.toMatchObject({ state: 'source_row_not_current', items: [], total: 0 })
  })

  it('returns only safe member fields and collapsed association sources', async () => {
    const result = await listAssociatedMembers(
      db([
        [{ state: 'ready' }],
        [
          {
            memberId: 'member-1',
            memberNumber: 12,
            credentialRef: 'credential-12',
            lifecycleState: 'validated',
            associationSources: ['resolved', 'validated'],
            total: 1,
          },
        ],
      ]) as never,
      'type-1',
      { page: 1, limit: 10 },
    )
    expect(result.items[0]).toEqual({
      memberId: 'member-1',
      memberNumber: 12,
      credentialRef: 'credential-12',
      lifecycleState: 'validated',
      associationSources: ['resolved', 'validated'],
      total: 1,
    })
  })
})
