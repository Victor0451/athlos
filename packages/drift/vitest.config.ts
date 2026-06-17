import { defineConfig } from 'vitest/config'

/**
 * Vitest config for @athlos/drift. Node-only — the package queries
 * Postgres via Drizzle and compares content hashes.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    testTimeout: 5_000,
  },
})
