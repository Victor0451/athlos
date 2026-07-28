import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createDb } from '@athlos/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createClosurePreview,
  reserveClosureConfirmation,
  validateClosurePreview,
} from './evidence-closure-boundary.ts'

const url = process.env.ATHLOS_TEST_DATABASE_URL
const schema = `closure_boundary_${randomUUID().replaceAll('-', '')}`
const q = `"${schema}"`
const sql = readFileSync(
  join(
    import.meta.dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    'packages',
    'db',
    'drizzle',
    '0041_socios_evidence_closure_preview.sql',
  ),
  'utf8',
)
  .replaceAll('socios.', `${q}.`)
  .replaceAll('public.raw_events', `${q}.raw_events`)
const confirmationSql = readFileSync(
  join(
    import.meta.dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    'packages',
    'db',
    'drizzle',
    '0042_socios_closure_confirmation_keys.sql',
  ),
  'utf8',
).replaceAll('socios.', `${q}.`)
const { pool } = createDb({ connectionString: url ?? '' })

beforeAll(async () => {
  if (!url) throw new Error('ATHLOS_TEST_DATABASE_URL is required')
  await pool.query(
    `CREATE SCHEMA ${q}; CREATE TABLE ${q}.raw_events (id uuid PRIMARY KEY, source_table text NOT NULL, import_batch uuid NOT NULL, content_hash text NOT NULL, payload jsonb NOT NULL); ${sql} ${confirmationSql} ${confirmationSql}`,
  )
})
afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${q} CASCADE`)
  await pool.end()
})
const seed = (table: string, batch: string) =>
  pool.query(`INSERT INTO ${q}.raw_events VALUES ($1,$2,$3,$4,'{}')`, [
    randomUUID(),
    table,
    batch,
    randomUUID().replaceAll('-', ''),
  ])

describe('closure preview boundary', () => {
  it('persists preview identity and rejects invalid or stale validation', async () => {
    const catalog = randomUUID(),
      socios = randomUUID()
    await Promise.all([seed('tiposoci', catalog), seed('socios', socios)])
    await expect(createClosurePreview(pool, schema, catalog, randomUUID())).rejects.toThrow(
      'invalid closure batch pair',
    )
    const wrongCatalog = randomUUID()
    await seed('socios', wrongCatalog)
    await expect(createClosurePreview(pool, schema, wrongCatalog, socios)).rejects.toThrow(
      'invalid closure batch pair',
    )
    await expect(createClosurePreview(pool, schema, catalog, catalog)).rejects.toThrow(
      'invalid closure batch pair',
    )
    await seed('socios', socios)
    const preview = await createClosurePreview(pool, schema, catalog, socios)
    expect(preview.counts).toEqual({ catalog: 1, socios: 2 })
    await expect(
      validateClosurePreview(pool, schema, preview.previewId, catalog, socios),
    ).resolves.toMatchObject({ outcome: 'fresh' })
    await expect(
      validateClosurePreview(pool, schema, randomUUID(), catalog, socios),
    ).resolves.toEqual({ outcome: 'missing' })
    await expect(
      validateClosurePreview(pool, schema, preview.previewId, socios, catalog),
    ).resolves.toEqual({ outcome: 'stale' })
    await seed('socios', socios)
    await expect(
      validateClosurePreview(pool, schema, preview.previewId, catalog, socios),
    ).resolves.toEqual({ outcome: 'stale' })
    await pool.query(
      `UPDATE ${q}.evidence_closure_previews SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [preview.previewId],
    )
    await expect(
      validateClosurePreview(pool, schema, preview.previewId, catalog, socios),
    ).resolves.toEqual({ outcome: 'stale' })
    const mixed = randomUUID()
    await Promise.all([seed('tiposoci', mixed), seed('socios', mixed)])
    await expect(createClosurePreview(pool, schema, mixed, socios)).rejects.toThrow(
      'invalid closure batch pair',
    )
    expect(preview).not.toHaveProperty('payload')
  })

  it('atomically reserves compatible keys, rejects incompatible keys, and never creates a lease', async () => {
    const catalog = randomUUID(),
      socios = randomUUID()
    await Promise.all([seed('tiposoci', catalog), seed('socios', socios)])
    const preview = await createClosurePreview(pool, schema, catalog, socios)
    const replayKey = randomUUID()
    const input = {
      catalogBatchId: catalog,
      sociosBatchId: socios,
      previewId: preview.previewId,
      fingerprint: preview.fingerprint,
      idempotencyKey: replayKey,
    }
    const [first, second] = await Promise.all([
      reserveClosureConfirmation(pool, schema, input),
      reserveClosureConfirmation(pool, schema, input),
    ])
    expect([first.outcome, second.outcome].sort()).toEqual(['replay', 'reserved'])
    await expect(
      pool.query(`SELECT count(*)::int AS count FROM ${q}.evidence_closure_confirmations`),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] })
    await seed('socios', socios)
    await expect(reserveClosureConfirmation(pool, schema, input)).resolves.toEqual({
      outcome: 'replay',
    })
    await expect(
      reserveClosureConfirmation(pool, schema, { ...input, idempotencyKey: randomUUID() }),
    ).resolves.toEqual({ outcome: 'stale' })
    const otherCatalog = randomUUID(),
      otherSocios = randomUUID()
    await Promise.all([seed('tiposoci', otherCatalog), seed('socios', otherSocios)])
    const otherPreview = await createClosurePreview(pool, schema, otherCatalog, otherSocios)
    await expect(
      reserveClosureConfirmation(pool, schema, {
        ...input,
        catalogBatchId: otherCatalog,
        sociosBatchId: otherSocios,
        previewId: otherPreview.previewId,
        fingerprint: otherPreview.fingerprint,
      }),
    ).resolves.toEqual({ outcome: 'conflict' })
    await expect(
      pool.query(
        `INSERT INTO ${q}.evidence_closure_confirmations (idempotency_key, catalog_batch_id, socios_batch_id, preview_id, fingerprint) VALUES ($1,$2,$3,$4,$5)`,
        [randomUUID(), randomUUID(), socios, preview.previewId, preview.fingerprint],
      ),
    ).rejects.toThrow()
    await expect(
      pool.query(`SELECT count(*)::int AS count FROM ${q}.evidence_closure_leases`),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] })
  })

  it('keeps the winning binding during a deterministic incompatible same-key race', async () => {
    const catalog = randomUUID(),
      socios = randomUUID(),
      otherCatalog = randomUUID(),
      otherSocios = randomUUID(),
      key = randomUUID()
    await Promise.all([
      seed('tiposoci', catalog),
      seed('socios', socios),
      seed('tiposoci', otherCatalog),
      seed('socios', otherSocios),
    ])
    const [preview, otherPreview] = await Promise.all([
      createClosurePreview(pool, schema, catalog, socios),
      createClosurePreview(pool, schema, otherCatalog, otherSocios),
    ])
    let releaseInsert!: () => void
    const insertHeld = new Promise<void>((resolve) => (releaseInsert = resolve))
    let enteredInsert!: () => void
    const insertEntered = new Promise<void>((resolve) => (enteredInsert = resolve))
    const heldPool = {
      query: async (text: string, values?: unknown[]) => {
        if (text.includes('INSERT INTO') && text.includes('evidence_closure_confirmations')) {
          enteredInsert()
          await insertHeld
        }
        return pool.query(text, values as never)
      },
    }
    const held = reserveClosureConfirmation(heldPool, schema, {
      catalogBatchId: otherCatalog,
      sociosBatchId: otherSocios,
      previewId: otherPreview.previewId,
      fingerprint: otherPreview.fingerprint,
      idempotencyKey: key,
    })
    await insertEntered
    const winner = await reserveClosureConfirmation(pool, schema, {
      catalogBatchId: catalog,
      sociosBatchId: socios,
      previewId: preview.previewId,
      fingerprint: preview.fingerprint,
      idempotencyKey: key,
    })
    releaseInsert()
    await expect(held).resolves.toEqual({ outcome: 'conflict' })
    expect(winner).toEqual({ outcome: 'reserved' })
    await expect(
      pool.query(
        `SELECT catalog_batch_id FROM ${q}.evidence_closure_confirmations WHERE idempotency_key = $1`,
        [key],
      ),
    ).resolves.toMatchObject({ rows: [{ catalog_batch_id: catalog }] })
  })
})
