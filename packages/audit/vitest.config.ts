import { defineConfig } from 'vitest/config'

/**
 * Vitest config for @athlos/audit. Node-only — the package uses
 * Drizzle ORM to write/read audit_events.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    testTimeout: 5_000,
  },
})
