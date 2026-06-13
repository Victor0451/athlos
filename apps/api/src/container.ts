import { createDb, type Db } from '@athlos/db'
import { createClock, type Clock, type FakeClock } from '@athlos/integrations-clock'
import { createEmail, type Email, type StubEmail } from '@athlos/integrations-email'
import { createLegacyDb, type LegacyDb, type StubLegacyDb } from '@athlos/integrations-legacy-db'
import { createWhatsApp, type WhatsApp, type StubWhatsApp } from '@athlos/integrations-whatsapp'
import { validateEnv, type Env } from '@athlos/config'
import type { Pool } from 'pg'

/**
 * App-wide DI container. Every service, route handler, and job reaches
 * its dependencies through this object — no module-level singletons
 * (per the testing-setup design, the Adapter Interface Pattern).
 *
 * In test env, the factory picks stub adapters for every external
 * integration. Tests that need behavior verification on a specific
 * adapter pass it through `overrides` to keep the rest stubbed.
 */
export interface AppContainer {
  db: Db
  /** pg pool; tests may close this in `afterAll`. */
  pool: Pool
  legacyDb: LegacyDb
  whatsapp: WhatsApp
  email: Email
  clock: Clock | FakeClock
  /** Validated env object — required for auth services. */
  env: Env
}

/**
 * Stub-flavored overrides for tests. Each field is the same shape the
 * factory would produce when `type: 'stub'`. Use these when a test
 * needs to assert on the recording surface (messages[], outbox, etc.).
 */
export interface StubContainerOverrides {
  db?: Db
  pool?: Pool
  legacyDb?: StubLegacyDb
  whatsapp?: StubWhatsApp
  email?: StubEmail
  clock?: FakeClock
}

/**
 * Either pass stub overrides OR a fully-real container. The union
 * keeps the type system honest: in test env you get stubs; in prod
 * you get reals; overrides are always stubs.
 */
export interface ContainerConfig {
  env: NodeJS.ProcessEnv
  /** Override individual deps for tests. */
  overrides?: StubContainerOverrides
}

const DEFAULT_REAL_WHATSAPP_CONFIG = {
  apiBaseUrl: 'https://graph.facebook.com/v18.0',
  phoneNumberId: '',
  accessToken: '',
}

const DEFAULT_REAL_EMAIL_CONFIG = {
  host: 'localhost',
  port: 1025,
  secure: false,
  auth: { user: '', pass: '' },
  from: 'noreply@gorriti.local',
}

const DEFAULT_REAL_LEGACY_CONFIG = {
  basePath: '',
}

/**
 * Build a fully-wired container. In production, every external
 * integration is its real adapter. In test env (`NODE_ENV === 'test'`
 * and no overrides), every external is a stub and the Drizzle pool
 * still points at the configured `DATABASE_URL` — tests that need
 * different DBs inject via `overrides.db` / `overrides.pool`.
 */
export function buildContainer(config: ContainerConfig): AppContainer {
  const { env, overrides } = config
  const useStubs = env['NODE_ENV'] === 'test' && !overrides

  if (!env['DATABASE_URL']) {
    throw new Error('buildContainer: DATABASE_URL is required')
  }

  // Validate the env once. In test env we relax the LEGACY_DB_PATH /
  // JWT_SECRET min-length checks by passing synthetic values; the
  // validation rules live in @athlos/config and are the source of truth.
  const validatedEnv = validateEnv(buildContainerEnv(env))

  const { db, pool } =
    overrides?.db && overrides?.pool
      ? { db: overrides.db, pool: overrides.pool }
      : createDb({ connectionString: env['DATABASE_URL'] })

  return {
    db,
    pool,
    env: validatedEnv,
    legacyDb:
      overrides?.legacyDb ??
      createLegacyDb({
        type: useStubs ? 'stub' : 'real',
        ...(useStubs
          ? {}
          : {
              config: { basePath: env['LEGACY_DBF_PATH'] ?? DEFAULT_REAL_LEGACY_CONFIG.basePath },
            }),
      }),
    whatsapp:
      overrides?.whatsapp ??
      createWhatsApp({
        type: useStubs ? 'stub' : 'real',
        ...(useStubs
          ? {}
          : {
              config: {
                ...DEFAULT_REAL_WHATSAPP_CONFIG,
                phoneNumberId: env['WHATSAPP_PHONE_ID'] ?? '',
                accessToken: env['WHATSAPP_ACCESS_TOKEN'] ?? '',
              },
            }),
      }),
    email:
      overrides?.email ??
      createEmail({
        type: useStubs ? 'stub' : 'real',
        ...(useStubs
          ? {}
          : {
              config: {
                ...DEFAULT_REAL_EMAIL_CONFIG,
                host: env['SMTP_HOST'] ?? DEFAULT_REAL_EMAIL_CONFIG.host,
                port: Number(env['SMTP_PORT'] ?? DEFAULT_REAL_EMAIL_CONFIG.port),
              },
            }),
      }),
    clock: overrides?.clock ?? createClock({ type: useStubs ? 'stub' : 'real' }),
  }
}

/**
 * Build the env object that {@link validateEnv} will see. In test mode
 * (NODE_ENV=test) we inject 32-char placeholder secrets so the strict
 * zod checks pass without forcing every test to set a JWT_SECRET.
 * Production / staging / development all run the real validation.
 */
function buildContainerEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (env['NODE_ENV'] !== 'test') return env
  const placeholder = 'test-secret-please-rotate-32chars-minimum'
  return {
    ...env,
    JWT_SECRET: env['JWT_SECRET'] ?? placeholder,
    JWT_REFRESH_SECRET: env['JWT_REFRESH_SECRET'] ?? placeholder,
    LEGACY_DB_PATH: env['LEGACY_DB_PATH'] ?? '/tmp/athlos-test-legacy',
  }
}
