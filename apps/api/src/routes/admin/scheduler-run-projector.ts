import type { JobRunStatus, JobTrigger } from '@athlos/db/schema'

type SchedulerFailureCode =
  | 'REVIEW_REQUIRED'
  | 'CANCELLED'
  | 'RETRIES_EXHAUSTED'
  | 'PROCESS_INTERRUPTED'
  | 'PROCESS_SHUTDOWN'
  | 'EXECUTION_FAILED'
  | 'UNCLASSIFIED_FAILURE'

interface SchedulerRunSource {
  id: string
  jobName: string
  status: JobRunStatus | string
  attempt: number
  scheduledAt: Date
  startedAt: Date | null
  finishedAt: Date | null
  triggeredBy: JobTrigger | string
  errorMessage: string | null | undefined
}

const SAFE_MESSAGES: Record<SchedulerFailureCode, string> = {
  REVIEW_REQUIRED: 'The job completed and requires review.',
  CANCELLED: 'The job was cancelled.',
  RETRIES_EXHAUSTED: 'The job exhausted its retry attempts.',
  PROCESS_INTERRUPTED: 'The process was interrupted.',
  PROCESS_SHUTDOWN: 'The process shut down before completion.',
  EXECUTION_FAILED: 'The job failed during execution.',
  UNCLASSIFIED_FAILURE: 'The job ended in an unclassified failure state.',
}

function reasonFor(status: string, errorMessage: string | null | undefined) {
  const code: SchedulerFailureCode | undefined =
    status === 'completed_with_review'
      ? 'REVIEW_REQUIRED'
      : status === 'cancelled'
        ? 'CANCELLED'
        : status === 'dead_letter'
          ? 'RETRIES_EXHAUSTED'
          : status === 'failed'
            ? errorMessage === 'process terminated unexpectedly'
              ? 'PROCESS_INTERRUPTED'
              : errorMessage === 'process shutdown'
                ? 'PROCESS_SHUTDOWN'
                : 'EXECUTION_FAILED'
            : ['pending', 'running', 'succeeded'].includes(status)
              ? undefined
              : 'UNCLASSIFIED_FAILURE'
  return code ? { code, message: SAFE_MESSAGES[code] } : undefined
}

export function projectSchedulerRun(row: SchedulerRunSource) {
  const startedAt = row.startedAt?.toISOString() ?? null
  const finishedAt = row.finishedAt?.toISOString() ?? null
  const durationMs =
    row.startedAt && row.finishedAt ? row.finishedAt.getTime() - row.startedAt.getTime() : null
  const reason = reasonFor(row.status, row.errorMessage)

  return {
    id: row.id,
    jobName: row.jobName,
    status: row.status,
    attempt: row.attempt,
    scheduledAt: row.scheduledAt.toISOString(),
    startedAt,
    finishedAt,
    triggeredBy: row.triggeredBy,
    durationMs,
    ...(reason ? { reason } : {}),
  }
}
