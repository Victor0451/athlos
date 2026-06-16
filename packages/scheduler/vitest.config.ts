import { defineConfig } from 'vitest/config'

/**
 * Vitest config for @athlos/scheduler. Node-only — the scheduler talks
 * to Postgres and the cron engine, no DOM, no fake browser APIs.
 *
 * Tests use the in-memory Drizzle standin (mirrors `apps/api`'s
 * `test-standins/db.ts` pattern) so they run without Docker.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    testTimeout: 5_000,
  },
})
