import { defineConfig } from 'vitest/config'

/**
 * Vitest config for @athlos/projection. Node-only — the package queries
 * Postgres via Drizzle and computes saldo from raw_events.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    testTimeout: 5_000,
  },
})
