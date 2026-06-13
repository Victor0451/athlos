import type { FakeClock } from './types.ts'

/**
 * Test clock. Begins at the Unix epoch and only advances when a test
 * calls `advance(ms)` or `setNow(d)`. `sleep()` resolves in chronological
 * order — a service awaiting `clock.sleep(500)` will not resume until
 * the clock has been advanced by at least 500ms.
 *
 * Usage in a test:
 *   const clock = createFakeClock()
 *   const t1 = clock.now()             // epoch
 *   clock.advance(1000)                // 1s later
 *   const t2 = clock.now()             // epoch + 1s
 */
export function createFakeClock(): FakeClock {
  let current = new Date(0)
  /** Pending sleep callbacks ordered by wakeup time. */
  const pending: Array<{ wakeAt: number; resolve: () => void }> = []

  function resolveDue(now: number): void {
    while (pending.length > 0 && pending[0]!.wakeAt <= now) {
      pending.shift()!.resolve()
    }
  }

  return {
    now: () => new Date(current.getTime()),
    sleep: (ms: number) =>
      new Promise<void>((resolve) => {
        pending.push({ wakeAt: current.getTime() + ms, resolve })
        resolveDue(current.getTime())
      }),
    advance(ms: number): void {
      current = new Date(current.getTime() + ms)
      resolveDue(current.getTime())
    },
    setNow(d: Date): void {
      current = new Date(d.getTime())
      resolveDue(current.getTime())
    },
    reset(): void {
      current = new Date(0)
      while (pending.length > 0) {
        pending.shift()!.resolve()
      }
    },
  }
}
