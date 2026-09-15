/**
 * community-work-approval.harness.ts — Shared canonical-chain test harness.
 *
 * Used by the community-work approval persistence suites
 * (`community-work-approval.persistence.test.ts` and
 * `community-work-approval.constraints.test.ts`). Applies EVERY canonical
 * drizzle migration (idx 0..58 incl. 0071) in journal order against a fresh
 * database inside an owned PostgreSQL container, so assertions run on REAL
 * tables: tesoreria.dues_community_work_executions and public.approval_tokens.
 *
 * Each consuming test file gets its own database (created on demand) so the
 * suites never interfere when vitest runs files in parallel workers.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'

export interface FkSeeds {
  operatorId: string
  socioId: string
  settlementId: string
  obligationId: string
}

export interface ApplyChainResult {
  ok: boolean
  error?: string
}

export interface CanonicalHarness {
  /** Pool bound to this harness's dedicated database. Safe to destructure. */
  pool: Pool
  /** Create the dedicated database if missing, then verify connectivity. */
  connect(): Promise<void>
  /** Drop every schema (incl. public) and recreate minimal scaffolding. */
  resetDatabase(): Promise<void>
  /** Documented no-op; migrations create user schemas explicitly. */
  buildMinStubSchemas(): Promise<void>
  /** Apply journal entries idx 0..toIdx via readFileSync, recording the ledger. */
  applyCanonicalChain(toIdx: number): Promise<ApplyChainResult>
  /** Seed one row per FK-prerequisite table used by test INSERTs. */
  seedFKReferences(): Promise<FkSeeds>
  /** Best-effort schema reset, then close the pool. */
  end(): Promise<void>
}

/** Read ATHLOS_TEST_DATABASE_URL or throw (PostgreSQL integration guard). */
export function requireDatabaseUrl(): string {
  const databaseUrl = process.env['ATHLOS_TEST_DATABASE_URL']
  if (!databaseUrl) {
    throw new Error('ATHLOS_TEST_DATABASE_URL must be set for PostgreSQL integration tests')
  }
  return databaseUrl
}

/** Split a migration file on Drizzle's `--> statement-breakpoint` marker. */
export function splitStatements(sql: string): string[] {
  const parts = sql.split(/-->\s*statement-breakpoint\s*\n/)
  return parts.map((s) => s.trim()).filter(Boolean)
}

/** Replace the pathname of a connection URL with `/<databaseName>`. */
function withDatabaseName(databaseUrl: string, databaseName: string): string {
  const url = new URL(databaseUrl)
  url.pathname = `/${databaseName}`
  return url.toString()
}

/**
 * Build a harness bound to its own database. The Pool is created eagerly (pg
 * pools do not connect until first query); `connect()` creates the database on
 * a maintenance connection when missing, so suites are self-contained.
 */
export function createCanonicalHarness(
  databaseUrl: string,
  databaseName: string,
): CanonicalHarness {
  const targetUrl = withDatabaseName(databaseUrl, databaseName)
  const pool = new Pool({ connectionString: targetUrl, connectionTimeoutMillis: 5_000 })

  async function connect(): Promise<void> {
    const admin = new Pool({
      connectionString: withDatabaseName(databaseUrl, 'postgres'),
      connectionTimeoutMillis: 5_000,
    })
    try {
      const found = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
        databaseName,
      ])
      if (found.rowCount === 0) {
        // Identifier comes from trusted test code, never external input.
        await admin.query(`CREATE DATABASE ${databaseName}`)
      }
    } finally {
      await admin.end()
    }
    await pool.query('SELECT 1')
  }

  async function resetDatabase(): Promise<void> {
    // Drop all non-template schemas
    await pool.query(`DROP SCHEMA IF EXISTS contabilidad CASCADE`)
    await pool.query(`DROP SCHEMA IF EXISTS deportes CASCADE`)
    await pool.query(`DROP SCHEMA IF EXISTS socios CASCADE`)
    await pool.query(`DROP SCHEMA IF EXISTS tesoreria CASCADE`)
    await pool.query(`DROP SCHEMA IF EXISTS drizzle CASCADE`)
    await pool.query(`DROP SCHEMA IF EXISTS public CASCADE`)

    // Recreate minimal scaffolding — migrations will add content to these
    await pool.query(`CREATE SCHEMA public`)
    await pool.query(`CREATE SCHEMA drizzle`)
    await pool.query(`
      CREATE TABLE drizzle.__drizzle_migrations (
        id serial PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint NOT NULL
      )
    `)
  }

  async function buildMinStubSchemas(): Promise<void> {
    // Intentionally left blank. Migration 0000 creates contabilidad, deportes,
    // socios, and tesoreria schemas. Pre-creating them would cause "already exists"
    // failures when the first migration runs plain CREATE SCHEMA.
  }

  async function applyCanonicalChain(toIdx: number): Promise<ApplyChainResult> {
    const dbDir = join(__dirname, '..', 'drizzle')
    const metaPath = join(dbDir, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(metaPath, 'utf8')) as {
      entries: Array<{
        idx: number
        tag: string
        when: number
        version: string
        breakpoints?: boolean
      }>
    }

    const entries = journal.entries.sort((a, b) => a.idx - b.idx)
    for (let i = 0; i <= toIdx && i < entries.length; i++) {
      const entry = entries[i]
      if (!entry) continue
      const sqlPath = join(dbDir, `${entry.tag}.sql`)
      const sql = readFileSync(sqlPath, 'utf8')
      const statements = splitStatements(sql)
      for (const stmt of statements) {
        try {
          await pool.query(stmt)
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          return { ok: false, error: `[${entry.idx}/${entry.tag}] ${msg}` }
        }
      }
      // Record in tracking table so later migrations that depend on the ledger succeed
      await pool.query(
        'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)',
        [entry.version || '', entry.when],
      )
    }
    return { ok: true }
  }

  async function seedFKReferences(): Promise<FkSeeds> {
    const opId = randomUUID()
    await pool.query(
      `INSERT INTO public.operators (id, username, password_hash, role, can_reprint, can_anulate, is_active, failed_login_attempts) VALUES ($1, 'test-op', 'hash', 'A', false, false, true, 0)`,
      [opId],
    )

    const socioId = randomUUID()
    await pool.query(
      `INSERT INTO socios.socios (id, numero_socio, nombre, apellido, dni, fecha_alta, estado) VALUES ($1, 'TEST', 'Test', 'Operator', '00000000', CURRENT_DATE, 'activo')`,
      [socioId],
    )

    const settleId = randomUUID()
    await pool.query(
      `INSERT INTO tesoreria.dues_settlements (id, socio_id, kind, amount, currency, evidence, operator_id, caller_key, request_fingerprint) VALUES ($1, $2, 'MONETARY', 1000, 'ARS', '{}', $3, 'seed-ck', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')`,
      [settleId, socioId, opId],
    )

    // First ensure a generation receipt exists for obligation FK
    const receiptId = randomUUID()
    await pool.query(
      `INSERT INTO tesoreria.dues_generation_receipts (id, operator_id, caller_key, request_fingerprint, period_start, period_end, authorization_evidence) VALUES ($1, $2, 'seed-rk', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', DATE '2099-01-01', DATE '2099-02-01', '{}')`,
      [receiptId, opId],
    )

    const obligaId = randomUUID()
    await pool.query(
      `INSERT INTO tesoreria.dues_obligations (id, socio_id, kind, period_start, period_end, amount, generation_receipt_id, actor_id, snapshot) VALUES ($1, $2, 'MONTHLY_DUES', DATE '2099-01-01', DATE '2099-02-01', 1000, $3, $4, '{}')`,
      [obligaId, socioId, receiptId, opId],
    )

    return { operatorId: opId, socioId, settlementId: settleId, obligationId: obligaId }
  }

  async function end(): Promise<void> {
    try {
      await resetDatabase()
    } catch {
      /* best-effort cleanup */
    }
    await pool.end()
  }

  return {
    pool,
    connect,
    resetDatabase,
    buildMinStubSchemas,
    applyCanonicalChain,
    seedFKReferences,
    end,
  }
}
