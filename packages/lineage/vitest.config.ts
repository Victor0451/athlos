import { defineConfig } from 'vitest/config'

/**
 * Vitest config for @athlos/lineage. Node-only — the package queries
 * Postgres via Drizzle and computes SHA-256 hashes.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    testTimeout: 5_000,
  },
})
