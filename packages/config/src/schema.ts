import * as fs from 'node:fs'
import { z } from 'zod'

/**
 * Environment variable schema. Every variable the API needs lives here so
 * `validateEnv()` returns a fully-typed object — code can write
 * `env.JWT_SECRET` and the type system knows it's a non-empty string.
 *
 * Defaults that are SAFE (port, log level, CORS origin for dev) are
 * declared inline. Variables that MUST be supplied (DB URL, JWT secrets)
 * are required — `validateEnv()` throws a readable error pointing at the
 * missing field rather than letting the app boot with a half-config.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
  LEGACY_DB_PATH: z.string().min(1),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  FROM_ADDRESS: z.string().email().default('noreply@gorriti.app'),
  IMPLEMENTATION_CONTACT_RECIPIENT: z.string().email().optional(),
  // Scheduler cron expressions (PR 6a). The defaults match the
  // scheduler-jobs spec §"Cron Configuration" — change here and the
  // scheduler picks them up on next boot. `RECONCILIATION_CRON` is
  // optional: when unset the reconciliation job is registered but
  // disabled (the boot skips it; `runNow` still works for manual
  // triggers).
  DRIFT_DETECTION_CRON: z.string().default('*/15 * * * *'),
  FRESHNESS_REFRESH_CRON: z.string().default('*/5 * * * *'),
  TOKEN_CLEANUP_CRON: z.string().default('0 3 * * *'),
  RECONCILIATION_CRON: z.string().optional(),
  PROMOTION_CRON: z.string().default('0 */6 * * *'),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  DUES_ASSESSMENT_ENABLED: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .default('false'),
  // File-storage env (PR 8c.1 — athlos-socio-legajo). Optional so
  // existing deployments don't fail the env-validator; defaults
  // match the spec's locked values.
  STORAGE_LOCAL_ROOT: z.string().default('/app/storage'),
  STORAGE_MAX_FILE_SIZE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024),
})

export type Env = z.infer<typeof envSchema>

/**
 * Validate `env` (defaults to `process.env`) against {@link envSchema}.
 *
 * Two failure modes:
 *   1. Zod parse fails — the message lists every offending field by path
 *      so the operator can fix the .env in one read.
 *   2. Staging/production check fails — `LEGACY_DB_PATH` must point at a
 *      readable directory in non-dev environments. Dev gets a pass because
 *      contributors can iterate without the legacy data share mounted.
 *
 * The return value is a plain object — callers can freeze it themselves
 * if they want immutability guarantees.
 */
export function validateEnv(env: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(env)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Environment validation failed:\n${issues}`)
  }
  if (result.data.NODE_ENV !== 'test' && !result.data.IMPLEMENTATION_CONTACT_RECIPIENT) {
    throw new Error('Environment validation failed:\n  IMPLEMENTATION_CONTACT_RECIPIENT: Required')
  }
  if (result.data.NODE_ENV === 'production' || result.data.NODE_ENV === 'staging') {
    if (!fs.existsSync(result.data.LEGACY_DB_PATH)) {
      throw new Error(`LEGACY_DB_PATH not accessible: ${result.data.LEGACY_DB_PATH}`)
    }
  }
  return result.data
}
