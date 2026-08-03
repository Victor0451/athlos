import { describe, expect, it } from 'vitest'
import { projectSchedulerRun } from './scheduler-run-projector.ts'
const baseRun = {
  id: '00000000-0000-4000-8000-000000000001',
  jobName: 'reconciliation',
  attempt: 3,
  scheduledAt: new Date('2026-08-01T10:00:00.000Z'),
  startedAt: new Date('2026-08-01T10:01:00.000Z'),
  finishedAt: new Date('2026-08-01T10:02:30.000Z'),
  triggeredBy: 'scheduler' as const,
  metadata: { stack: 'secret stack trace' },
}

describe('projectSchedulerRun', () => {
  it('projects a failed run to allowlisted data without raw failure content', () => {
    const result = projectSchedulerRun({
      ...baseRun,
      status: 'failed',
      errorMessage: 'connection refused: postgres://operator:secret@db',
    })

    expect(result).toEqual({
      id: baseRun.id,
      jobName: baseRun.jobName,
      status: 'failed',
      attempt: 3,
      scheduledAt: '2026-08-01T10:00:00.000Z',
      startedAt: '2026-08-01T10:01:00.000Z',
      finishedAt: '2026-08-01T10:02:30.000Z',
      triggeredBy: 'scheduler',
      durationMs: 90_000,
      reason: { code: 'EXECUTION_FAILED', message: 'The job failed during execution.' },
    })
    expect(JSON.stringify(result)).not.toContain('postgres://operator:secret@db')
    expect(JSON.stringify(result)).not.toContain('secret stack trace')
  })
  it.each([
    [
      'completed_with_review',
      undefined,
      'REVIEW_REQUIRED',
      'The job completed and requires review.',
    ],
    ['cancelled', undefined, 'CANCELLED', 'The job was cancelled.'],
    ['dead_letter', 'anything', 'RETRIES_EXHAUSTED', 'The job exhausted its retry attempts.'],
    [
      'failed',
      'process terminated unexpectedly',
      'PROCESS_INTERRUPTED',
      'The process was interrupted.',
    ],
    ['failed', 'process shutdown', 'PROCESS_SHUTDOWN', 'The process shut down before completion.'],
  ] as const)('maps %s to a fixed safe reason', (status, errorMessage, code, message) => {
    const result = projectSchedulerRun({ ...baseRun, status, errorMessage })

    expect(result.reason).toEqual({ code, message })
    expect([...message].length).toBeLessThanOrEqual(160)
  })
  it.each(['pending', 'running', 'succeeded'] as const)(
    'does not add a reason to %s runs',
    (status) => {
      const result = projectSchedulerRun({ ...baseRun, status, errorMessage: 'raw failure' })

      expect(result.reason).toBeUndefined()
    },
  )
})
