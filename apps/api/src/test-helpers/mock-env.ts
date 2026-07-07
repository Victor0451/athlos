/**
 * Test-only factory: returns a fully-typed `Env` object suitable for
 * `signAccessToken()`, `authPlugin`, and `mockContainer.env` in route
 * integration tests. Centralized here so the partial-env test pattern
 * stays consistent across the 5 route test files in `apps/api/src/routes/`.
 *
 * Why a helper:
 *  - `Env` has 20+ fields (most have defaults, but TS strict mode requires
 *    the full object literal at the test boundary).
 *  - Tests only care about 2-3 fields (JWT_SECRET, JWT_ACCESS_TTL_SECONDS).
 *    Inlining the full env per test is noisy and error-prone.
 *  - The `as never` escape hatch (which the original tests used) hides
 *    typecheck errors. We avoid it by having a single, validated factory.
 *
 * Usage in a route test:
 * ```ts
 * import { mockEnv } from '../test/helpers/mock-env.ts'
 * const env = mockEnv()
 * signAccessToken({ sub, role, permissions }, env)
 * ```
 */
const PLACEHOLDER_SECRET = 'test-secret-please-rotate-32chars-minimum'

export const mockEnv = () => ({
  NODE_ENV: 'test' as const,
  PORT: 3001,
  HOST: '0.0.0.0',
  LOG_LEVEL: 'fatal' as const,
  DATABASE_URL: 'postgresql://athlos:athlos@localhost:5432/athlos_test',
  JWT_SECRET: PLACEHOLDER_SECRET,
  JWT_REFRESH_SECRET: PLACEHOLDER_SECRET,
  JWT_ACCESS_TTL_SECONDS: 900,
  JWT_REFRESH_TTL_SECONDS: 604800,
  LEGACY_DB_PATH: '/tmp/legacy-test',
  CORS_ORIGINS: 'http://localhost:3000',
  FROM_ADDRESS: 'noreply@test.local',
  DRIFT_DETECTION_CRON: '*/15 * * * *',
  FRESHNESS_REFRESH_CRON: '*/5 * * * *',
  TOKEN_CLEANUP_CRON: '0 3 * * *',
  RECONCILIATION_CRON: '0 * * * *',
  PROMOTION_CRON: '0 */6 * * *',
  AUDIT_RETENTION_DAYS: 90,
  STORAGE_LOCAL_ROOT: '/app/storage',
  STORAGE_MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,
})

export type MockEnv = ReturnType<typeof mockEnv>
