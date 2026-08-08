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
const getSociosAggregateMock = vi.fn()
const getNotificationsMock = vi.fn()

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

vi.mock('@/lib/api/socios', () => ({
  getSociosAggregate: (...args: unknown[]) => getSociosAggregateMock(...args),
}))

vi.mock('@/lib/api/notifications', () => ({
  getNotifications: (...args: unknown[]) => getNotificationsMock(...args),
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
    getSociosAggregateMock.mockReset()
    getNotificationsMock.mockReset()
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
    getSociosAggregateMock.mockResolvedValue({ activos: 12, suspendidos: 1, baja: 2, total: 15 })
    getNotificationsMock.mockResolvedValue({
      items: [
        {
          id: 'notification-1',
          body: 'La cuota vence mañana.',
          status: 'pending',
        },
      ],
      page: 1,
      limit: 20,
      total: 1,
      has_more: false,
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

  it.each(['TESORERO', 'OPERADOR', 'CONSULTA'] as const)(
    'keeps workspace cards usable without requesting the ADMIN snapshot for %s',
    async (role) => {
      useAuthMock.mockReturnValue({
        ...makeOperadorUser(),
        user: { ...makeOperadorUser().user, role },
      })
      renderDashboard()

      await waitFor(() => {
        expect(screen.getByLabelText('Resumen de socios')).toHaveTextContent('15 socios')
      })
      expect(screen.getByRole('link', { name: /socios/i })).toHaveAttribute('href', '/socios')
      expect(screen.getByRole('link', { name: /cuenta corriente/i })).toHaveAttribute(
        'href',
        '/ctacte',
      )
      expect(screen.getByText('La cuota vence mañana.')).toBeInTheDocument()
      expect(getOperationalSnapshotMock).not.toHaveBeenCalled()
    },
  )

  it('shows an independent aggregate loading state while empty notifications leave cards usable', async () => {
    getSociosAggregateMock.mockImplementation(() => new Promise(() => undefined))
    getNotificationsMock.mockResolvedValue({
      items: [],
      page: 1,
      limit: 20,
      total: 0,
      has_more: false,
    })
    useAuthMock.mockReturnValue(makeOperadorUser())
    renderDashboard()

    expect(screen.getByText(/cargando resumen de socios/i)).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByLabelText('Notificaciones')).toHaveTextContent(
        'No hay notificaciones pendientes.',
      )
    })
    expect(screen.getByRole('link', { name: /padrones/i })).toHaveAttribute('href', '/padrones')
  })

  it('shows a safe aggregate error without hiding notification and workspace regions', async () => {
    getSociosAggregateMock.mockRejectedValue(new Error('raw backend detail'))
    useAuthMock.mockReturnValue(makeOperadorUser())
    renderDashboard()

    await waitFor(() =>
      expect(screen.getByRole('alert', { name: /resumen de socios/i })).toBeInTheDocument(),
    )
    expect(screen.getByText('La cuota vence mañana.')).toBeInTheDocument()
    expect(screen.queryByText(/raw backend detail/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /socios/i })).toBeInTheDocument()
  })
})
