import type { Clock } from './types.ts'

/**
 * Production clock. Uses the system `Date` and `setTimeout` for `sleep`.
 * Tests should NOT inject this — wire the `FakeClock` instead.
 */
export const realClock: Clock = {
  now: () => new Date(),
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}
