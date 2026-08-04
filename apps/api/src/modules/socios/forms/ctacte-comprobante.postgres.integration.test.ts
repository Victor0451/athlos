import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderComprobante } from './ctacte-comprobante.ts'
import { createIsolatedComprobanteHarness } from './ctacte-comprobante.postgres-harness.test-support.ts'
import { ManualClock } from './ctacte-comprobante.timeout.test-support.ts'

const url = process.env['ATHLOS_TEST_DATABASE_URL']
let harness: Awaited<ReturnType<typeof createIsolatedComprobanteHarness>> | undefined

beforeEach(async () => {
  if (!url) throw new Error('ATHLOS_TEST_DATABASE_URL is required for PostgreSQL lease tests')
  harness = await createIsolatedComprobanteHarness(url)
})
afterEach(async () => {
  await harness?.cleanup()
  harness = undefined
})

describe('PostgreSQL comprobante lease', () => {
  it('atomically selects one owner across two independent database clients and protects completion by owner', async () => {
    if (!harness) throw new Error('PostgreSQL harness was not initialized')
    const { ownerStore, rivalStore: followerStore } = harness
    const now = Date.now()
    const [one, two] = await Promise.all([
      ownerStore.claim('key', 'fingerprint', 'owner-a', now, 1_000, 60_000),
      followerStore.claim('key', 'fingerprint', 'owner-b', now, 1_000, 60_000),
    ])
    expect([one.kind, two.kind].filter((kind) => kind === 'owner')).toHaveLength(1)
    const owner = one.kind === 'owner' ? ownerStore : followerStore
    const ownerId = one.kind === 'owner' ? 'owner-a' : 'owner-b'
    const nonOwner = one.kind === 'owner' ? followerStore : ownerStore
    const nonOwnerId = one.kind === 'owner' ? 'owner-b' : 'owner-a'
    expect(
      await nonOwner.complete('key', nonOwnerId, {
        pdf: Buffer.from('%PDF-wrong'),
        filename: 'wrong.pdf',
        sha256: 'wrong',
        byteSize: 10,
        movementCount: 9,
      }),
    ).toBe(false)
    expect(
      await owner.complete('key', ownerId, {
        pdf: Buffer.from('%PDF-right'),
        filename: 'right.pdf',
        sha256: 'right',
        byteSize: 10,
        movementCount: 3,
      }),
    ).toBe(true)
    const replay = await followerStore.claim(
      'key',
      'fingerprint',
      'observer',
      now + 1,
      1_000,
      60_000,
    )
    expect(replay).toMatchObject({
      kind: 'complete',
      result: { filename: 'right.pdf', movementCount: 3 },
    })
  })

  it('reclaims a stale owner atomically and rejects the restarted owner completion', async () => {
    if (!harness) throw new Error('PostgreSQL harness was not initialized')
    const { ownerStore: formerOwner, rivalStore: reclaimer } = harness
    const now = Date.now()
    expect(
      await formerOwner.claim('stale-key', 'fingerprint', 'dead-instance', now, 1, 60_000),
    ).toMatchObject({
      kind: 'owner',
    })
    const claim = await reclaimer.claim(
      'stale-key',
      'fingerprint',
      'new-instance',
      now + 10,
      1_000,
      60_000,
    )
    expect(claim).toMatchObject({ kind: 'owner' })
    expect(
      await formerOwner.complete('stale-key', 'dead-instance', {
        pdf: Buffer.from('%PDF-old'),
        filename: 'old.pdf',
        sha256: 'old',
        byteSize: 8,
        movementCount: 1,
      }),
    ).toBe(false)
    expect(
      await reclaimer.complete('stale-key', 'new-instance', {
        pdf: Buffer.from('%PDF-new'),
        filename: 'new.pdf',
        sha256: 'new',
        byteSize: 8,
        movementCount: 2,
      }),
    ).toBe(true)
  })

  it('conflicts on a changed fingerprint and lets an expired completed result start a new owner attempt', async () => {
    if (!harness) throw new Error('PostgreSQL harness was not initialized')
    const { ownerStore: store } = harness
    const now = Date.now()
    expect(await store.claim('expiry-key', 'range-a', 'owner-a', now, 1_000, 1)).toMatchObject({
      kind: 'owner',
    })
    await store.complete('expiry-key', 'owner-a', {
      pdf: Buffer.from('%PDF-a'),
      filename: 'a.pdf',
      sha256: 'a',
      byteSize: 6,
      movementCount: 1,
    })
    expect(
      await store.claim('expiry-key', 'range-b', 'owner-b', now + 2, 1_000, 60_000),
    ).toMatchObject({ kind: 'owner' })
  })

  it('rejects a changed fingerprint before reclaiming failed and stale rows', async () => {
    if (!harness) throw new Error('PostgreSQL harness was not initialized')
    const { ownerStore: original, rivalStore: retry } = harness
    const now = Date.now()

    expect(
      await original.claim('failed-key', 'range-a', 'owner-a', now, 1_000, 60_000),
    ).toMatchObject({
      kind: 'owner',
    })
    expect(await original.failOrdinary('failed-key', 'owner-a')).toBe(true)
    await expect(
      retry.claim('failed-key', 'range-b', 'owner-b', now + 1, 1_000, 60_000),
    ).resolves.toEqual({ kind: 'conflict' })

    expect(await original.claim('stale-key', 'range-a', 'owner-a', now, 1, 60_000)).toMatchObject({
      kind: 'owner',
    })
    await expect(
      retry.claim('stale-key', 'range-b', 'owner-b', now + 2, 1_000, 60_000),
    ).resolves.toEqual({ kind: 'conflict' })
  })

  it('persists timeout, reclaims ordinary failure, and fences both race orders', async () => {
    if (!harness) throw new Error('PostgreSQL harness was not initialized')
    const { ownerStore: owner, rivalStore: rival } = harness
    const now = Date.now()
    const result = {
      pdf: Buffer.from('ok'),
      filename: 'ok.pdf',
      sha256: 'sha',
      byteSize: 2,
      movementCount: 1,
    }
    expect(await owner.claim('timeout', 'same', 'a', now, 100, 60_000)).toEqual({ kind: 'owner' })
    expect(await rival.failTimeout('timeout', 'b')).toBe(false)
    expect(await owner.failTimeout('timeout', 'a')).toBe(true)
    expect(await rival.claim('timeout', 'same', 'b', now, 100, 60_000)).toEqual({
      kind: 'terminal-timeout',
    })
    expect(await rival.claim('timeout', 'changed', 'b', now, 100, 60_000)).toEqual({
      kind: 'conflict',
    })
    expect(await owner.complete('timeout', 'a', result)).toBe(false)
    expect(await owner.claim('ordinary', 'same', 'a', now, 100, 60_000)).toEqual({ kind: 'owner' })
    expect(await owner.failOrdinary('ordinary', 'a')).toBe(true)
    expect(await rival.claim('ordinary', 'same', 'b', now, 100, 60_000)).toEqual({ kind: 'owner' })
    expect(await rival.complete('ordinary', 'b', result)).toBe(true)
    expect(await rival.failTimeout('ordinary', 'b')).toBe(false)
  })

  it('linearizes an owner deadline against late completion and leaves a healthy owner unchanged by a follower', async () => {
    if (!harness) throw new Error('PostgreSQL harness was not initialized')
    const { ownerStore: owner, rivalStore: follower } = harness
    const now = Date.now()
    const result = {
      pdf: Buffer.from('late'),
      filename: 'late.pdf',
      sha256: 'late',
      byteSize: 4,
      movementCount: 1,
    }

    expect(await owner.claim('deadline-race', 'same', 'owner', now, 5_000, 60_000)).toEqual({
      kind: 'owner',
    })
    const [failed, completed] = await Promise.all([
      owner.failTimeout('deadline-race', 'owner'),
      follower.complete('deadline-race', 'owner', result),
    ])
    expect([failed, completed].filter(Boolean)).toHaveLength(1)
    expect(await harness.snapshot('deadline-race')).toEqual(
      failed
        ? expect.objectContaining({
            status: 'failed',
            failure_reason: 'RENDER_TIMEOUT',
            pdf_base64: null,
          })
        : expect.objectContaining({ status: 'complete', failure_reason: null }),
    )

    expect(await owner.claim('healthy-owner', 'same', 'owner', now, 5_000, 60_000)).toEqual({
      kind: 'owner',
    })
    expect(
      await follower.claim('healthy-owner', 'same', 'follower', now + 1, 5_000, 60_000),
    ).toEqual({ kind: 'follower' })
    expect(await harness.snapshot('healthy-owner')).toMatchObject({
      status: 'rendering',
      lease_owner: 'owner',
      failure_reason: null,
    })
  })

  it('drives a real follower deadline without mutating its healthy owner and fences late audit publication', async () => {
    if (!harness) throw new Error('PostgreSQL harness was not initialized')
    const activeHarness = harness
    const key = `deadline-${activeHarness.schema}`
    const entityId = `entity-${activeHarness.schema}`
    const now = Date.UTC(2026, 0, 1)
    const fingerprint = 'b44e9496ab7e46d76a163ee32bfa2964858e7ecb28ac99bd109b55df3d6603f2'
    const result = {
      pdf: Buffer.from('%PDF-late'),
      filename: 'late.pdf',
      sha256: 'late-sha',
      byteSize: 9,
      movementCount: 4,
    }
    expect(
      await activeHarness.ownerStore.claim(key, fingerprint, 'healthy', now, 60_000, 60_000),
    ).toEqual({
      kind: 'owner',
    })
    const clock = new ManualClock(now)
    const follower = renderComprobante({
      socioId: 's-1',
      cuenta: 'principal',
      operatorId: 'o-1',
      from: '2026-07-01',
      to: '2026-07-31',
      idempotencyKey: key,
      db: {} as never,
      leaseStore: activeHarness.rivalStore,
      pdfGenerator: { generate: async () => Buffer.from('%PDF-unused') } as never,
      now: clock.now,
      timers: clock,
    })
    await clock.flush()
    const beforeFollowerDeadline = await activeHarness.snapshot(key)
    expect(beforeFollowerDeadline).toMatchObject({
      status: 'rendering',
      lease_owner: 'healthy',
      failure_reason: null,
      attempt_count: 1,
    })
    await clock.advanceBy(30_000)
    await expect(follower).rejects.toMatchObject({ role: 'follower', live: true })
    expect(await activeHarness.snapshot(key)).toEqual(beforeFollowerDeadline)
    expect(clock.pendingCount()).toBe(0)

    const barrier = activeHarness.createBarrier()
    const lateCompletion = activeHarness.completeAndPublish({
      store: activeHarness.ownerStore,
      key,
      owner: 'healthy',
      entityId,
      result,
      barrier,
    })
    await barrier.entered
    expect(await activeHarness.rivalStore.failTimeout(key, 'healthy')).toBe(true)
    const timedOut = await activeHarness.snapshot(key)
    expect(timedOut).toMatchObject({
      status: 'failed',
      failure_reason: 'RENDER_TIMEOUT',
      lease_owner: null,
      pdf_base64: null,
      sha256: null,
    })
    barrier.release()
    await expect(lateCompletion).resolves.toBe(false)
    expect(await activeHarness.snapshot(key)).toEqual(timedOut)
    await expect(
      activeHarness.observePrintedAudit({
        key,
        entityId,
        expectedCount: 0,
        timeoutMs: 40,
        pollMs: 5,
      }),
    ).resolves.toBe(0)
  })
})
