import Fastify, { type FastifyInstance } from 'fastify'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { authPlugin } from '@athlos/auth'
import { buildContainer, type AppContainer } from './container.ts'
import { authRoutes } from './routes/auth.ts'
import { approvalRoutes, internalApprovalLinksRoutes } from './routes/approval.ts'
import { adminOperatorsRoutes } from './routes/admin/operators.ts'
import { healthRoutes } from './routes/health.ts'
import { versionsRoutes } from './routes/versions.ts'
import { sociosRoutes } from './routes/socios.ts'
import { ctacteRoutes } from './routes/ctacte.ts'
import { padronesRoutes } from './routes/padrones.ts'
import { errorHandler } from './plugins/error-handler.ts'
import { genRequestId as genReqId, requestId } from './plugins/request-id.ts'
import { LOG_REDACT_PATHS, logging } from './plugins/logging.ts'
import { metrics } from './plugins/metrics.ts'
import { cors } from './plugins/cors.ts'
import { helmet } from './plugins/helmet.ts'
import { rateLimit } from './plugins/rate-limit.ts'
import { versioning } from './plugins/versioning.ts'
import { routeAudit } from './plugins/route-audit.ts'

/**
 * Read the API package version from `package.json` at boot. Used as
 * the `API-Version` response header value and as the `api` field
 * in the `/api/versions` response. Falls back to `0.0.0` if the
 * file can't be read (e.g. the build output was relocated).
 */
function readApiVersion(): string {
  try {
    const here = fileURLToPath(import.meta.url)
    // server.ts lives at apps/api/src/server.ts; package.json is
    // at apps/api/package.json (two levels up from src/).
    const pkgPath = resolve(here, '..', '..', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/**
 * Build a Fastify instance with a fully-wired DI container.
 *
 * The container is decorated onto the Fastify instance as
 * `app.container` so route handlers (registered in later PRs) can
 * reach the dependencies via `request.server.container`. Plugins can
 * also pull it from the app reference.
 *
 * In production, the container wires real adapters. In test env the
 * container is built with stubs (see `container.ts`); tests that need
 * different stubs pass `containerOverrides`.
 *
 * Plugin registration order matters:
 *
 *   1. errorHandler  — must be first so subsequent plugins / routes
 *                      inherit the same response shape on error.
 *   2. requestId     — sets `x-request-id` on every response; the
 *                      error handler reads `request.id`.
 *   3. authPlugin    — decorates `request.operator` on every request
 *                      (anonymous routes still work — requireAuth is
 *                      the explicit gate).
 *   4. route plugins — registered in the order they were added.
 */
export interface BuildServerOptions {
  env?: NodeJS.ProcessEnv
  containerOverrides?: Parameters<typeof buildContainer>[0]['overrides']
  /** Skip starting the Fastify logger (test mode). */
  quietLogger?: boolean
}

export async function buildServer(opts: BuildServerOptions = {}): Promise<FastifyInstance> {
  const env = opts.env ?? process.env
  const container: AppContainer = buildContainer(
    opts.containerOverrides ? { env, overrides: opts.containerOverrides } : { env },
  )

  const isProduction = env['NODE_ENV'] === 'production'

  const app = Fastify({
    // genReqId runs BEFORE Fastify builds the request — it returns
    // the inbound x-request-id when valid, otherwise a UUID. The
    // requestId plugin mirrors this onto the response header.
    genReqId,
    requestIdHeader: 'x-request-id',
    logger: opts.quietLogger
      ? false
      : isProduction
        ? {
            level: env['LOG_LEVEL'] ?? 'info',
            redact: LOG_REDACT_PATHS,
            base: { service: 'athlos-api' },
            formatters: { level: (label) => ({ level: label }) },
          }
        : {
            level: env['LOG_LEVEL'] ?? 'debug',
            redact: LOG_REDACT_PATHS,
            base: { service: 'athlos-api' },
            transport: {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' },
            },
          },
  })

  app.decorate('container', container)

  // 1. Error handler — must be registered before any route so the
  //    mapping applies to every request. fp()ed so the handler
  //    reaches the parent scope (PR 3a / 3b lesson).
  await app.register(errorHandler)

  // 2. Logging — captures `startTime` on every request so the
  //    error handler / future log enrichers can compute duration_ms.
  await app.register(logging)

  // 3. Request id — mirrors request.id onto the response header.
  await app.register(requestId)

  // Read the API version from package.json once. Used by versioning
  // + health + /api/versions routes.
  const apiVersion = readApiVersion()

  // 4. Security plugins (PR 4b). Order: helmet (headers) → cors
  //    (origin gating) → rate-limit (throttling). Each is wrapped
  //    in fastify-plugin so the configuration reaches the parent
  //    scope. Rate-limit registers a global hook; we apply stricter
  //    limits on auth routes via the route's `config.rateLimit`
  //    field.
  await app.register(helmet)
  await app.register(cors, { getEnv: () => container.env })
  await app.register(rateLimit)

  // 5. Versioning — sets the `API-Version: <x.y.z>` response header
  //    on every /api/v1/* response. Reads from package.json at boot.
  await app.register(versioning, { version: apiVersion })

  // 6. Metrics — exposes /metrics (Prometheus text format) and
  //    populates the http_requests_total / http_request_duration_seconds
  //    counters from the onResponse hook.
  await app.register(metrics)

  // 7. Route audit — runs on every `fastify.route(...)` call. Catches
  //    unprotected /api/v1/* routes at registration time.
  await app.register(routeAudit)

  // 8. Auth plugin: parses Authorization: Bearer <jwt> and decorates
  //    request.operator on every request. Anonymous routes stay reachable.
  await app.register(authPlugin(() => container.env))

  // 9. Auth routes (PR 3a: login; PR 3b: refresh / logout / me / change-password).
  await app.register(authRoutes)

  // 10. Approval routes (PR 3b): public-by-token + internal create-link.
  await app.register(approvalRoutes)
  await app.register(internalApprovalLinksRoutes)

  // 11. Admin operator management (PR 3b): /api/v1/admin/operators/*.
  await app.register(adminOperatorsRoutes)

  // 12. Health probes (PR 4b TASK-034): /health, /health/ready,
  //     /health/startup. Registered AFTER the route audit so the
  //     audit's allow-list (the /api/v1/* only) doesn't see them.
  await app.register(healthRoutes, { pool: container.pool, version: apiVersion })

  // 13. Socios (PR 5 TASK-037): /api/v1/socios CRUD.
  await app.register(sociosRoutes)

  // 14. Cuenta corriente (PR 5 TASK-039): /api/v1/socios/:id/cuenta-corriente
  //     and the movimientos sub-path. Read-only in PR 5.
  await app.register(ctacteRoutes)

  // 15. Padrones (PR 5 TASK-040): /api/v1/padrones. Read-only
  //     list of socio/disciplina/enrollments for an ejercicio.
  await app.register(padronesRoutes)

  // 16. Version discovery (PR 4b TASK-035): /api/versions is
  //     intentionally unversioned — clients discover it without
  //     knowing the API version.
  await app.register(versionsRoutes, {
    pool: container.pool,
    version: apiVersion,
    buildSha: env['BUILD_SHA'] ?? 'dev',
  })

  // Smoke probe used by `server.test.ts` and as a last-resort liveness
  // check at `/`. The proper `/health` route is registered above.
  app.get('/', async () => ({ status: 'ok' }))

  return app
}

declare module 'fastify' {
  interface FastifyInstance {
    container: AppContainer
  }
}
