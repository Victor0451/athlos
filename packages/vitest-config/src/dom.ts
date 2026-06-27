import type { InlineConfig } from 'vitest'

/**
 * Vitest config preset for frontend / DOM packages — web app, design-system
 * components, anything that touches `document` or `window`. Uses jsdom so
 * React, hooks, and `localStorage` work in a node process.
 *
 * Default `include` covers both `.test.ts` and `.test.tsx` — React component
 * tests are the most common consumer of this preset.
 *
 * Setup file `vitest.setup.ts` is loaded if present in the consuming
 * package root. It is responsible for registering `@testing-library/jest-dom`
 * matchers and any global test polyfills.
 */
export function domPreset(): Partial<InlineConfig> {
  return {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['vitest.setup.ts'],
    testTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.next/**',
        '**/*.config.ts',
        '**/*.config.cjs',
        '**/*.config.mts',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.spec.ts',
        '**/*.spec.tsx',
        'vitest.setup.ts',
      ],
    },
  }
}
