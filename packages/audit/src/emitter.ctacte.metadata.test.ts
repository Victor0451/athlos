import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuditAction, emitAudit, type AuditRecord } from './emitter.ts'

/**
 * CTACTE_* audit action metadata-shape tests — PR A1b.1
 * (athlos-ctacte-mutations).
 *
 * Part 1 of 2 — covers the `registerPayment` and `registerDebit`
 * surfaces (PAYMENT 6-key + DEBIT 5-key). Sibling file
 * `emitter.ctacte.metadata2.test.ts` covers the NOTE 5-key +
 * COMPROBANTE 7-key metadata. Split for the 200 LoC per-file cap.
 *
 * The key sets mirror the docblock on `AuditAction` in `emitter.ts`
 * lines 66-80 and the production emissions in:
 *   - `apps/api/src/modules/socios/forms/ctacte-mutations.ts`
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

describe('emitAudit — CTACTE_PAYMENT_REGISTERED (6-key metadata)', () => {
  it('persists the exact 6-key metadata shape for a payment with a comprobante', async () => {
    const metadata = {
      ctacte_id: '00000000-0000-4000-8000-000000000010',
      movement_id: '00000000-0000-4000-8000-000000000011',
      monto: 1500.5,
      fecha: '2026-07-09',
      concepto: 'Pago cuota Julio',
      comprobante_attachment_id: '00000000-0000-4000-8000-000000000012',
    }
    await emitAudit(buildMockDb() as never, {
      operatorId: OPERATOR_ID,
      action: AuditAction.CTACTE_PAYMENT_REGISTERED,
      entityType: 'ctacte_movement',
      entityId: metadata.movement_id,
      oldValue: null,
      newValue: { id: metadata.movement_id, monto: metadata.monto },
      sourceIp: null,
      payload: { id: metadata.movement_id, monto: metadata.monto },
      metadata,
    } satisfies AuditRecord)
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.action).toBe('CTACTE_PAYMENT_REGISTERED')
    expect(row.entityType).toBe('ctacte_movement')
    expect(Object.keys(row.metadata ?? {}).sort()).toEqual([
      'comprobante_attachment_id',
      'concepto',
      'ctacte_id',
      'fecha',
      'monto',
      'movement_id',
    ])
    expect(row.metadata).toEqual(metadata)
  })

  it('keeps comprobante_attachment_id as JSON null (not undefined) when no file was uploaded', async () => {
    const metadata = {
      ctacte_id: '00000000-0000-4000-8000-000000000020',
      movement_id: '00000000-0000-4000-8000-000000000021',
      monto: 250,
      fecha: '2026-07-09',
      concepto: 'Pago sin comprobante',
      comprobante_attachment_id: null,
    }
    await emitAudit(buildMockDb() as never, {
      operatorId: OPERATOR_ID,
      action: AuditAction.CTACTE_PAYMENT_REGISTERED,
      entityType: 'ctacte_movement',
      entityId: metadata.movement_id,
      oldValue: null,
      newValue: { id: metadata.movement_id },
      sourceIp: null,
      payload: { id: metadata.movement_id },
      metadata,
    } satisfies AuditRecord)
    expect(rows[0]!.metadata).toEqual(metadata)
    expect(Object.keys(rows[0]!.metadata ?? {})).toContain('comprobante_attachment_id')
    expect(rows[0]!.metadata?.comprobante_attachment_id).toBeNull()
  })
})

describe('emitAudit — CTACTE_DEBIT_REGISTERED (5-key metadata)', () => {
  it('persists the exact 5-key metadata shape for a debit', async () => {
    const metadata = {
      ctacte_id: '00000000-0000-4000-8000-000000000030',
      movement_id: '00000000-0000-4000-8000-000000000031',
      monto: 800,
      fecha: '2026-07-09',
      motivo: 'Cargo mora',
    }
    await emitAudit(buildMockDb() as never, {
      operatorId: OPERATOR_ID,
      action: AuditAction.CTACTE_DEBIT_REGISTERED,
      entityType: 'ctacte_movement',
      entityId: metadata.movement_id,
      oldValue: null,
      newValue: { id: metadata.movement_id, motivo: metadata.motivo },
      sourceIp: null,
      payload: { id: metadata.movement_id, monto: metadata.monto },
      metadata,
    } satisfies AuditRecord)
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.action).toBe('CTACTE_DEBIT_REGISTERED')
    expect(row.entityType).toBe('ctacte_movement')
    expect(Object.keys(row.metadata ?? {}).sort()).toEqual([
      'ctacte_id',
      'fecha',
      'monto',
      'motivo',
      'movement_id',
    ])
    expect(row.metadata).toEqual(metadata)
  })
})
