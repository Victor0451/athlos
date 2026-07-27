import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  projectLegacyMemberEvidence,
  projectLegacyMembershipCandidates,
  type SqlTransactionSource,
} from './legacy-membership-evidence'

function client(failInsert = false): SqlTransactionSource & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async acquire() {
      return {
        async query(text) {
          calls.push(text)
          if (text.startsWith('SELECT')) return { rowCount: 1 }
          if (failInsert && text.startsWith('INSERT')) throw new Error('insert failed')
          return {}
        },
        release() {},
      }
    },
  }
}

describe('projectLegacyMembershipCandidates', () => {
  it('rebuilds candidates from greatest source ordinals and is repeatable', async () => {
    const db = client()
    await projectLegacyMembershipCandidates(db, '00000000-0000-4000-8000-000000000001')
    await projectLegacyMembershipCandidates(db, '00000000-0000-4000-8000-000000000001')

    expect(db.calls.filter((call) => call.startsWith('DELETE'))).toHaveLength(2)
    expect(
      db.calls.filter((call) => call.includes('PARTITION BY code ORDER BY record_ordinal DESC')),
    ).toHaveLength(2)
    expect(db.calls.filter((call) => call === 'COMMIT')).toHaveLength(2)
  })

  it('rolls back the snapshot rebuild when candidate insertion fails', async () => {
    const db = client(true)
    await expect(
      projectLegacyMembershipCandidates(db, '00000000-0000-4000-8000-000000000002'),
    ).rejects.toThrow('insert failed')
    expect(db.calls.at(-1)).toBe('ROLLBACK')
  })

  it('releases an acquired session when BEGIN fails', async () => {
    let releases = 0
    const boundary = {
      async acquire() {
        return {
          async query(text: string) {
            if (text === 'BEGIN') throw new Error('begin failed')
            return { rowCount: 1 }
          },
          release() {
            releases++
          },
        }
      },
    }

    await expect(
      projectLegacyMembershipCandidates(boundary, '00000000-0000-4000-8000-000000000003'),
    ).rejects.toThrow('begin failed')
    expect(releases).toBe(1)
  })
})

const url = process.env.ATHLOS_TEST_DATABASE_URL
const schema = `member_projection_${randomUUID().replaceAll('-', '')}`
const q = `"${schema}"`
let pool: Pool

if (false) {
  // @ts-expect-error A pool is not an explicit transaction source.
  projectLegacyMemberEvidence(pool, randomUUID())
}

async function migrate() {
  const migration = (name: string) =>
    readFileSync(join(import.meta.dirname, '..', '..', 'db', 'drizzle', name), 'utf8')
      .replaceAll('socios.', `${q}.`)
      .replaceAll('public.raw_events', `${q}.raw_events`)
  await pool.query(`CREATE SCHEMA ${q}; CREATE EXTENSION IF NOT EXISTS pgcrypto`)
  await pool.query(`CREATE TABLE ${q}.raw_events (
    id uuid PRIMARY KEY, source_table text NOT NULL, source_key text NOT NULL,
    payload jsonb NOT NULL, import_batch uuid NOT NULL
  ); CREATE TABLE ${q}.member_identities (id uuid PRIMARY KEY);
  CREATE TABLE ${q}.legacy_identity_evidence (
    id uuid PRIMARY KEY, raw_event_id uuid NOT NULL, member_id uuid,
    review_state text NOT NULL
  )`)
  await pool.query(
    `SET search_path TO ${q}, public; ${migration('0038_socios_legacy_membership_evidence.sql')}`,
  )
  await pool.query(
    `SET search_path TO ${q}, public; ${migration('0039_socios_legacy_member_evidence.sql')}`,
  )
}

async function seedProjection(batch: string) {
  const catalogEvent = randomUUID()
  await pool.query(`INSERT INTO ${q}.raw_events VALUES ($1, 'tiposoci', '4', '{}', $2)`, [
    catalogEvent,
    batch,
  ])
  await pool.query(`INSERT INTO ${q}.legacy_membership_type_snapshots (batch_id) VALUES ($1)`, [
    batch,
  ])
  await pool.query(
    `INSERT INTO ${q}.legacy_membership_type_source_rows
       (raw_event_id, batch_id, record_ordinal, code, name, letter, content_hash)
       VALUES ($1, $2, 1, '4', 'Type four', 'T', 'hash')`,
    [catalogEvent, batch],
  )
  await pool.query(
    `INSERT INTO ${q}.legacy_membership_type_candidates (snapshot_batch_id, code, source_row_id)
       SELECT $1, '4', id FROM ${q}.legacy_membership_type_source_rows WHERE batch_id = $1`,
    [batch],
  )
  const validMember = randomUUID()
  await pool.query(`INSERT INTO ${q}.member_identities VALUES ($1)`, [validMember])
  for (const [type, category, fee, state, member] of [
    ['4', 'category-a', '12.50', 'validated', validMember],
    ['99', 'category-b', '0', 'validated', validMember],
    ['4', 'category-c', '', 'review_required', null],
  ]) {
    const event = randomUUID()
    const identity = randomUUID()
    await pool.query(`INSERT INTO ${q}.raw_events VALUES ($1, 'socios', $2, $3, $4)`, [
      event,
      event,
      { SOCTIPSOCI: type, SOCCATEGOR: category, SOCIMPCUOT: fee },
      batch,
    ])
    await pool.query(`INSERT INTO ${q}.legacy_identity_evidence VALUES ($1, $2, $3, $4)`, [
      identity,
      event,
      member,
      state,
    ])
  }
}

function trackedPool() {
  const clients: object[] = []
  let releases = 0
  return {
    boundary: {
      async acquire() {
        const client = await pool.connect()
        clients.push(client)
        return {
          query: client.query.bind(client),
          release() {
            releases++
            client.release()
          },
        }
      },
    },
    evidence: () => ({ clients, releases }),
  }
}

describe('projectLegacyMemberEvidence', () => {
  beforeAll(async () => {
    if (!url) throw new Error('ATHLOS_TEST_DATABASE_URL is required')
    pool = new Pool({ connectionString: url })
    await migrate()
  })
  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${q} CASCADE`)
    await pool.end()
  })

  it('projects reviewed facts without conflating categories or fee evidence and is idempotent', async () => {
    const batch = randomUUID()
    await seedProjection(batch)
    const tracked = trackedPool()
    await projectLegacyMemberEvidence(tracked.boundary, batch, schema)
    await projectLegacyMemberEvidence(tracked.boundary, batch, schema)

    expect(
      (
        await pool.query(`SELECT legacy_type_code, legacy_category, fee_state, fee_value, review_state,
        member_id IS NULL AS member_unattached, membership_type_candidate_source_row_id IS NULL AS type_unattached
        FROM ${q}.legacy_member_evidence ORDER BY legacy_category`)
      ).rows,
    ).toEqual([
      {
        legacy_type_code: '4',
        legacy_category: 'category-a',
        fee_state: 'non_zero',
        fee_value: '12.50',
        review_state: 'validated',
        member_unattached: false,
        type_unattached: false,
      },
      {
        legacy_type_code: '99',
        legacy_category: 'category-b',
        fee_state: 'zero',
        fee_value: '0.00',
        review_state: 'unknown_type',
        member_unattached: true,
        type_unattached: true,
      },
      {
        legacy_type_code: '4',
        legacy_category: 'category-c',
        fee_state: 'blank',
        fee_value: null,
        review_state: 'ambiguous_identity',
        member_unattached: true,
        type_unattached: true,
      },
    ])
    expect(tracked.evidence().releases).toBe(2)
    expect(tracked.evidence().clients).toHaveLength(2)
  })

  it('rolls back a failed projection on its acquired PostgreSQL session and releases it', async () => {
    const batch = randomUUID()
    await seedProjection(batch)
    await pool.query(`CREATE FUNCTION ${q}.reject_member_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'forced member evidence failure'; END $$;
      CREATE TRIGGER reject_member_evidence BEFORE INSERT ON ${q}.legacy_member_evidence
      FOR EACH ROW EXECUTE FUNCTION ${q}.reject_member_evidence()`)
    const tracked = trackedPool()

    await expect(projectLegacyMemberEvidence(tracked.boundary, batch, schema)).rejects.toThrow(
      'forced member evidence failure',
    )
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS count FROM ${q}.legacy_member_evidence WHERE import_batch = $1`,
          [batch],
        )
      ).rows,
    ).toEqual([{ count: 0 }])
    expect(tracked.evidence().releases).toBe(1)
    expect(tracked.evidence().clients).toHaveLength(1)
    await pool.query(`DROP TRIGGER reject_member_evidence ON ${q}.legacy_member_evidence`)
    await projectLegacyMemberEvidence(trackedPool().boundary, batch, schema)
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS count FROM ${q}.legacy_member_evidence WHERE import_batch = $1`,
          [batch],
        )
      ).rows,
    ).toEqual([{ count: 3 }])
  })
})
