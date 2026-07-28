import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createDb } from '@athlos/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClosurePreview, validateClosurePreview } from './evidence-closure-boundary.ts'

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
const { pool } = createDb({ connectionString: url ?? '' })

beforeAll(async () => {
  if (!url) throw new Error('ATHLOS_TEST_DATABASE_URL is required')
  await pool.query(
    `CREATE SCHEMA ${q}; CREATE TABLE ${q}.raw_events (id uuid PRIMARY KEY, source_table text NOT NULL, import_batch uuid NOT NULL, content_hash text NOT NULL, payload jsonb NOT NULL); ${sql}`,
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
})
