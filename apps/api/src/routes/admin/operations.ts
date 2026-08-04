import type { FastifyPluginCallback, FastifyInstance } from 'fastify'
import { requireRole } from '@athlos/auth'
import { getJobHealth, listAttentionRuns } from '@athlos/scheduler'
import { buildOperationalSnapshot } from '../../services/operational-snapshot.ts'
import { probeReadiness } from '../../services/readiness.ts'
import { projectSchedulerRun } from './scheduler-run-projector.ts'

const ADMIN_GATE = { preHandler: requireRole('ADMIN') }

export const operationalSnapshotRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get('/api/v1/admin/operations/snapshot', ADMIN_GATE, async (_request, reply) => {
    const server = fastify as FastifyInstance
    const snapshot = await buildOperationalSnapshot({
      readReadiness: () => probeReadiness(server.container.pool),
      readFreshness: () => server.container.freshnessService.getFreshness(),
      readJobs: async () => {
        const health = await getJobHealth(server.container.db, server.scheduler.list())
        return health.map((item) => ({
          name: item.name,
          enabled: item.enabled,
          cronExpr: item.cronExpr,
          cadenceMinutes: item.cadenceMinutes,
          scheduled: item.scheduled,
          inFlight: item.inFlight,
          healthy: item.healthy,
          reason: item.reason,
          lastRun: item.lastRun ? projectSchedulerRun(item.lastRun) : null,
        }))
      },
      readAttention: async () =>
        (await listAttentionRuns(server.container.db, 10)).map(projectSchedulerRun),
    })
    return reply.code(200).send(snapshot)
  })
  done()
}
