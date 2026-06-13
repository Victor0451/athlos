import type { ConfigBase } from 'vitest/config'

/**
 * Vitest config preset for backend (Node.js) packages — services, API,
 * data-access, integrations. No jsdom, no DOM globals, no fake browser APIs.
 *
 * Defaults match the testing-setup spec §B: 10s timeout, v8 coverage provider,
 * and the standard exclusion set (migrations, config files, test files).
 */
export function nodePreset(): Partial<ConfigBase> {
  return {
    test: {
      environment: 'node',
      globals: false,
      include: ['src/**/*.{test,spec}.ts'],
      timeout: 10_000,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json-summary', 'html'],
        exclude: [
          '**/node_modules/**',
          '**/dist/**',
          '**/drizzle/**',
          '**/*.config.ts',
          '**/*.test.ts',
          '**/*.spec.ts',
          'vitest.setup.ts',
        ],
      },
    },
  }
}
