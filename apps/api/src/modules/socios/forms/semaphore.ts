/**
 * Resource-bounded concurrency primitive (hand-rolled FIFO semaphore).
 *
 * Designed for the PDF form-emit endpoint (`pdf-generator.ts`) where
 * concurrent `puppeteer.page.pdf()` calls must be capped to protect
 * the chromium process from runaway memory pressure. Each `acquire`
 * increments a counter (or queues) until a slot is free, runs the
 * caller's function, and releases the slot in `finally` — so leaks
 * from forgotten `release()` calls are impossible by construction.
 *
 * Pattern: NO manual `acquire()` / `release()` exposed. The closure
 * owns the slot lifecycle.
 *
 * Tests in `semaphore.test.ts` cover:
 *   - 3 concurrent tasks succeed
 *   - 4th task waits
 *   - FIFO order
 *   - finally release on throw
 *   - counter resets after acquire
 */

export class Semaphore {
  private readonly capacity: number
  private active = 0
  private readonly waiters: Array<() => void> = []

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`Semaphore capacity must be a positive integer; got ${capacity}`)
    }
    this.capacity = capacity
  }

  /**
   * Run `fn` when a slot is available. The slot is released in
   * `finally`, so a throw inside `fn` does NOT leak the slot.
   */
  async acquire<T>(fn: () => Promise<T>): Promise<T> {
    await this.take()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }

  private take(): Promise<void> {
    if (this.active < this.capacity) {
      this.active++
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve)
    })
  }

  private release(): void {
    const next = this.waiters.shift()
    if (next) {
      // Hand the slot to the next waiter without touching the counter.
      // `active` stays the same; the next `take()` resolves immediately
      // by the queued microtask.
      next()
    } else {
      this.active--
    }
  }
}
