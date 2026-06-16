import { defineConfig } from 'vitest/config'

/**
 * Vitest config for @athlos/import. Node-only — the package talks
 * to the DBF reader, Postgres, and the legacy-db adapter.
 *
 * Tests use a tiny per-test in-memory standin for the raw_events
 * insert path so they run without Docker. The full SQL semantics
 * (`ON CONFLICT DO NOTHING`, jsonb) are exercised in CI's Postgres
 * service by the integration suite.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    testTimeout: 5_000,
  },
})
