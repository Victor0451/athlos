/**
 * Clock integration contract. Every caller that needs the current time
 * MUST go through `Clock.now()` so tests can swap the implementation
 * (per the testing-setup spec, section H "Time and Clock Control").
 *
 * `sleep(ms)` is a deliberate part of the contract: a fake-timer-based
 * test can stub it without having to know whether a service uses
 * `setTimeout` under the hood.
 */
export interface Clock {
  now(): Date
  sleep(ms: number): Promise<void>
}

/**
 * A controllable clock for tests. Extends the production contract with
 * a single `advance(ms)` knob — the same idea as `vi.useFakeTimers()`,
 * but exposed as a method on the instance so service code stays
 * dependency-injected.
 */
export interface FakeClock extends Clock {
  /**
   * Move the fake clock forward by `ms` milliseconds. Pending `sleep()`
   * calls resolve in chronological order; new `now()` returns the
   * advanced time.
   */
  advance(ms: number): void
  /** Jump the clock to a specific instant. Useful for "next morning" tests. */
  setNow(d: Date): void
  /** Reset to the default epoch. Test setup should call this in `beforeEach`. */
  reset(): void
}
