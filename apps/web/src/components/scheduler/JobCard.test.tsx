import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * JobCard component tests (TASK-031, PR 8c.1).
 *
 * `<JobCard>` renders ONE scheduler job as a clickable stacked-list
 * card. Used by the `/admin/scheduler` list page to surface the 6
 * registered jobs (drift-detection, freshness-refresh, token-cleanup,
 * scheduled-import, scheduled-promotion, reconciliation).
 *
 * Contract:
 *   - Renders the job name (in display font, semibold)
 *   - Renders the cron expression (mono, small) when present
 *   - Renders the last-run timestamp + status (when the job has run)
 *   - Renders "Sin corridas" when the job has never run
 *   - Renders a status badge (Operativo / Deshabilitado / Caído) per
 *     the lastRun.status + enabled flags
 *   - The whole card is a button — clicking it fires onSelect
 *     (parent navigates to /admin/scheduler/<name>)
 *   - Card is keyboard-accessible (button role + Enter/Space activate)
 *
 * The component is pure presentation — no data fetching, no
 * navigation. The page that owns the list is responsible for
 * mapping `SchedulerJobRun[]` → `<JobCard>` (typically aggregating
 * the most-recent run per jobName).
 */

const pushMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin/scheduler',
  useSearchParams: () => new URLSearchParams(),
}))

const onSelectMock = vi.fn()
const { JobCard } = await import('./JobCard')

const SAMPLE_LAST_RUN = {
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

describe('JobCard', () => {
  beforeEach(() => {
    pushMock.mockReset()
    onSelectMock.mockReset()
  })

  it('renders the job name as the primary heading', () => {
    render(
      <JobCard
        jobName="drift-detection"
        cronExpr="*/15 * * * *"
        enabled
        lastRun={SAMPLE_LAST_RUN}
        onSelect={onSelectMock}
      />,
    )
    expect(screen.getByText('drift-detection')).toBeInTheDocument()
  })

  it('renders the cron expression in mono font (small)', () => {
    render(
      <JobCard
        jobName="scheduled-import"
        cronExpr="0 2 * * *"
        enabled
        lastRun={SAMPLE_LAST_RUN}
        onSelect={onSelectMock}
      />,
    )
    expect(screen.getByTestId('job-card-scheduled-import-cron')).toHaveTextContent('0 2 * * *')
  })

  it('renders the last-run timestamp in es-AR locale (dateStyle: short + timeStyle: short)', () => {
    render(
      <JobCard
        jobName="drift-detection"
        cronExpr="*/15 * * * *"
        enabled
        lastRun={SAMPLE_LAST_RUN}
        onSelect={onSelectMock}
      />,
    )
    // The timestamp formatter uses Intl.DateTimeFormat('es-AR',
    // { dateStyle: 'short', timeStyle: 'short' }) per design §6.
    // es-AR "short" date renders as D/M/YY (not zero-padded) so we
    // match the day/month as `27/6` and skip the year (varies across
    // Intl implementations and ICU versions).
    const lastRunEl = screen.getByTestId('job-card-drift-detection-last-run')
    expect(lastRunEl.textContent).toMatch(/27\/6/)
  })

  it('renders "Sin corridas" when the job has no last run', () => {
    render(
      <JobCard
        jobName="freshness-refresh"
        cronExpr="*/5 * * * *"
        enabled
        lastRun={null}
        onSelect={onSelectMock}
      />,
    )
    expect(screen.getByText(/sin corridas/i)).toBeInTheDocument()
  })

  it('renders the Operativo status badge when enabled and the last run succeeded', () => {
    render(
      <JobCard
        jobName="drift-detection"
        cronExpr="*/15 * * * *"
        enabled
        lastRun={SAMPLE_LAST_RUN}
        onSelect={onSelectMock}
      />,
    )
    expect(screen.getByText('Operativo')).toBeInTheDocument()
  })

  it('renders the Deshabilitado status badge when enabled=false', () => {
    render(
      <JobCard
        jobName="token-cleanup"
        cronExpr="0 3 * * *"
        enabled={false}
        lastRun={SAMPLE_LAST_RUN}
        onSelect={onSelectMock}
      />,
    )
    expect(screen.getByText('Deshabilitado')).toBeInTheDocument()
  })

  it('renders the Caído status badge when the last run failed', () => {
    render(
      <JobCard
        jobName="scheduled-import"
        cronExpr="0 2 * * *"
        enabled
        lastRun={{
          ...SAMPLE_LAST_RUN,
          status: 'failed',
          reason: { code: 'EXECUTION_FAILED', message: 'The job failed during execution.' },
        }}
        onSelect={onSelectMock}
      />,
    )
    expect(screen.getByText('Caído')).toBeInTheDocument()
  })

  it.each<[status: 'cancelled' | 'completed_with_review', label: string]>([
    ['cancelled', 'Cancelada'],
    ['completed_with_review', 'Requiere revisión'],
  ])('renders the %s status with its operator-safe label', (status, label) => {
    render(
      <JobCard
        jobName="scheduled-import"
        cronExpr="0 2 * * *"
        enabled
        lastRun={{ ...SAMPLE_LAST_RUN, status }}
        onSelect={onSelectMock}
      />,
    )

    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('invokes onSelect(jobName) when the card is clicked', async () => {
    const user = userEvent.setup()
    render(
      <JobCard
        jobName="scheduled-promotion"
        cronExpr="0 */6 * * *"
        enabled
        lastRun={SAMPLE_LAST_RUN}
        onSelect={onSelectMock}
      />,
    )
    await user.click(screen.getByRole('button', { name: /scheduled-promotion/i }))
    expect(onSelectMock).toHaveBeenCalledTimes(1)
    expect(onSelectMock).toHaveBeenCalledWith('scheduled-promotion')
  })

  it('exposes a stable test-id based on jobName for the list page', () => {
    render(
      <JobCard
        jobName="reconciliation"
        cronExpr="0 * * * *"
        enabled
        lastRun={SAMPLE_LAST_RUN}
        onSelect={onSelectMock}
      />,
    )
    expect(screen.getByTestId('job-card-reconciliation')).toBeInTheDocument()
  })
})
