import { describe, expect, it, vi } from 'vitest'
import { REQUEST_DEADLINE_MS, renderComprobante } from './ctacte-comprobante.ts'
import {
  createDeferred,
  createLeaseHarness,
  ManualClock,
} from './ctacte-comprobante.timeout.test-support.ts'

vi.mock('./ctacte-mutations.ts', () => ({
  getMovementsForComprobante: vi.fn().mockResolvedValue([]),
}))
vi.mock('../repository.ts', () => ({
  findById: vi
    .fn()
    .mockResolvedValue({ id: 's-1', numeroSocio: '1', apellido: 'A', nombre: 'B', dni: '1' }),
}))
vi.mock('@athlos/audit', () => ({ emitAudit: vi.fn().mockResolvedValue({ inserted: true }) }))

function params(
  clock: ManualClock,
  leaseStore: ReturnType<typeof createLeaseHarness>['store'],
  generate: (html: string, options?: { signal?: AbortSignal }) => Promise<Buffer>,
) {
  return {
    socioId: 's-1',
    cuenta: 'principal',
    operatorId: 'o-1',
    from: '2026-07-01',
    to: '2026-07-31',
    idempotencyKey: 'deadline-key',
    db: {} as never,
    leaseStore,
    pdfGenerator: { generate } as never,
    now: clock.now,
    timers: clock,
  }
}

describe('renderComprobante fixed request deadline', () => {
  it('keeps a successful owner inside one 30-second budget while renewing only the 5-second lease', async () => {
    const clock = new ManualClock()
    const lease = createLeaseHarness([{ kind: 'owner' }])
    const rendered = createDeferred<Buffer>()
    const result = renderComprobante(params(clock, lease.store, () => rendered.promise))
    await clock.flush()
    await clock.advanceBy(29_999)
    expect(lease.calls.filter((call) => call.operation === 'heartbeat').length).toBeGreaterThan(1)
    expect(lease.calls.every((call) => call.operation !== 'failTimeout')).toBe(true)
    rendered.resolve(Buffer.from('%PDF-ok'))
    await expect(result).resolves.toMatchObject({ movementCount: 0 })
    expect(clock.pendingCount()).toBe(0)
  })

  it('aborts and terminally fails only the active owner at exactly 30 seconds, observing late rejection', async () => {
    const clock = new ManualClock()
    const lease = createLeaseHarness([{ kind: 'owner' }])
    const rendered = createDeferred<Buffer>()
    let signal: AbortSignal | undefined
    const result = renderComprobante(
      params(clock, lease.store, (_html, options) => {
        signal = options?.signal
        return rendered.promise
      }),
    )
    await clock.flush()
    await clock.advanceBy(REQUEST_DEADLINE_MS - 1)
    expect(signal?.aborted).toBe(false)
    await clock.advanceBy(1)
    await expect(result).rejects.toMatchObject({
      code: 'RENDER_TIMEOUT',
      role: 'owner',
      live: true,
    })
    expect(signal?.aborted).toBe(true)
    expect(lease.calls.filter((call) => call.operation === 'failTimeout')).toHaveLength(1)
    const unhandled = vi.fn()
    process.once('unhandledRejection', unhandled)
    rendered.reject(new Error('late renderer rejection'))
    await clock.flush()
    await Promise.resolve()
    expect(unhandled).not.toHaveBeenCalled()
    process.removeListener('unhandledRejection', unhandled)
    expect(clock.pendingCount()).toBe(0)
  })

  it('lets completion win before the deadline and observes a late resolve after timeout', async () => {
    const completeFirstClock = new ManualClock()
    const completeFirstLease = createLeaseHarness([{ kind: 'owner' }])
    const completeFirst = createDeferred<Buffer>()
    const completed = renderComprobante(
      params(completeFirstClock, completeFirstLease.store, () => completeFirst.promise),
    )
    await completeFirstClock.flush()
    await completeFirstClock.advanceBy(REQUEST_DEADLINE_MS - 1)
    completeFirst.resolve(Buffer.from('%PDF-complete-first'))
    await expect(completed).resolves.toMatchObject({ movementCount: 0 })
    expect(
      completeFirstLease.calls.filter((call) => call.operation === 'failTimeout'),
    ).toHaveLength(0)
    expect(completeFirstClock.pendingCount()).toBe(0)

    const timeoutClock = new ManualClock()
    const timeoutLease = createLeaseHarness([{ kind: 'owner' }])
    const late = createDeferred<Buffer>()
    const timedOut = renderComprobante(params(timeoutClock, timeoutLease.store, () => late.promise))
    await timeoutClock.flush()
    await timeoutClock.advanceBy(REQUEST_DEADLINE_MS)
    await expect(timedOut).rejects.toMatchObject({ role: 'owner', live: true })
    late.resolve(Buffer.from('%PDF-late'))
    await timeoutClock.flush()
    expect(timeoutLease.calls.filter((call) => call.operation === 'complete')).toHaveLength(1)
    expect(timeoutClock.pendingCount()).toBe(0)
  })

  it('times out a follower without durable writes and gives a stale takeover only its remaining budget', async () => {
    const followerClock = new ManualClock()
    const followerLease = createLeaseHarness([{ kind: 'follower' }])
    const follower = renderComprobante(params(followerClock, followerLease.store, vi.fn()))
    await followerClock.advanceBy(REQUEST_DEADLINE_MS)
    await expect(follower).rejects.toMatchObject({ role: 'follower', live: true })
    expect(followerLease.calls.filter((call) => call.operation.startsWith('fail'))).toHaveLength(0)

    const takeoverClock = new ManualClock()
    const takeoverLease = createLeaseHarness([{ kind: 'follower' }, { kind: 'owner' }])
    const rendered = createDeferred<Buffer>()
    const loseTimeout = vi.fn(async () => false)
    takeoverLease.store.failTimeout = loseTimeout
    const takeover = renderComprobante(
      params(takeoverClock, takeoverLease.store, () => rendered.promise),
    )
    await takeoverClock.flush()
    await takeoverClock.advanceBy(15)
    await takeoverClock.advanceBy(REQUEST_DEADLINE_MS - 15)
    await expect(takeover).rejects.toMatchObject({ role: 'owner', live: false })
    expect(loseTimeout).toHaveBeenCalledOnce()
    expect(takeoverLease.calls.filter((call) => call.operation === 'claim').length).toBeGreaterThan(
      1,
    )
    expect(takeoverClock.pendingCount()).toBe(0)
  })

  it('replays a stored terminal timeout without rendering or counting it as live', async () => {
    const clock = new ManualClock()
    const lease = createLeaseHarness([{ kind: 'terminal-timeout' }])
    const generate = vi.fn()
    await expect(renderComprobante(params(clock, lease.store, generate))).rejects.toMatchObject({
      code: 'RENDER_TIMEOUT',
      live: false,
    })
    expect(generate).not.toHaveBeenCalled()
    expect(clock.pendingCount()).toBe(0)
  })
})
