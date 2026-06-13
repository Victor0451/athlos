import { defineConfig } from 'vitest/config'

/**
 * Vitest config for @athlos/errors. Backend preset, no coverage by default
 * (the package is leaf-level primitives — full coverage would couple to
 * the Fastify server, which lives in apps/api).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    testTimeout: 5_000,
  },
})
