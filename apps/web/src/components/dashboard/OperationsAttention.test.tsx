import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const getOperationalSnapshotMock = vi.fn()
vi.mock('@/lib/api/operations', () => ({
  getOperationalSnapshot: (...args: unknown[]) => getOperationalSnapshotMock(...args),
}))
import { OperationsAttention } from './OperationsAttention'

type TestAttentionItem = {
  id: string
  jobName: string
  status: string
  startedAt: string
  durationMs: number
  reason: { code: string; message: string }
}

function attentionItem(overrides: Partial<TestAttentionItem> = {}): TestAttentionItem {
  return {
    id: 'run-0',
    jobName: 'scheduled-import-0',
    status: 'failed',
    startedAt: '2026-06-29T11:59:00.000Z',
    durationMs: 4200,
    reason: { code: 'EXECUTION_FAILED', message: 'Safe failure' },
    ...overrides,
  }
}

function snapshotWithAttention(items: TestAttentionItem[] = defaultItems(12)) {
  return {
    readiness: { overall: 'ready' as const, db: 'ready' as const, schema: 'ready' as const },
    freshness: { available: true, items: [] },
    jobs: { available: true, items: [] },
    attention: { available: true, items },
  }
}

function defaultItems(count: number) {
  return Array.from({ length: count }, (_, index) =>
    attentionItem({
      id: `run-${index}`,
      jobName: `scheduled-import-${index}`,
      startedAt: `2026-06-${String(29 - Math.floor(index / 24)).padStart(2, '0')}T${String(
        11 - (index % 12),
      ).padStart(2, '0')}:59:00.000Z`,
      reason: { code: 'EXECUTION_FAILED', message: `Safe failure ${index}` },
    }),
  )
}

function renderAttention(isAdmin = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <OperationsAttention isAdmin={isAdmin} />
    </QueryClientProvider>,
  )
}

describe('OperationsAttention', () => {
  beforeEach(() => {
    getOperationalSnapshotMock.mockReset()
    getOperationalSnapshotMock.mockResolvedValue(snapshotWithAttention())
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('groups runs by job, sorts groups by their latest run, and shows one review link per job', async () => {
    getOperationalSnapshotMock.mockResolvedValue(
      snapshotWithAttention([
        attentionItem({
          id: 'run-old',
          jobName: 'same-job',
          startedAt: '2026-06-29T10:00:00.000Z',
        }),
        attentionItem({
          id: 'run-new',
          jobName: 'same-job',
          startedAt: '2026-06-29T11:00:00.000Z',
        }),
        attentionItem({
          id: 'run-newest',
          jobName: 'same-job',
          startedAt: '2026-06-29T12:00:00.000Z',
        }),
        attentionItem({
          id: 'run-other',
          jobName: 'other-job',
          startedAt: '2026-06-29T13:00:00.000Z',
        }),
      ]),
    )

    renderAttention()

    await waitFor(() => expect(screen.getByText('3 ejecuciones')).toBeInTheDocument())
    expect(screen.getAllByRole('link')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'Revisar same-job' })).toHaveAttribute(
      'href',
      '/admin/scheduler/same-job',
    )
    expect(screen.getByText('29/6/26, 12:00 p. m.')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('other-job')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows at most ten job groups', async () => {
    renderAttention()
    await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(10))
  })

  it('does not render raw reason messages', async () => {
    getOperationalSnapshotMock.mockResolvedValue(
      snapshotWithAttention([
        attentionItem({ reason: { code: 'EXECUTION_FAILED', message: 'raw backend detail' } }),
      ]),
    )
    renderAttention()
    await waitFor(() => expect(screen.getByRole('link', { name: /Revisar/ })).toBeInTheDocument())
    expect(screen.queryByText('raw backend detail')).not.toBeInTheDocument()
  })

  it('refreshes the ADMIN snapshot every 30 seconds', async () => {
    vi.useFakeTimers()
    renderAttention()
    await act(async () => {})
    expect(getOperationalSnapshotMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(getOperationalSnapshotMock).toHaveBeenCalledTimes(2)
  })

  it('renders nothing and does not request a snapshot for non-ADMIN users', async () => {
    renderAttention(false)
    await act(async () => {})
    expect(getOperationalSnapshotMock).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Atención de operaciones')).not.toBeInTheDocument()
  })

  it('shows a loading skeleton while the snapshot is pending', () => {
    getOperationalSnapshotMock.mockImplementation(() => new Promise(() => undefined))
    renderAttention()
    const status = screen.getByRole('status', { name: 'Cargando atención de operaciones' })
    expect(status).toBeInTheDocument()
    expect(status.querySelectorAll('.animate-pulse')).toHaveLength(2)
    expect(screen.getByText('Cargando atención de operaciones…')).toHaveClass('sr-only')
  })

  it('shows the calm empty state when attention is unavailable or empty', async () => {
    getOperationalSnapshotMock.mockResolvedValue({
      ...snapshotWithAttention([]),
      attention: { available: false, items: [] },
    })
    renderAttention()
    await waitFor(() =>
      expect(screen.getByText('Sin ejecuciones que requieran atención.')).toBeInTheDocument(),
    )
  })
})
