import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Db } from '@athlos/db'
import type { AppContainer } from '../../container.ts'
import { createStandinDb } from '../../test-standins/db.ts'
import { promoteAll } from '@athlos/promotion'
import type { JobHandler } from '@athlos/scheduler'

vi.mock('@athlos/promotion', () => ({
  promoteAll: vi.fn(),
}))

/**
 * Build a minimal AppContainer with a standin DB and a mock
 * promotionInFlight flag that tests can toggle.
 */
function makeTestContainer(db: Db) {
  const container: AppContainer = {
    db,
    pool: { end: async () => undefined } as never,
    legacyDb: { type: 'stub', close: async () => undefined } as never,
    whatsapp: { type: 'stub' } as never,
    email: { type: 'stub', send: async () => ({ id: 'stub' }) } as never,
    clock: { type: 'stub', now: () => new Date() } as never,
    env: {
      NODE_ENV: 'test',
      PORT: 3001,
      HOST: '0.0.0.0',
      LOG_LEVEL: 'fatal',
      DATABASE_URL: 'postgresql://test/test',
      JWT_SECRET: 'test-secret-please-rotate-32chars-minimum',
      JWT_REFRESH_SECRET: 'test-secret-please-rotate-32chars-minimum',
      JWT_ACCESS_TTL_SECONDS: 900,
      JWT_REFRESH_TTL_SECONDS: 604800,
      LEGACY_DB_PATH: '/tmp/athlos-test-legacy',
      CORS_ORIGINS: 'http://localhost:3000',
      FROM_ADDRESS: 'noreply@gorriti.app',
      DRIFT_DETECTION_CRON: '*/15 * * * *',
      FRESHNESS_REFRESH_CRON: '*/5 * * * *',
      TOKEN_CLEANUP_CRON: '0 3 * * *',
      RECONCILIATION_CRON: '0 * * * *',
      PROMOTION_CRON: '0 */6 * * *',
      AUDIT_RETENTION_DAYS: 90,
      DUES_ASSESSMENT_ENABLED: false,
      DUES_AGREEMENTS_ENABLED: false,
      DUES_CASH_ENABLED: false,
      DUES_CTACTE_PROJECTION_ENABLED: false,
      STORAGE_LOCAL_ROOT: '/app/storage',
      STORAGE_MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,
    },
    driftService: {
      detect: async () => ({ driftCount: 0, domain: 'all', scanned: 0 }),
      detectAll: async () => ({ driftCount: 0, domain: 'all', scanned: 0 }),
      emitDriftAlert: async () => ({ audited: true, notificationDispatched: false }),
    } as never,
    freshnessService: { getFreshness: async () => [], refreshAll: async () => [] } as never,
    permissionsRepo: {
      hasPermission: async () => false,
      grant: async () => undefined,
      revoke: async () => undefined,
    } as never,
    projectionService: {
      rebuild: async () => ({ rowCount: 0, durationMs: 0 }),
      rebuildAll: async () => ({ domainsChecked: [], totalRowCount: 0 }),
    } as never,
    auditPlugin: undefined as never,
    promotionInFlight: false,
  }
  return container
}

describe('makeScheduledPromotionHandler', () => {
  let db: Db
  let container: AppContainer

  beforeEach(() => {
    vi.resetAllMocks()
    const standin = createStandinDb()
    db = standin.drizzle as unknown as Db
    container = makeTestContainer(db)
  })

  it('returns succeeded with metadata when promoteAll succeeds', async () => {
    const { makeScheduledPromotionHandler } = await import('../scheduled-promotion.ts')
    const handler: JobHandler = makeScheduledPromotionHandler(db, container)

    vi.mocked(promoteAll).mockResolvedValue([
      {
        domain: 'socios',
        attempted: 10,
        inserted: 8,
        skipped: 2,
        failed: 0,
        errors: [],
        durationMs: 150,
      },
      {
        domain: 'ctacte',
        attempted: 5,
        inserted: 3,
        skipped: 1,
        failed: 1,
        errors: [{ sourceKey: 'ctacte:1', reason: 'FK blocked' }],
        durationMs: 80,
      },
    ])

    const ctx = {
      jobRunId: '00000000-0000-4000-8000-000000000001',
      jobName: 'scheduled-promotion',
      attempt: 1,
      triggeredBy: 'scheduler' as const,
      metadata: {},
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
      } as never,
      signal: {
        aborted: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onabort: null,
      } as never,
    }

    const result = await handler(ctx as never)

    expect(result.status).toBe('succeeded')
    expect(result.metadata).toMatchObject({
      totals: { inserted: 11, skipped: 3, failed: 1 },
      durationMs: expect.any(Number),
      domains: expect.arrayContaining([
        expect.objectContaining({
          domain: 'socios',
          attempted: 10,
          inserted: 8,
          skipped: 2,
          failed: 0,
        }),
        expect.objectContaining({
          domain: 'ctacte',
          attempted: 5,
          inserted: 3,
          skipped: 1,
          failed: 1,
        }),
      ]),
    })
    expect(container.promotionInFlight).toBe(false) // reset after run
  })

  it('throws when promotionInFlight is true without modifying the flag', async () => {
    const { makeScheduledPromotionHandler } = await import('../scheduled-promotion.ts')
    const handler: JobHandler = makeScheduledPromotionHandler(db, container)
    container.promotionInFlight = true
    const flagBefore = container.promotionInFlight

    const ctx = {
      jobRunId: '00000000-0000-4000-8000-000000000002',
      jobName: 'scheduled-promotion',
      attempt: 1,
      triggeredBy: 'scheduler' as const,
      metadata: {},
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
      } as never,
      signal: {
        aborted: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onabort: null,
      } as never,
    } as never

    await expect(handler(ctx)).rejects.toThrow('promotion already in flight')
    // The handler throws BEFORE setting the flag, so it stays at the pre-handler value.
    expect(container.promotionInFlight).toBe(flagBefore)
  })

  it('propagates error when promoteAll throws', async () => {
    const { makeScheduledPromotionHandler } = await import('../scheduled-promotion.ts')
    const handler: JobHandler = makeScheduledPromotionHandler(db, container)

    vi.mocked(promoteAll).mockRejectedValue(new Error('DB connection lost'))

    const ctx = {
      jobRunId: '00000000-0000-4000-8000-000000000003',
      jobName: 'scheduled-promotion',
      attempt: 1,
      triggeredBy: 'scheduler' as const,
      metadata: {},
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
      } as never,
      signal: {
        aborted: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onabort: null,
      } as never,
    } as never

    await expect(handler(ctx)).rejects.toThrow('DB connection lost')
    expect(container.promotionInFlight).toBe(false) // reset after error
  })
})
