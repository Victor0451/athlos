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
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { diffMigrations, getAppliedMigrationsWithDates, statusSchema } from './status.ts'

const connectionString = process.env.ATHLOS_TEST_DATABASE_URL
const drizzleDir = fileURLToPath(new URL('../../drizzle/', import.meta.url))
const ledger = 'drizzle.__drizzle_migrations'
let pool: Pool

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  return new Promise<{ exitCode: number; stdout: string }>((resolve, reject) => {
    const child = spawn(command, args, { cwd, env })
    let stdout = ''
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.once('error', reject)
    child.once('close', (exitCode) => resolve({ exitCode: exitCode ?? 1, stdout }))
  })
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

beforeAll(async () => {
  if (!connectionString) throw new Error('ATHLOS_TEST_DATABASE_URL is required')
  pool = new Pool({ connectionString })
  await pool.query(`
    CREATE SCHEMA drizzle;
    CREATE TABLE ${ledger} (
      id serial PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint NOT NULL
    )
  `)
})

afterAll(async () => {
  await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE')
  await pool.end()
})

describe('migrate:status', () => {
  it('discovers the forward member-evidence migration through the production journal', async () => {
    await expect(localMigrationNames()).resolves.toContain('0039_socios_legacy_member_evidence')
  })

  it('discovers the forward closure preview migration through the production journal', async () => {
    await expect(localMigrationNames()).resolves.toContain('0041_socios_evidence_closure_preview')
  })

  it('reads the hash and created_at columns used by the Drizzle migration ledger', async () => {
    await pool.query(`INSERT INTO ${ledger} (hash, created_at) VALUES ($1, $2)`, [
      'ledger-hash',
      1_700_000_000_000,
    ])

    await expect(getAppliedMigrationsWithDates(connectionString!)).resolves.toEqual([
      { hash: 'ledger-hash', createdAt: new Date(1_700_000_000_000) },
    ])
  })

  it('emits clean JSON with exit code 0 when every local migration hash is applied', async () => {
    const hashes = await localMigrationHashes()
    await pool.query(`TRUNCATE ${ledger}`)
    for (const [index, hash] of hashes.entries()) {
      await pool.query(`INSERT INTO ${ledger} (hash, created_at) VALUES ($1, $2)`, [
        hash,
        1_700_000_000_000 + index,
      ])
    }

    const result = await run(
      fileURLToPath(new URL('../../node_modules/.bin/tsx', import.meta.url)),
      ['src/scripts/status.ts', '--json'],
      fileURLToPath(new URL('../../', import.meta.url)),
      { ...process.env, DATABASE_URL: connectionString },
    )

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ pending: [], divergence: [], exitCode: 0 })
  })

  it('emits only JSON with exit code 1 when local migrations are pending', async () => {
    await pool.query(`TRUNCATE ${ledger}`)

    const result = await run(
      fileURLToPath(new URL('../../node_modules/.bin/tsx', import.meta.url)),
      ['src/scripts/status.ts', '--json'],
      fileURLToPath(new URL('../../', import.meta.url)),
      { ...process.env, DATABASE_URL: connectionString },
    )

    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({
      applied: [],
      pending: await localMigrationNames(),
      divergence: [],
      exitCode: 1,
    })
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
