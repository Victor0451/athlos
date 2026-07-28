import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  acquireClosureLease,
  createClosurePreview,
  previewFingerprint,
  releaseClosureLease,
  renewClosureLease,
} from './evidence-closure.ts'

const url = process.env.ATHLOS_TEST_DATABASE_URL
const schema = `closure_${randomUUID().replaceAll('-', '')}`
const q = `"${schema}"`
let pool: Pool
const migration = readFileSync(
  join(import.meta.dirname, '..', 'drizzle', '0041_socios_evidence_closure_preview.sql'),
  'utf8',
)
  .replaceAll('socios.', `${q}.`)
  .replaceAll('public.raw_events', `${q}.raw_events`)
beforeAll(async () => {
  if (!url) throw new Error('ATHLOS_TEST_DATABASE_URL is required')
  pool = new Pool({ connectionString: url })
  await pool.query(
    `CREATE SCHEMA ${q}; CREATE TABLE ${q}.raw_events (id uuid PRIMARY KEY, source_table text NOT NULL, import_batch uuid NOT NULL, content_hash text NOT NULL, payload jsonb NOT NULL); ${migration}`,
  )
})
afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${q} CASCADE`)
  await pool.end()
})

describe('socios evidence closure preview and lease', () => {
  it('binds both explicit batch IDs into canonical sanitized input identity', () => {
    const input = [{ sourceTable: 'socios', id: 'event', contentHash: 'a'.repeat(64) }]
    expect(previewFingerprint('catalog-a', 'socios-a', input)).toBe(
      previewFingerprint('catalog-a', 'socios-a', input),
    )
    expect(previewFingerprint('catalog-a', 'socios-a', input)).not.toBe(
      previewFingerprint('catalog-b', 'socios-a', input),
    )
    expect(previewFingerprint('catalog-a', 'socios-a', input)).not.toContain('event')
  })
  it('binds a preview to ordered content and invalidates it after an eligible input changes', async () => {
    const catalog = randomUUID(),
      socios = randomUUID()
    await pool.query(
      `INSERT INTO ${q}.raw_events VALUES ($1,'tiposoci',$2,$3,'{}'),($4,'socios',$5,$6,'{}')`,
      [randomUUID(), catalog, 'a'.repeat(64), randomUUID(), socios, 'b'.repeat(64)],
    )
    const first = await createClosurePreview(pool, schema, catalog, socios)
    await pool.query(`INSERT INTO ${q}.raw_events VALUES ($1,'socios',$2,$3,'{}')`, [
      randomUUID(),
      socios,
      'c'.repeat(64),
    ])
    const next = await createClosurePreview(pool, schema, catalog, socios)
    expect(first.fingerprint).not.toBe(next.fingerprint)
    expect(first).toMatchObject({
      catalogBatchId: catalog,
      sociosBatchId: socios,
      counts: { catalog: 1, socios: 1 },
    })
    expect(next.counts.socios).toBe(2)
  })
  it('allows one durable holder and fences an expired owner across independent connections', async () => {
    const key = 'a'.repeat(64),
      first = await pool.connect(),
      second = await pool.connect()
    try {
      const owner = await acquireClosureLease(
        first,
        schema,
        key,
        'first',
        new Date('2026-01-01T00:00:00Z'),
        1000,
      )
      const blocked = await acquireClosureLease(
        second,
        schema,
        key,
        'second',
        new Date('2026-01-01T00:00:00.500Z'),
        1000,
      )
      const successor = await acquireClosureLease(
        second,
        schema,
        key,
        'second',
        new Date('2026-01-01T00:00:02Z'),
        1000,
      )
      expect([owner, blocked, successor]).toEqual([
        { acquired: true, fence: 1 },
        { acquired: false },
        { acquired: true, fence: 2 },
      ])
    } finally {
      first.release()
      second.release()
    }
  })
  it('rejects stale renewal and release tokens while the current owner can renew then release', async () => {
    const key = 'd'.repeat(64),
      now = new Date('2026-01-01T00:00:00Z')
    const first = await acquireClosureLease(pool, schema, key, 'first', now, 1000)
    const second = await acquireClosureLease(
      pool,
      schema,
      key,
      'second',
      new Date(now.valueOf() + 2000),
      1000,
    )
    if (!first.acquired || !second.acquired) throw new Error('lease acquisition failed')
    expect(await renewClosureLease(pool, schema, key, 'first', first.fence, now, 1000)).toBe(false)
    expect(await releaseClosureLease(pool, schema, key, 'first', first.fence, now)).toBe(false)
    expect(await renewClosureLease(pool, schema, key, 'second', second.fence, now, 1000)).toBe(true)
    expect(await releaseClosureLease(pool, schema, key, 'second', second.fence, now)).toBe(true)
  })
  it('preserves released fences and rejects an expired owner release', async () => {
    const now = new Date('2026-01-01T00:00:00Z'),
      key = 'e'.repeat(64)
    const release = (key: string, fence: number, ms: number) =>
      releaseClosureLease(pool, schema, key, 'owner', fence, new Date(now.valueOf() + ms))
    const owner = await acquireClosureLease(pool, schema, key, 'owner', now, 1000)
    if (!owner.acquired) throw new Error('lease acquisition failed')
    expect(await release(key, owner.fence, 500)).toBe(true)
    await expect(
      acquireClosureLease(pool, schema, key, 'next', new Date(now.valueOf() + 500), 1000),
    ).resolves.toEqual({ acquired: true, fence: 2 })
    const expired = await acquireClosureLease(pool, schema, 'f'.repeat(64), 'owner', now, 1000)
    if (!expired.acquired) throw new Error('lease acquisition failed')
    await expect(release('f'.repeat(64), expired.fence, 2000)).resolves.toBe(false)
  })
})
