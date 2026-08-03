import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Dashboard page tests (TASK-016, PR 8a.3).
 *
 * Covers `web-frontend/spec.md` Dashboard Cards scenarios:
 *   - API Health card shows status / version / uptime from /health
 *   - Master Counts card shows row counts from /api/v1/freshness
 *   - Scheduler Status + Recent Runs cards render for ADMIN only
 *   - Non-ADMIN operators do NOT see the scheduler cards
 *   - All cards auto-refresh every 30 seconds (verified by passing
 *     `refetchInterval: 30_000` to the queries — we don't need to
 *     fake time)
 *
 * We mock the API + auth modules (no fetch in the test) and provide
 * a fresh `QueryClient` per test so the cache state is isolated.
 */

const replaceMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: replaceMock, back: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}))

const getHealthMock = vi.fn()
const getFreshnessMock = vi.fn()
const getSchedulerHealthMock = vi.fn()
const getRecentRunsMock = vi.fn()
const getOperationalSnapshotMock = vi.fn()

vi.mock('@/lib/api/health', () => ({
  getHealth: (...args: unknown[]) => getHealthMock(...args),
  getFreshness: (...args: unknown[]) => getFreshnessMock(...args),
}))

vi.mock('@/lib/api/scheduler', () => ({
  getSchedulerHealth: (...args: unknown[]) => getSchedulerHealthMock(...args),
  getRecentRuns: (...args: unknown[]) => getRecentRunsMock(...args),
}))

vi.mock('@/lib/api/operations', () => ({
  getOperationalSnapshot: (...args: unknown[]) => getOperationalSnapshotMock(...args),
}))

const useAuthMock = vi.fn()
vi.mock('@/lib/use-auth', () => ({
  useAuth: () => useAuthMock(),
}))

const { default: DashboardPage } = await import('./page')

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
      operator_id: 'op-operador',
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

function renderDashboard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <DashboardPage />
    </QueryClientProvider>,
  )
}

describe('DashboardPage', () => {
  beforeEach(() => {
    replaceMock.mockReset()
    getHealthMock.mockReset()
    getFreshnessMock.mockReset()
    getSchedulerHealthMock.mockReset()
    getRecentRunsMock.mockReset()
    getOperationalSnapshotMock.mockReset()
    useAuthMock.mockReset()

    // Default: ADMIN user with healthy responses.
    useAuthMock.mockReturnValue(makeAdminUser())
    getHealthMock.mockResolvedValue({
      status: 'ok',
      version: '0.5.12',
      uptime: 12345.6,
      timestamp: '2026-06-29T12:00:00.000Z',
    })
    getFreshnessMock.mockResolvedValue({
      items: [
        { domain: 'socios', row_count: 16383, last_update: '2026-06-29T08:00:00.000Z' },
        { domain: 'ctacte', row_count: 200945, last_update: '2026-06-29T09:00:00.000Z' },
        { domain: 'escuela', row_count: 61, last_update: '2026-06-29T08:00:00.000Z' },
        { domain: 'disciplinas', row_count: 32, last_update: '2026-06-29T08:00:00.000Z' },
      ],
    })
    getSchedulerHealthMock.mockResolvedValue({
      items: [
        {
          name: 'scheduled-import',
          healthy: true,
          enabled: true,
          cronExpr: '*/5 * * * *',
          cadenceMinutes: 5,
          scheduled: true,
          inFlight: false,
          reason: null,
          lastRun: {
            id: 'run-scheduled-import-1',
            status: 'succeeded',
            startedAt: '2026-06-29T11:59:00.000Z',
            finishedAt: '2026-06-29T11:59:04.200Z',
            attempt: 1,
            durationMs: 4200,
            errorMessage: null,
          },
        },
        {
          name: 'reconciliation',
          healthy: true,
          enabled: true,
          cronExpr: '0 * * * *',
          cadenceMinutes: 60,
          scheduled: true,
          inFlight: false,
          reason: null,
          lastRun: {
            id: 'run-reconciliation-1',
            status: 'succeeded',
            startedAt: '2026-06-29T11:00:00.000Z',
            finishedAt: '2026-06-29T11:00:01.100Z',
            attempt: 1,
            durationMs: 1100,
            errorMessage: null,
          },
        },
      ],
    })
    getRecentRunsMock.mockResolvedValue({
      items: [
        {
          id: 'run-1',
          jobName: 'scheduled-import',
          startedAt: '2026-06-29T11:59:00.000Z',
          finishedAt: '2026-06-29T11:59:04.200Z',
          durationMs: 4200,
          status: 'succeeded',
          attempt: 1,
          scheduledAt: '2026-06-29T11:59:00.000Z',
          triggeredBy: 'scheduler',
          errorMessage: null,
        },
        {
          id: 'run-2',
          jobName: 'reconciliation',
          startedAt: '2026-06-29T11:00:00.000Z',
          finishedAt: '2026-06-29T11:00:01.100Z',
          durationMs: 1100,
          status: 'succeeded',
          attempt: 1,
          scheduledAt: '2026-06-29T11:00:00.000Z',
          triggeredBy: 'scheduler',
          errorMessage: null,
        },
      ],
    })
    getOperationalSnapshotMock.mockResolvedValue({
      readiness: { overall: 'ready', db: 'ready', schema: 'ready' },
      freshness: {
        available: true,
        items: [
          {
            domain: 'socios',
            lastImportAt: '2026-06-29T08:00:00.000Z',
            recordCount: 16383,
            status: 'current',
            ageDisplay: '4h',
          },
        ],
      },
      jobs: {
        available: true,
        items: [
          {
            name: 'scheduled-import',
            healthy: true,
            enabled: true,
            cronExpr: '*/5 * * * *',
            lastRun: { startedAt: '2026-06-29T11:59:00.000Z' },
          },
        ],
      },
      attention: {
        available: true,
        items: [
          {
            id: 'run-1',
            jobName: 'scheduled-import',
            status: 'failed',
            startedAt: '2026-06-29T11:59:00.000Z',
            durationMs: 4200,
            reason: { code: 'EXECUTION_FAILED', message: 'Execution failed safely.' },
          },
        ],
      },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('renders the page heading', async () => {
    renderDashboard()
    expect(screen.getByRole('heading', { name: /dashboard/i, level: 1 })).toBeInTheDocument()
  })

  it('renders DB and schema readiness from the operational snapshot', async () => {
    renderDashboard()
    await waitFor(() => {
      expect(screen.getByText('Operativa')).toBeInTheDocument()
    })
    const apiCard = screen.getByTestId('dashboard-health-card')
    expect(within(apiCard).getByRole('status', { name: /operativo/i })).toBeInTheDocument()
    expect(within(apiCard).getByText('Schema')).toBeInTheDocument()
  })

  it('renders the Master Counts card with the row counts from /api/v1/freshness', async () => {
    renderDashboard()
    await waitFor(() => {
      expect(screen.getByText('socios')).toBeInTheDocument()
    })
    expect(screen.getByText('16.383')).toBeInTheDocument()
  })

  it('renders the Scheduler Status card for ADMIN', async () => {
    useAuthMock.mockReturnValue(makeAdminUser())
    renderDashboard()
    await waitFor(() => {
      expect(screen.getByTestId('scheduler-job-scheduled-import')).toBeInTheDocument()
    })
  })

  it('renders the Recent Runs card for ADMIN', async () => {
    useAuthMock.mockReturnValue(makeAdminUser())
    renderDashboard()
    await waitFor(() => {
      expect(screen.getByTestId('attention-run-run-1')).toBeInTheDocument()
    })
  })

  it('hides the Scheduler Status + Recent Runs cards for non-ADMIN operators', async () => {
    useAuthMock.mockReturnValue(makeOperadorUser())
    renderDashboard()
    await act(async () => {})
    expect(getOperationalSnapshotMock).not.toHaveBeenCalled()
    expect(screen.queryByTestId('dashboard-scheduler-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('dashboard-recent-runs-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('dashboard-admin-section')).not.toBeInTheDocument()
  })

  it('uses one operational snapshot query on mount and every 30 seconds', async () => {
    vi.useFakeTimers()
    renderDashboard()

    await act(async () => {})
    expect(getOperationalSnapshotMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(getOperationalSnapshotMock).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('renders independent snapshot signals and caps safe attention rows at ten', async () => {
    getOperationalSnapshotMock.mockResolvedValueOnce({
      readiness: { overall: 'unavailable', db: 'ready', schema: 'unavailable' },
      freshness: { available: false, items: [] },
      jobs: { available: false, items: [] },
      attention: {
        available: true,
        items: Array.from({ length: 11 }, (_, index) => ({
          id: `attention-${index}`,
          jobName: `job-${index}`,
          status: 'failed',
          startedAt: '2026-06-29T11:00:00.000Z',
          durationMs: null,
          reason: { code: 'EXECUTION_FAILED', message: 'Execution failed safely.' },
        })),
      },
    })
    renderDashboard()

    await waitFor(() => expect(screen.getByTestId('attention-run-attention-0')).toBeInTheDocument())
    expect(screen.getByText('DB')).toBeInTheDocument()
    expect(screen.getByText('Schema')).toBeInTheDocument()
    expect(screen.getByText(/sin datos de frescura/i)).toBeInTheDocument()
    expect(screen.getByText(/sin datos de trabajos/i)).toBeInTheDocument()
    expect(screen.getAllByTestId(/attention-run-/)).toHaveLength(10)
    expect(screen.queryByTestId('attention-run-attention-10')).not.toBeInTheDocument()
    expect(screen.queryByText(/raw exception/i)).not.toBeInTheDocument()
  })
})
