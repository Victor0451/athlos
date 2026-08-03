import { describe, it, expect } from 'vitest'
import {
  recordStart,
  recordRunning,
  recordFinish,
  reconcileOrphanedRuns,
  markInflightAsShutdown,
  getLastRun,
  listAttentionRuns,
  listRuns,
} from './run-tracker.ts'
import { createStandinDb, asDrizzle, findRow, listRows, seedRow } from './test-standins/db.ts'

/**
 * The run-tracker is the SQL surface for the `job_runs` state machine.
 * Tests use the in-memory Drizzle standin; the production code path
 * is exercised in CI's Postgres service.
 */
describe('recordStart', () => {
  it('inserts a row with status=pending and returns it', async () => {
    const standin = createStandinDb()
    const db = asDrizzle(standin)
    const row = await recordStart(db, {
      jobName: 'drift-detection',
      triggeredBy: 'scheduler',
      metadata: { tickAt: '2026-01-01T00:00:00Z' },
    })
    expect(row.status).toBe('pending')
    expect(row.attempt).toBe(1)
    expect(row.jobName).toBe('drift-detection')
    expect(row.triggeredBy).toBe('scheduler')
    expect(row.metadata).toEqual({ tickAt: '2026-01-01T00:00:00Z' })
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(listRows(standin)).toHaveLength(1)
  })
})

describe('recordRunning', () => {
  it('transitions a pending row to running and stamps startedAt', async () => {
    const standin = createStandinDb()
    const db = asDrizzle(standin)
    const row = await recordStart(db, {
      jobName: 'token-cleanup',
      triggeredBy: 'scheduler',
      metadata: {},
    })
    expect(row.startedAt).toBeNull()
    await recordRunning(db, row.id)
    const updated = findRow(standin, row.id)
    expect(updated?.status).toBe('running')
    expect(updated?.startedAt).toBeInstanceOf(Date)
  })
})

describe('recordFinish', () => {
  it('marks a row succeeded and merges metadata', async () => {
    const standin = createStandinDb()
    const db = asDrizzle(standin)
    const row = await recordStart(db, {
      jobName: 'drift-detection',
      triggeredBy: 'scheduler',
      metadata: { tickAt: 'x' },
    })
    await recordRunning(db, row.id)
    const updated = await recordFinish(db, {
      jobRunId: row.id,
      status: 'succeeded',
      metadata: { drift_count: 0 },
    })
    expect(updated?.status).toBe('succeeded')
    expect(updated?.finishedAt).toBeInstanceOf(Date)
    expect(updated?.metadata).toEqual({ drift_count: 0 })
  })

  it('marks a row failed with error_message preserved', async () => {
    const standin = createStandinDb()
    const db = asDrizzle(standin)
    const row = await recordStart(db, {
      jobName: 'token-cleanup',
      triggeredBy: 'scheduler',
      metadata: {},
    })
    await recordRunning(db, row.id)
    const updated = await recordFinish(db, {
      jobRunId: row.id,
      status: 'failed',
      errorMessage: 'connection refused',
      attempt: 1,
    })
    expect(updated?.status).toBe('failed')
    expect(updated?.errorMessage).toBe('connection refused')
    expect(updated?.attempt).toBe(1)
  })

  it('marks a row dead_letter with the final attempt', async () => {
    const standin = createStandinDb()
    const db = asDrizzle(standin)
    const row = await recordStart(db, {
      jobName: 'drift-detection',
      triggeredBy: 'scheduler',
      metadata: {},
    })
    await recordRunning(db, row.id)
    const updated = await recordFinish(db, {
      jobRunId: row.id,
      status: 'dead_letter',
      errorMessage: 'db down x3',
      attempt: 3,
    })
    expect(updated?.status).toBe('dead_letter')
    expect(updated?.attempt).toBe(3)
  })
})

describe('reconcileOrphanedRuns', () => {
  it('marks orphaned running rows as failed', async () => {
    const standin = createStandinDb()
    const db = asDrizzle(standin)
    // Seed a running row (the post-crash state).
    seedRow(standin, { jobName: 'drift-detection', status: 'running' })
    seedRow(standin, { jobName: 'freshness-refresh', status: 'running' })
    seedRow(standin, { jobName: 'token-cleanup', status: 'succeeded' })

    const count = await reconcileOrphanedRuns(db)
    // The standin's `update().where().returning()` returns the matching
    // rows, so count === number reconciled.
    expect(count).toBe(2)
    const rows = listRows(standin)
    const failed = rows.filter((r) => r.status === 'failed')
    expect(failed).toHaveLength(2)
    for (const r of failed) {
      expect(r.errorMessage).toBe('process terminated unexpectedly')
    }
    const succeeded = rows.find((r) => r.jobName === 'token-cleanup')
    expect(succeeded?.status).toBe('succeeded')
  })

  it('returns 0 when no running rows exist', async () => {
    const standin = createStandinDb()
    const db = asDrizzle(standin)
    seedRow(standin, { jobName: 'drift-detection', status: 'succeeded' })
    const count = await reconcileOrphanedRuns(db)
    expect(count).toBe(0)
  })
})

describe('markInflightAsShutdown', () => {
  it('marks running rows as failed with process shutdown', async () => {
    const standin = createStandinDb()
    const db = asDrizzle(standin)
    seedRow(standin, { jobName: 'freshness-refresh', status: 'running' })
    const count = await markInflightAsShutdown(db)
    expect(count).toBe(1)
    const row = listRows(standin)[0]
    expect(row?.status).toBe('failed')
    expect(row?.errorMessage).toBe('process shutdown')
  })
})

describe('getLastRun', () => {
  it('returns the most recent row for a job name', async () => {
    const standin = createStandinDb()
    const db = asDrizzle(standin)
    const old = seedRow(standin, {
      jobName: 'drift-detection',
      status: 'succeeded',
      scheduledAt: new Date('2024-01-01T00:00:00Z'),
    })
    const recent = seedRow(standin, {
      jobName: 'drift-detection',
      status: 'failed',
      scheduledAt: new Date('2024-06-01T00:00:00Z'),
    })
    const last = await getLastRun(db, 'drift-detection')
    expect(last?.id).toBe(recent.id)
    expect(last?.id).not.toBe(old.id)
  })

  it('returns null when no rows exist for the name', async () => {
    const standin = createStandinDb()
    const db = asDrizzle(standin)
    const last = await getLastRun(db, 'unknown-job')
    expect(last).toBeNull()
  })
})

describe('listRuns', () => {
  it('returns every row when no filter is provided', async () => {
    const standin = createStandinDb()
    const db = asDrizzle(standin)
    await recordStart(db, { jobName: 'a', triggeredBy: 'manual', metadata: {} })
    await recordStart(db, { jobName: 'b', triggeredBy: 'manual', metadata: {} })
    const out = await listRuns(db, {})
    expect(out).toHaveLength(2)
  })

  it('filters by job name', async () => {
    const standin = createStandinDb()
    const db = asDrizzle(standin)
    await recordStart(db, { jobName: 'a', triggeredBy: 'manual', metadata: {} })
    await recordStart(db, { jobName: 'b', triggeredBy: 'manual', metadata: {} })
    const out = await listRuns(db, { jobName: 'a' })
    expect(out).toHaveLength(1)
    expect(out[0]?.jobName).toBe('a')
  })

  it('filters by status', async () => {
    const standin = createStandinDb()
    const db = asDrizzle(standin)
    const a = await recordStart(db, { jobName: 'a', triggeredBy: 'manual', metadata: {} })
    await recordStart(db, { jobName: 'b', triggeredBy: 'manual', metadata: {} })
    await recordFinish(db, {
      jobRunId: a.id,
      status: 'failed',
      errorMessage: 'boom',
    })
    const failed = await listRuns(db, { status: 'failed' })
    expect(failed).toHaveLength(1)
    expect(failed[0]?.id).toBe(a.id)
  })

  it('respects the limit (hard-capped at 200)', async () => {
    const standin = createStandinDb()
    const db = asDrizzle(standin)
    for (let i = 0; i < 5; i += 1) {
      await recordStart(db, { jobName: 'x', triggeredBy: 'manual', metadata: {} })
    }
    expect(await listRuns(db, { limit: 3 })).toHaveLength(3)
    // A limit of 1000 is capped at 200 — but we only inserted 5,
    // so the result is 5. The cap is enforced, not the floor.
    expect(await listRuns(db, { limit: 1000 })).toHaveLength(5)
  })
})

describe('listAttentionRuns', () => {
  it('returns only the four attention statuses in descending run order', async () => {
    const standin = createStandinDb()
    const db = asDrizzle(standin)
    const oldest = seedRow(standin, {
      jobName: 'old-failure',
      status: 'failed',
      startedAt: new Date('2026-08-01T08:00:00.000Z'),
    })
    const current = seedRow(standin, {
      jobName: 'review-needed',
      status: 'completed_with_review',
      startedAt: new Date('2026-08-01T11:00:00.000Z'),
    })
    const cancelled = seedRow(standin, {
      jobName: 'cancelled-job',
      status: 'cancelled',
      startedAt: new Date('2026-08-01T10:00:00.000Z'),
    })
    const deadLetter = seedRow(standin, {
      jobName: 'dead-letter-job',
      status: 'dead_letter',
      startedAt: new Date('2026-08-01T09:00:00.000Z'),
    })
    seedRow(standin, {
      jobName: 'successful-job',
      status: 'succeeded',
      startedAt: new Date('2026-08-01T12:00:00.000Z'),
    })

    const runs = await listAttentionRuns(db, 10)

    expect(runs.map((run) => run.id)).toEqual([current.id, cancelled.id, deadLetter.id, oldest.id])
    expect(runs.map((run) => run.status)).toEqual([
      'completed_with_review',
      'cancelled',
      'dead_letter',
      'failed',
    ])
  })

  it('caps the attention list at the requested bounded limit', async () => {
    const standin = createStandinDb()
    const db = asDrizzle(standin)
    for (let i = 0; i < 3; i += 1) {
      seedRow(standin, {
        jobName: `failed-${i}`,
        status: 'failed',
        startedAt: new Date(`2026-08-01T0${i}:00:00.000Z`),
      })
    }

    const runs = await listAttentionRuns(db, 2)

    expect(runs).toHaveLength(2)
    expect(runs.every((run) => run.status === 'failed')).toBe(true)
  })
})
