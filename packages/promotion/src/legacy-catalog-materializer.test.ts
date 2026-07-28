import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  catalogInputHash,
  materializeLegacyMembershipCatalog,
  type SqlTransactionSource,
} from './legacy-catalog-materializer.ts'

const url = process.env.ATHLOS_TEST_DATABASE_URL
const schema = `catalog_materializer_${randomUUID().replaceAll('-', '')}`
const q = `"${schema}"`
let pool: Pool

function migration(name: string) {
  return readFileSync(join(import.meta.dirname, '..', '..', 'db', 'drizzle', name), 'utf8')
    .replaceAll('socios.', `${q}.`)
    .replaceAll('public.raw_events', `${q}.raw_events`)
}

async function seed(batchId: string, rows: readonly [number, string, string, string][]) {
  for (const [ordinal, code, name, hash] of rows) {
    await pool.query(
      `INSERT INTO ${q}.raw_events (id, source_table, source_key, content_hash, payload, import_batch)
       VALUES ($1, 'tiposoci', $2, $3, $4, $5)`,
      [
        randomUUID(),
        `${code}-${ordinal}`,
        hash,
        { RECORD_ORDINAL: ordinal, TSOCODIGO: code, TSONOMBRE: name, TSOLETRA: 'T' },
        batchId,
      ],
    )
  }
}

function source(): SqlTransactionSource {
  return {
    async acquire() {
      const client = await pool.connect()
      return { query: client.query.bind(client), release: () => client.release() }
    },
  }
}

describe('materializeLegacyMembershipCatalog', () => {
  beforeAll(async () => {
    if (!url) throw new Error('ATHLOS_TEST_DATABASE_URL is required')
    pool = new Pool({ connectionString: url })
    await pool.query(`CREATE SCHEMA ${q}; CREATE EXTENSION IF NOT EXISTS pgcrypto`)
    await pool.query(`CREATE TABLE ${q}.raw_events (
      id uuid PRIMARY KEY, source_table text NOT NULL, source_key text NOT NULL,
      content_hash text NOT NULL, payload jsonb NOT NULL, import_batch uuid NOT NULL
    ); SET search_path TO ${q}, public; ${migration('0038_socios_legacy_membership_evidence.sql')}; ${migration('0040_socios_closure_receipts.sql')}`)
  })

  it('hashes ordered source identity without raw payload content', () => {
    const first = catalogInputHash([
      { id: 'event-a', recordOrdinal: '1', contentHash: 'a'.repeat(64) },
      { id: 'event-b', recordOrdinal: '2', contentHash: 'b'.repeat(64) },
    ])
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(first).toBe(
      catalogInputHash([
        { id: 'event-a', recordOrdinal: '1', contentHash: 'a'.repeat(64) },
        { id: 'event-b', recordOrdinal: '2', contentHash: 'b'.repeat(64) },
      ]),
    )
    expect(first).not.toBe(
      catalogInputHash([
        { id: 'event-a', recordOrdinal: '2', contentHash: 'a'.repeat(64) },
        { id: 'event-b', recordOrdinal: '1', contentHash: 'b'.repeat(64) },
      ]),
    )
  })

  afterAll(async () => {
    if (!pool) return
    await pool.query(`DROP SCHEMA IF EXISTS ${q} CASCADE`)
    await pool.end()
  })

  it('preserves duplicate occurrences, source ordinal/hash and one durable receipt on replay', async () => {
    const batchId = randomUUID()
    await seed(batchId, [
      [1, '4', 'Active', 'a'.repeat(64)],
      [2, '4', 'Active', 'b'.repeat(64)],
    ])

    await materializeLegacyMembershipCatalog(source(), batchId, schema)
    await materializeLegacyMembershipCatalog(source(), batchId, schema)

    expect(
      (
        await pool.query(
          `SELECT record_ordinal, content_hash, batch_id FROM ${q}.legacy_membership_type_source_rows ORDER BY record_ordinal`,
        )
      ).rows,
    ).toEqual([
      { record_ordinal: 1, content_hash: 'a'.repeat(64), batch_id: batchId },
      { record_ordinal: 2, content_hash: 'b'.repeat(64), batch_id: batchId },
    ])
    expect(
      (
        await pool.query(
          `SELECT eligible_source_row_count, materialized_source_row_count, failed_source_row_count, outcome
           FROM ${q}.legacy_catalog_materialization_receipts`,
        )
      ).rows,
    ).toEqual([
      {
        eligible_source_row_count: 2,
        materialized_source_row_count: 2,
        failed_source_row_count: 0,
        outcome: 'materialized',
      },
    ])
  })

  it('preserves distinct raw events that share an ordinal and replays them once', async () => {
    const batchId = randomUUID()
    await seed(batchId, [
      [1, '4', 'Active', 'e'.repeat(64)],
      [1, '4', 'Active revised', 'f'.repeat(64)],
    ])

    await materializeLegacyMembershipCatalog(source(), batchId, schema)
    await materializeLegacyMembershipCatalog(source(), batchId, schema)

    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS count FROM ${q}.legacy_membership_type_source_rows WHERE batch_id = $1`,
          [batchId],
        )
      ).rows,
    ).toEqual([{ count: 2 }])
    expect(
      (
        await pool.query(
          `SELECT eligible_source_row_count, materialized_source_row_count FROM ${q}.legacy_catalog_materialization_receipts WHERE batch_id = $1`,
          [batchId],
        )
      ).rows,
    ).toEqual([{ eligible_source_row_count: 2, materialized_source_row_count: 2 }])
  })

  it('rejects a batch without tiposoci input without creating evidence', async () => {
    const batchId = randomUUID()
    await pool.query(`INSERT INTO ${q}.raw_events VALUES ($1, 'socios', '1', 'c', '{}', $2)`, [
      randomUUID(),
      batchId,
    ])

    await expect(materializeLegacyMembershipCatalog(source(), batchId, schema)).rejects.toThrow(
      'Missing tiposoci input',
    )
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS count FROM ${q}.legacy_membership_type_snapshots WHERE batch_id = $1`,
          [batchId],
        )
      ).rows,
    ).toEqual([{ count: 0 }])
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS count FROM ${q}.legacy_catalog_materialization_receipts WHERE batch_id = $1`,
          [batchId],
        )
      ).rows,
    ).toEqual([{ count: 0 }])
    await expect(
      materializeLegacyMembershipCatalog(source(), randomUUID(), schema),
    ).rejects.toThrow('Unknown import batch')
  })

  it('rolls back snapshot rows and its receipt together on an insert failure', async () => {
    const batchId = randomUUID()
    await seed(batchId, [[1, '4', 'Active', 'd'.repeat(64)]])
    await pool.query(`CREATE FUNCTION ${q}.reject_catalog() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced failure'; END $$;
      CREATE TRIGGER reject_catalog BEFORE INSERT ON ${q}.legacy_catalog_materialization_receipts FOR EACH ROW EXECUTE FUNCTION ${q}.reject_catalog()`)

    await expect(materializeLegacyMembershipCatalog(source(), batchId, schema)).rejects.toThrow(
      'forced failure',
    )
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS count FROM ${q}.legacy_membership_type_snapshots WHERE batch_id = $1`,
          [batchId],
        )
      ).rows,
    ).toEqual([{ count: 0 }])
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS count FROM ${q}.legacy_membership_type_source_rows WHERE batch_id = $1`,
          [batchId],
        )
      ).rows,
    ).toEqual([{ count: 0 }])
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS count FROM ${q}.legacy_catalog_materialization_receipts WHERE batch_id = $1`,
          [batchId],
        )
      ).rows,
    ).toEqual([{ count: 0 }])
  })
})
