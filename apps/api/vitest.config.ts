import { createConfig } from '@athlos/vitest-config'

/**
 * Vitest config for the @athlos/api app.
 *
 * Backend (Node) preset — no jsdom, no DOM globals. Tests live next to
 * the source files they cover (test.ts suffix in src/). DI container
 * tests are the first consumers (TASK-020); route handler tests follow
 * in PR 3b and later.
 */
export default createConfig('node', {
  include: ['src/**/*.{test,spec}.ts'],
})
