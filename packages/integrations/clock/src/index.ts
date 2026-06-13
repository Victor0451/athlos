import { realClock } from './real.ts'
import { createFakeClock } from './stub.ts'
import type { Clock, FakeClock } from './types.ts'

export type { Clock, FakeClock } from './types.ts'
export { realClock } from './real.ts'
export { createFakeClock } from './stub.ts'

/**
 * Build a clock by flavor. `real` returns the production clock; `stub`
 * returns a fresh `FakeClock` instance (each test gets its own — do NOT
 * share across tests, the wakeup queue is per-instance).
 *
 * The DI container in apps/api/src/container.ts picks `stub` when
 * NODE_ENV === 'test' and no overrides are passed in.
 */
export function createClock(opts: { type: 'real' | 'stub' }): Clock | FakeClock {
  return opts.type === 'real' ? realClock : createFakeClock()
}
