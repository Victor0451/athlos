import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb } from '@athlos/db'
import { createPostgresComprobanteLeaseStore } from './ctacte-comprobante.ts'

const url = process.env['ATHLOS_TEST_DATABASE_URL']
let first: ReturnType<typeof createDb> | undefined
let second: ReturnType<typeof createDb> | undefined

beforeAll(async () => {
  if (!url) throw new Error('ATHLOS_TEST_DATABASE_URL is required for PostgreSQL lease tests')
  first = createDb({ connectionString: url })
  second = createDb({ connectionString: url })
  await first.pool.query('SELECT 1')
})
beforeEach(async () => {
  if (!first) return
  await first.pool.query(`DROP SCHEMA IF EXISTS tesoreria CASCADE; CREATE SCHEMA tesoreria;
    CREATE TABLE tesoreria.ctacte_comprobante_retries (
       idempotency_key text PRIMARY KEY, request_fingerprint text NOT NULL, status text NOT NULL, pdf_base64 text, sha256 text,
      byte_size integer, filename text, movement_count integer, failure_reason text, lease_owner text,
      lease_expires_at timestamptz, attempt_count integer NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`)
})
afterAll(async () => {
  await first?.pool.end()
  await second?.pool.end()
})

describe('PostgreSQL comprobante lease', () => {
  it('atomically selects one owner across two independent database clients and protects completion by owner', async () => {
    if (!first || !second) throw new Error('PostgreSQL clients were not initialized')
    const ownerStore = createPostgresComprobanteLeaseStore(first.db)
    const followerStore = createPostgresComprobanteLeaseStore(second.db)
    const now = Date.now()
    const [one, two] = await Promise.all([
      ownerStore.claim('key', 'fingerprint', 'owner-a', now, 1_000, 60_000),
      followerStore.claim('key', 'fingerprint', 'owner-b', now, 1_000, 60_000),
    ])
    expect([one.kind, two.kind].filter((kind) => kind === 'owner')).toHaveLength(1)
    expect(
      await followerStore.complete('key', 'owner-b', {
        pdf: Buffer.from('%PDF-wrong'),
        filename: 'wrong.pdf',
        sha256: 'wrong',
        byteSize: 10,
        movementCount: 9,
      }),
    ).toBe(false)
    const owner = one.kind === 'owner' ? ownerStore : followerStore
    const ownerId = one.kind === 'owner' ? 'owner-a' : 'owner-b'
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
    if (!first || !second) throw new Error('PostgreSQL clients were not initialized')
    const formerOwner = createPostgresComprobanteLeaseStore(first.db)
    const reclaimer = createPostgresComprobanteLeaseStore(second.db)
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
    if (!first || !second) throw new Error('PostgreSQL clients were not initialized')
    const store = createPostgresComprobanteLeaseStore(first.db)
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
    if (!first || !second) throw new Error('PostgreSQL clients were not initialized')
    const original = createPostgresComprobanteLeaseStore(first.db)
    const retry = createPostgresComprobanteLeaseStore(second.db)
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
    if (!first || !second) throw new Error('PostgreSQL clients were not initialized')
    const owner = createPostgresComprobanteLeaseStore(first.db)
    const rival = createPostgresComprobanteLeaseStore(second.db)
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
})
