import { describe, it, expect } from 'vitest'
import { getOperatorByIdsQuerySchema, OperatorRole } from './lookup.ts'

/**
 * Schema-only tests for the operator batch lookup query schema.
 *
 * The spec (openspec/changes/athlos-audit-operator-display/specs/
 * operator-lookup/spec.md, §"Input validation") locks four cases:
 *
 *   - empty array → reject
 *   - non-UUID string → reject
 *   - 201 ids → reject (>200 cap)
 *   - 200 ids → accept (boundary)
 *
 * The schema is the single source of truth for the validation
 * envelope; the route layer parses `request.query` through it and
 * the global error handler turns the thrown BusinessError into a
 * 400 with `{ error: 'VALIDATION_ERROR', details: [...] }`.
 */

const VALID_UUID_A = '00000000-0000-4000-8000-000000000001'
const VALID_UUID_B = '00000000-0000-4000-8000-000000000002'
const VALID_UUID_C = '00000000-0000-4000-8000-000000000003'

describe('getOperatorByIdsQuerySchema', () => {
  it('accepts a single uuid', () => {
    const parsed = getOperatorByIdsQuerySchema.parse({ ids: [VALID_UUID_A] })
    expect(parsed.ids).toEqual([VALID_UUID_A])
  })

  it('accepts multiple uuids', () => {
    const parsed = getOperatorByIdsQuerySchema.parse({
      ids: [VALID_UUID_A, VALID_UUID_B, VALID_UUID_C],
    })
    expect(parsed.ids).toEqual([VALID_UUID_A, VALID_UUID_B, VALID_UUID_C])
  })

  it('accepts exactly 200 uuids (boundary)', () => {
    const ids = Array.from(
      { length: 200 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    )
    const parsed = getOperatorByIdsQuerySchema.parse({ ids })
    expect(parsed.ids).toHaveLength(200)
  })

  it('rejects an empty array', () => {
    const result = getOperatorByIdsQuerySchema.safeParse({ ids: [] })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['ids'])
    }
  })

  it('rejects a 201-element array', () => {
    const ids = Array.from(
      { length: 201 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    )
    const result = getOperatorByIdsQuerySchema.safeParse({ ids })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['ids'])
    }
  })

  it('rejects a non-uuid string', () => {
    const result = getOperatorByIdsQuerySchema.safeParse({ ids: ['not-a-uuid'] })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['ids', 0])
    }
  })

  it('rejects when ids is missing entirely', () => {
    const result = getOperatorByIdsQuerySchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects when ids is not an array', () => {
    const result = getOperatorByIdsQuerySchema.safeParse({ ids: VALID_UUID_A })
    expect(result.success).toBe(false)
  })
})

describe('OperatorRole', () => {
  it('exports the four roles the spec locks', () => {
    expect(OperatorRole.options).toEqual(['ADMIN', 'TESORERO', 'OPERADOR', 'CONSULTA'])
  })
})
