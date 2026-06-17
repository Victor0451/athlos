import { defineConfig } from 'vitest/config'

/**
 * Vitest config for @athlos/freshness. Node-only — pure TypeScript
 * functions (thresholds, status mapping, age display).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    testTimeout: 5_000,
  },
})
