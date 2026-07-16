import type { ComprobanteLeaseStore } from './ctacte-comprobante.ts'

type Timer = { at: number; interval?: number; run: () => void | Promise<void> }
type LeaseClaim = Awaited<ReturnType<ComprobanteLeaseStore['claim']>>

export class ManualClock {
  private time: number
  private nextId = 1
  private readonly timers = new Map<number, Timer>()

  constructor(startMs = 0) {
    this.time = startMs
  }
  now = (): Date => new Date(this.time)
  nowMs = (): number => this.time
  setTimeout(run: Timer['run'], delayMs: number): number {
    return this.addTimer(run, delayMs)
  }
  setInterval(run: Timer['run'], ms: number): number {
    return this.addTimer(run, ms, ms)
  }
  clearTimer(id: number): void {
    this.timers.delete(id)
  }
  sleep = (delayMs: number): Promise<void> =>
    new Promise((resolve) => void this.setTimeout(resolve, delayMs))
  pendingCount = (): number => this.timers.size
  async flush(): Promise<void> {
    await Promise.resolve()
    await Promise.resolve()
  }
  async advanceBy(ms: number): Promise<void> {
    if (ms < 0) throw new Error('clock cannot move backwards')
    const target = this.time + ms
    while (true) {
      const due = [...this.timers].filter(([, timer]) => timer.at <= target)
      due.sort((a, b) => a[1].at - b[1].at || a[0] - b[0])
      const next = due[0]
      if (!next) break
      const [id, timer] = next
      this.time = timer.at
      this.timers.delete(id)
      if (timer.interval) this.timers.set(id, { ...timer, at: timer.at + timer.interval })
      await timer.run()
      await this.flush()
    }
    this.time = target
    await this.flush()
  }
  reset(startMs = 0): void {
    this.time = startMs
    this.timers.clear()
  }
  private addTimer(run: Timer['run'], delayMs: number, interval?: number): number {
    if (delayMs < 0) throw new Error('timer delay must be non-negative')
    const id = this.nextId++
    const timer: Timer = { at: this.time + delayMs, run }
    if (interval !== undefined) timer.interval = interval
    this.timers.set(id, timer)
    return id
  }
}

export function createDeferred<T>() {
  let status: 'pending' | 'fulfilled' | 'rejected' = 'pending'
  let resolvePromise!: (value: T | PromiseLike<T>) => void
  let rejectPromise!: (reason?: unknown) => void
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return {
    promise,
    resolve(value: T) {
      if (status === 'pending') {
        status = 'fulfilled'
        resolvePromise(value)
      }
    },
    reject(reason: unknown) {
      if (status === 'pending') {
        status = 'rejected'
        rejectPromise(reason)
      }
    },
    state: () => status,
  }
}

export function createLeaseHarness(script: LeaseClaim[], maxCalls = 64) {
  const initial = [...script]
  let claims = [...initial]
  const calls: Array<{ operation: string; args: unknown[] }> = []
  const record = (operation: string, args: unknown[]) => {
    if (calls.length >= maxCalls) throw new Error('lease call limit exceeded')
    calls.push({ operation, args })
  }
  const succeeds =
    (operation: string) =>
    async (...args: unknown[]) => {
      record(operation, args)
      return true
    }
  const store = {
    async claim(...args: Parameters<ComprobanteLeaseStore['claim']>) {
      record('claim', args)
      return claims.shift() ?? { kind: 'follower' as const }
    },
    heartbeat: succeeds('heartbeat'),
    complete: succeeds('complete'),
    failOrdinary: succeeds('failOrdinary'),
    failTimeout: succeeds('failTimeout'),
  } as ComprobanteLeaseStore
  return {
    store,
    calls,
    reset() {
      calls.splice(0)
      claims = [...initial]
    },
  }
}
