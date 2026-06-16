// dotenv/config MUST be imported first so the rest of the app sees env vars
// at module init time (per openspec/changes/athlos-foundation/specs/config-environment).
import 'dotenv/config'

import { buildServer } from './server.js'

const PORT = Number(process.env['PORT'] ?? 3001)
const HOST = process.env['HOST'] ?? '0.0.0.0'

/**
 * Maximum time the scheduler has to drain in-flight handlers on
 * SIGTERM before we mark them `failed / 'process shutdown'`. Matches
 * the design's 30s graceful window.
 */
const SCHEDULER_STOP_TIMEOUT_MS = 30_000

async function main() {
  const app = await buildServer()
  try {
    await app.listen({ port: PORT, host: HOST })
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }

  // Start the scheduler AFTER the HTTP server is bound so the boot
  // reconciliation runs first and cron ticks do not compete with the
  // listen() promise. The log line shape matches the spec AC for
  // TASK-051 ("scheduler: started with N jobs").
  const registeredJobs = app.scheduler.list()
  await app.scheduler.start()
  app.log.info(
    { jobs: registeredJobs.map((j) => j.name), count: registeredJobs.length },
    `scheduler: started with ${registeredJobs.length} jobs`,
  )

  // Graceful shutdown: SIGTERM stops the scheduler first (drains
  // in-flight handlers up to 30s) and then closes the HTTP server.
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    app.log.info({ signal }, 'received shutdown signal')
    try {
      await app.scheduler.stop(SCHEDULER_STOP_TIMEOUT_MS)
    } catch (err) {
      app.log.error({ err }, 'scheduler stop failed')
    }
    try {
      await app.close()
    } catch (err) {
      app.log.error({ err }, 'fastify close failed')
    }
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main()
