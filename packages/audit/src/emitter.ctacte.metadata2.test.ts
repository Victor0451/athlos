import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuditAction, emitAudit, type AuditRecord } from './emitter.ts'

/**
 * CTACTE_* audit action metadata-shape tests — PR A1b.1
 * (athlos-ctacte-mutations). Part 2 of 2.
 *
 * Covers the NOTE 5-key + COMPROBANTE 7-key metadata. Sibling file
 * `emitter.ctacte.metadata.test.ts` covers the PAYMENT 6-key + DEBIT
 * 5-key. Split for the 200 LoC per-file cap.
 *
 * The key sets mirror the docblock on `AuditAction` in `emitter.ts`
 * lines 66-80 and the production emissions in:
 *   - `apps/api/src/modules/socios/ctacte_movement_notes.ts` (NOTE)
 *   - `apps/api/src/modules/socios/forms/ctacte-comprobante.ts` (COMPROBANTE)
 *
 * If a future PR widens or narrows any of these bags, BOTH the
 * emitter docblock AND these test files MUST move together.
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

function buildMockDb() {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((_cond: unknown) => ({
          limit: vi.fn(() => ({
            then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => {
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

describe('emitAudit — CTACTE_MOVEMENT_NOTE_ADDED (5-key metadata)', () => {
  it('persists the exact 5-key metadata shape for a movement note', async () => {
    const metadata = {
      ctacte_id: '00000000-0000-4000-8000-000000000040',
      movement_id: '00000000-0000-4000-8000-000000000041',
      note_id: '00000000-0000-4000-8000-000000000042',
      body: 'Llamó el socio para confirmar el pago del lunes',
      author_operator_id: OPERATOR_ID,
    }
    await emitAudit(buildMockDb() as never, {
      operatorId: OPERATOR_ID,
      action: AuditAction.CTACTE_MOVEMENT_NOTE_ADDED,
      entityType: 'ctacte_movement_note',
      entityId: metadata.note_id,
      oldValue: null,
      newValue: { id: metadata.note_id, body: metadata.body },
      sourceIp: null,
      payload: { id: metadata.note_id },
      metadata,
    } satisfies AuditRecord)
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.action).toBe('CTACTE_MOVEMENT_NOTE_ADDED')
    expect(row.entityType).toBe('ctacte_movement_note')
    expect(Object.keys(row.metadata ?? {}).sort()).toEqual([
      'author_operator_id',
      'body',
      'ctacte_id',
      'movement_id',
      'note_id',
    ])
    expect(row.metadata).toEqual(metadata)
  })
})

describe('emitAudit — CTACTE_COMPROBANTE_PRINTED (7-key metadata)', () => {
  it('persists the exact 7-key metadata shape including sha256 + byte_size', async () => {
    const sha = 'b'.repeat(64)
    const metadata = {
      socio_id: '00000000-0000-4000-8000-000000000050',
      ctacte_id: '00000000-0000-4000-8000-000000000050',
      from: '2026-06-01',
      to: '2026-06-30',
      movement_count: 12,
      sha256: sha,
      byte_size: 4096,
    }
    await emitAudit(buildMockDb() as never, {
      operatorId: OPERATOR_ID,
      action: AuditAction.CTACTE_COMPROBANTE_PRINTED,
      entityType: 'ctacte_comprobante',
      entityId: metadata.socio_id,
      oldValue: null,
      newValue: null,
      sourceIp: null,
      payload: { id: metadata.socio_id, sha256: sha, byteSize: metadata.byte_size },
      metadata,
    } satisfies AuditRecord)
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.action).toBe('CTACTE_COMPROBANTE_PRINTED')
    expect(row.entityType).toBe('ctacte_comprobante')
    expect(Object.keys(row.metadata ?? {}).sort()).toEqual([
      'byte_size',
      'ctacte_id',
      'from',
      'movement_count',
      'sha256',
      'socio_id',
      'to',
    ])
    expect(row.metadata).toEqual(metadata)
  })
})
