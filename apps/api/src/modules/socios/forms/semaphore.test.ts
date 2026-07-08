import { describe, expect, it } from 'vitest'
import { Semaphore } from './semaphore.ts'

/**
 * `Semaphore` — closure-owned acquire/finally release.
 *
 * Locks the contract for `pdf-generator.ts`: 3 concurrent puppeteer
 * pages max, 4th request waits, finally release on throw.
 */

describe('Semaphore', () => {
  it('runs 3 concurrent tasks concurrently and succeeds', async () => {
    const sem = new Semaphore(3)
    const started: number[] = []
    const finishes: number[] = []
    const tasks = [0, 1, 2].map((i) =>
      sem.acquire(async () => {
        started.push(i)
        await new Promise((r) => setTimeout(r, 10))
        finishes.push(i)
        return i * 10
      }),
    )
    const results = await Promise.all(tasks)
    expect(results).toEqual([0, 10, 20])
    expect(started.sort()).toEqual([0, 1, 2])
    expect(finishes.sort()).toEqual([0, 1, 2])
  })

  it('makes a 4th task wait while 3 are already active and unblocks on release', async () => {
    const sem = new Semaphore(3)
    const order: string[] = []
    const blockers = [0, 1, 2].map((i) =>
      sem.acquire(async () => {
        order.push(`start-${i}`)
        await new Promise((r) => setTimeout(r, 30))
        order.push(`end-${i}`)
        return i
      }),
    )
    // Schedule the 4th task; it must wait while 3 are active.
    const fourth = sem.acquire(async () => {
      order.push('start-3')
      return 99
    })
    // Yield microtasks so the 3 first tasks start.
    await new Promise((r) => setTimeout(r, 5))
    // While 3 are running, the 4th must NOT have started.
    expect(order.filter((s) => s.startsWith('start-')).sort()).toEqual([
      'start-0',
      'start-1',
      'start-2',
    ])

    const fourthResult = await Promise.all([...blockers, fourth])
    // The 4th task DID run (proves it was queued and unblocked).
    expect(fourthResult[3]).toBe(99)
    expect(order).toContain('start-3')
    // The 4th's `start-3` must appear AFTER at least one `end-N` —
    // FIFO guarantees it unblocks on the first release, not that it
    // runs after all 3 finish.
    const firstEnd = order.findIndex((s) => s.startsWith('end-'))
    const start3Idx = order.indexOf('start-3')
    expect(start3Idx).toBeGreaterThan(firstEnd)
  })

  it('releases the slot in finally even when the task throws', async () => {
    const sem = new Semaphore(1)
    const seen: string[] = []
    const boom = sem
      .acquire(async () => {
        seen.push('boom-start')
        throw new Error('boom')
      })
      .catch((e: unknown) => {
        seen.push('boom-caught:' + (e as Error).message)
      })
    // Second task MUST be able to acquire even though the first threw.
    // This is the safety property — a throw leaks NO slot.
    const after = sem.acquire(async () => {
      seen.push('after-start')
      return 42
    })
    const [, afterResult] = await Promise.all([boom, after])
    // The throw + catch path happened.
    expect(seen).toContain('boom-start')
    expect(seen).toContain('boom-caught:boom')
    // The next task ran (proves the slot was released).
    expect(seen).toContain('after-start')
    expect(afterResult).toBe(42)
  })

  it('rejects a non-positive capacity', () => {
    expect(() => new Semaphore(0)).toThrow(/positive integer/)
    expect(() => new Semaphore(-1)).toThrow(/positive integer/)
    expect(() => new Semaphore(1.5)).toThrow(/positive integer/)
  })

  it('preserves FIFO ordering across multiple waiters', async () => {
    const sem = new Semaphore(1)
    const order: number[] = []
    const first = sem.acquire(async () => {
      await new Promise((r) => setTimeout(r, 30))
      return 'first'
    })
    // Queue 3 more while the first is running.
    const second = sem.acquire(async () => {
      order.push(2)
      return 'second'
    })
    const third = sem.acquire(async () => {
      order.push(3)
      return 'third'
    })
    const fourth = sem.acquire(async () => {
      order.push(4)
      return 'fourth'
    })
    expect(await first).toBe('first')
    await Promise.all([second, third, fourth])
    expect(order).toEqual([2, 3, 4])
  })

  it('handles many sequential acquires without leaking slots', async () => {
    const sem = new Semaphore(2)
    for (let i = 0; i < 20; i++) {
      await sem.acquire(async () => i)
    }
    // After 20 sequential acquires the counter MUST be 0; the next
    // 2 acquires should run concurrently without waiting on stale
    // state, and a 3rd must wait. The peak concurrent count proves
    // the slot counter wasn't leaked by the 20 sequential acquires.
    let concurrent = 0
    let peak = 0
    const observed: string[] = []
    const a = sem.acquire(async () => {
      concurrent++
      peak = Math.max(peak, concurrent)
      observed.push('a-start')
      await new Promise((r) => setTimeout(r, 10))
      concurrent--
      observed.push('a-end')
    })
    const b = sem.acquire(async () => {
      concurrent++
      peak = Math.max(peak, concurrent)
      observed.push('b-start')
      await new Promise((r) => setTimeout(r, 10))
      concurrent--
      observed.push('b-end')
    })
    const c = sem.acquire(async () => {
      concurrent++
      peak = Math.max(peak, concurrent)
      observed.push('c-start')
    })
    await Promise.all([a, b, c])
    expect(peak).toBe(2)
    // `c` ran AFTER at least one of a/b ended (proves it was queued
    // and unblocked by a release, not racing on a leaked slot).
    const firstEnd = observed.findIndex((s) => s.endsWith('-end'))
    const cStart = observed.indexOf('c-start')
    expect(cStart).toBeGreaterThan(firstEnd)
  })
})
