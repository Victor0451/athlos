import Fastify, { type FastifyInstance } from 'fastify'
import { authPlugin } from '@athlos/auth'
import { buildContainer, type AppContainer } from './container.ts'
import { authRoutes } from './routes/auth.ts'
import { approvalRoutes, internalApprovalLinksRoutes } from './routes/approval.ts'
import { adminOperatorsRoutes } from './routes/admin/operators.ts'
import { errorHandler } from './plugins/error-handler.ts'
import { genRequestId as genReqId, requestId } from './plugins/request-id.ts'
import { LOG_REDACT_PATHS, logging } from './plugins/logging.ts'

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

  // 4. Auth plugin: parses Authorization: Bearer <jwt> and decorates
  //    request.operator on every request. Anonymous routes stay reachable.
  await app.register(authPlugin(() => container.env))

  // 5. Auth routes (PR 3a: login; PR 3b: refresh / logout / me / change-password).
  await app.register(authRoutes)

  // 6. Approval routes (PR 3b): public-by-token + internal create-link.
  await app.register(approvalRoutes)
  await app.register(internalApprovalLinksRoutes)

  // 7. Admin operator management (PR 3b): /api/v1/admin/operators/*.
  await app.register(adminOperatorsRoutes)

  // Smoke probe used by `server.test.ts` and as a last-resort liveness
  // check at `/`. The proper `/health` route lands in PR 4b (TASK-034).
  app.get('/', async () => ({ status: 'ok' }))

  return app
}

declare module 'fastify' {
  interface FastifyInstance {
    container: AppContainer
  }
}
