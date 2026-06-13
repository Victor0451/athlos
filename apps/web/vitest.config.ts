import { createConfig } from '@athlos/vitest-config'

/**
 * Vitest config for the @athlos/web app.
 *
 * Frontend (jsdom) preset — needed for React component tests and any
 * code that touches document, window, or localStorage. Tests live next
 * to the source files they cover (test.tsx suffix in src/).
 */
export default createConfig('dom', {
  include: ['src/**/*.{test,spec}.{ts,tsx}'],
})
