import type { InlineConfig } from 'vitest'

/**
 * Vitest config preset for frontend / DOM packages — web app, design-system
 * components, anything that touches `document` or `window`. Uses jsdom so
 * React, hooks, and `localStorage` work in a node process.
 *
 * Default `include` covers both `.test.ts` and `.test.tsx` — React component
 * tests are the most common consumer of this preset.
 */
export function domPreset(): Partial<InlineConfig> {
  return {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
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
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.spec.ts',
        '**/*.spec.tsx',
        'vitest.setup.ts',
      ],
    },
  }
}
