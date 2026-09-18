import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Root-level fallback for vitest runs that start outside a workspace package (editor
 * integrations, check runners, `pnpm exec vitest run <file>` from the repo root).
 *
 * Without it, TSX compiles through the classic JSX transform with an unbound `React`
 * reference and every component test fails with "React is not defined". Package runs
 * (cwd inside apps/* or packages/*) still pick their own closest vitest config first;
 * this file only fills the gap for runs that would otherwise have no config at all.
 */
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)),
    },
  },
  test: {
    setupFiles: ['./apps/web/vitest.setup.ts'],
  },
})
