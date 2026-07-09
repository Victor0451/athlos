import Fastify, { type FastifyInstance } from 'fastify'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import multipart from '@fastify/multipart'
import { authPlugin } from '@athlos/auth'
import { buildContainer, type AppContainer } from './container.ts'
import { authRoutes } from './routes/auth.ts'
import { approvalRoutes, internalApprovalLinksRoutes } from './routes/approval.ts'
import { adminOperatorsRoutes } from './routes/admin/operators.ts'
import { adminJobsRoutes } from './routes/admin/jobs.ts'
import { schedulerAdminRoutes } from './routes/admin/scheduler.ts'
import { healthRoutes } from './routes/health.ts'
import { versionsRoutes } from './routes/versions.ts'
import { sociosRoutes } from './routes/socios.ts'
import { operatorsRoutes } from './routes/operators.ts'
import { ctacteRoutes } from './routes/ctacte.ts'
import { padronesRoutes } from './routes/padrones.ts'
import { socioAttachmentsRoutes } from './routes/socios-attachments.ts'
import { socioFormsRoutes } from './routes/socio-forms.ts'
import { ctacteMutationsRoutes } from './routes/ctacte-mutations.ts'
import { createPdfGenerator } from './modules/socios/forms/pdf-generator.ts'
import { errorHandler } from './plugins/error-handler.ts'
import { genRequestId as genReqId, requestId } from './plugins/request-id.ts'
import { LOG_REDACT_PATHS, logging } from './plugins/logging.ts'
import { metrics } from './plugins/metrics.ts'
import { cors } from './plugins/cors.ts'
import { helmet } from './plugins/helmet.ts'
import { rateLimit } from './plugins/rate-limit.ts'
import { versioning } from './plugins/versioning.ts'
import { routeAudit } from './plugins/route-audit.ts'
import { buildScheduler } from './jobs/register.ts'
import type { JobScheduler } from '@athlos/scheduler'
// 7b.2 new imports
import { auditPlugin } from '@athlos/audit'
import { importRoutes } from './routes/import.ts'
import { lineageRoutes } from './routes/lineage.ts'
import { driftRoutes } from './routes/drift.ts'
import { freshnessRoutes } from './routes/freshness.ts'
import { auditRoutes } from './routes/audit.ts'
import { notificationRoutes } from './routes/notifications.ts'
// 9. N16 (athlos-n16-gastos-ctacte-fk): admin gastos CRUD + mapping routes
import { gastosAdminRoutes } from './routes/admin/gastos.ts'
import { gastosCtacteAdminRoutes } from './routes/admin/gastos-ctacte.ts'

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
  /**
   * Optional PDF generator override (PR 8d.1). When unset, server.ts
   * wires a real `createPdfGenerator()` singleton. Tests inject a stub
   * so route tests don't launch a real Chromium.
   */
  pdfGenerator?: ReturnType<typeof createPdfGenerator>
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
  //    request.operator on every request. Anonymous routes still reachable.
  await app.register(authPlugin(() => container.env))

  // 9. Audit plugin: captures operator mutations via onResponse hook.
  //    CRITICAL: fp()-wrapped so hooks reach the parent scope (PR 3a bug).
  //    Registered BEFORE routes so the hooks apply to all route handlers.
  await app.register(auditPlugin)

  // 9b. Multipart plugin (PR 8c.1): enables `request.file()` for the
  //     socio-attachments upload route. Registered with a 10 MB
  //     per-file cap (matches the spec's `STORAGE_MAX_FILE_SIZE_BYTES`
  //     default) and 1 file per request. The route layer also has
  //     an explicit per-file check as defence-in-depth.
  const fileSizeCap = container.env.STORAGE_MAX_FILE_SIZE_BYTES
    ? Number(container.env.STORAGE_MAX_FILE_SIZE_BYTES)
    : 10 * 1024 * 1024
  await app.register(multipart, {
    limits: { fileSize: fileSizeCap, files: 1 },
  })

  // 10. Auth routes (PR 3a: login; PR 3b: refresh / logout / me / change-password).
  await app.register(authRoutes)

  // 10b. Approval routes (PR 3b): public-by-token + internal create-link.
  await app.register(approvalRoutes)
  await app.register(internalApprovalLinksRoutes)

  // 11. Admin operator management (PR 3b): /api/v1/admin/operators/*.
  await app.register(adminOperatorsRoutes)

  // 11b. Admin jobs (PR 6b TASK-050): /api/v1/admin/jobs/runs
  //      and /api/v1/admin/jobs/health. Read-only views over the
  //      scheduler state. Same ADMIN gate as the operator routes.
  await app.register(adminJobsRoutes)

  // 11c. Admin scheduler endpoints (athlos-async-scheduler): POST /run-now,
  //      GET /jobs, GET /jobs/:name, PATCH /jobs/:name for enable/disable.
  await app.register(schedulerAdminRoutes)

  // 12. Health probes (PR 4b TASK-034): /health, /health/ready,
  //     /health/startup. Registered AFTER the route audit so the
  //     audit's allow-list (the /api/v1/* only) doesn't see them.
  await app.register(healthRoutes, { pool: container.pool, version: apiVersion })

  // 13. Socios (PR 5 TASK-037): /api/v1/socios CRUD.
  await app.register(sociosRoutes)

  // 13b. Socio attachments (PR 8c.1): /api/v1/socios/:socioId/attachments/*
  //      — five routes (POST upload, GET list, GET metadata, GET file
  //      stream, DELETE soft). Requires `@fastify/multipart` to be
  //      registered above.
  await app.register(socioAttachmentsRoutes)

  // 13c. Socio forms (PR 8d.1 / athlos-socio-form-emit):
  //      GET /api/v1/socios/:socioId/forms/solicitud-inscripcion.pdf
  //      — server-renders the Gorriti `solicitud-inscripcion` PDF via
  //      a puppeteer singleton. The generator is wired here (rather
  //      than inside the route plugin) so the browser launch cost is
  //      paid once per process. Tests can override via
  //      `opts.pdfGenerator` to inject a stub.
  const pdfGenerator = opts.pdfGenerator ?? createPdfGenerator({ maxConcurrent: 3 })
  await app.register(socioFormsRoutes, { pdfGenerator })

  // 13d. ctacte mutations (athlos-ctacte-mutations PR A1b):
  //     POST /payment + POST /debit + POST /:movementId/notes
  //     (all authenticated), GET /comprobante.pdf (authenticated).
  //     Shares the same pdfGenerator singleton as socioFormsRoutes.
  await app.register(ctacteMutationsRoutes, { pdfGenerator })

  // 13b. Operator batch lookup (athlos-audit-operator-display PR A):
  //      GET /api/v1/operators?ids=<uuid>,… — any authenticated
  //      operator (no role gate; design D4).
  await app.register(operatorsRoutes)

  // 14. Cuenta corriente (PR 5 TASK-039): /api/v1/socios/:id/cuenta-corriente
  //     and the movimientos sub-path. Read-only in PR 5.
  await app.register(ctacteRoutes)

  // 15. Padrones (PR 5 TASK-040): /api/v1/padrones. Read-only
  //     list of socio/disciplina/enrollments for an ejercicio.
  await app.register(padronesRoutes)

  // 16. Import pipeline routes (PR 7b.2 TASK-088):
  //     POST /api/v1/import/trigger (ADMIN), DELETE /api/v1/import/trigger/:batchId (ADMIN),
  //     GET /api/v1/import/status (ADMIN), GET /api/v1/import/status/:batchId (ADMIN)
  await app.register(importRoutes)

  // 17. Lineage route (PR 7b.2 TASK-087): GET /api/v1/lineage/:entityId (any auth)
  await app.register(lineageRoutes)

  // 18. Drift route (PR 7b.2 TASK-087): GET /api/v1/drift (ADMIN OR data_steward)
  await app.register(driftRoutes)

  // 19. Freshness route (PR 7b.2 TASK-087): GET /api/v1/freshness (any auth)
  await app.register(freshnessRoutes)

  // 20. Audit route (PR 7b.2 TASK-089): GET /api/v1/audit (ADMIN OR data_steward)
  await app.register(auditRoutes)

  // 20a. In-app notifications (PR bell-N1): GET /api/v1/notifications,
  //      GET /api/v1/notifications/unread-count,
  //      PATCH /api/v1/notifications/:id/read. Per-operator bell feed.
  await app.register(notificationRoutes)

  // 20b. N16 gastos + gastos-ctacte admin routes (athlos-n16-gastos-ctacte-fk).
  //      ADMIN-only. 12 new endpoints total: 6 gastos CRUD +
  //      6 gastos↔ctacte mapping (link create/delete/anular, candidates).
  await app.register(gastosAdminRoutes)
  await app.register(gastosCtacteAdminRoutes)

  // 21. Version discovery (PR 4b TASK-035): /api/versions is
  //     intentionally unversioned — clients discover it without
  //     knowing the API version.
  await app.register(versionsRoutes, {
    pool: container.pool,
    version: apiVersion,
    buildSha: env['BUILD_SHA'] ?? 'dev',
  })

  // 22. Scheduler (PR 6a TASK-041..TASK-047): build + register all 5
  //     default jobs. Started in `app.ready` by the caller (apps/api/
  //     src/index.ts) so cron ticks fire only after the HTTP server
  //     is bound. Stopped from the SIGTERM handler with a 30s
  //     graceful window.
  const scheduler = await buildScheduler({
    db: container.db,
    env: container.env,
    logger: app.log as never,
    container,
  })
  app.decorate('scheduler', scheduler)

  // Smoke probe used by `server.test.ts` and as a last-resort liveness
  // check at `/`. The proper `/health` route is registered above.
  app.get('/', async () => ({ status: 'ok' }))

  return app
}

declare module 'fastify' {
  interface FastifyInstance {
    container: AppContainer
    scheduler: JobScheduler
  }
}
