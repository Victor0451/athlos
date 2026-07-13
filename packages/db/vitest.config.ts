import { createConfig } from '@athlos/vitest-config'

/**
 * Vitest config for the @athlos/db package.
 *
 * Backend (Node) preset — repository / migration tests will run against
 * a Testcontainer PostgreSQL instance (PR 10b). For now the package has
 * the smoke test under __smoke__.ts; that file is intentionally excluded
 * from the vitest include glob (it uses tsx for ad-hoc DB connection
 * verification, not vitest's test API).
 */
export default createConfig('node', {
  include: ['src/**/*.{test,spec}.ts'],
  // DB test files recreate the shared tesoreria schema.
  fileParallelism: false,
})
