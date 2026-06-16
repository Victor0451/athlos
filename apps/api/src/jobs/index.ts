/**
 * Job handlers. Each function builds a {@link JobHandler} bound to a
 * Drizzle client + the relevant config. The scheduler in
 * `apps/api/src/server.ts` wires them up at boot.
 *
 * Handlers that are stubs in PR 6a (drift-detection, freshness-refresh,
 * scheduled-import, reconciliation) have explicit comments pointing to
 * the PR 7 task that will replace the body. The handler SHAPES are
 * stable — admin endpoints, the import pipeline's post-trigger, and
 * the scheduler's retry logic all consume the return value.
 *
 * The token-cleanup handler is the only fully-implemented job in this
 * PR — it deletes expired refresh + approval tokens + audit events.
 */
export { makeDriftDetectionHandler } from './drift-detection.ts'
export { makeFreshnessRefreshHandler } from './freshness-refresh.ts'
export { makeTokenCleanupHandler } from './token-cleanup.ts'
export { makeScheduledImportHandler } from './scheduled-import.ts'
export { makeReconciliationHandler } from './reconciliation.ts'
