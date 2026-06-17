import { createDb, type Db } from '@athlos/db'
import { createClock, type Clock, type FakeClock } from '@athlos/integrations-clock'
import { createEmail, type Email, type StubEmail } from '@athlos/integrations-email'
import { createLegacyDb, type LegacyDb, type StubLegacyDb } from '@athlos/integrations-legacy-db'
import { createWhatsApp, type WhatsApp, type StubWhatsApp } from '@athlos/integrations-whatsapp'
import { validateEnv, type Env } from '@athlos/config'
import type { Pool } from 'pg'
import { detect, emitDriftAlert, type DriftReport } from '@athlos/drift'
import { rebuildProjection, DOMAIN_PROJECTION_TABLE, type Domain } from '@athlos/projection'
import { getFreshness, refreshAll, type DomainFreshness } from '@athlos/freshness'
import { makePermissionsRepo, type PermissionsRepo } from '@athlos/db/repositories/permissions'
import { auditPlugin } from '@athlos/audit'

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
  /** Drift detection service — detect() + emitDriftAlert() */
  driftService: DriftService
  /** Freshness service — getFreshness() + refreshAll() */
  freshnessService: FreshnessService
  /** Permissions repo — hasPermission() + grant() + revoke() */
  permissionsRepo: PermissionsRepo
  /** Projection service — rebuild() + rebuildAll() */
  projectionService: ProjectionService
  /** Audit plugin instance — registered in server.ts before routes */
  auditPlugin: typeof auditPlugin
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
  driftService?: DriftService
  projectionService?: ProjectionService
  freshnessService?: FreshnessService
  permissionsRepo?: PermissionsRepo
}

/** Drift detection service interface */
export interface DriftService {
  detect: (opts?: { domain?: string }) => Promise<DriftReport>
  detectAll: () => Promise<DriftReport>
  emitDriftAlert: (
    report: DriftReport,
    ctx: { jobRunId: string },
  ) => Promise<{ audited: true; notificationDispatched: boolean }>
}

/** Projection service interface */
export interface ProjectionService {
  rebuild: (domain: string) => Promise<{ rowCount: number; durationMs: number }>
  rebuildAll: () => Promise<{ domainsChecked: string[]; totalRowCount: number }>
}

/** Freshness monitoring service interface */
export interface FreshnessService {
  getFreshness: (opts?: { domain?: string }) => Promise<DomainFreshness[]>
  refreshAll: (opts?: {
    domain?: string
  }) => Promise<Array<{ domain: string; lastImportAt: Date | null; recordCount: number }>>
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
 * Build a no-op pool for the standin DB. The standin doesn't need a
 * real connection — but the container's `pool` field is required by
 * the type, so we return a stub that satisfies the shape. Tests that
 * close the pool in afterAll won't actually disconnect anything.
 */
function makeStubPool(): Pool {
  const stub = {
    end: async () => undefined,
    on: () => stub,
    once: () => stub,
    emit: () => true,
    query: async () => ({ rows: [], rowCount: 0 }),
  } as unknown as Pool
  return stub
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

  const { db, pool } = overrides?.db
    ? { db: overrides.db, pool: overrides.pool ?? makeStubPool() }
    : createDb({ connectionString: env['DATABASE_URL'] })

  const driftService: DriftService = overrides?.driftService ?? {
    detect: (opts) => detect(db, opts ?? {}),
    detectAll: () => detect(db, {}),
    emitDriftAlert: (report, ctx) => emitDriftAlert(db, report, ctx),
  }

  const projectionService: ProjectionService = {
    rebuild: async (domain) => rebuildProjection(db, domain as Domain),
    rebuildAll: async () => {
      const domains = Object.keys(DOMAIN_PROJECTION_TABLE) as Domain[]
      const results = await Promise.all(domains.map((d) => rebuildProjection(db, d)))
      return {
        domainsChecked: domains,
        totalRowCount: results.reduce((sum, r) => sum + r.rowCount, 0),
      }
    },
  }

  const freshnessService: FreshnessService = overrides?.freshnessService ?? {
    getFreshness: (opts) => getFreshness(db, opts ?? {}),
    refreshAll: (opts) => refreshAll(db, opts ?? {}),
  }

  const permissionsRepo: PermissionsRepo = overrides?.permissionsRepo ?? makePermissionsRepo(db)

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
    driftService,
    projectionService,
    freshnessService,
    permissionsRepo,
    auditPlugin,
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
