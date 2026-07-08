import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emitAudit, type AuditRecord } from './emitter.ts'

/**
 * `emitAudit` extension tests — PR 8c.1 (athlos-socio-legajo).
 *
 * The existing emitter persists `operatorId`, `action`, `entityType`,
 * `entityId`, `oldValue`, `newValue`, `sourceIp`, and an
 * idempotencyKey derived from those fields. The new contract:
 *
 *   1. `AuditRecord.metadata?: Record<string, unknown>` is accepted.
 *   2. The metadata reaches the `audit_events.metadata` JSONB column.
 *   3. Two new audit actions — `SOCIO_ATTACHMENT_UPLOADED` and
 *      `SOCIO_ATTACHMENT_DELETED` — type-narrow against the union
 *      and pass through unchanged.
 *
 * The audit package is a leaf (consumed by api / web / workers); the
 * shared in-memory standin lives in `apps/api/src/test-standins/db.ts`
 * and is not reachable from here. We mock the minimum Drizzle
 * surface needed by the emitter — `db.select().from().where().limit(1)`
 * (idempotency check) and `db.insert().values().returning()` (insert).
 */

interface AuditRow {
  id: string
  operatorId: string | null
  action: string
  entityType: string
  entityId: string
  oldValue: unknown
  newValue: unknown
  sourceIp: string | null
  metadata: Record<string, unknown> | null
  idempotencyKey: string | null
  createdAt: Date
}

let rows: AuditRow[]
let byKey: Map<string, string>

const OPERATOR_ID = '00000000-0000-4000-8000-000000000001'
const OTHER_OPERATOR_ID = '00000000-0000-4000-8000-000000000002'

function buildMockDb() {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((_cond: unknown) => ({
          limit: vi.fn(() => ({
            then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => {
              // Simplified idempotency check: when `byKey` has any
              // entry, report "existing row" — enough to drive the
              // dedupe code path. The other tests don't care
              // because they only call once.
              const first = byKey.values().next().value as string | undefined
              return Promise.resolve(first ? [{ id: first }] : []).then(onFulfilled, onRejected)
            },
          })),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((row: Record<string, unknown>) => ({
        returning: vi.fn(() => ({
          then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => {
            // Drizzle generates `id` server-side; the mock pretends
            // to do the same so downstream code that reads `id` (and
            // the idempotency-key lookup) sees a stable value.
            const r = { ...row, id: 'row-' + (rows.length + 1) } as unknown as AuditRow
            rows.push(r)
            const key = (r as unknown as { idempotencyKey?: string }).idempotencyKey
            if (key) byKey.set(key, r.id)
            return Promise.resolve([{ id: r.id }]).then(onFulfilled, onRejected)
          },
        })),
      })),
    })),
  }
}

beforeEach(() => {
  rows = []
  byKey = new Map()
})

afterEach(() => {
  rows = []
  byKey.clear()
})

describe('emitAudit — metadata field', () => {
  it('persists metadata into the audit_events row when provided', async () => {
    const metadata = {
      attachment_id: 'a-1',
      filename: 'front.jpg',
      category: 'dni',
      size_bytes: 524288,
    }
    const result = await emitAudit(buildMockDb() as never, {
      operatorId: OPERATOR_ID,
      action: 'SOCIO_ATTACHMENT_UPLOADED',
      entityType: 'socio_attachment',
      entityId: 'a-1',
      oldValue: null,
      newValue: { id: 'a-1', category: 'dni' },
      sourceIp: '127.0.0.1',
      payload: { foo: 'bar' },
      metadata,
    } satisfies AuditRecord)
    expect(result.inserted).toBe(true)
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.metadata).toEqual(metadata)
    expect(row.action).toBe('SOCIO_ATTACHMENT_UPLOADED')
    // The emitter passes column values in camelCase (matches Drizzle
    // column references); production pg/drizzle maps to snake_case
    // at INSERT time. The mock stores the raw object.
    expect(row.entityType).toBe('socio_attachment')
  })

  it('persists null metadata when the field is omitted (legacy callers)', async () => {
    const result = await emitAudit(buildMockDb() as never, {
      operatorId: OPERATOR_ID,
      action: 'SOCIO_UPDATED',
      entityType: 'socio',
      entityId: 's-1',
      oldValue: null,
      newValue: { id: 's-1' },
      sourceIp: null,
      payload: {},
    } satisfies AuditRecord)
    expect(result.inserted).toBe(true)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.metadata).toBeNull()
  })

  it('records the exact metadata keys for SOCIO_ATTACHMENT_DELETED', async () => {
    await emitAudit(buildMockDb() as never, {
      operatorId: OPERATOR_ID,
      action: 'SOCIO_ATTACHMENT_DELETED',
      entityType: 'socio_attachment',
      entityId: 'a-2',
      oldValue: null,
      newValue: null,
      sourceIp: '127.0.0.1',
      payload: { id: 'a-2' },
      metadata: {
        attachment_id: 'a-2',
        filename: 'comprobante.pdf',
        category: 'comprobante',
        size_bytes: 1024,
      },
    } satisfies AuditRecord)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.metadata).toEqual({
      attachment_id: 'a-2',
      filename: 'comprobante.pdf',
      category: 'comprobante',
      size_bytes: 1024,
    })
  })
})

describe('emitAudit — action union widening', () => {
  it('accepts SOCIO_ATTACHMENT_UPLOADED at the type level', async () => {
    // The point is that this CALL compiles under `satisfies AuditRecord`
    // (verified by `tsc --noEmit`). The runtime assertion just
    // proves the row was inserted.
    await emitAudit(buildMockDb() as never, {
      operatorId: OPERATOR_ID,
      action: 'SOCIO_ATTACHMENT_UPLOADED',
      entityType: 'socio_attachment',
      entityId: 'a-3',
      oldValue: null,
      newValue: { id: 'a-3' },
      sourceIp: null,
      payload: {},
      metadata: { attachment_id: 'a-3', filename: 'x.png', category: 'foto', size_bytes: 100 },
    } satisfies AuditRecord)
    expect(rows[0]!.action).toBe('SOCIO_ATTACHMENT_UPLOADED')
  })

  it('accepts SOCIO_FORM_EMITTED with the 4-key metadata shape (PR 8d.1)', async () => {
    // PR 8d.1 (athlos-socio-form-emit): the audit-logger spec mandates
    // an exact 4-key metadata shape — `socio_id`, `form_id`, `sha256`,
    // `byte_size`. Any deviation (extra keys or missing keys) breaks
    // the spec, so we pin both the shape and the runtime persistence.
    const sha = 'a'.repeat(64)
    const metadata = {
      socio_id: '00000000-0000-4000-8000-000000000099',
      form_id: 'solicitud-inscripcion',
      sha256: sha,
      byte_size: 12345,
    }
    await emitAudit(buildMockDb() as never, {
      operatorId: OPERATOR_ID,
      action: 'SOCIO_FORM_EMITTED',
      entityType: 'socio',
      entityId: '00000000-0000-4000-8000-000000000099',
      oldValue: null,
      newValue: null,
      sourceIp: null,
      payload: { socioId: '00000000-0000-4000-8000-000000000099', sha256: sha, byteSize: 12345 },
      metadata,
    } satisfies AuditRecord)
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.action).toBe('SOCIO_FORM_EMITTED')
    expect(Object.keys(row.metadata ?? {}).sort()).toEqual([
      'byte_size',
      'form_id',
      'sha256',
      'socio_id',
    ])
    expect(row.metadata).toEqual(metadata)
  })

  it('two distinct upload events with identical payload dedupe within the 10s window', async () => {
    // The idempotency key is `sha256(operatorId|action|entityId|payload|10s_bucket)`.
    // Two identical uploads within 10s collapse to a single row. The
    // `metadata` field is NOT part of the key, so it can differ
    // between calls without affecting dedup.
    const input = {
      operatorId: OPERATOR_ID,
      action: 'SOCIO_ATTACHMENT_UPLOADED' as const,
      entityType: 'socio_attachment',
      entityId: 'a-dedupe',
      oldValue: null,
      newValue: { id: 'a-dedupe' },
      sourceIp: null,
      payload: { id: 'a-dedupe' },
      metadata: {
        attachment_id: 'a-dedupe',
        filename: 'dni.jpg',
        category: 'dni',
        size_bytes: 4096,
      },
    } satisfies AuditRecord

    // First call: byKey is empty → SELECT returns no row → INSERT.
    const first = await emitAudit(buildMockDb() as never, input)
    expect(first.inserted).toBe(true)
    expect(rows).toHaveLength(1)

    // Second call: byKey now has the first row's key → SELECT
    // returns it → emitAudit skips the INSERT and returns deduped.
    const second = await emitAudit(buildMockDb() as never, input)
    expect(second.inserted).toBe(false)
    expect(rows).toHaveLength(1)
  })
})

describe('emitAudit — legacy callers without metadata are unaffected', () => {
  it('legacy SOCIO_UPDATED still works with null metadata', async () => {
    const result = await emitAudit(buildMockDb() as never, {
      operatorId: OTHER_OPERATOR_ID,
      action: 'SOCIO_UPDATED',
      entityType: 'socio',
      entityId: 's-2',
      oldValue: null,
      newValue: { id: 's-2' },
      sourceIp: null,
      payload: { x: 1 },
    } satisfies AuditRecord)
    expect(result.inserted).toBe(true)
    expect(rows[0]!.metadata).toBeNull()
  })
})

// Sanity: keep the import live so a tree-shake doesn't remove the
// AuditRecord reference used by the satisfies annotations.
void ({} as AuditRecord)
