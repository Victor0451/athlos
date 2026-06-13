import Fastify, { type FastifyInstance } from 'fastify'
import { ApiError, redact } from '@athlos/errors'
import { authPlugin } from '@athlos/auth'
import { buildContainer, type AppContainer } from './container.ts'
import { authRoutes } from './routes/auth.ts'

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

  const app = Fastify({
    logger: opts.quietLogger
      ? false
      : {
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' },
          },
        },
  })

  app.decorate('container', container)

  // Global error handler: map ApiError → declared status + body,
  // redact anything else and emit a generic 500. PII redaction runs
  // on the request body before logging so passwords never hit disk.
  app.setErrorHandler((err, request, reply) => {
    if (err instanceof ApiError) {
      if (!err.isBusiness) {
        request.log.error({ err: redact(err), code: err.code }, 'technical error')
      }
      return reply.code(err.statusCode).send({
        error: err.code,
        message: err.isBusiness ? err.message : 'Internal server error',
        ...(err.details !== undefined ? { details: err.details } : {}),
      })
    }
    // Unknown error: log the redacted shape, return a generic 500.
    request.log.error({ err: redact(err) }, 'unhandled error')
    return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Internal server error' })
  })

  // Auth plugin: parses Authorization: Bearer <jwt> and decorates
  // request.operator on every request. Anonymous routes stay reachable.
  await app.register(authPlugin(() => container.env))

  // Auth routes (PR 3a: login implemented; refresh/logout/me/change-password
  // return 501 until PR 3b wires the refresh-token service).
  await app.register(authRoutes)

  app.get('/', async () => ({ status: 'ok' }))

  return app
}

declare module 'fastify' {
  interface FastifyInstance {
    container: AppContainer
  }
}
