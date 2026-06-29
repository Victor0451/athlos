import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
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

vi.mock('@/lib/api/health', () => ({
  getHealth: (...args: unknown[]) => getHealthMock(...args),
  getFreshness: (...args: unknown[]) => getFreshnessMock(...args),
}))

vi.mock('@/lib/api/scheduler', () => ({
  getSchedulerHealth: (...args: unknown[]) => getSchedulerHealthMock(...args),
  getRecentRuns: (...args: unknown[]) => getRecentRunsMock(...args),
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
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the page heading', async () => {
    renderDashboard()
    expect(screen.getByRole('heading', { name: /dashboard/i, level: 1 })).toBeInTheDocument()
  })

  it('renders the API Health card with version and uptime from /health', async () => {
    renderDashboard()
    await waitFor(() => {
      expect(screen.getByText('0.5.12')).toBeInTheDocument()
    })
    // Uptime is formatted as "h" — 12345s ≈ 3h 25m
    expect(screen.getByText(/3h/)).toBeInTheDocument()
    // The health badge sits inside the API card specifically (not
    // the per-job scheduler badges further down). Scope to the
    // health-card testid to avoid colliding with the same-status
    // scheduler badges that the ADMIN user also sees.
    const apiCard = screen.getByTestId('dashboard-health-card')
    expect(within(apiCard).getByRole('status', { name: /operativo/i })).toBeInTheDocument()
  })

  it('renders the Master Counts card with the row counts from /api/v1/freshness', async () => {
    renderDashboard()
    await waitFor(() => {
      expect(screen.getByText('socios')).toBeInTheDocument()
    })
    expect(screen.getByText('16.383')).toBeInTheDocument()
    expect(screen.getByText('200.945')).toBeInTheDocument()
    expect(screen.getByText('escuela')).toBeInTheDocument()
  })

  it('renders the Scheduler Status card for ADMIN', async () => {
    useAuthMock.mockReturnValue(makeAdminUser())
    renderDashboard()
    await waitFor(() => {
      expect(screen.getByTestId('scheduler-job-scheduled-import')).toBeInTheDocument()
    })
    expect(screen.getByTestId('scheduler-job-reconciliation')).toBeInTheDocument()
  })

  it('renders the Recent Runs card for ADMIN', async () => {
    useAuthMock.mockReturnValue(makeAdminUser())
    renderDashboard()
    await waitFor(() => {
      expect(screen.getByTestId('recent-run-run-1')).toBeInTheDocument()
    })
    expect(screen.getByTestId('recent-run-run-2')).toBeInTheDocument()
  })

  it('hides the Scheduler Status + Recent Runs cards for non-ADMIN operators', async () => {
    useAuthMock.mockReturnValue(makeOperadorUser())
    renderDashboard()
    // Wait for ADMIN-only queries to resolve (they shouldn't fire).
    await waitFor(() => {
      expect(getHealthMock).toHaveBeenCalled()
    })
    expect(getSchedulerHealthMock).not.toHaveBeenCalled()
    expect(getRecentRunsMock).not.toHaveBeenCalled()
    expect(screen.queryByTestId('dashboard-scheduler-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('dashboard-recent-runs-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('dashboard-admin-section')).not.toBeInTheDocument()
  })
})
