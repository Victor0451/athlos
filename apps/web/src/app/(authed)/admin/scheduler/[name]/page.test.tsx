import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Scheduler detail page tests (TASK-034, PR 8c.1).
 *
 * `/admin/scheduler/[name]` shows one scheduler job's full detail.
 * Per the spec:
 *   - Job name + cron + timezone + cadence header
 *   - Last 5 runs (RunList) with status, duration, attempt, error
 *   - "Disparar ahora" button with confirm dialog
 *   - Enable/disable toggle (controlled by the job's enabled flag)
 *   - ADMIN-only: non-ADMIN operators see "Sin permisos" + no fetch
 *   - 404 for unknown job name → "Trabajo no encontrado" + back link
 *   - Refetches after a successful trigger or toggle
 *   - Loading skeleton + error state on initial load
 */

const pushMock = vi.fn()
const replaceMock = vi.fn()
const backMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, back: backMock }),
  useParams: () => ({ name: 'drift-detection' }),
  usePathname: () => '/admin/scheduler/drift-detection',
  useSearchParams: () => new URLSearchParams(),
}))

const getSchedulerJobMock = vi.fn()
const triggerSchedulerJobMock = vi.fn()
const setSchedulerJobEnabledMock = vi.fn()
vi.mock('@/lib/api/scheduler', () => ({
  getSchedulerJob: (...args: unknown[]) => getSchedulerJobMock(...args),
  triggerSchedulerJob: (...args: unknown[]) => triggerSchedulerJobMock(...args),
  setSchedulerJobEnabled: (...args: unknown[]) => setSchedulerJobEnabledMock(...args),
}))

const useAuthMock = vi.fn()
vi.mock('@/lib/use-auth', () => ({
  useAuth: () => useAuthMock(),
}))

const { default: SchedulerDetailPage } = await import('./page')

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

const SAMPLE_JOB_DETAIL = {
  name: 'drift-detection',
  cronExpr: '*/15 * * * *',
  timezone: 'America/Argentina/Buenos_Aires',
  cadenceMinutes: 15,
  enabled: true,
  healthy: true,
  reason: '',
  lastRuns: [
    {
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
    },
  ],
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <SchedulerDetailPage />
    </QueryClientProvider>,
  )
}

describe('Scheduler detail page', () => {
  beforeEach(() => {
    pushMock.mockReset()
    replaceMock.mockReset()
    backMock.mockReset()
    useAuthMock.mockReset()
    useAuthMock.mockReturnValue(makeAdminUser())
    getSchedulerJobMock.mockReset()
    getSchedulerJobMock.mockResolvedValue(SAMPLE_JOB_DETAIL)
    triggerSchedulerJobMock.mockReset()
    setSchedulerJobEnabledMock.mockReset()
  })

  it('renders the job name as the heading + back link to the list', async () => {
    renderPage()
    expect(
      await screen.findByRole('heading', { name: 'drift-detection', level: 1 }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /volver al listado/i })).toHaveAttribute(
      'href',
      '/admin/scheduler',
    )
  })

  it('calls getSchedulerJob(name) on mount for ADMIN', async () => {
    renderPage()
    await waitFor(() => {
      expect(getSchedulerJobMock).toHaveBeenCalledTimes(1)
    })
    expect(getSchedulerJobMock).toHaveBeenCalledWith('drift-detection')
  })

  it('renders the cron expression + timezone + cadence metadata strip', async () => {
    renderPage()
    expect(await screen.findByText(/\*\/\s*15\s*\*\s*\*\s*\*\s*\*?/)).toBeInTheDocument()
    expect(screen.getByText(/america\/argentina/i)).toBeInTheDocument()
    expect(screen.getByText(/15\s*min/i)).toBeInTheDocument()
  })

  it('renders the RunList with the most-recent runs', async () => {
    renderPage()
    expect(await screen.findByTestId('run-list')).toBeInTheDocument()
    expect(screen.getByTestId('run-row-run-1')).toBeInTheDocument()
  })

  it('renders the "Disparar ahora" trigger button', async () => {
    renderPage()
    expect(await screen.findByTestId('trigger-now-button')).toBeInTheDocument()
  })

  it('renders the enable toggle in the enabled state', async () => {
    renderPage()
    const toggle = await screen.findByTestId('enable-toggle-switch')
    expect(toggle).toBeChecked()
  })

  it('opens the confirm dialog and triggers the job on Confirmar', async () => {
    const user = userEvent.setup()
    triggerSchedulerJobMock.mockResolvedValue({ jobRunId: 'run-new', status: 'pending' })
    renderPage()
    const triggerBtn = await screen.findByTestId('trigger-now-button')
    await user.click(triggerBtn)
    await user.click(screen.getByTestId('trigger-dialog-confirm'))
    await waitFor(() => {
      expect(triggerSchedulerJobMock).toHaveBeenCalledWith('drift-detection')
    })
  })

  it('refetches the job detail after a successful trigger', async () => {
    const user = userEvent.setup()
    triggerSchedulerJobMock.mockResolvedValue({ jobRunId: 'run-new', status: 'pending' })
    renderPage()
    await screen.findByTestId('trigger-now-button')
    await user.click(screen.getByRole('button', { name: /disparar ahora/i }))
    await user.click(screen.getByTestId('trigger-dialog-confirm'))
    await waitFor(() => {
      // initial fetch + refetch after trigger = 2 calls
      expect(getSchedulerJobMock.mock.calls.length).toBeGreaterThanOrEqual(2)
    })
  })

  it('toggles the job off when the switch is clicked', async () => {
    const user = userEvent.setup()
    setSchedulerJobEnabledMock.mockResolvedValue({
      name: 'drift-detection',
      cronExpr: '*/15 * * * *',
      timezone: 'America/Argentina/Buenos_Aires',
      cadenceMinutes: 15,
      enabled: false,
    })
    renderPage()
    const toggle = await screen.findByTestId('enable-toggle-switch')
    await user.click(toggle)
    await waitFor(() => {
      expect(setSchedulerJobEnabledMock).toHaveBeenCalledWith('drift-detection', false)
    })
  })

  it('renders the "Trabajo no encontrado" copy for an unknown job name (404)', async () => {
    const notFound = Object.assign(new Error('JOB_NOT_FOUND'), {
      status: 404,
      code: 'JOB_NOT_FOUND',
      name: 'ApiError',
    })
    getSchedulerJobMock.mockRejectedValueOnce(notFound)
    renderPage()
    // The copy appears in both the h1 + the body p (the spec
    // requires both — page title + explanatory text), so we use
    // findAllByText and assert that at least one is present.
    const matches = await screen.findAllByText(/trabajo no encontrado/i)
    expect(matches.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('link', { name: /volver al listado/i })).toBeInTheDocument()
  })

  it('renders the "Sin permisos" copy for a non-ADMIN operator', () => {
    useAuthMock.mockReturnValue(makeOperadorUser())
    renderPage()
    expect(screen.getByText(/sin permisos/i)).toBeInTheDocument()
    expect(getSchedulerJobMock).not.toHaveBeenCalled()
  })

  it('renders the loading skeleton while the query is pending', () => {
    getSchedulerJobMock.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByText(/cargando/i)).toBeInTheDocument()
  })

  it('renders the error state when the fetch fails (non-404)', async () => {
    getSchedulerJobMock.mockRejectedValueOnce(new Error('network down'))
    renderPage()
    expect(await screen.findByText(/no se pudo cargar el trabajo/i)).toBeInTheDocument()
  })

  it('renders the "Deshabilitado" badge when the job is disabled', async () => {
    getSchedulerJobMock.mockResolvedValueOnce({ ...SAMPLE_JOB_DETAIL, enabled: false })
    renderPage()
    expect(await screen.findByText('Deshabilitado')).toBeInTheDocument()
  })
})
