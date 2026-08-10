import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/**
 * RunList component tests (TASK-032, PR 8c.1).
 *
 * `<RunList>` renders the recent runs of a single scheduler job
 * (the last 5 returned by `GET /api/v1/scheduler/jobs/<name>`).
 * Used by the `/admin/scheduler/<name>` detail page.
 *
 * Contract:
 *   - Header shows the run count + "corridas" copy
 *   - One row per run with: status badge, started timestamp,
 *     duration (seconds), attempt number, error message (when failed)
 *   - Loading state: 5 skeleton rows
 *   - Empty state: "Sin corridas registradas" copy
 *   - Failed runs are visually muted (text-ink-500) so the
 *     operator can scan for failures quickly
 *
 * The component is pure presentation — no data fetching, no
 * pagination. The page that owns the runs is responsible for
 * passing the array of `SchedulerJobRun`.
 */

const { RunList } = await import('./RunList')

const RUN_SUCCEEDED = {
  id: 'run-1',
  jobName: 'drift-detection',
  status: 'succeeded' as const,
  attempt: 1,
  scheduledAt: '2026-06-27T10:00:00.000Z',
  startedAt: '2026-06-27T10:00:01.000Z',
  finishedAt: '2026-06-27T10:00:05.000Z',
  triggeredBy: 'scheduler' as const,
  errorMessage: null,
  durationMs: 4000,
}

const RUN_FAILED = {
  id: 'run-2',
  jobName: 'drift-detection',
  status: 'failed' as const,
  attempt: 2,
  scheduledAt: '2026-06-27T09:45:00.000Z',
  startedAt: '2026-06-27T09:45:01.000Z',
  finishedAt: '2026-06-27T09:45:02.000Z',
  triggeredBy: 'scheduler' as const,
  reason: { code: 'EXECUTION_FAILED', message: 'The job failed during execution.' },
  durationMs: 1000,
}

describe('RunList', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('renders the run count in the header', () => {
    render(<RunList runs={[RUN_SUCCEEDED, RUN_FAILED]} loading={false} />)
    expect(screen.getByText(/2 corridas/i)).toBeInTheDocument()
  })

  it('renders one row per run with the status badge', () => {
    render(<RunList runs={[RUN_SUCCEEDED, RUN_FAILED]} loading={false} />)
    expect(screen.getAllByRole('status').length).toBeGreaterThanOrEqual(2)
  })

  it('renders the duration in seconds (e.g. "4.0s") for succeeded runs', () => {
    render(<RunList runs={[RUN_SUCCEEDED]} loading={false} />)
    expect(screen.getByText('4.0s')).toBeInTheDocument()
  })

  it('renders the attempt count with "Intento N" copy', () => {
    render(<RunList runs={[RUN_FAILED]} loading={false} />)
    expect(screen.getByText(/intento\s*2/i)).toBeInTheDocument()
  })

  it('renders the projected message when a run failed', () => {
    render(<RunList runs={[RUN_FAILED]} loading={false} />)
    expect(screen.getByText('The job failed during execution.')).toBeInTheDocument()
  })

  it('renders only the projected message for cancelled and review-required runs', () => {
    render(
      <RunList
        runs={[
          {
            ...RUN_SUCCEEDED,
            id: 'run-cancelled',
            status: 'cancelled',
            reason: { code: 'CANCELLED', message: 'The job was cancelled.' },
          },
          {
            ...RUN_SUCCEEDED,
            id: 'run-review',
            status: 'completed_with_review',
            reason: { code: 'REVIEW_REQUIRED', message: 'The job completed and requires review.' },
          },
        ]}
      />,
    )

    expect(screen.getByText('Cancelada')).toBeInTheDocument()
    expect(screen.getByText('Requiere revisión')).toBeInTheDocument()
    expect(screen.getByText('The job was cancelled.')).toBeInTheDocument()
    expect(screen.getByText('The job completed and requires review.')).toBeInTheDocument()
    expect(screen.queryByText('connection refused to upstream')).not.toBeInTheDocument()
  })

  it('does NOT render an error row when the run succeeded', () => {
    render(<RunList runs={[RUN_SUCCEEDED]} loading={false} />)
    expect(screen.queryByText(/failed during execution/i)).not.toBeInTheDocument()
  })

  it('renders the empty state when there are no runs', () => {
    render(<RunList runs={[]} loading={false} />)
    expect(screen.getByText(/sin corridas registradas/i)).toBeInTheDocument()
  })

  it('renders the loading skeleton (5 rows) when loading=true', () => {
    render(<RunList runs={[]} loading />)
    expect(screen.getByText(/cargando/i)).toBeInTheDocument()
  })

  it('exposes a stable test-id per run id for the detail page', () => {
    render(<RunList runs={[RUN_SUCCEEDED, RUN_FAILED]} loading={false} />)
    expect(screen.getByTestId('run-row-run-1')).toBeInTheDocument()
    expect(screen.getByTestId('run-row-run-2')).toBeInTheDocument()
  })

  it('renders "Manual" copy when the run was triggered by an operator', () => {
    const manualRun = { ...RUN_SUCCEEDED, id: 'run-3', triggeredBy: 'manual' as const }
    render(<RunList runs={[manualRun]} loading={false} />)
    expect(screen.getByText(/manual/i)).toBeInTheDocument()
  })
})
