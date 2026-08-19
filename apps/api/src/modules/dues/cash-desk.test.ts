import { describe, expect, it } from 'vitest'
import {
  businessDateForOpening,
  movementInInterval,
  reconcileTenders,
  requestFingerprintConflict,
} from './cash-desk.ts'

describe('cash desk reconciliation', () => {
  it('keeps opening balance, income, and expense totals separated by tender', () => {
    expect(
      reconcileTenders(
        { CASH: 1_000, CARD: 500 },
        [
          { tender: 'CASH', direction: 'INCOME', amountCents: 2_000 },
          { tender: 'CARD', direction: 'EXPENSE', amountCents: 100 },
        ],
        { CASH: 2_900, CARD: 400 },
        'Counted cash was short',
      ),
    ).toEqual({
      expected: { CASH: 3_000, CARD: 400 },
      counted: { CASH: 2_900, CARD: 400 },
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
})
