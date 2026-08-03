import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Scheduler list page tests (TASK-033, PR 8c.1).
 *
 * `/admin/scheduler` is the operator's landing page for the
 * 6 registered jobs (drift-detection, freshness-refresh,
 * token-cleanup, scheduled-import, scheduled-promotion,
 * reconciliation). Per the spec:
 *   - One row per job with name, last-run timestamp, status badge
 *   - The whole row is clickable → navigates to /admin/scheduler/<name>
 *   - ADMIN-only (page renders the "Sin permisos" copy for
 *     non-ADMIN operators and does NOT fire any query)
 *   - Loading skeleton + empty state on initial load
 *   - "Próximamente" placeholder for the deferred advanced filters
 *
 * The page makes 6 parallel `getSchedulerJob(name)` calls (one
 * per known job) to pull the live def + lastRuns. The list is
 * hardcoded because the API has no "list all jobs" endpoint —
 * the dashboard's /api/v1/admin/jobs/health could be used but
 * the orchestrator brief specifies /api/v1/scheduler/jobs for
 * the admin surface.
 */

const pushMock = vi.fn()
const replaceMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, back: vi.fn() }),
  usePathname: () => '/admin/scheduler',
  useSearchParams: () => new URLSearchParams(),
}))

const getSchedulerJobMock = vi.fn()
const getSchedulerHealthMock = vi.fn()
vi.mock('@/lib/api/scheduler', () => ({
  getSchedulerJob: (...args: unknown[]) => getSchedulerJobMock(...args),
  getSchedulerHealth: (...args: unknown[]) => getSchedulerHealthMock(...args),
}))

const useAuthMock = vi.fn()
vi.mock('@/lib/use-auth', () => ({
  useAuth: () => useAuthMock(),
}))

const { default: SchedulerListPage } = await import('./page')

function makeAdminUser() {
  return {
    user: {
      operator_id: 'op-admin',
      role: 'ADMIN' as const,
      username: 'admin',
      permissions: { can_reprint: true, can_anulate: true },
    },
    token: 'fake.jwt',
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  }
}

function makeOperadorUser() {
  return {
    user: {
      operator_id: 'op-1',
      role: 'OPERADOR' as const,
      username: 'operador',
      permissions: { can_reprint: false, can_anulate: false },
    },
    token: 'fake.jwt',
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  }
}

function makeJobDetail(name: string, cronExpr: string, lastRunStatus: string | null) {
  return {
    name,
    cronExpr,
    timezone: 'America/Argentina/Buenos_Aires',
    cadenceMinutes: 15,
    enabled: true,
    healthy: lastRunStatus === 'succeeded',
    reason: '',
    lastRuns:
      lastRunStatus === null
        ? []
        : [
            {
              id: `run-${name}`,
              jobName: name,
              status: lastRunStatus,
              attempt: 1,
              scheduledAt: '2026-06-27T10:00:00.000Z',
              startedAt: '2026-06-27T10:00:01.000Z',
              finishedAt: '2026-06-27T10:00:05.000Z',
              triggeredBy: 'scheduler',
              errorMessage: null,
              durationMs: 4000,
            },
          ],
  }
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <SchedulerListPage />
    </QueryClientProvider>,
  )
}

describe('Scheduler list page', () => {
  beforeEach(() => {
    pushMock.mockReset()
    replaceMock.mockReset()
    useAuthMock.mockReset()
    useAuthMock.mockReturnValue(makeAdminUser())
    getSchedulerJobMock.mockReset()
    getSchedulerHealthMock.mockReset()
    getSchedulerHealthMock.mockResolvedValue({
      items: [
        {
          name: 'drift-detection',
          cronExpr: '*/15 * * * *',
          enabled: true,
          healthy: true,
          lastRun: makeJobDetail('drift-detection', '*/15 * * * *', 'succeeded').lastRuns[0],
        },
      ],
    })
  })

  it('renders the page heading + intro copy', async () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /scheduler/i, level: 1 })).toBeInTheDocument()
  })

  it('fires one dynamic health query on mount for ADMIN', async () => {
    renderPage()
    await waitFor(() => {
      expect(getSchedulerHealthMock).toHaveBeenCalledTimes(1)
    })
    expect(getSchedulerJobMock).not.toHaveBeenCalled()
  })

  it('renders runtime-registered jobs from one dynamic health query', async () => {
    getSchedulerHealthMock.mockResolvedValue({
      items: [
        {
          name: 'drift-detection',
          cronExpr: '*/15 * * * *',
          enabled: true,
          healthy: true,
          lastRun: null,
        },
        {
          name: 'runtime-registered-job',
          cronExpr: '0 * * * *',
          enabled: true,
          healthy: false,
          lastRun: null,
        },
      ],
    })

    renderPage()

    expect(await screen.findByTestId('job-card-runtime-registered-job')).toBeInTheDocument()
    expect(getSchedulerHealthMock).toHaveBeenCalledTimes(1)
    expect(getSchedulerJobMock).not.toHaveBeenCalled()
  })

  it('renders one JobCard per registry job with the right name + cron + status badge', async () => {
    renderPage()
    expect(await screen.findByTestId('job-card-drift-detection')).toBeInTheDocument()
  })

  it('navigates to /admin/scheduler/<name> when a card is clicked', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByTestId('job-card-drift-detection')
    await user.click(screen.getByRole('button', { name: /drift-detection/i }))
    expect(pushMock).toHaveBeenCalledWith('/admin/scheduler/drift-detection')
  })

  it('renders the Próximamente placeholder for deferred advanced filters', () => {
    renderPage()
    expect(screen.getByText(/próximamente/i)).toBeInTheDocument()
  })

  it('renders the loading skeleton while the queries are pending', () => {
    getSchedulerHealthMock.mockReturnValue(new Promise(() => {})) // never resolves
    renderPage()
    expect(screen.getByText(/cargando/i)).toBeInTheDocument()
  })

  it('renders the error state when the dynamic job query fails', async () => {
    getSchedulerHealthMock.mockRejectedValue(new Error('network down'))
    renderPage()
    expect(await screen.findByText(/no se pudo cargar/i)).toBeInTheDocument()
  })

  it('does NOT fire the health query for a non-ADMIN operator', () => {
    useAuthMock.mockReturnValue(makeOperadorUser())
    renderPage()
    expect(getSchedulerHealthMock).not.toHaveBeenCalled()
  })

  it('renders the "Sin permisos" copy for a non-ADMIN operator', () => {
    useAuthMock.mockReturnValue(makeOperadorUser())
    renderPage()
    expect(screen.getByText(/sin permisos/i)).toBeInTheDocument()
  })

  it('renders the Operativo badge for a healthy job (last run succeeded)', async () => {
    renderPage()
    const card = await screen.findByTestId('job-card-drift-detection')
    expect(within(card).getByText('Operativo')).toBeInTheDocument()
  })

  it('renders the Caído badge when the last run failed', async () => {
    getSchedulerHealthMock.mockResolvedValue({
      items: [
        {
          name: 'drift-detection',
          cronExpr: '*/15 * * * *',
          enabled: true,
          healthy: false,
          lastRun: makeJobDetail('drift-detection', '*/15 * * * *', 'failed').lastRuns[0],
        },
      ],
    })
    renderPage()
    const card = await screen.findByTestId('job-card-drift-detection')
    expect(within(card).getByText('Caído')).toBeInTheDocument()
  })
})
