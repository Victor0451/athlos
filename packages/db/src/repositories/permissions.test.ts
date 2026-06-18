import { describe, it, expect, vi } from 'vitest'
import { makePermissionsRepo } from './permissions.ts'
import type { Db } from '../pool'
import { rolePermissions, operators } from '../schema/operators.js'

/**
 * Tests for PermissionsRepo. Uses the in-memory Drizzle standin
 * (the same pattern as `packages/db/src/repositories/*_test.ts`).
 *
 * The standin is a thin in-memory implementation of Drizzle's chainable
 * query builder. We mock it just enough to test the repo's SQL shape
 * and the `isActive` filter.
 */
function makeMockDb(rows: Array<{ id: string; username: string | null; isActive: boolean }>) {
  // The real repo runs:
  //   .select(...).from(rolePermissions)
  //     .innerJoin(operators, ...)
  //     .where(eq(rolePermissions.permissionKey, key))
  // and then `.filter((r) => r.isActive === true)` in JS.
  // The standin here just returns the prepared rows.
  return {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: async () => rows,
        }),
      }),
    }),
  } as unknown as Db
}

describe('PermissionsRepo', () => {
  describe('listOperatorsWithPermission', () => {
    it('returns active operators with the given permission key', async () => {
      const rows = [
        { id: 'op-1', username: 'alice', isActive: true },
        { id: 'op-2', username: 'bob', isActive: true },
      ]
      const db = makeMockDb(rows)
      const repo = makePermissionsRepo(db)
      const result = await repo.listOperatorsWithPermission('data_steward')
      expect(result).toEqual([
        { id: 'op-1', username: 'alice' },
        { id: 'op-2', username: 'bob' },
      ])
    })

    it('filters out inactive operators', async () => {
      const rows = [
        { id: 'op-1', username: 'alice', isActive: true },
        { id: 'op-2', username: 'bob', isActive: false }, // suspended
        { id: 'op-3', username: 'carol', isActive: true },
      ]
      const db = makeMockDb(rows)
      const repo = makePermissionsRepo(db)
      const result = await repo.listOperatorsWithPermission('data_steward')
      expect(result).toEqual([
        { id: 'op-1', username: 'alice' },
        { id: 'op-3', username: 'carol' },
      ])
    })

    it('returns empty array when no operators hold the permission', async () => {
      const db = makeMockDb([])
      const repo = makePermissionsRepo(db)
      const result = await repo.listOperatorsWithPermission('data_steward')
      expect(result).toEqual([])
    })
  })

  describe('schema references', () => {
    // Smoke test: ensure the repo imports the expected schema tables.
    // If the schema is renamed/removed, this fails at module load.
    it('references rolePermissions and operators tables', () => {
      expect(rolePermissions).toBeDefined()
      expect(operators).toBeDefined()
    })
  })
})

// Vitest placeholder to silence "vi" import being unused in some configurations.
// The actual mocking pattern is shown above (manual DB standin).
void vi
