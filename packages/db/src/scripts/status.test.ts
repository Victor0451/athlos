/**
 * RED-phase tests for migrate:status.
 *
 * These tests FAIL because status.ts does not exist yet.
 * They cover the cases defined in design.md §4.1:
 * - empty applied list → all pending
 * - partial applied list → some pending
 * - full applied list → empty pending/divergence
 * - drift: DB row missing from filesystem → divergence
 * - pending: filesystem entry not in DB → pending
 * - --json Zod shape validation
 * - connection error → exit 2
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Pool, type PoolClient } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { diffMigrations, getAppliedMigrationsWithDates, main, statusSchema } from './status.ts'

const connectionString = process.env.ATHLOS_TEST_DATABASE_URL
const drizzleDir = fileURLToPath(new URL('../../drizzle/', import.meta.url))
const drizzleLedger = 'drizzle.__drizzle_migrations'
const publicLedger = 'public.__drizzle_migrations'
// Two fixed PostgreSQL int4 keys: "ATHL" / "STAT". This lock scopes only this file's ledger DDL.
const advisoryLockNamespace = 0x4154484c
const advisoryLockKey = 0x53544154
let pool: Pool | undefined
let client: PoolClient | undefined
let lockHeld = false
let setupFailed = false

function databaseClient(): PoolClient {
  if (!client) throw new Error('status test database client is unavailable')
  return client
}

async function runStatus(args: string[]) {
  const previousDatabaseUrl = process.env.DATABASE_URL
  const previousExitCode = process.exitCode
  const stdout: string[] = []
  const stderr: string[] = []
  const info = vi.spyOn(console, 'info').mockImplementation((...messages: unknown[]) => {
    stdout.push(messages.map(String).join(' '))
  })
  const error = vi.spyOn(console, 'error').mockImplementation((...messages: unknown[]) => {
    stderr.push(messages.map(String).join(' '))
  })

  process.env.DATABASE_URL = connectionString
  process.exitCode = undefined
  try {
    await main(args)
    return { exitCode: process.exitCode ?? 0, stdout: stdout.join('\n'), stderr: stderr.join('\n') }
  } finally {
    info.mockRestore()
    error.mockRestore()
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
    process.exitCode = previousExitCode
  }
}

async function localMigrationHashes(): Promise<string[]> {
  const journal = JSON.parse(await readFile(`${drizzleDir}/meta/_journal.json`, 'utf8')) as {
    entries: Array<{ tag: string }>
  }
  return Promise.all(
    journal.entries.map(async (entry) =>
      createHash('sha256')
        .update(await readFile(`${drizzleDir}/${entry.tag}.sql`, 'utf8'))
        .digest('hex'),
    ),
  )
}

async function localMigrationNames(): Promise<string[]> {
  const journal = JSON.parse(await readFile(`${drizzleDir}/meta/_journal.json`, 'utf8')) as {
    entries: Array<{ tag: string }>
  }
  return journal.entries.map((entry) => entry.tag).sort()
}

async function resetLedger() {
  await databaseClient().query(`
    DROP SCHEMA IF EXISTS drizzle CASCADE;
    DROP TABLE IF EXISTS ${publicLedger};
    CREATE SCHEMA drizzle;
    CREATE TABLE ${drizzleLedger} (
      id serial PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint NOT NULL
    )
  `)
}

async function cleanupLedgers() {
  if (!client) return
  await client.query(`
    DROP SCHEMA IF EXISTS drizzle CASCADE;
    DROP TABLE IF EXISTS ${publicLedger};
  `)
}

beforeAll(async () => {
  if (!connectionString) throw new Error('ATHLOS_TEST_DATABASE_URL is required')
  pool = new Pool({ connectionString })
  try {
    client = await pool.connect()
    await client.query('SELECT pg_advisory_lock($1, $2)', [advisoryLockNamespace, advisoryLockKey])
    lockHeld = true
    await resetLedger()
  } catch (error) {
    setupFailed = true
    throw error
  }
})

afterEach(async () => {
  await resetLedger()
})

afterAll(async () => {
  const cleanupErrors: unknown[] = []
  try {
    if (lockHeld) await cleanupLedgers()
  } catch (error) {
    cleanupErrors.push(error)
  } finally {
    try {
      if (lockHeld && client) {
        await client.query('SELECT pg_advisory_unlock($1, $2)', [
          advisoryLockNamespace,
          advisoryLockKey,
        ])
      }
    } catch (error) {
      cleanupErrors.push(error)
    } finally {
      lockHeld = false
      try {
        client?.release()
      } catch (error) {
        cleanupErrors.push(error)
      } finally {
        client = undefined
        try {
          await pool?.end()
        } catch (error) {
          cleanupErrors.push(error)
        } finally {
          pool = undefined
        }
      }
    }
  }
  // Preserve setup failures as the primary error while still unwinding every acquired resource.
  if (!setupFailed && cleanupErrors.length === 1) throw cleanupErrors[0]
  if (!setupFailed && cleanupErrors.length > 1)
    throw new AggregateError(cleanupErrors, 'status test cleanup failed')
})

describe('migrate:status', () => {
  it('discovers the forward member-evidence migration through the production journal', async () => {
    await expect(localMigrationNames()).resolves.toContain('0039_socios_legacy_member_evidence')
  })

  it('discovers the forward closure preview migration through the production journal', async () => {
    await expect(localMigrationNames()).resolves.toContain('0041_socios_evidence_closure_preview')
  })

  it('discovers the forward confirmation reservation migration through the production journal', async () => {
    await expect(localMigrationNames()).resolves.toContain('0042_socios_closure_confirmation_keys')
  })

  it('reads Drizzle Kit 0.30 default drizzle ledger columns', async () => {
    await databaseClient().query(
      `INSERT INTO ${drizzleLedger} (hash, created_at) VALUES ($1, $2)`,
      ['ledger-hash', 1_700_000_000_000],
    )

    await expect(getAppliedMigrationsWithDates(connectionString!)).resolves.toEqual([
      { hash: 'ledger-hash', createdAt: new Date(1_700_000_000_000) },
    ])
  })

  it('emits clean JSON with exit code 0 when every local migration hash is applied', async () => {
    const hashes = await localMigrationHashes()
    await databaseClient().query(`TRUNCATE ${drizzleLedger}`)
    for (const [index, hash] of hashes.entries()) {
      await databaseClient().query(
        `INSERT INTO ${drizzleLedger} (hash, created_at) VALUES ($1, $2)`,
        [hash, 1_700_000_000_000 + index],
      )
    }

    const result = await runStatus(['--json'])

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ pending: [], divergence: [], exitCode: 0 })
  })

  it('emits only JSON with exit code 1 when local migrations are pending', async () => {
    await databaseClient().query(`TRUNCATE ${drizzleLedger}`)

    const result = await runStatus(['--json'])

    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({
      applied: [],
      pending: await localMigrationNames(),
      divergence: [],
      exitCode: 1,
    })
  })

  it('falls back to the public ledger when the default drizzle ledger is absent', async () => {
    await databaseClient().query(`DROP TABLE ${drizzleLedger}`)
    await databaseClient().query(
      `CREATE TABLE ${publicLedger} (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint NOT NULL)`,
    )
    await databaseClient().query(`INSERT INTO ${publicLedger} (hash, created_at) VALUES ($1, $2)`, [
      'legacy-public-hash',
      1_700_000_000_000,
    ])

    await expect(getAppliedMigrationsWithDates(connectionString!)).resolves.toEqual([
      { hash: 'legacy-public-hash', createdAt: new Date(1_700_000_000_000) },
    ])
  })

  it('fails explicitly when neither supported ledger exists', async () => {
    await databaseClient().query(`DROP TABLE ${drizzleLedger}`)

    const result = await runStatus(['--json'])

    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('migration ledger not found')
  })
})

describe('diffMigrations', () => {
  describe('empty applied list', () => {
    it('should mark all local migrations as pending', () => {
      const applied: string[] = []
      const local = ['0001_funny_eternals', '0002_stale_tyrannus']
      const result = diffMigrations(applied, local)
      expect(result.pending).toEqual(['0001_funny_eternals', '0002_stale_tyrannus'])
      expect(result.applied).toEqual([])
      expect(result.divergence).toEqual([])
    })
  })

  describe('partial applied list', () => {
    it('should mark only applied as applied, remainder as pending', () => {
      const applied = ['0000_quick_wraith']
      const local = ['0000_quick_wraith', '0001_funny_eternals', '0002_stale_tyrannus']
      const result = diffMigrations(applied, local)
      expect(result.applied).toEqual(['0000_quick_wraith'])
      expect(result.pending).toEqual(['0001_funny_eternals', '0002_stale_tyrannus'])
      expect(result.divergence).toEqual([])
    })
  })

  describe('full applied list', () => {
    it('should have no pending or divergence when local matches applied', () => {
      const applied = ['0000_quick_wraith', '0001_funny_eternals', '0002_stale_tyrannus']
      const local = ['0000_quick_wraith', '0001_funny_eternals', '0002_stale_tyrannus']
      const result = diffMigrations(applied, local)
      expect(result.applied).toEqual([
        '0000_quick_wraith',
        '0001_funny_eternals',
        '0002_stale_tyrannus',
      ])
      expect(result.pending).toEqual([])
      expect(result.divergence).toEqual([])
    })
  })

  describe('drift: DB row missing from filesystem', () => {
    it('should mark DB-only migration as divergence', () => {
      const applied = ['0000_quick_wraith', '0001_funny_eternals', '0099_ghost_migration']
      const local = ['0000_quick_wraith', '0001_funny_eternals']
      const result = diffMigrations(applied, local)
      expect(result.applied).toEqual(['0000_quick_wraith', '0001_funny_eternals'])
      expect(result.pending).toEqual([])
      expect(result.divergence).toEqual(['0099_ghost_migration'])
    })
  })

  describe('pending: filesystem entry not in DB', () => {
    it('should mark filesystem-only migration as pending', () => {
      const applied = ['0000_quick_wraith']
      const local = ['0000_quick_wraith', '0001_funny_eternals', '0002_stale_tyrannus']
      const result = diffMigrations(applied, local)
      expect(result.applied).toEqual(['0000_quick_wraith'])
      expect(result.pending).toEqual(['0001_funny_eternals', '0002_stale_tyrannus'])
      expect(result.divergence).toEqual([])
    })
  })

  describe('symmetry property', () => {
    it('applied ∪ pending ∪ divergence should equal applied ∪ local', () => {
      const applied = ['0000_quick_wraith', '0001_funny_eternals']
      const local = ['0000_quick_wraith', '0002_stale_tyrannus']
      const result = diffMigrations(applied, local)
      const all = [...result.applied, ...result.pending, ...result.divergence].sort()
      const union = [...new Set([...applied, ...local])].sort()
      expect(all).toEqual(union)
    })
  })
})

describe('statusSchema', () => {
  it('should validate a clean status response', () => {
    const input = {
      applied: ['0000_quick_wraith', '0001_funny_eternals'],
      pending: [],
      divergence: [],
      exitCode: 0 as const,
    }
    const result = statusSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('should validate a status with pending migrations', () => {
    const input = {
      applied: ['0000_quick_wraith'],
      pending: ['0001_funny_eternals', '0002_stale_tyrannus'],
      divergence: [],
      exitCode: 1 as const,
    }
    const result = statusSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('should validate a status with divergence', () => {
    const input = {
      applied: ['0000_quick_wraith'],
      pending: [],
      divergence: ['0099_ghost_migration'],
      exitCode: 1 as const,
    }
    const result = statusSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('should reject invalid exitCode', () => {
    const input = {
      applied: [],
      pending: [],
      divergence: [],
      exitCode: 2 as const,
    }
    const result = statusSchema.safeParse(input)
    // exitCode 2 is connection error, not valid for normal status
    expect(result.success).toBe(false)
  })

  it('should reject missing fields', () => {
    const input = {
      applied: ['0000_quick_wraith'],
    }
    const result = statusSchema.safeParse(input)
    expect(result.success).toBe(false)
  })
})
