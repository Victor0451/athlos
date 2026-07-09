import { beforeEach, describe, expect, it } from 'vitest'
import { AuditAction, emitAudit, type AuditRecord } from './emitter.ts'

/**
 * CTACTE_* action coverage for `emitAudit` (PR A1a — athlos-ctacte-mutations).
 *
 * Sibling of `emitter.test.ts` to keep each test file under the 200 LoC
 * per-file cap. Covers the 4 new ctacte actions + the const-map snapshot
 * + a legacy regression check.
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
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => ({
            then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => {
              const first = byKey.values().next().value as string | undefined
              return Promise.resolve(first ? [{ id: first }] : []).then(onFulfilled, onRejected)
            },
          }),
        }),
      }),
    }),
    insert: () => ({
      values: (row: Record<string, unknown>) => ({
        returning: () => ({
          then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => {
            const r = { ...row, id: 'row-' + (rows.length + 1) } as unknown as AuditRow
            rows.push(r)
            const key = (r as unknown as { idempotencyKey?: string }).idempotencyKey
            if (key) byKey.set(key, r.id)
            return Promise.resolve([{ id: r.id }]).then(onFulfilled, onRejected)
          },
        }),
      }),
    }),
  }
}

async function emitAndGetRow(
  action: AuditRecord['action'],
  metadata: Record<string, unknown>,
): Promise<AuditRow> {
  // Snapshot helper: emit one row, return the row for further
  // assertions. Keeps each test focused on the shape contract
  // without repeating boilerplate. Async because emitAudit is async
  // and we need the mock insert to fire before reading `rows`.
  await emitAudit(buildMockDb() as never, {
    operatorId: OPERATOR_ID,
    action,
    entityType: action.startsWith('CTACTE_COMPROBANTE')
      ? 'ctacte_comprobante'
      : action.startsWith('CTACTE_MOVEMENT_NOTE')
        ? 'ctacte_movement_note'
        : 'ctacte_movement',
    entityId: 'row-1',
    oldValue: null,
    newValue: { id: 'row-1' },
    sourceIp: null,
    payload: { id: 'row-1' },
    metadata,
  } satisfies AuditRecord)
  return rows[0]!
}

beforeEach(() => {
  rows = []
  byKey = new Map()
})

describe('emitAudit — ctacte actions (PR A1a)', () => {
  it('CTACTE_PAYMENT_REGISTERED persists the 6-key metadata shape', async () => {
    const row = await emitAndGetRow('CTACTE_PAYMENT_REGISTERED', {
      ctacte_id: 's-1',
      movement_id: 'm-1',
      monto: 1500,
      fecha: '2026-07-09',
      concepto: 'Cuota Julio',
      comprobante_attachment_id: null,
    })
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
    expect(row.metadata?.['comprobante_attachment_id']).toBeNull()
  })

  it('CTACTE_DEBIT_REGISTERED persists the 5-key metadata shape', async () => {
    const row = await emitAndGetRow('CTACTE_DEBIT_REGISTERED', {
      ctacte_id: 's-1',
      movement_id: 'm-2',
      monto: 800,
      fecha: '2026-07-09',
      motivo: 'Cuota social',
    })
    expect(row.action).toBe('CTACTE_DEBIT_REGISTERED')
    expect(Object.keys(row.metadata ?? {}).sort()).toEqual([
      'ctacte_id',
      'fecha',
      'monto',
      'motivo',
      'movement_id',
    ])
  })

  it('CTACTE_MOVEMENT_NOTE_ADDED persists the 5-key metadata shape', async () => {
    const row = await emitAndGetRow('CTACTE_MOVEMENT_NOTE_ADDED', {
      ctacte_id: 's-1',
      movement_id: 'm-1',
      note_id: 'n-1',
      body: 'Verificar comprobante',
      author_operator_id: OPERATOR_ID,
    })
    expect(row.action).toBe('CTACTE_MOVEMENT_NOTE_ADDED')
    expect(row.entityType).toBe('ctacte_movement_note')
    expect(Object.keys(row.metadata ?? {}).sort()).toEqual([
      'author_operator_id',
      'body',
      'ctacte_id',
      'movement_id',
      'note_id',
    ])
  })

  it('CTACTE_COMPROBANTE_PRINTED persists the 7-key shape with sha256 + byte_size', async () => {
    const row = await emitAndGetRow('CTACTE_COMPROBANTE_PRINTED', {
      socio_id: 's-1',
      ctacte_id: 's-1',
      from: '2026-07-01',
      to: '2026-07-31',
      movement_count: 12,
      sha256: 'b'.repeat(64),
      byte_size: 4096,
    })
    expect(row.action).toBe('CTACTE_COMPROBANTE_PRINTED')
    expect(Object.keys(row.metadata ?? {}).sort()).toEqual([
      'byte_size',
      'ctacte_id',
      'from',
      'movement_count',
      'sha256',
      'socio_id',
      'to',
    ])
  })
})

describe('AuditAction const-map — ctacte entries', () => {
  it('all four ctacte actions are present with the expected string values', () => {
    expect(AuditAction.CTACTE_PAYMENT_REGISTERED).toBe('CTACTE_PAYMENT_REGISTERED')
    expect(AuditAction.CTACTE_DEBIT_REGISTERED).toBe('CTACTE_DEBIT_REGISTERED')
    expect(AuditAction.CTACTE_MOVEMENT_NOTE_ADDED).toBe('CTACTE_MOVEMENT_NOTE_ADDED')
    expect(AuditAction.CTACTE_COMPROBANTE_PRINTED).toBe('CTACTE_COMPROBANTE_PRINTED')
  })

  it('legacy SOCIO_ATTACHMENT_UPLOADED still works (no union-widening regression)', async () => {
    const row = await emitAndGetRow('SOCIO_ATTACHMENT_UPLOADED', { attachment_id: 'a-legacy' })
    expect(row.action).toBe('SOCIO_ATTACHMENT_UPLOADED')
    expect(row.metadata).toEqual({ attachment_id: 'a-legacy' })
  })
})
