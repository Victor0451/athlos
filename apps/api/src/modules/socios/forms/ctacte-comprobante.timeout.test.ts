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
    rendered.reject(new Error('late renderer rejection'))
    await clock.flush()
    expect(clock.pendingCount()).toBe(0)
  })

  it('times out a follower without durable writes and uses the same remaining budget after takeover', async () => {
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
    await takeoverClock.advanceBy(250)
    await takeoverClock.advanceBy(REQUEST_DEADLINE_MS - 250)
    await expect(takeover).rejects.toMatchObject({ role: 'owner', live: false })
    expect(loseTimeout).toHaveBeenCalledOnce()
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
