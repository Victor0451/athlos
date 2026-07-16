import { describe, expect, it } from 'vitest'
import {
  ManualClock,
  createDeferred,
  createLeaseHarness,
} from './ctacte-comprobante.timeout.test-support.ts'
describe('comprobante timeout test support', () => {
  it('advances timers deterministically and clears cancelled work', async () => {
    const clock = new ManualClock(1_000)
    const events: number[] = []
    clock.setTimeout(() => void events.push(clock.nowMs()), 10)
    const cancelled = clock.setTimeout(() => void events.push(-1), 5)
    clock.clearTimer(cancelled)
    await clock.advanceBy(9)
    expect(events).toEqual([])
    await clock.advanceBy(1)
    expect(events).toEqual([1_010])
    expect(clock.pendingCount()).toBe(0)
  })
  it('observes deferred rejection and resets scripted lease calls', async () => {
    const deferred = createDeferred<Buffer>()
    const observed = deferred.promise.catch((error: Error) => error.message)
    deferred.reject(new Error('late renderer rejection'))
    await expect(observed).resolves.toBe('late renderer rejection')
    expect(deferred.state()).toBe('rejected')
    const lease = createLeaseHarness([{ kind: 'owner' }, { kind: 'follower' }])
    await lease.store.claim('key', 'fp', 'owner', 0, 5_000, 60_000)
    await lease.store.heartbeat('key', 'owner', 1_000, 5_000)
    expect(lease.calls.map((call) => call.operation)).toEqual(['claim', 'heartbeat'])
    lease.reset()
    expect(lease.calls).toEqual([])
  })
})
