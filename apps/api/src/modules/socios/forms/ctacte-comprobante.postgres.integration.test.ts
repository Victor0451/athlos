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
      byte_size integer, filename text, movement_count integer, lease_owner text,
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
})
