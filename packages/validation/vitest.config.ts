import { defineConfig } from 'vitest/config'

/**
 * Vitest config for @athlos/validation. Pure Zod schemas — no Fastify,
 * no DB. Defaults to 5s timeout (schemas are synchronous, tests are
 * short). Backend preset, no DOM.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    testTimeout: 5_000,
  },
})
