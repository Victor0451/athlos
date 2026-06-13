/**
 * @athlos/config — public API.
 *
 * Two ways to consume:
 *
 *   1. One-shot: import `validateEnv` and call it at app boot. Use this in
 *      `apps/api/src/index.ts` and in tests that need a known-good env.
 *
 *   2. Module-init: import `loadEnv` and rely on the side effect. The
 *      frozen object is cached and re-used across imports.
 *
 * `dotenv/config` is NOT imported here on purpose: the API entry point
 * already does so before this module loads, and importing it twice
 * triggers a warning.
 */
import { validateEnv, type Env, envSchema } from './schema.ts'

export { envSchema, validateEnv }
export type { Env }

/**
 * Convenience: validate `process.env` and freeze the result. Tests that
 * want to bypass the cache should call `validateEnv({...})` directly.
 */
let cached: Env | undefined

export function loadEnv(env: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached
  const parsed = validateEnv(env)
  cached = Object.freeze(parsed)
  return cached
}

/** Test-only: clear the cache so the next `loadEnv()` re-parses. */
export function _resetConfigCache(): void {
  cached = undefined
}
