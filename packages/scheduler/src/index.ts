/**
 * @athlos/scheduler — public API.
 *
 * In-process job scheduler with:
 *   - `JobScheduler` interface (5 methods) — the seam for future
 *      BullMQ + Redis migration.
 *   - `InProcessScheduler` — the v1 reference implementation backed
 *      by `node-cron` and the `job_runs` table.
 *   - `run-tracker` — the SQL surface for state transitions
 *      (recordStart / recordRunning / recordFinish /
 *      reconcileOrphanedRuns / markInflightAsShutdown).
 *   - `health` — `getJobHealth(db, definitions)` returns a
 *      per-job health snapshot for the admin endpoint.
 *   - `types` — the handler / context / result / definition shapes.
 *   - `adapters/node-cron` — the cron engine. Exposed for tests that
 *      want to validate a cron expression without booting a scheduler.
 *
 * Wiring is done by the API layer (apps/api/src/server.ts + index.ts);
 * this package owns the contract and the engine.
 */
export { InProcessScheduler, estimateCadenceMinutes } from './scheduler.ts'
export {
  recordStart,
  recordRunning,
  recordFinish,
  reconcileOrphanedRuns,
  markInflightAsShutdown,
  getLastRun,
  listRuns,
  type RunHistoryFilter,
} from './run-tracker.ts'
export { getJobHealth, type JobHealth } from './health.ts'
export {
  validateCronExpression,
  createNodeCronTask,
  type CronTaskHandle,
  type CreateNodeCronTaskOptions,
} from './adapters/node-cron.ts'
export type {
  JobContext,
  JobDefinition,
  JobHandler,
  JobResult,
  JobScheduler,
  RunNowResult,
  RunStartInput,
  RunFinishInput,
  ScheduleOptions,
} from './types.ts'
