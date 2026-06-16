import { defineConfig } from 'vitest/config'

/**
 * Vitest config for @athlos/notifications. Node-only — the
 * dispatcher talks to the DB pool, the email adapter, and the
 * pino logger. No DOM.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    testTimeout: 5_000,
  },
})
