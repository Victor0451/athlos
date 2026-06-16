/**
 * Trigger barrel — re-exports every per-event-type builder +
 * the shouldFire predicate. Consumers import the named
 * builder and call it; the dispatcher contract is
 * implementation detail.
 *
 * The 5 spec event types are split across 3 trigger files
 * because:
 *   - `drift-detected.ts`     — drift_alert
 *   - `import-completed.ts`   — import_completed + import_failed
 *   - `approval-needed.ts`    — approval_link_created
 *
 * `login_new_ip` is defined on the dispatcher event union but
 * has no trigger helper here — the auth-login service calls
 * `sendNotification` directly because the context is built
 * from request-time data (ip, userAgent) that the auth layer
 * already has in scope.
 */
export { buildDriftEvent, shouldFireDrift, type DriftContext } from './drift-detected.ts'
export {
  buildImportCompletedEvent,
  buildImportFailedEvent,
  shouldFireImportCompleted,
  shouldFireImportFailed,
  type ImportCompletedContext,
  type ImportFailedContext,
} from './import-completed.ts'
export { buildApprovalEvent, shouldFireApproval, type ApprovalContext } from './approval-needed.ts'
