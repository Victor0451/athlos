import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeIdempotencyKey, emitAudit, type AuditRecord } from './emitter.ts'

/**
 * `emitAudit` durable caller-key tests (PR A1b — S2.a).
 *
 * The S2 contract (see
 * `openspec/changes/athlos-ctacte-security-reliability-remediation/specs/audit-logger/spec.md`
 * §"Idempotency Window") is:
 *   - When `callerKey` is supplied, the idempotency key MUST be
 *     `sha256(operatorId|action|entityId|callerKey)` with no time
 *     bucket. Two retries of the same callerKey at any delay
 *     collapse to the same row.
 *   - Actor scope: the key MUST include `operatorId`, so actor B
 *     submitting actor A's completed callerKey does NOT see A's row.
 *   - Distinct callerKey for the same actor + entity MUST produce
 *     a distinct key.
 *   - The legacy 10s bucket MUST be preserved when `callerKey` is
 *     omitted (backwards-compat for non-CTACTE callers).
 *
 * The test layer is unit (in-memory mock; no DB). The DB-level
 * dedup race is covered separately by `pnpm --filter @athlos/api
 * test:run -- ctacte_movement_notes_repository.concurrent` (PR 4).
 *
 * Four cases (the spec scenarios):
 *   1. Durable 30s gap: same callerKey + 30s → identical key
 *   2. Actor scope: same callerKey + different actor → different key
 *   3. Distinct callerKey: same actor + different callerKey → different key
 *   4. Legacy 10s bucket: no callerKey + 30s → different keys (preserves
 *      legacy dedup window for non-CTACTE callers)
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

const OPERATOR_A = '00000000-0000-4000-8000-000000000001'
const OPERATOR_B = '00000000-0000-4000-8000-000000000002'
const ENTITY_ID = '00000000-0000-4000-8000-0000000000aa'
const CTACTE_PAYMENT = 'CTACTE_PAYMENT_REGISTERED' as const

function buildMockDb() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => ({
            // SELECT always returns empty: this test verifies the
            // COMPUTED idempotency key, not the DB-level dedup
            // (which is covered by the concurrent test in PR 4).
            then: (onFulfilled: (v: unknown) => unknown) => Promise.resolve([]).then(onFulfilled),
          }),
        }),
      }),
    }),
    insert: () => ({
      values: (row: Record<string, unknown>) => ({
        returning: () => ({
          then: (onFulfilled: (v: unknown) => unknown) => {
            const r = { ...row, id: 'row-' + (rows.length + 1) } as unknown as AuditRow
            rows.push(r)
            return Promise.resolve([{ id: r.id }]).then(onFulfilled)
          },
        }),
      }),
    }),
  }
}

const baseRecord = (overrides: Partial<AuditRecord> = {}): AuditRecord => ({
  operatorId: OPERATOR_A,
  action: CTACTE_PAYMENT,
  entityType: 'ctacte_movement',
  entityId: ENTITY_ID,
  oldValue: null,
  newValue: { id: ENTITY_ID },
  sourceIp: null,
  payload: { id: ENTITY_ID, monto: 1500 },
  metadata: {
    ctacte_id: '00000000-0000-4000-8000-0000000000bb',
    movement_id: ENTITY_ID,
    monto: 1500,
    fecha: '2026-07-09',
    concepto: 'Cuota Julio',
    comprobante_attachment_id: null,
  },
  ...overrides,
})

/** Legacy-mode base record (no `callerKey` field at all). Under
 *  `exactOptionalPropertyTypes: true` the optional field must be
 *  omitted rather than set to `undefined` so the consumer sees the
 *  pre-S2 contract. */
const legacyBaseRecord = (): AuditRecord => ({
  operatorId: OPERATOR_A,
  action: CTACTE_PAYMENT,
  entityType: 'ctacte_movement',
  entityId: ENTITY_ID,
  oldValue: null,
  newValue: { id: ENTITY_ID },
  sourceIp: null,
  payload: { id: ENTITY_ID, monto: 1500 },
  metadata: {
    ctacte_id: '00000000-0000-4000-8000-0000000000bb',
    movement_id: ENTITY_ID,
    monto: 1500,
    fecha: '2026-07-09',
    concepto: 'Cuota Julio',
    comprobante_attachment_id: null,
  },
})

beforeEach(() => {
  rows = []
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-07-09T12:00:00.000Z'))
})

afterEach(() => {
  rows = []
  vi.useRealTimers()
})

describe('emitAudit — durable caller-key (S2.a)', () => {
  it('same callerKey + 30s gap produces an identical idempotency_key (no time bucket)', async () => {
    const callerKey = 'idem-key-1'
    await emitAudit(buildMockDb() as never, baseRecord({ callerKey }))
    // Advance time by 30s — under the legacy 10s bucket, the bucket
    // value would change three times and the key would differ. Under
    // the S2.a durable contract the bucket is dropped when callerKey
    // is supplied, so the key MUST be identical.
    vi.setSystemTime(new Date('2026-07-09T12:00:30.000Z'))
    await emitAudit(buildMockDb() as never, baseRecord({ callerKey }))

    expect(rows).toHaveLength(2)
    expect(rows[0]!.idempotencyKey).toBe(rows[1]!.idempotencyKey)
    expect(rows[0]!.idempotencyKey).toMatch(/^[0-9a-f]{64}$/)
  })

  it('same callerKey with a different actor produces a different idempotency_key (actor scope)', async () => {
    const callerKey = 'idem-key-shared'
    await emitAudit(buildMockDb() as never, baseRecord({ operatorId: OPERATOR_A, callerKey }))
    // Actor B submits the SAME callerKey. The key MUST differ from
    // actor A's because the SHA-256 input includes operatorId —
    // actor B MUST NOT see actor A's completed audit row.
    await emitAudit(buildMockDb() as never, baseRecord({ operatorId: OPERATOR_B, callerKey }))

    expect(rows).toHaveLength(2)
    expect(rows[0]!.operatorId).toBe(OPERATOR_A)
    expect(rows[1]!.operatorId).toBe(OPERATOR_B)
    expect(rows[0]!.idempotencyKey).not.toBe(rows[1]!.idempotencyKey)
  })

  it('same actor + different callerKey produces a different idempotency_key', async () => {
    await emitAudit(buildMockDb() as never, baseRecord({ callerKey: 'idem-key-A' }))
    await emitAudit(buildMockDb() as never, baseRecord({ callerKey: 'idem-key-B' }))

    expect(rows).toHaveLength(2)
    expect(rows[0]!.idempotencyKey).not.toBe(rows[1]!.idempotencyKey)
    expect(rows[0]!.idempotencyKey).toMatch(/^[0-9a-f]{64}$/)
    expect(rows[1]!.idempotencyKey).toMatch(/^[0-9a-f]{64}$/)
  })

  it('legacy 10s bucket is preserved when callerKey is omitted (backwards-compat)', async () => {
    // No callerKey → legacy path. The bucket
    // `floor(Date.now() / 10_000)` is part of the hash. Two calls
    // 30s apart fall into different buckets → distinct keys. This
    // is the current pre-S2 behavior and MUST remain so for
    // non-CTACTE callers (SOCIO_* and friends).
    await emitAudit(buildMockDb() as never, legacyBaseRecord())
    vi.setSystemTime(new Date('2026-07-09T12:00:30.000Z'))
    await emitAudit(buildMockDb() as never, legacyBaseRecord())

    expect(rows).toHaveLength(2)
    expect(rows[0]!.idempotencyKey).not.toBe(rows[1]!.idempotencyKey)
  })

  it('computeIdempotencyKey is a pure function (same input → same output, no I/O)', () => {
    // The hash MUST be deterministic for the same inputs — this is
    // the property that lets the caller-supplied callerKey collapse
    // retries across any delay. Verify both modes without DB.
    const record = baseRecord({ callerKey: 'idem-key-pure' })
    const k1 = computeIdempotencyKey(record)
    const k2 = computeIdempotencyKey(record)
    expect(k1).toBe(k2)
    expect(k1).toMatch(/^[0-9a-f]{64}$/)

    // Legacy mode (no callerKey) is time-dependent — calling it
    // across a 10s bucket boundary MUST produce different keys.
    vi.setSystemTime(new Date('2026-07-09T12:00:00.000Z'))
    const legacyT0 = computeIdempotencyKey(legacyBaseRecord())
    vi.setSystemTime(new Date('2026-07-09T12:00:30.000Z'))
    const legacyT30 = computeIdempotencyKey(legacyBaseRecord())
    expect(legacyT0).not.toBe(legacyT30)
  })
})

// Sanity: keep the AuditRecord reference live.
void ({} as AuditRecord)
