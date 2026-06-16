import type { NotificationEvent } from '../types.ts'

/**
 * Import-completed trigger. The import service calls
 * `buildImportCompletedEvent(ctx)` after a successful batch
 * (status='completed' or 'partial' in the import_jobs table).
 * The dispatcher writes one in-app row for the triggering
 * operator; no email is sent (spec §"Import Completed").
 *
 * The `eventId` is `<jobRunId>:import-completed` so a
 * subsequent retry that also lands in 'completed' dedups.
 */

export interface ImportCompletedContext {
  jobRunId: string
  operatorId: string
  domain: 'socios' | 'ctacte' | 'padrones' | 'deportes'
  recordCount: number
}

export interface ImportFailedContext {
  jobRunId: string
  operatorId: string
  domain: 'socios' | 'ctacte' | 'padrones' | 'deportes'
  errorCode: string
  errorMessage: string
}

/**
 * Should the import-completed trigger fire? v1: every
 * successful import (recordCount > 0). An empty import is a
 * no-op for the operator — the spec doesn't list it as a
 * notification-worthy event.
 */
export function shouldFireImportCompleted(ctx: ImportCompletedContext): boolean {
  return ctx.recordCount > 0
}

/**
 * Should the import-failed trigger fire? v1: every failure.
 * A future "fail-soft" policy could gate this on retries.
 */
export function shouldFireImportFailed(_ctx: ImportFailedContext): boolean {
  return true
}

/**
 * Build the dispatcher event for a successful import.
 */
export function buildImportCompletedEvent(ctx: ImportCompletedContext): NotificationEvent {
  return {
    type: 'import_completed',
    eventId: `${ctx.jobRunId}:import-completed`,
    operatorId: ctx.operatorId,
    metadata: {
      domain: ctx.domain,
      recordCount: ctx.recordCount,
    },
  }
}

/**
 * Build the dispatcher event for a failed import. The
 * dispatcher emails every ADMIN and writes in-app rows for
 * ADMINs + the triggering operator.
 */
export function buildImportFailedEvent(ctx: ImportFailedContext): NotificationEvent {
  return {
    type: 'import_failed',
    eventId: `${ctx.jobRunId}:import-failed`,
    operatorId: ctx.operatorId,
    metadata: {
      domain: ctx.domain,
      errorCode: ctx.errorCode,
      errorMessage: ctx.errorMessage,
    },
  }
}
