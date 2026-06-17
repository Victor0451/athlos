import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeReconciliationHandler } from './reconciliation.ts'

// Minimal logger
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

describe('makeReconciliationHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rebuilds all domains and detects drift', async () => {
    const mockProjectionService = {
      rebuild: vi.fn().mockResolvedValue({ rowCount: 100, durationMs: 50 }),
      rebuildAll: vi.fn().mockResolvedValue({
        domainsChecked: ['socios', 'ctacte'],
        totalRowCount: 200,
      }),
    }

    const mockDriftService = {
      detect: vi.fn().mockResolvedValue({ domain: null, scanned: 200, driftCount: 0, drifts: [] }),
      detectAll: vi
        .fn()
        .mockResolvedValue({ domain: null, scanned: 200, driftCount: 0, drifts: [] }),
      emitDriftAlert: vi.fn(),
    }

    const handler = makeReconciliationHandler(mockProjectionService, mockDriftService)

    const result = await handler({
      jobRunId: 'jr-recon-1',
      jobName: 'reconciliation',
      attempt: 1,
      triggeredBy: 'scheduler',
      metadata: {},
      log: makeLogger(),
      signal: new AbortController().signal,
    })

    expect(result.status).toBe('succeeded')
    expect(result.metadata).toMatchObject({
      domains_checked: ['socios', 'ctacte'],
      total_rows: 200,
      drift_count: 0,
    })
    expect(mockProjectionService.rebuildAll).toHaveBeenCalled()
    expect(mockDriftService.detectAll).toHaveBeenCalled()
  })
})
