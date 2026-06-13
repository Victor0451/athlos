import Fastify, { type FastifyInstance } from 'fastify'
import { buildContainer, type AppContainer } from './container.ts'

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

  app.get('/', async () => ({ status: 'ok' }))

  return app
}

declare module 'fastify' {
  interface FastifyInstance {
    container: AppContainer
  }
}
