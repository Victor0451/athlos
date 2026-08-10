import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '@athlos/db'
import { makeSociosEvidenceClosureHandler } from './socios-evidence-closure.ts'
const url = process.env.ATHLOS_TEST_DATABASE_URL
const schema = `closure_runner_${randomUUID().replaceAll('-', '')}`
const q = `"${schema}"`
let pool: ReturnType<typeof createDb>['pool']
const sql = (text: string) => text.replaceAll('"socios".', `${q}.`).replaceAll('socios.', `${q}.`)
// prettier-ignore
const source = { query: (text: string, values?: unknown[]) => pool.query(sql(text), values), connect: async () => { const client = await pool.connect(); return { query: (text: string, values?: unknown[]) => client.query(sql(text), values), release: () => client.release() } } }
// prettier-ignore
const migration = (name: string) => readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'packages', 'db', 'drizzle', name), 'utf8').replaceAll('socios.', `${q}.`).replaceAll('public.raw_events', `${q}.raw_events`)
// prettier-ignore
async function seed(catalogBatchId: string, sociosBatchId: string) {
  const [catalogEvent, member, event, identity] = Array.from({ length: 4 }, randomUUID)
  await Promise.all([pool.query(`INSERT INTO ${q}.raw_events VALUES ($1, 'tiposoci', '4', $2, $3, $4)`, [catalogEvent, 'a'.repeat(64), { RECORD_ORDINAL: 1, TSOCODIGO: '4', TSONOMBRE: 'Four', TSOLETRA: 'F' }, catalogBatchId]), pool.query(`INSERT INTO ${q}.member_identities VALUES ($1)`, [member])])
  await pool.query(`INSERT INTO ${q}.raw_events VALUES ($1, 'socios', '1', $2, $3, $4)`, [event, 'b'.repeat(64), { SOCTIPSOCI: '4', SOCCATEGOR: 'A', SOCIMPCUOT: '1' }, sociosBatchId])
  await pool.query(`INSERT INTO ${q}.legacy_identity_evidence VALUES ($1, $2, $3, 'validated')`, [identity, event, member])
}
describe('Socios closure runner (PostgreSQL)', () => {
  beforeAll(async () => {
    if (!url) throw new Error('ATHLOS_TEST_DATABASE_URL is required')
    pool = createDb({ connectionString: url }).pool
    await pool.query(`CREATE SCHEMA ${q}; CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE TABLE ${q}.raw_events (id uuid PRIMARY KEY, source_table text NOT NULL, source_key text NOT NULL, content_hash text NOT NULL, payload jsonb NOT NULL, import_batch uuid NOT NULL);
      CREATE TABLE ${q}.member_identities (id uuid PRIMARY KEY);
      CREATE TABLE ${q}.legacy_identity_evidence (id uuid PRIMARY KEY, raw_event_id uuid NOT NULL, member_id uuid, review_state text NOT NULL);
      SET search_path TO ${q}, public; ${migration('0038_socios_legacy_membership_evidence.sql')}; ${migration('0039_socios_legacy_member_evidence.sql')}; ${migration('0040_socios_closure_receipts.sql')}; ${migration('0041_socios_evidence_closure_preview.sql')}; ${migration('0043_socios_closure_phase_receipts.sql')}`)
  })
  // prettier-ignore
  afterAll(async () => { await pool.query(`DROP SCHEMA IF EXISTS ${q} CASCADE`); await pool.end() })
  it('executes real catalog/candidate/member receipts in order, resumes, and rejects a changed catalog binding', async () => {
    const [catalogBatchId, sociosBatchId] = [randomUUID(), randomUUID()]
    const handler = makeSociosEvidenceClosureHandler(source)
    await seed(catalogBatchId, sociosBatchId)
    // prettier-ignore
    const metadata = { catalogBatchId, sociosBatchId, previewId: randomUUID(), fingerprint: 'f'.repeat(64), idempotencyKey: randomUUID(), leaseOwner: randomUUID(), leaseFence: 1 }
    const ctx = { metadata, signal: new AbortController().signal, log: { info() {} } } as never
    // prettier-ignore
    await pool.query(`INSERT INTO ${q}.evidence_closure_leases (pair_fingerprint, owner, fence, expires_at) VALUES ($1, $2, 1, now() + interval '1 hour')`, [metadata.fingerprint, metadata.leaseOwner])
    await expect(handler(ctx)).resolves.toMatchObject({ status: 'succeeded' })
    await expect(handler(ctx)).resolves.toMatchObject({ status: 'succeeded' })
    const { rows } = await pool.query(
      `SELECT phase, status FROM ${q}.evidence_closure_phase_receipts ORDER BY phase`,
    )
    expect(rows.map(({ phase, status }) => `${phase}:${status}`)).toEqual([
      'candidates:committed',
      'members:committed',
    ])
    await pool.query(
      `UPDATE ${q}.raw_events SET content_hash = 'changed' WHERE import_batch = $1`,
      [catalogBatchId],
    )
    await expect(handler(ctx)).rejects.toThrow('incompatible catalog receipt binding')
  })
})
