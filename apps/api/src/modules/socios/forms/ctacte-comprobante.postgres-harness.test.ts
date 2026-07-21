import { afterAll, describe, expect, it } from 'vitest'
import {
  createIsolatedComprobanteHarness,
  schemaExists,
} from './ctacte-comprobante.postgres-harness.test-support.ts'

const databaseUrl = process.env['ATHLOS_TEST_DATABASE_URL']
const harnesses: Array<Awaited<ReturnType<typeof createIsolatedComprobanteHarness>>> = []

afterAll(async () => {
  await Promise.allSettled(harnesses.map((harness) => harness.cleanup()))
})

describe('isolated PostgreSQL comprobante harness', () => {
  it('bounds a real fenced completion, preserves full state, and cleans up only its schema', async () => {
    if (!databaseUrl) throw new Error('ATHLOS_TEST_DATABASE_URL is required')
    const beforeGlobal = await schemaExists(databaseUrl, 'tesoreria')

    const harness = await createIsolatedComprobanteHarness(databaseUrl, { barrierTimeoutMs: 500 })
    harnesses.push(harness)
    expect(harness.schema).toMatch(/^tesoreria_s4b_[0-9a-f]{24}$/)
    expect(await schemaExists(databaseUrl, harness.schema)).toBe(true)

    const key = `harness-${harness.schema}`
    const entityId = `entity-${harness.schema}`
    const now = Date.now()
    expect(await harness.ownerStore.claim(key, 'fingerprint', 'owner', now, 5_000, 60_000)).toEqual(
      {
        kind: 'owner',
      },
    )
    const beforeFence = await harness.snapshot(key)
    expect(beforeFence).toMatchObject({
      status: 'rendering',
      failure_reason: null,
      lease_owner: 'owner',
      pdf_base64: null,
      attempt_count: 1,
    })
    expect(beforeFence?.lease_expires_at).toBeInstanceOf(Date)
    expect(beforeFence?.updated_at).toBeInstanceOf(Date)

    const barrier = harness.createBarrier()
    const completion = harness.completeAndPublish({
      store: harness.ownerStore,
      key,
      owner: 'owner',
      entityId,
      result: {
        pdf: Buffer.from('%PDF-late'),
        filename: 'late.pdf',
        sha256: 'late-sha',
        byteSize: 9,
        movementCount: 4,
      },
      barrier,
    })
    try {
      await barrier.entered
      expect(await harness.rivalStore.failTimeout(key, 'owner')).toBe(true)
      const fencedState = await harness.snapshot(key)
      barrier.release()
      await expect(completion).resolves.toBe(false)
      expect(await harness.snapshot(key)).toEqual(fencedState)
      expect(fencedState).toMatchObject({
        status: 'failed',
        failure_reason: 'RENDER_TIMEOUT',
        lease_owner: null,
        lease_expires_at: null,
        pdf_base64: null,
        sha256: null,
        byte_size: null,
        filename: null,
        movement_count: null,
        attempt_count: 1,
      })
      await expect(
        harness.observePrintedAudit({ key, entityId, expectedCount: 0, timeoutMs: 40, pollMs: 5 }),
      ).resolves.toBe(0)
    } finally {
      barrier.release()
      await completion.catch(() => undefined)
    }

    const cleanupBarrier = harness.createBarrier()
    const pending = cleanupBarrier.wait()
    await cleanupBarrier.entered
    const ownedSchema = harness.schema
    await harness.cleanup()
    await expect(pending).resolves.toBeUndefined()
    expect(await schemaExists(databaseUrl, ownedSchema)).toBe(false)
    expect(await schemaExists(databaseUrl, 'tesoreria')).toBe(beforeGlobal)
  })
})
