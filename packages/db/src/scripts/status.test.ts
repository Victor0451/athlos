/**
 * RED-phase tests for migrate:status.
 *
 * These tests FAIL because status.ts does not exist yet.
 * They cover the cases defined in design.md §4.1:
 * - empty applied list → all pending
 * - partial applied list → some pending
 * - full applied list → empty pending/divergence
 * - drift: DB row missing from filesystem → divergence
 * - pending: filesystem entry not in DB → pending
 * - --json Zod shape validation
 * - connection error → exit 2
 */
import { describe, expect, it } from 'vitest'
import { diffMigrations } from './status'
import { statusSchema } from './status'

describe('diffMigrations', () => {
  describe('empty applied list', () => {
    it('should mark all local migrations as pending', () => {
      const applied: string[] = []
      const local = ['0001_funny_eternals', '0002_stale_tyrannus']
      const result = diffMigrations(applied, local)
      expect(result.pending).toEqual(['0001_funny_eternals', '0002_stale_tyrannus'])
      expect(result.applied).toEqual([])
      expect(result.divergence).toEqual([])
    })
  })

  describe('partial applied list', () => {
    it('should mark only applied as applied, remainder as pending', () => {
      const applied = ['0000_quick_wraith']
      const local = ['0000_quick_wraith', '0001_funny_eternals', '0002_stale_tyrannus']
      const result = diffMigrations(applied, local)
      expect(result.applied).toEqual(['0000_quick_wraith'])
      expect(result.pending).toEqual(['0001_funny_eternals', '0002_stale_tyrannus'])
      expect(result.divergence).toEqual([])
    })
  })

  describe('full applied list', () => {
    it('should have no pending or divergence when local matches applied', () => {
      const applied = ['0000_quick_wraith', '0001_funny_eternals', '0002_stale_tyrannus']
      const local = ['0000_quick_wraith', '0001_funny_eternals', '0002_stale_tyrannus']
      const result = diffMigrations(applied, local)
      expect(result.applied).toEqual([
        '0000_quick_wraith',
        '0001_funny_eternals',
        '0002_stale_tyrannus',
      ])
      expect(result.pending).toEqual([])
      expect(result.divergence).toEqual([])
    })
  })

  describe('drift: DB row missing from filesystem', () => {
    it('should mark DB-only migration as divergence', () => {
      const applied = ['0000_quick_wraith', '0001_funny_eternals', '0099_ghost_migration']
      const local = ['0000_quick_wraith', '0001_funny_eternals']
      const result = diffMigrations(applied, local)
      expect(result.applied).toEqual(['0000_quick_wraith', '0001_funny_eternals'])
      expect(result.pending).toEqual([])
      expect(result.divergence).toEqual(['0099_ghost_migration'])
    })
  })

  describe('pending: filesystem entry not in DB', () => {
    it('should mark filesystem-only migration as pending', () => {
      const applied = ['0000_quick_wraith']
      const local = ['0000_quick_wraith', '0001_funny_eternals', '0002_stale_tyrannus']
      const result = diffMigrations(applied, local)
      expect(result.applied).toEqual(['0000_quick_wraith'])
      expect(result.pending).toEqual(['0001_funny_eternals', '0002_stale_tyrannus'])
      expect(result.divergence).toEqual([])
    })
  })

  describe('symmetry property', () => {
    it('applied ∪ pending ∪ divergence should equal applied ∪ local', () => {
      const applied = ['0000_quick_wraith', '0001_funny_eternals']
      const local = ['0000_quick_wraith', '0002_stale_tyrannus']
      const result = diffMigrations(applied, local)
      const all = [...result.applied, ...result.pending, ...result.divergence].sort()
      const union = [...new Set([...applied, ...local])].sort()
      expect(all).toEqual(union)
    })
  })
})

describe('statusSchema', () => {
  it('should validate a clean status response', () => {
    const input = {
      applied: ['0000_quick_wraith', '0001_funny_eternals'],
      pending: [],
      divergence: [],
      exitCode: 0 as const,
    }
    const result = statusSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('should validate a status with pending migrations', () => {
    const input = {
      applied: ['0000_quick_wraith'],
      pending: ['0001_funny_eternals', '0002_stale_tyrannus'],
      divergence: [],
      exitCode: 1 as const,
    }
    const result = statusSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('should validate a status with divergence', () => {
    const input = {
      applied: ['0000_quick_wraith'],
      pending: [],
      divergence: ['0099_ghost_migration'],
      exitCode: 1 as const,
    }
    const result = statusSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('should reject invalid exitCode', () => {
    const input = {
      applied: [],
      pending: [],
      divergence: [],
      exitCode: 2 as const,
    }
    const result = statusSchema.safeParse(input)
    // exitCode 2 is connection error, not valid for normal status
    expect(result.success).toBe(false)
  })

  it('should reject missing fields', () => {
    const input = {
      applied: ['0000_quick_wraith'],
    }
    const result = statusSchema.safeParse(input)
    expect(result.success).toBe(false)
  })
})
