import { describe, it, expect } from 'vitest'
import { validateCronExpression, createNodeCronTask } from './node-cron.ts'

/**
 * The node-cron adapter is the only place that talks to the cron
 * engine. We validate the wrapper behavior — the underlying
 * `node-cron` library has its own tests; we just check our
 * boundaries: invalid input throws, valid input returns a handle
 * whose `stop()` is a no-op after creation.
 */
describe('validateCronExpression', () => {
  it('accepts standard 5-field expressions', () => {
    expect(validateCronExpression('*/5 * * * *')).toBe(true)
    expect(validateCronExpression('0 3 * * *')).toBe(true)
    expect(validateCronExpression('0 0 * * 0')).toBe(true)
  })

  it('rejects malformed expressions', () => {
    expect(validateCronExpression('not-a-cron')).toBe(false)
    expect(validateCronExpression('99 99 99 99 99')).toBe(false)
    expect(validateCronExpression('* * *')).toBe(false)
  })
})

describe('createNodeCronTask', () => {
  it('returns a handle with a stop() that does not throw', () => {
    const handle = createNodeCronTask({
      cronExpr: '0 0 31 2 *', // Feb 31 — never fires
      onTick: () => undefined,
    })
    expect(typeof handle.stop).toBe('function')
    expect(() => handle.stop()).not.toThrow()
  })

  it('throws on an invalid cron expression at task creation', () => {
    expect(() =>
      createNodeCronTask({
        cronExpr: 'totally-invalid',
        onTick: () => undefined,
      }),
    ).toThrow(/Invalid cron expression/)
  })
})
