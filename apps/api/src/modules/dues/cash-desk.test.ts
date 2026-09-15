import { describe, expect, it } from 'vitest'
import type { Db } from '@athlos/db'
import {
  businessDateForOpening,
  movementInInterval,
  reconcileTenders,
  requestFingerprintConflict,
  validateOpeningTenders,
} from './cash-desk.ts'
import { CashDeskService } from './cash-desk.ts'

describe('cash desk reconciliation', () => {
  it('keeps cash reconciliation separate from non-cash tender reporting', () => {
    expect(
      reconcileTenders(
        { CASH: 1_000, CARD: 500 },
        [
          { tender: 'CASH', direction: 'INCOME', amountCents: 2_000 },
          { tender: 'CARD', direction: 'EXPENSE', amountCents: 100 },
        ],
        { CASH: 2_900 },
        'Counted cash was short',
      ),
    ).toEqual({
      expected: { CASH: 3_000 },
      counted: { CASH: 2_900 },
      discrepancy: { CASH: -100 },
    })
  })

  it('requires a reason for any discrepancy and accepts an exact close', () => {
    expect(() => reconcileTenders({}, [], { CASH: 1 })).toThrow('justification')
    expect(reconcileTenders({ CASH: 5 }, [], { CASH: 5 }, 'counted')).toEqual({
      expected: { CASH: 5 },
      counted: { CASH: 5 },
      discrepancy: {},
    })
  })

  it('derives the immutable business date in the club timezone, including after-midnight closes', () => {
    expect(businessDateForOpening(new Date('2026-08-20T02:30:00.000Z'))).toBe('2026-08-19')
  })

  it('uses an inclusive opening/closing movement interval', () => {
    const openedAt = new Date('2026-08-19T10:00:00.000Z')
    const closedAt = new Date('2026-08-20T09:59:59.999Z')
    expect(movementInInterval(openedAt, closedAt, openedAt)).toBe(true)
    expect(movementInInterval(openedAt, closedAt, closedAt)).toBe(true)
    expect(movementInInterval(openedAt, closedAt, new Date('2026-08-20T10:00:00.000Z'))).toBe(false)
  })

  it('distinguishes same-key replay from a payload conflict', () => {
    expect(requestFingerprintConflict('a'.repeat(64), 'a'.repeat(64))).toBe(false)
    expect(requestFingerprintConflict('a'.repeat(64), 'b'.repeat(64))).toBe(true)
  })

  it('accepts only bounded CASH opening cents while preserving an empty opening', () => {
    expect(validateOpeningTenders({})).toEqual({})
    expect(validateOpeningTenders({ CASH: 0 })).toEqual({ CASH: 0 })
    expect(validateOpeningTenders({ CASH: 99_999_999_999_999 })).toEqual({
      CASH: 99_999_999_999_999,
    })
    for (const opening of [
      { CARD: 1 },
      { CASH: -1 },
      { CASH: 1.5 },
      { CASH: Number.MAX_SAFE_INTEGER + 1 },
      { CASH: 100_000_000_000_000 },
    ])
      expect(() => validateOpeningTenders(opening)).toThrow('CASH')
  })
})

describe('MANUAL tender attribution validation', () => {
  // recordTender validates attribution BEFORE any db access; the stub proves rejection paths never touch PG.
  const unreachable = (): never => {
    throw new Error('db must not be reached')
  }
  const stubDb = { transaction: unreachable, execute: unreachable } as unknown as Db
  const record = (overrides: Record<string, unknown>) =>
    new CashDeskService(stubDb).recordTender({
      actorId: 'a1',
      role: 'ADMIN' as const,
      permissions: [] as string[],
      sourceIp: '127.0.0.1',
      callerKey: 'key',
      requestFingerprint: 'f'.repeat(64),
      authorizationEvidence: {},
      shiftId: 's1',
      direction: 'INCOME' as const,
      tender: 'CASH' as const,
      amountCents: 500,
      sourceType: 'MANUAL' as const,
      reason: 'Receipt',
      ...overrides,
    })

  it('rejects accountCode-only as incomplete attribution', async () => {
    await expect(record({ accountCode: '1.1.1.01' })).rejects.toThrow(
      'A manual account code and description are required together',
    )
  })

  it('rejects description-only as incomplete attribution', async () => {
    await expect(record({ description: 'Manual income' })).rejects.toThrow(
      'A manual account code and description are required together',
    )
  })

  it('passes full, blank, and omitted attribution through to the db layer', async () => {
    for (const overrides of [
      { accountCode: '1.1.1.01', description: 'Cash receipt' },
      { accountCode: ' ', description: '' },
      {},
    ])
      await expect(record(overrides)).rejects.toThrow('db must not be reached')
  })

  it('authorizes an operator manual tender but never an operator settlement tender', async () => {
    await expect(record({ role: 'OPERADOR' })).rejects.toThrow('db must not be reached')
    await expect(
      record({
        role: 'OPERADOR',
        sourceType: 'SETTLEMENT' as const,
        direction: 'INCOME' as const,
        sourceId: '00000000-0000-4000-8000-000000000009',
      }),
    ).rejects.toThrow('Cash desk action is not authorized')
  })
})
