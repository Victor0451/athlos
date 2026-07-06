import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createStandinDb } from '../../test-standins/db.ts'
import type { Db } from '@athlos/db'
import {
  getOperatorByIdsQuerySchema,
  listByIds,
  OperatorRole,
  type OperatorSummary,
} from './lookup.ts'

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

/**
 * Repository tests for the operator batch lookup. Spec §"Single
 * batched query" + §"Soft-deleted operators retained" + §"Minimal
 * response shape" pin three behaviors:
 *
 *   - All-present batch returns every requested row, with the
 *     SELECT projection limited to { id, username, role }.
 *   - Mixed valid + unknown ids silently omits the unknown one.
 *   - Soft-deleted (`is_active = false`) rows are included so
 *     historical audit actors keep their name.
 *
 * The standin has been extended (test-standins/db.ts) to model
 * `inArray(...)` so the function goes through the same code path
 * in tests and production. Empty-input short-circuit is verified
 * separately because the spec lets us return `[]` without a query.
 */

const VALID_ID_A = '00000000-0000-4000-8000-000000000001'
const VALID_ID_B = '00000000-0000-4000-8000-000000000002'
const VALID_ID_C = '00000000-0000-4000-8000-000000000003'
const MISSING_ID = '00000000-0000-4000-8000-000000000099'
const SOFT_DELETED_ID = '00000000-0000-4000-8000-000000000010'

let db: Db
let selectSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  const standin = createStandinDb()
  db = standin.drizzle as unknown as Db
  // Seed operators directly into the standin state so the production
  // `listByIds` path runs end-to-end against the standin.
  standin.state.operators.push(
    {
      id: VALID_ID_A,
      username: 'vlongo',
      passwordHash: 'h',
      role: 'A',
      canReprint: false,
      canAnulate: false,
      isActive: true,
      lastLoginAt: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
    {
      id: VALID_ID_B,
      username: 'laura',
      passwordHash: 'h',
      role: 'T',
      canReprint: false,
      canAnulate: false,
      isActive: true,
      lastLoginAt: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
    {
      id: VALID_ID_C,
      username: 'maria',
      passwordHash: 'h',
      role: 'O',
      canReprint: false,
      canAnulate: false,
      isActive: true,
      lastLoginAt: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
    {
      id: SOFT_DELETED_ID,
      username: 'former',
      passwordHash: 'h',
      role: 'C',
      canReprint: false,
      canAnulate: false,
      isActive: false,
      lastLoginAt: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
  )
  selectSpy = vi.spyOn(standin.drizzle, 'select')
})

describe('listByIds', () => {
  it('returns 3 summaries when 3 active ids match', async () => {
    const rows = await listByIds(db, [VALID_ID_A, VALID_ID_B, VALID_ID_C])
    expect(rows).toHaveLength(3)
    const byId = new Map<string, OperatorSummary>(rows.map((r) => [r.id, r]))
    expect(byId.get(VALID_ID_A)).toEqual({ id: VALID_ID_A, username: 'vlongo', role: 'ADMIN' })
    expect(byId.get(VALID_ID_B)).toEqual({ id: VALID_ID_B, username: 'laura', role: 'TESORERO' })
    expect(byId.get(VALID_ID_C)).toEqual({ id: VALID_ID_C, username: 'maria', role: 'OPERADOR' })
  })

  it('only exposes {id, username, role} per row (no password_hash / is_active / etc.)', async () => {
    const rows = await listByIds(db, [VALID_ID_A])
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    // Exact key set — no extra columns leak onto the wire.
    expect(Object.keys(row).sort()).toEqual(['id', 'role', 'username'])
  })

  it('silently omits ids that have no matching row', async () => {
    const rows = await listByIds(db, [VALID_ID_A, MISSING_ID, VALID_ID_B])
    expect(rows.map((r) => r.id).sort()).toEqual([VALID_ID_A, VALID_ID_B].sort())
  })

  it('returns an empty array when every id is unknown', async () => {
    const rows = await listByIds(db, [MISSING_ID, '00000000-0000-4000-8000-000000000098'])
    expect(rows).toEqual([])
  })

  it('includes soft-deleted rows (is_active = false) with their historical name', async () => {
    const rows = await listByIds(db, [VALID_ID_A, SOFT_DELETED_ID])
    expect(rows.map((r) => r.id).sort()).toEqual([VALID_ID_A, SOFT_DELETED_ID].sort())
    const former = rows.find((r) => r.id === SOFT_DELETED_ID)
    expect(former).toEqual({
      id: SOFT_DELETED_ID,
      username: 'former',
      role: 'CONSULTA',
    })
  })

  it('returns an empty array without firing any query when ids is empty', async () => {
    const rows = await listByIds(db, [])
    expect(rows).toEqual([])
    expect(selectSpy).not.toHaveBeenCalled()
  })

  it('decodes the char(1) role code to the wire enum', async () => {
    const rows = await listByIds(db, [
      VALID_ID_A, // 'A' → ADMIN
      VALID_ID_B, // 'T' → TESORERO
      VALID_ID_C, // 'O' → OPERADOR
      SOFT_DELETED_ID, // 'C' → CONSULTA
    ])
    const byId = new Map(rows.map((r) => [r.id, r]))
    expect(byId.get(VALID_ID_A)?.role).toBe('ADMIN')
    expect(byId.get(VALID_ID_B)?.role).toBe('TESORERO')
    expect(byId.get(VALID_ID_C)?.role).toBe('OPERADOR')
    expect(byId.get(SOFT_DELETED_ID)?.role).toBe('CONSULTA')
  })

  it('issues a single batched select — not per-id roundtrips', async () => {
    await listByIds(db, [VALID_ID_A, VALID_ID_B, VALID_ID_C])
    expect(selectSpy).toHaveBeenCalledTimes(1)
  })
})
