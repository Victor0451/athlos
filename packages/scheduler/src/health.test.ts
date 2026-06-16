import { describe, it, expect } from 'vitest'
import { getJobHealth } from './health.ts'
import { createStandinDb, asDrizzle, seedRow } from './test-standins/db.ts'
import type { JobDefinition } from './types.ts'

function makeDef(overrides: Partial<JobDefinition> = {}): JobDefinition {
  return {
    name: 'drift-detection',
    cronExpr: '*/15 * * * *',
    handler: async () => ({ status: 'succeeded' }),
    cadenceMinutes: 15,
    enabled: true,
    ...overrides,
  }
}

describe('getJobHealth', () => {
  it('marks a job with no runs as unhealthy', async () => {
    const standin = createStandinDb()
    const db = asDrizzle(standin)
    const out = await getJobHealth(db, [makeDef()])
    expect(out).toHaveLength(1)
    expect(out[0]?.healthy).toBe(false)
    expect(out[0]?.reason).toBe('no successful run recorded')
    expect(out[0]?.lastRun).toBeNull()
  })

  it('marks a job with a recent successful run as healthy', async () => {
    const standin = createStandinDb()
    const db = asDrizzle(standin)
    seedRow(standin, {
      jobName: 'drift-detection',
      status: 'succeeded',
      startedAt: new Date(Date.now() - 5 * 60_000), // 5 min ago
    })
    const out = await getJobHealth(db, [makeDef()])
    expect(out[0]?.healthy).toBe(true)
    expect(out[0]?.reason).toBe('')
  })

  it('marks a job with a stale successful run (over 2× cadence) as unhealthy', async () => {
    const standin = createStandinDb()
    const db = asDrizzle(standin)
    seedRow(standin, {
      jobName: 'drift-detection',
      status: 'succeeded',
      startedAt: new Date(Date.now() - 2 * 60 * 60_000), // 2 hours ago
    })
    const out = await getJobHealth(db, [makeDef({ cadenceMinutes: 15 })])
    expect(out[0]?.healthy).toBe(false)
    expect(out[0]?.reason).toMatch(/2× interval/)
  })

  it('ignores failed runs when computing the healthy baseline', async () => {
    const standin = createStandinDb()
    const db = asDrizzle(standin)
    // Recent failure
    seedRow(standin, {
      jobName: 'drift-detection',
      status: 'failed',
      startedAt: new Date(Date.now() - 1 * 60_000),
    })
    // Old success — over 2× interval
    seedRow(standin, {
      jobName: 'drift-detection',
      status: 'succeeded',
      startedAt: new Date(Date.now() - 60 * 60_000),
    })
    const out = await getJobHealth(db, [makeDef({ cadenceMinutes: 15 })])
    expect(out[0]?.healthy).toBe(false)
  })

  it('marks manual-only jobs as healthy when no run is in flight', async () => {
    const standin = createStandinDb()
    const db = asDrizzle(standin)
    const out = await getJobHealth(db, [
      makeDef({ name: 'import-batch', cronExpr: null, cadenceMinutes: null }),
    ])
    expect(out[0]?.healthy).toBe(true)
    expect(out[0]?.cadenceMinutes).toBeNull()
  })

  it('marks manual-only jobs as unhealthy when a run is in flight', async () => {
    const standin = createStandinDb()
    const db = asDrizzle(standin)
    seedRow(standin, {
      jobName: 'import-batch',
      status: 'running',
      startedAt: new Date(),
    })
    const out = await getJobHealth(db, [
      makeDef({ name: 'import-batch', cronExpr: null, cadenceMinutes: null }),
    ])
    expect(out[0]?.healthy).toBe(false)
    expect(out[0]?.reason).toBe('manual run in progress')
    expect(out[0]?.inFlight).toBe(true)
  })

  it('returns lastRun metadata when a row exists', async () => {
    const standin = createStandinDb()
    const db = asDrizzle(standin)
    seedRow(standin, {
      jobName: 'drift-detection',
      status: 'succeeded',
      startedAt: new Date(Date.now() - 1_000),
      attempt: 1,
    })
    const out = await getJobHealth(db, [makeDef()])
    expect(out[0]?.lastRun).not.toBeNull()
    expect(out[0]?.lastRun?.status).toBe('succeeded')
    expect(out[0]?.lastRun?.attempt).toBe(1)
  })
})
