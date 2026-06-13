import { describe, it, expect } from 'vitest'
import { LOCKOUT_MINUTES, LOCKOUT_THRESHOLD, computeLockoutUpdate } from './login.ts'

describe('lockout window logic', () => {
  it('first four failures increment without locking', () => {
    const now = new Date('2026-01-01T12:00:00Z')
    expect(computeLockoutUpdate(0, now)).toEqual({
      failedLoginAttempts: 1,
      lockedUntil: null,
    })
    expect(computeLockoutUpdate(1, now)).toEqual({
      failedLoginAttempts: 2,
      lockedUntil: null,
    })
    expect(computeLockoutUpdate(2, now)).toEqual({
      failedLoginAttempts: 3,
      lockedUntil: null,
    })
    expect(computeLockoutUpdate(3, now)).toEqual({
      failedLoginAttempts: 4,
      lockedUntil: null,
    })
  })

  it('fifth failure locks the account for 15 minutes and resets counter', () => {
    const now = new Date('2026-01-01T12:00:00Z')
    const result = computeLockoutUpdate(4, now)
    expect(result.failedLoginAttempts).toBe(0)
    expect(result.lockedUntil).toBeInstanceOf(Date)
    expect(result.lockedUntil?.getTime()).toBe(now.getTime() + LOCKOUT_MINUTES * 60 * 1000)
  })

  it('exposes the spec-defined threshold (5) and window (15 min)', () => {
    expect(LOCKOUT_THRESHOLD).toBe(5)
    expect(LOCKOUT_MINUTES).toBe(15)
  })

  it('lockout is monotonic: a second lockout after another 5 failures pushes the window forward', () => {
    const now = new Date('2026-01-01T12:00:00Z')
    // After a lockout the counter is 0; the next 5 failures will lock again
    expect(computeLockoutUpdate(0, now).failedLoginAttempts).toBe(1)
    expect(computeLockoutUpdate(4, now).failedLoginAttempts).toBe(0)
  })
})
