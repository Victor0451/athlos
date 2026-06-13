import Fastify, { type FastifyInstance } from 'fastify'

/**
 * Build a Fastify instance. Placeholder for PR 1 — returns `{ status: 'ok' }`
 * on `GET /`. Real plugin registration (CORS, helmet, rate-limit, routes,
 * error handler, etc.) lands in PR 4 (API foundation).
 */
export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' },
      },
    },
  })

  app.get('/', async () => ({ status: 'ok' }))

  return app
}
