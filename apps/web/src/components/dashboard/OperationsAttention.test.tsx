import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const getOperationalSnapshotMock = vi.fn()
vi.mock('@/lib/api/operations', () => ({
  getOperationalSnapshot: (...args: unknown[]) => getOperationalSnapshotMock(...args),
}))
import { OperationsAttention } from './OperationsAttention'
function snapshotWithAttention(count = 1) {
  return {
    readiness: { overall: 'ready' as const, db: 'ready' as const, schema: 'ready' as const },
    freshness: { available: true, items: [] },
    jobs: { available: true, items: [] },
    attention: {
      available: true,
      items: Array.from({ length: count }, (_, index) => ({
        id: `run-${index}`,
        jobName: `scheduled-import-${index}`,
        status: 'failed',
        startedAt: '2026-06-29T11:59:00.000Z',
        durationMs: 4200,
        reason: { code: 'EXECUTION_FAILED', message: `Safe failure ${index}` },
      })),
    },
  }
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
    getOperationalSnapshotMock.mockResolvedValue(snapshotWithAttention(12))
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('shows at most ten safe links to existing scheduler destinations without controls', async () => {
    renderAttention()
    await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(10))
    expect(screen.getByRole('link', { name: /scheduled-import-0/i })).toHaveAttribute(
      'href',
      '/admin/scheduler/scheduled-import-0',
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
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

  it('does not request an operational snapshot for non-ADMIN users', async () => {
    renderAttention(false)
    await act(async () => {})
    expect(getOperationalSnapshotMock).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Atención de operaciones')).not.toBeInTheDocument()
  })

  it('keeps snapshot failure details out of the attention region', async () => {
    getOperationalSnapshotMock.mockResolvedValue({
      ...snapshotWithAttention(),
      attention: {
        available: true,
        items: [
          {
            id: 'run-raw-detail',
            jobName: 'scheduled-import',
            status: 'failed',
            startedAt: '2026-06-29T11:59:00.000Z',
            durationMs: 4200,
            reason: { code: 'EXECUTION_FAILED', message: 'raw backend detail' },
          },
        ],
      },
    })
    renderAttention()
    await waitFor(() => {
      expect(screen.getByText('Esta ejecución requiere atención.')).toBeInTheDocument()
    })
    expect(screen.queryByText('raw backend detail')).not.toBeInTheDocument()
  })
})
