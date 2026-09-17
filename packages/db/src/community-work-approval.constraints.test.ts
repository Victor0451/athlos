/**
 * community-work-approval.constraints.test.ts — Canonical-chain persistence tests
 * (candidate 2: constraint behavior + legacy compatibility).
 *
 * Runs against REAL tables after applying every canonical drizzle migration
 * incl. 0071 (shared harness with community-work-approval.persistence.test.ts,
 * own dedicated database so parallel workers never interfere).
 *
 * Covers: legacy condonation compatibility, unique(action_id, requester_key),
 * positive amount_cents CHECK, NOT NULL fingerprint/receipt/token, FK
 * restrict/dangling settlement+allocation, multiple pending community-work
 * requests for one obligation, transaction/savepoint recovery semantics, and
 * partial-index non-interference with condonation rows.
 *
 * Strict TDD cycle: RED→GREEN→TRIANGULATE→REFACTOR.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createCanonicalHarness,
  requireDatabaseUrl,
  type FkSeeds,
} from './community-work-approval.harness'

const harness = createCanonicalHarness(requireDatabaseUrl(), 'athlos_test_constraints')
const { pool, resetDatabase, buildMinStubSchemas, applyCanonicalChain, seedFKReferences } = harness
let _seeds: FkSeeds | undefined

beforeAll(async () => {
  await harness.connect()
})

afterAll(async () => {
  await harness.end()
}, 30_000)

describe('GREEN: constraint behavior & legacy compatibility (chain incl. 0071)', () => {
  beforeAll(async () => {
    await resetDatabase()
    await buildMinStubSchemas()
    // Derived from the journal: the union interleaves 0071 between 0070 and 0072.
    const journal = JSON.parse(
      readFileSync(join(__dirname, '..', 'drizzle', 'meta', '_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number; tag: string }> }
    const cwIdx = journal.entries.findIndex((e) => e.tag === '0071_community_work_approval')
    expect(cwIdx).toBeGreaterThan(0)
    const result = await applyCanonicalChain(cwIdx)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(`Full chain failed: ${result.error}`)
    // Seed one row per FK-prerequisite table so assertion INSERTs can succeed
    _seeds = await seedFKReferences()
  }, 120_000)

  beforeEach(async () => {
    // Truncate in reverse-FK-dependency order to avoid conflicts
    // Execution depends on tokens → settle → obligation (independent)
    await pool.query(`TRUNCATE TABLE tesoreria.dues_community_work_executions`)
    await pool.query(`TRUNCATE TABLE public.approval_tokens CASCADE`)
    await pool.query(`TRUNCATE TABLE tesoreria.dues_settlements CASCADE`)
    await pool.query(`TRUNCATE TABLE tesoreria.dues_obligations CASCADE`)
  })

  /* ── Legacy condonation compatibility ── */
  it('legacy condonation row survives with all community fields null', async () => {
    const tokenId = randomUUID()
    await pool.query(
      `INSERT INTO public.approval_tokens 
         (id, token_hash, action_type, action_id, context_summary, 
          created_by_operator_id, approver_channel, approver_address, expires_at, status)
       VALUES ($1, $2, 'dues.condonation', 'cond-legacy', 'Legacy condonation', 
               $3, 'email', 'old@example.com', $4, 'approved')`,
      [tokenId, randomUUID(), _seeds!.operatorId, new Date('2099-06-15')],
    )

    const row = await pool.query(
      `SELECT community_snapshot, requester_key, agreement_uuid, terms_version, actor_fingerprint, receipt 
       FROM public.approval_tokens WHERE id = $1`,
      [tokenId],
    )
    expect(row.rows.length).toBe(1)
    expect(row.rows[0].community_snapshot).toBeNull()
    expect(row.rows[0].requester_key).toBeNull()
    expect(row.rows[0].agreement_uuid).toBeNull()
    expect(row.rows[0].terms_version).toBeNull()
    expect(row.rows[0].actor_fingerprint).toBeNull()
    expect(row.rows[0].receipt).toBeNull()
  })

  /* ── Unique constraint on (action_id, requester_key) ── */
  it('enforces unique(action_id, requester_key) on dues_community_work_executions', async () => {
    const tokenId = randomUUID()
    await pool.query(
      `INSERT INTO public.approval_tokens 
         (id, token_hash, action_type, action_id, context_summary, 
          created_by_operator_id, approver_channel, approver_address, expires_at, status)
       VALUES ($1, $2, 'dues.community-work-request', 'act-dup', 'Dup test', 
               $3, 'whatsapp', 'rep@test.com', $4, 'pending')`,
      [tokenId, randomUUID(), _seeds!.operatorId, new Date('2099-01-01')],
    )

    await pool.query(
      `INSERT INTO tesoreria.dues_community_work_executions 
         (id, approval_token_id, action_id, requester_key, snapshot_actor_fingerprint, receipt)
       VALUES ($1, $2, 'act-dup', 'user-a', 'fp-1', 'rec-1')`,
      [randomUUID(), tokenId],
    )

    const err = (await pool
      .query(
        `INSERT INTO tesoreria.dues_community_work_executions 
         (id, approval_token_id, action_id, requester_key, snapshot_actor_fingerprint, receipt)
       VALUES ($1, $2, 'act-dup', 'user-a', 'fp-2', 'rec-2')`,
        [randomUUID(), tokenId],
      )
      .catch((e: Error) => ({ error: e }))) as { error?: Error }

    expect(err).toHaveProperty('error')
    expect(String(err.error)).toMatch(/unique/i)
  })

  it('allows different action_id or requester_key combinations', async () => {
    const tokenId = randomUUID()
    await pool.query(
      `INSERT INTO public.approval_tokens 
         (id, token_hash, action_type, action_id, context_summary, 
          created_by_operator_id, approver_channel, approver_address, expires_at, status)
       VALUES ($1, $2, 'dues.community-work-request', 'X', 'Test', 
               $3, 'whatsapp', 'r@test.com', $4, 'pending')`,
      [tokenId, randomUUID(), _seeds!.operatorId, new Date('2099-01-01')],
    )

    await pool.query(
      `INSERT INTO tesoreria.dues_community_work_executions 
         (id, approval_token_id, action_id, requester_key, snapshot_actor_fingerprint, receipt)
       VALUES (gen_random_uuid(), $1, 'A', 'same-user', 'fp-1', 'rec-1')`,
      [tokenId],
    )
    await pool.query(
      `INSERT INTO tesoreria.dues_community_work_executions 
         (id, approval_token_id, action_id, requester_key, snapshot_actor_fingerprint, receipt)
       VALUES (gen_random_uuid(), $1, 'B', 'same-user', 'fp-2', 'rec-2')`,
      [tokenId],
    )
    await pool.query(
      `INSERT INTO tesoreria.dues_community_work_executions 
         (id, approval_token_id, action_id, requester_key, snapshot_actor_fingerprint, receipt)
       VALUES (gen_random_uuid(), $1, 'A', 'other-user', 'fp-3', 'rec-3')`,
      [tokenId],
    )

    const result = await pool.query(
      `SELECT count(*)::int AS cnt FROM tesoreria.dues_community_work_executions`,
    )
    expect(result.rows[0].cnt).toBe(3)
  })

  /* ── CHECK positive amount_cents ── */
  it('rejects negative amount_cents', async () => {
    const tokenId = randomUUID()
    await pool.query(
      `INSERT INTO public.approval_tokens 
         (id, token_hash, action_type, action_id, context_summary, 
          created_by_operator_id, approver_channel, approver_address, expires_at, status)
       VALUES ($1, $2, 'dues.community-work-request', 'neg', 'Test', 
               $3, 'email', 'r@test.com', $4, 'pending')`,
      [tokenId, randomUUID(), _seeds!.operatorId, new Date('2099-01-01')],
    )

    const err = (await pool
      .query(
        `INSERT INTO tesoreria.dues_community_work_executions 
         (id, approval_token_id, action_id, requester_key, amount_cents, snapshot_actor_fingerprint, receipt)
       VALUES (gen_random_uuid(), $1, 'neg', 'k', -100, 'fp', 'rec')`,
        [tokenId],
      )
      .catch((e: Error) => ({ error: e }))) as { error?: Error }

    expect(err).toHaveProperty('error')
    expect(String(err.error)).toMatch(/check|constraint|violation/i)
  })

  it('rejects zero amount_cents', async () => {
    const tokenId = randomUUID()
    await pool.query(
      `INSERT INTO public.approval_tokens 
         (id, token_hash, action_type, action_id, context_summary, 
          created_by_operator_id, approver_channel, approver_address, expires_at, status)
       VALUES ($1, $2, 'dues.community-work-request', 'zero', 'Test', 
               $3, 'email', 'r@test.com', $4, 'pending')`,
      [tokenId, randomUUID(), _seeds!.operatorId, new Date('2099-01-01')],
    )

    const err = (await pool
      .query(
        `INSERT INTO tesoreria.dues_community_work_executions 
         (id, approval_token_id, action_id, requester_key, amount_cents, snapshot_actor_fingerprint, receipt)
       VALUES (gen_random_uuid(), $1, 'zero', 'k', 0, 'fp', 'rec')`,
        [tokenId],
      )
      .catch((e: Error) => ({ error: e }))) as { error?: Error }

    expect(err).toHaveProperty('error')
    expect(String(err.error)).toMatch(/check|constraint|violation/i)
  })

  it('accepts positive amount_cents', async () => {
    const tokenId = randomUUID()
    await pool.query(
      `INSERT INTO public.approval_tokens 
         (id, token_hash, action_type, action_id, context_summary, 
          created_by_operator_id, approver_channel, approver_address, expires_at, status)
       VALUES ($1, $2, 'dues.community-work-request', 'pos', 'Test', 
               $3, 'email', 'r@test.com', $4, 'pending')`,
      [tokenId, randomUUID(), _seeds!.operatorId, new Date('2099-01-01')],
    )

    await pool.query(
      `INSERT INTO tesoreria.dues_community_work_executions 
         (id, approval_token_id, action_id, requester_key, amount_cents, snapshot_actor_fingerprint, receipt)
       VALUES (gen_random_uuid(), $1, 'pos', 'k', 5000, 'fp-pos', 'rec-pos')`,
      [tokenId],
    )

    const result = await pool.query(
      `SELECT amount_cents FROM tesoreria.dues_community_work_executions WHERE action_id = 'pos'`,
    )
    expect(Number(result.rows[0].amount_cents)).toBe(5000)
  })

  it('accepts NULL amount_cents', async () => {
    const tokenId = randomUUID()
    await pool.query(
      `INSERT INTO public.approval_tokens 
         (id, token_hash, action_type, action_id, context_summary, 
          created_by_operator_id, approver_channel, approver_address, expires_at, status)
       VALUES ($1, $2, 'dues.community-work-request', 'null-amt', 'Test', 
               $3, 'email', 'r@test.com', $4, 'pending')`,
      [tokenId, randomUUID(), _seeds!.operatorId, new Date('2099-01-01')],
    )

    await pool.query(
      `INSERT INTO tesoreria.dues_community_work_executions 
         (id, approval_token_id, action_id, requester_key, snapshot_actor_fingerprint, receipt)
       VALUES (gen_random_uuid(), $1, 'null-amt', 'k', 'fp-null', 'rec-null')`,
      [tokenId],
    )

    const result = await pool.query(
      `SELECT amount_cents FROM tesoreria.dues_community_work_executions WHERE action_id = 'null-amt'`,
    )
    expect(result.rows[0].amount_cents).toBeNull()
  })

  /* ── NOT NULL constraints ── */
  it('rejects NULL snapshot_actor_fingerprint', async () => {
    const tokenId = randomUUID()
    await pool.query(
      `INSERT INTO public.approval_tokens 
         (id, token_hash, action_type, action_id, context_summary, 
          created_by_operator_id, approver_channel, approver_address, expires_at, status)
       VALUES ($1, $2, 'dues.community-work-request', 'nfps', 'Test', 
               $3, 'email', 'r@test.com', $4, 'pending')`,
      [tokenId, randomUUID(), _seeds!.operatorId, new Date('2099-01-01')],
    )

    const err = (await pool
      .query(
        `INSERT INTO tesoreria.dues_community_work_executions 
         (id, approval_token_id, action_id, requester_key, snapshot_actor_fingerprint, receipt)
       VALUES (gen_random_uuid(), $1, 'nfps', 'k', NULL, 'rec')`,
        [tokenId],
      )
      .catch((e: Error) => ({ error: e }))) as { error?: Error }

    expect(err).toHaveProperty('error')
    expect(String(err.error)).toMatch(/null/i)
  })

  it('rejects NULL receipt', async () => {
    const tokenId = randomUUID()
    await pool.query(
      `INSERT INTO public.approval_tokens 
         (id, token_hash, action_type, action_id, context_summary, 
          created_by_operator_id, approver_channel, approver_address, expires_at, status)
       VALUES ($1, $2, 'dues.community-work-request', 'nr', 'Test', 
               $3, 'email', 'r@test.com', $4, 'pending')`,
      [tokenId, randomUUID(), _seeds!.operatorId, new Date('2099-01-01')],
    )

    const err = (await pool
      .query(
        `INSERT INTO tesoreria.dues_community_work_executions 
         (id, approval_token_id, action_id, requester_key, snapshot_actor_fingerprint, receipt)
       VALUES (gen_random_uuid(), $1, 'nr', 'k', 'fp', NULL)`,
        [tokenId],
      )
      .catch((e: Error) => ({ error: e }))) as { error?: Error }

    expect(err).toHaveProperty('error')
    expect(String(err.error)).toMatch(/null/i)
  })

  it('rejects NULL approval_token_id', async () => {
    const err = (await pool
      .query(
        `INSERT INTO tesoreria.dues_community_work_executions 
         (id, approval_token_id, action_id, requester_key, snapshot_actor_fingerprint, receipt)
       VALUES (gen_random_uuid(), NULL, 'nn', 'k', 'fp', 'rec')`,
      )
      .catch((e: Error) => ({ error: e }))) as { error?: Error }

    expect(err).toHaveProperty('error')
    expect(String(err.error)).toMatch(/null/i)
  })

  /* ── FK restrictions ── */
  it('rejects dangling settlement_id FK', async () => {
    const tokenId = randomUUID()
    await pool.query(
      `INSERT INTO public.approval_tokens 
         (id, token_hash, action_type, action_id, context_summary, 
          created_by_operator_id, approver_channel, approver_address, expires_at, status)
       VALUES ($1, $2, 'dues.community-work-request', 'fk-settle', 'Test', 
               $3, 'email', 'r@test.com', $4, 'pending')`,
      [tokenId, randomUUID(), _seeds!.operatorId, new Date('2099-01-01')],
    )

    const settleId = randomUUID()
    const err = (await pool
      .query(
        `INSERT INTO tesoreria.dues_community_work_executions 
         (id, approval_token_id, settlement_id, action_id, requester_key, snapshot_actor_fingerprint, receipt)
       VALUES (gen_random_uuid(), $1, $2, 'fk-settle', 'k', 'fp', 'rec')`,
        [tokenId, settleId],
      )
      .catch((e: Error) => ({ error: e }))) as { error?: Error }

    expect(err).toHaveProperty('error')
    expect(String(err.error)).toMatch(/foreign.key|violates/i)
  })

  it('restricts deletion of referenced settlement', async () => {
    const tokenId = randomUUID()
    await pool.query(
      `INSERT INTO public.approval_tokens 
         (id, token_hash, action_type, action_id, context_summary, 
          created_by_operator_id, approver_channel, approver_address, expires_at, status)
       VALUES ($1, $2, 'dues.community-work-request', 'fk-del', 'Test', 
               $3, 'email', 'r@test.com', $4, 'pending')`,
      [tokenId, randomUUID(), _seeds!.operatorId, new Date('2099-01-01')],
    )

    const settleId = randomUUID()
    // Insert settlement using seeded socio/operator for FK compliance
    await pool.query(
      `INSERT INTO tesoreria.dues_settlements 
         (id, socio_id, kind, amount, currency, evidence, operator_id, caller_key, request_fingerprint)
       VALUES ($1, $2, 'MONETARY', 1000, 'ARS', '{}', $3, 'ck', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')`,
      [settleId, _seeds!.socioId, _seeds!.operatorId],
    )

    // Link execution to settlement
    await pool.query(
      `INSERT INTO tesoreria.dues_community_work_executions 
         (id, approval_token_id, settlement_id, action_id, requester_key, snapshot_actor_fingerprint, receipt)
       VALUES (gen_random_uuid(), $1, $2, 'fk-del', 'k', 'fp', 'rec')`,
      [tokenId, settleId],
    )

    const delErr = (await pool
      .query(`DELETE FROM tesoreria.dues_settlements WHERE id = $1`, [settleId])
      .catch((e: Error) => ({ error: e }))) as { error?: Error }

    expect(delErr).toHaveProperty('error')
    // The pre-existing immutability trigger on dues_settlements fires before the
    // FK RESTRICT constraint, so deletion is rejected either way. Both messages
    // prove the referenced settlement cannot be deleted.
    expect(String(delErr.error)).toMatch(/foreign.key|referenced|violates|immutable/i)
  })

  it('rejects dangling allocation_id FK', async () => {
    const tokenId = randomUUID()
    await pool.query(
      `INSERT INTO public.approval_tokens 
         (id, token_hash, action_type, action_id, context_summary, 
          created_by_operator_id, approver_channel, approver_address, expires_at, status)
       VALUES ($1, $2, 'dues.community-work-request', 'fk-alloc', 'Test', 
               $3, 'email', 'r@test.com', $4, 'pending')`,
      [tokenId, randomUUID(), _seeds!.operatorId, new Date('2099-01-01')],
    )

    const badAllocId = randomUUID()
    const err = (await pool
      .query(
        `INSERT INTO tesoreria.dues_community_work_executions 
         (id, approval_token_id, action_id, requester_key, allocation_id, snapshot_actor_fingerprint, receipt)
       VALUES (gen_random_uuid(), $1, 'fk-alloc', 'k', $2, 'fp', 'rec')`,
        [tokenId, badAllocId],
      )
      .catch((e: Error) => ({ error: e }))) as { error?: Error }

    expect(err).toHaveProperty('error')
    expect(String(err.error)).toMatch(/foreign.key|violates/i)
  })

  /* ── Multiple pending requests same obligation distinct actions ── */
  it('supports multiple pending community-work requests for same obligation with distinct action_ids', async () => {
    for (let i = 0; i < 3; i++) {
      const tokenId = randomUUID()
      await pool.query(
        `INSERT INTO public.approval_tokens 
           (id, token_hash, action_type, action_id, context_summary, 
            created_by_operator_id, approver_channel, approver_address, expires_at, status)
         VALUES ($1, $2, 'dues.community-work-request', $3, 'Pending CWA', 
                 $4, 'whatsapp', 'rep@test.com', $5, 'pending')`,
        [tokenId, randomUUID(), `pending-${i}`, _seeds!.operatorId, new Date('2099-01-01')],
      )
    }

    const result = await pool.query(
      `SELECT count(*)::int AS cnt FROM public.approval_tokens WHERE action_type = 'dues.community-work-request'`,
    )
    expect(result.rows[0].cnt).toBe(3)
  })

  /* ── SAVEPOINT isolation ── */
  it('ROLLBACK TO savepoint after unique violation preserves valid prior INSERT', async () => {
    // Use the pre-seeded operator token (deterministic ID known to both test and DO block)
    const spTokenId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' // deterministic UUID
    await pool.query(
      `INSERT INTO public.approval_tokens 
         (id, token_hash, action_type, action_id, context_summary, 
          created_by_operator_id, approver_channel, approver_address, expires_at, status)
       VALUES ($1, $2, 'cwa-test', 'savepoint-uniq', 'SP test', 
               $3, 'whatsapp', 'sp@test.com', $4, 'pending')`,
      [spTokenId, randomUUID(), _seeds!.operatorId, new Date('2099-01-01')],
    )

    // SAVEPOINT/ROLLBACK TO SAVEPOINT are transaction-level SQL commands and are
    // not allowed inside plpgsql DO blocks, so drive them with a dedicated client.
    // The savepoint is taken AFTER the valid insert so rollback preserves it.
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO tesoreria.dues_community_work_executions
           (id, approval_token_id, action_id, requester_key, snapshot_actor_fingerprint, receipt)
         VALUES (gen_random_uuid(), $1, 'savepoint-uniq', 'user-sp', 'fp1', 'rec1')`,
        [spTokenId],
      )
      await client.query('SAVEPOINT sp1')
      const dupErr = await client
        .query(
          `INSERT INTO tesoreria.dues_community_work_executions
             (id, approval_token_id, action_id, requester_key, snapshot_actor_fingerprint, receipt)
           VALUES (gen_random_uuid(), $1, 'savepoint-uniq', 'user-sp', 'fp2', 'rec2')`,
          [spTokenId],
        )
        .catch((e: Error & { code?: string }) => e)
      expect((dupErr as { code?: string }).code).toBe('23505') // unique_violation
      await client.query('ROLLBACK TO SAVEPOINT sp1')
      await client.query('COMMIT')
    } finally {
      client.release()
    }

    const result = await pool.query(
      `SELECT count(*)::int AS cnt FROM tesoreria.dues_community_work_executions WHERE action_id = 'savepoint-uniq'`,
    )
    expect(result.rows[0].cnt).toBe(1)
  })

  it('ROLLBACK TO savepoint after CHECK violation preserves valid INSERT', async () => {
    const spTokenId = 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee'
    await pool.query(
      `INSERT INTO public.approval_tokens 
         (id, token_hash, action_type, action_id, context_summary, 
          created_by_operator_id, approver_channel, approver_address, expires_at, status)
       VALUES ($1, $2, 'cwa-test', 'savepoint-check', 'SP test', 
               $3, 'whatsapp', 'sp@test.com', $4, 'pending')`,
      [spTokenId, randomUUID(), _seeds!.operatorId, new Date('2099-01-01')],
    )

    // Transaction-level savepoint via dedicated client (see prior test rationale).
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO tesoreria.dues_community_work_executions
           (id, approval_token_id, action_id, requester_key, amount_cents, snapshot_actor_fingerprint, receipt)
         VALUES (gen_random_uuid(), $1, 'good-sp', 'user', 500, 'fp', 'rec')`,
        [spTokenId],
      )
      await client.query('SAVEPOINT sp2')
      const checkErr = await client
        .query(
          `INSERT INTO tesoreria.dues_community_work_executions
             (id, approval_token_id, action_id, requester_key, amount_cents, snapshot_actor_fingerprint, receipt)
           VALUES (gen_random_uuid(), $1, 'bad-sp', 'user', -100, 'fp', 'rec')`,
          [spTokenId],
        )
        .catch((e: Error & { code?: string }) => e)
      expect((checkErr as { code?: string }).code).toBe('23514') // check_violation
      await client.query('ROLLBACK TO SAVEPOINT sp2')
      await client.query('COMMIT')
    } finally {
      client.release()
    }

    const result = await pool.query(
      `SELECT count(*)::int AS cnt FROM tesoreria.dues_community_work_executions WHERE action_id = 'good-sp'`,
    )
    expect(result.rows[0].cnt).toBe(1)

    const badResult = await pool.query(
      `SELECT count(*)::int AS cnt FROM tesoreria.dues_community_work_executions WHERE action_id = 'bad-sp'`,
    )
    expect(badResult.rows[0].cnt).toBe(0)
  })

  it('full ROLLBACK prevents both inserts', async () => {
    const tokenId = randomUUID()
    await pool.query(
      `INSERT INTO public.approval_tokens 
         (id, token_hash, action_type, action_id, context_summary, 
          created_by_operator_id, approver_channel, approver_address, expires_at, status)
       VALUES ($1, $2, 'cwa-test', 'full-rollback', 'FR test', 
               $3, 'whatsapp', 'fr@test.com', $4, 'pending')`,
      [tokenId, randomUUID(), _seeds!.operatorId, new Date('2099-01-01')],
    )

    // DO blocks cannot take bind parameters and cannot issue ROLLBACK, so drive
    // the full-rollback proof with a dedicated client transaction: the duplicate
    // insert aborts the transaction and the explicit ROLLBACK discards both rows.
    const client = await pool.connect()
    let violationSeen = false
    try {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO tesoreria.dues_community_work_executions
           (id, approval_token_id, action_id, requester_key, snapshot_actor_fingerprint, receipt)
         VALUES (gen_random_uuid(), $1, 'fr-bad1', 'user', 'fp1', 'rec1')`,
        [tokenId],
      )
      await client
        .query(
          `INSERT INTO tesoreria.dues_community_work_executions
             (id, approval_token_id, action_id, requester_key, snapshot_actor_fingerprint, receipt)
           VALUES (gen_random_uuid(), $1, 'fr-bad1', 'user', 'fp3', 'rec3')`,
          [tokenId],
        )
        .catch((e: Error & { code?: string }) => {
          violationSeen = true
          expect((e as { code?: string }).code).toBe('23505')
        })
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }
    expect(violationSeen).toBe(true)

    const result = await pool.query(
      `SELECT count(*)::int AS cnt FROM tesoreria.dues_community_work_executions WHERE action_id = 'fr-bad1'`,
    )
    expect(result.rows[0].cnt).toBe(0)
  })

  /* ── Partial unique index scope ── */
  it('partial unique index on action_type=dues.community-work-request does not affect condonation rows', async () => {
    // A condonation row has action_type='dues.condonation', not 'dues.community-work-request',
    // so it should NOT participate in the partial unique index.
    const condTokenId = randomUUID()
    const condTokenId2 = randomUUID()

    await pool.query(
      `INSERT INTO public.approval_tokens 
         (id, token_hash, action_type, action_id, context_summary, 
          created_by_operator_id, approver_channel, approver_address, expires_at, status)
       VALUES ($1, $2, 'dues.condonation', 'req-same', 'Cond 1', 
               $3, 'email', 'cond@test.com', $4, 'approved')`,
      [condTokenId, randomUUID(), _seeds!.operatorId, new Date('2099-01-01')],
    )
    await pool.query(
      `INSERT INTO public.approval_tokens 
         (id, token_hash, action_type, action_id, context_summary, 
          created_by_operator_id, approver_channel, approver_address, expires_at, status)
       VALUES ($1, $2, 'dues.condonation', 'req-same', 'Cond 2', 
               $3, 'email', 'cond2@test.com', $4, 'approved')`,
      [condTokenId2, randomUUID(), _seeds!.operatorId, new Date('2099-01-01')],
    )

    // Both condonation rows coexist despite same action_id — the partial index only covers
    // action_type = 'dues.community-work-request'.
    const result = await pool.query(
      `SELECT count(*)::int AS cnt FROM public.approval_tokens 
       WHERE action_type = 'dues.condonation' AND action_id = 'req-same'`,
    )
    expect(result.rows[0].cnt).toBe(2)
  })
})
