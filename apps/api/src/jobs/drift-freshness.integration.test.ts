import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeDriftDetectionHandler } from './drift-detection.ts'
import { makeFreshnessRefreshHandler } from './freshness-refresh.ts'

// Minimal logger that satisfies JobContext['log'] shape
function makeLogger() {
  const noop = () => undefined
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => makeLogger(),
    level: 'silent',
  } as never
}

// Mock the @athlos/drift package
vi.mock('@athlos/drift', () => ({
  detect: vi.fn(),
  emitDriftAlert: vi.fn(),
}))

// Mock the @athlos/freshness package
vi.mock('@athlos/freshness', () => ({
  refreshAll: vi.fn(),
}))

// Import after mock is set
import { detect, emitDriftAlert } from '@athlos/drift'
import { refreshAll } from '@athlos/freshness'

describe('drift-detection job handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls detect with no domain filter when metadata has no domain', async () => {
    const db = {} as never
    const handler = makeDriftDetectionHandler(db)

    // Mock detect returning no drift
    vi.mocked(detect).mockResolvedValueOnce({
      domain: null,
      scanned: 0,
      driftCount: 0,
      drifts: [],
    })

    const result = await handler({
      jobRunId: 'jr-drift-1',
      jobName: 'drift-detection',
      attempt: 1,
      triggeredBy: 'scheduler',
      metadata: {},
      log: makeLogger(),
      signal: new AbortController().signal,
    })

    expect(detect).toHaveBeenCalledWith(expect.anything(), {})
    expect(result.status).toBe('succeeded')
    expect(result.metadata).toMatchObject({ drift_count: 0 })
    expect(emitDriftAlert).not.toHaveBeenCalled()
  })

  it('calls detect with domain filter from metadata', async () => {
    const db = {} as never
    const handler = makeDriftDetectionHandler(db)

    vi.mocked(detect).mockResolvedValueOnce({
      domain: 'ctacte',
      scanned: 100,
      driftCount: 0,
      drifts: [],
    })

    await handler({
      jobRunId: 'jr-drift-2',
      jobName: 'drift-detection',
      attempt: 1,
      triggeredBy: 'scheduler',
      metadata: { domain: 'ctacte' },
      log: makeLogger(),
      signal: new AbortController().signal,
    })

    expect(detect).toHaveBeenCalledWith(expect.anything(), { domain: 'ctacte' })
  })

  it('emits alert and returns drift count when drift is detected', async () => {
    const db = {} as never
    const handler = makeDriftDetectionHandler(db)

    const mockReport = {
      domain: 'ctacte',
      scanned: 50_000,
      driftCount: 2,
      drifts: [
        { entityUuid: 'uuid-1', oldHash: 'abc', newHash: 'xyz', lastImportedAt: new Date() },
        { entityUuid: 'uuid-2', oldHash: 'def', newHash: 'uvw', lastImportedAt: new Date() },
      ],
    }
    vi.mocked(detect).mockResolvedValueOnce(mockReport)
    vi.mocked(emitDriftAlert).mockResolvedValueOnce({ audited: true, notificationDispatched: true })

    const result = await handler({
      jobRunId: 'jr-drift-3',
      jobName: 'drift-detection',
      attempt: 1,
      triggeredBy: 'scheduler',
      metadata: {},
      log: makeLogger(),
      signal: new AbortController().signal,
    })

    expect(emitDriftAlert).toHaveBeenCalledWith(expect.anything(), mockReport, {
      jobRunId: 'jr-drift-3',
    })
    expect(result.metadata).toMatchObject({ drift_count: 2, domain: 'ctacte', scanned: 50000 })
  })
})

describe('freshness-refresh job handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls refreshAll with no filter when domain is all', async () => {
    const db = {} as never
    const handler = makeFreshnessRefreshHandler(db)

    vi.mocked(refreshAll).mockResolvedValueOnce([
      { domain: 'socios', lastImportAt: new Date('2026-06-15T10:00:00Z'), recordCount: 30_000 },
      { domain: 'ctacte', lastImportAt: new Date('2026-06-15T09:00:00Z'), recordCount: 50_000 },
    ])

    const result = await handler({
      jobRunId: 'jr-fresh-1',
      jobName: 'freshness-refresh',
      attempt: 1,
      triggeredBy: 'scheduler',
      metadata: {},
      log: makeLogger(),
      signal: new AbortController().signal,
    })

    expect(refreshAll).toHaveBeenCalledWith(expect.anything(), {})
    expect(result.status).toBe('succeeded')
    expect(result.metadata).toMatchObject({
      scope: 'all',
      refreshed_domains: ['socios', 'ctacte'],
    })
  })

  it('calls refreshAll with domain filter from metadata', async () => {
    const db = {} as never
    const handler = makeFreshnessRefreshHandler(db)

    vi.mocked(refreshAll).mockResolvedValueOnce([
      { domain: 'caja', lastImportAt: new Date('2026-06-16T08:00:00Z'), recordCount: 500 },
    ])

    const result = await handler({
      jobRunId: 'jr-fresh-2',
      jobName: 'freshness-refresh',
      attempt: 1,
      triggeredBy: 'post-import',
      metadata: { domain: 'caja' },
      log: makeLogger(),
      signal: new AbortController().signal,
    })

    expect(refreshAll).toHaveBeenCalledWith(expect.anything(), { domain: 'caja' })
    expect(result.metadata).toMatchObject({ scope: 'caja', refreshed_domains: ['caja'] })
  })

  it('returns empty refreshed_domains when no domains match', async () => {
    const db = {} as never
    const handler = makeFreshnessRefreshHandler(db)

    vi.mocked(refreshAll).mockResolvedValueOnce([])

    const result = await handler({
      jobRunId: 'jr-fresh-3',
      jobName: 'freshness-refresh',
      attempt: 1,
      triggeredBy: 'scheduler',
      metadata: {},
      log: makeLogger(),
      signal: new AbortController().signal,
    })

    expect(result.metadata).toMatchObject({ scope: 'all', refreshed_domains: [] })
  })
})
