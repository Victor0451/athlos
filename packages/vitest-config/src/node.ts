import type { InlineConfig } from 'vitest'

/**
 * Vitest config preset for backend (Node.js) packages — services, API,
 * data-access, integrations. No jsdom, no DOM globals, no fake browser APIs.
 *
 * Defaults match the testing-setup spec section B: 10s timeout, v8 coverage
 * provider, and the standard exclusion set (migrations, config files,
 * test files).
 */
export function nodePreset(): Partial<InlineConfig> {
  return {
    environment: 'node',
    globals: false,
    include: ['src/**/*.{test,spec}.ts'],
    testTimeout: 10_000,
    // Parallel test execution via worker threads (vitest default).
    // Explicit config ensures it's not overridden by package-level configs
    // that may set singleFork: true.
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        isolate: false,
      },
    },
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
  }
}
