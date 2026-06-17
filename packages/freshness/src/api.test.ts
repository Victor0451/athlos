import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getFreshness, refreshAll } from './api.js'

function makeMockDb(executeResults: unknown[]) {
  return {
    execute: vi.fn().mockImplementation(() => Promise.resolve(executeResults.shift())),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function makeStatsRow(domain: string, minutesAgo: number, recordCount: number) {
  return {
    domain,
    last_import_at: new Date(Date.now() - minutesAgo * 60 * 1000),
    record_count: recordCount,
    refreshed_at: new Date(),
  }
}

describe('freshness.getFreshness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns only the requested domain', async () => {
    const db = makeMockDb([{ rows: [makeStatsRow('ctacte', 30, 50_000)] }])

    const results = await getFreshness(db, { domain: 'ctacte' })

    expect(results).toHaveLength(1)
    expect(results[0]!.domain).toBe('ctacte')
    expect(results[0]!.recordCount).toBe(50000)
    expect(results[0]!.status).toBe('current')
  })

  it('returns all 11 domains from DOMAIN_THRESHOLDS', async () => {
    const allDomains = [
      'socios',
      'ctacte',
      'ctacte1',
      'contable',
      'contabl1',
      'catastros',
      'escuela',
      'deportes',
      'locacion',
      'caja',
      'gastos',
    ]
    const db = makeMockDb([
      { rows: allDomains.map((d, i) => makeStatsRow(d, 20 + i * 5, 1000 * (i + 1))) },
    ])

    const results = await getFreshness(db)

    expect(results).toHaveLength(11)
  })

  it('null last_import_at produces status unknown', async () => {
    const db = makeMockDb([
      {
        rows: [{ domain: 'caja', last_import_at: null, record_count: 0, refreshed_at: new Date() }],
      },
    ])

    const results = await getFreshness(db, { domain: 'caja' })

    expect(results[0]!.status).toBe('unknown')
    expect(results[0]!.ageDisplay).toBe('nunca')
  })

  it('stale domain (old import) produces status stale', async () => {
    // caja threshold = PT30M = 30 min; 2h ago is way beyond 1.5× grace zone
    const db = makeMockDb([{ rows: [makeStatsRow('caja', 60 * 2, 100)] }])

    const results = await getFreshness(db, { domain: 'caja' })

    expect(results[0]!.status).toBe('stale')
  })

  it('domain filter is passed through to the SQL query', async () => {
    const executeMock = vi.fn().mockResolvedValue({ rows: [] })
    const db = makeMockDb([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(db as any).execute = executeMock

    await getFreshness(db, { domain: 'socios' })

    expect(executeMock).toHaveBeenCalledOnce()
  })
})

describe('freshness.refreshAll', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array when no events exist', async () => {
    const db = makeMockDb([{ rows: [] }])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(db as any).insert = vi
      .fn()
      .mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn() }) })

    const results = await refreshAll(db)

    expect(results).toEqual([])
  })

  it('inserts a row per domain and returns the computed stats', async () => {
    const onConflictMock = vi.fn().mockResolvedValue({ rowCount: 1 })
    const insertMock = vi
      .fn()
      .mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoUpdate: onConflictMock }) })
    const db = makeMockDb([
      {
        rows: [
          {
            domain: 'ctacte',
            last_import_at: new Date('2026-06-15T10:00:00Z'),
            record_count: 50000,
          },
        ],
      },
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(db as any).insert = insertMock

    const results = await refreshAll(db, { domain: 'ctacte' })

    expect(results).toHaveLength(1)
    expect(results[0]!.domain).toBe('ctacte')
    expect(results[0]!.recordCount).toBe(50000)
    expect(insertMock).toHaveBeenCalledOnce()
    expect(onConflictMock).toHaveBeenCalledOnce()
  })

  it('filters by domain when the option is provided', async () => {
    const executeMock = vi.fn().mockResolvedValue({ rows: [] })
    const db = makeMockDb([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(db as any).execute = executeMock
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(db as any).insert = vi
      .fn()
      .mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn() }) })

    await refreshAll(db, { domain: 'caja' })

    expect(executeMock).toHaveBeenCalledOnce()
    const calledSql = executeMock.mock.calls[0]![0] as object
    expect(JSON.stringify(calledSql)).toContain('source_table')
  })

  it('upserts domain_freshness row via insert().values().onConflictDoUpdate()', async () => {
    const onConflictMock = vi.fn().mockResolvedValue({ rowCount: 1 })
    const insertMock = vi
      .fn()
      .mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoUpdate: onConflictMock }) })
    const db = makeMockDb([
      {
        rows: [
          {
            domain: 'socios',
            last_import_at: new Date('2026-06-16T08:30:00Z'),
            record_count: 12000,
          },
        ],
      },
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(db as any).insert = insertMock

    await refreshAll(db)

    expect(insertMock).toHaveBeenCalledOnce()
    expect(onConflictMock).toHaveBeenCalledOnce()
  })
})
