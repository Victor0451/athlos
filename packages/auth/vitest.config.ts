import { defineConfig } from 'vitest/config'

/**
 * Vitest config for @athlos/auth. Uses the node preset (no DOM) — the
 * package deals with bcrypt and JWT, both pure Node.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    testTimeout: 10_000,
  },
})
