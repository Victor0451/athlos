/**
 * @athlos/notifications — public API.
 *
 * Cross-cutting notification primitives for Athlos. Consumers
 * (apps/api, jobs, drift-detector, import, auth) import the
 * dispatcher and the typed event shapes from this barrel.
 *
 * Two ways to use it:
 *
 *   1. Module-level convenience: call `setGlobalDispatcher(...)`
 *      once at app boot, then anywhere in the codebase call
 *      `sendNotification(event)`. The dispatcher is fire-and-forget
 *      from the caller's perspective — `await` is optional.
 *
 *   2. Instance-level: instantiate `NotificationDispatcher` directly
 *      and call `dispatcher.send(event)`. Useful in tests where each
 *      test wants its own dispatcher with a stub DB and stub
 *      adapters.
 *
 * The package never throws. Channel failures, timeouts, and
 * template errors are caught inside the dispatcher and written
 * to the audit log via the `audit_events` table. The originating
 * request returns successfully even when every channel attempt
 * fails.
 */
export {
  NotificationDispatcher,
  sendNotification,
  setGlobalDispatcher,
  resetGlobalDispatcherForTests,
} from './dispatcher.ts'

export { render } from './templates/renderer.ts'

export { EmailChannel } from './channels/email.ts'
export { InAppChannel } from './channels/in-app.ts'
export { WhatsAppChannel } from './channels/whatsapp.ts'

export type {
  NotificationChannel,
  NotificationEvent,
  NotificationEventId,
  NotificationMetadata,
  ResolvedRecipient,
  ResolvedAttempt,
  DispatcherDeps,
} from './types.ts'

export { TemplateNotFoundError } from './types.ts'

export { buildDriftEvent, shouldFireDrift, type DriftContext } from './triggers/drift-detected.ts'
export {
  buildImportCompletedEvent,
  buildImportFailedEvent,
  shouldFireImportCompleted,
  shouldFireImportFailed,
  type ImportCompletedContext,
  type ImportFailedContext,
} from './triggers/import-completed.ts'
export {
  buildApprovalEvent,
  shouldFireApproval,
  type ApprovalContext,
} from './triggers/approval-needed.ts'
