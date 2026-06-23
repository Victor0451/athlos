import { config as dotenvConfig } from 'dotenv'

let dotenvLoaded = false

/**
 * Loads environment variables from .env files when not in production.
 *
 * In production, env vars come from compose env_file: .env.production —
 * loading dotenv there would silently override compose env vars with stale
 * .env values. See deployment-devops/spec.md (Slice C).
 */
export function loadEnv(): void {
  if (process.env['NODE_ENV'] === 'production') {
    return
  }
  dotenvConfig()
  dotenvLoaded = true
}

export function isDotenvLoaded(): boolean {
  return dotenvLoaded
}
