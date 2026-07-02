import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

/**
 * Notifications API + hooks tests (PR 8d / 2026-07-02).
 *
 * Covers the wire contract from the backend PR1:
 *   - `getNotifications(params?)`     → `GET /api/v1/notifications`
 *   - `getUnreadCount()`             → `GET /api/v1/notifications/unread-count`
 *   - `markNotificationAsRead(id)`   → `PATCH /api/v1/notifications/:id/read`
 *   - `useNotifications(params)`     → TanStack Query list hook
 *   - `useUnreadCount()`             → TanStack Query count hook
 *   - `useMarkNotificationAsRead()`  → TanStack Query mutation hook
 *
 * The hooks tests use a fresh QueryClient per test so refetch timers
 * don't leak between cases (refetchInterval: 30_000 in the production
 * hook would otherwise keep the test process alive).
 */

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}))

const { apiFetch } = await import('@/lib/api')
const apiFetchMock = apiFetch as unknown as ReturnType<typeof vi.fn>

const {
  getNotifications,
  getUnreadCount,
  markNotificationAsRead,
  useNotifications,
  useUnreadCount,
  useMarkNotificationAsRead,
} = await import('./notifications')

const SAMPLE_NOTIFICATION = {
  id: '11111111-2222-3333-4444-555555555555',
  channel: 'in_app' as const,
  recipient_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  recipient_address: null,
  subject: null,
  body: 'Drift detectado en raw_events.legacy_id',
  metadata: { source_table: 'ctacte', drift_count: 42 },
  event_id: 'drift-2026-07-02-001',
  status: 'sent' as const,
  read_at: null,
  created_at: '2026-07-02T12:34:56.000Z',
}

describe('notifications API', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getNotifications()', () => {
    it('calls GET /api/v1/notifications with no params when invoked without arguments', async () => {
      apiFetchMock.mockResolvedValueOnce({
        items: [SAMPLE_NOTIFICATION],
        page: 1,
        limit: 20,
        total: 1,
        has_more: false,
      })

      await getNotifications()

      expect(apiFetchMock).toHaveBeenCalledTimes(1)
      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/notifications', { query: {} })
    })

    it('serializes status, page, and limit as query params when provided', async () => {
      apiFetchMock.mockResolvedValueOnce({
        items: [],
        page: 1,
        limit: 50,
        total: 0,
        has_more: false,
      })

      await getNotifications({ status: 'unread', page: 2, limit: 50 })

      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/notifications', {
        query: { status: 'unread', page: 2, limit: 50 },
      })
    })

    it('returns the parsed list shape with items + pagination metadata', async () => {
      const payload = {
        items: [SAMPLE_NOTIFICATION],
        page: 1,
        limit: 20,
        total: 1,
        has_more: false,
      }
      apiFetchMock.mockResolvedValueOnce(payload)

      const result = await getNotifications()

      expect(result).toEqual(payload)
    })
  })

  describe('getUnreadCount()', () => {
    it('calls GET /api/v1/notifications/unread-count', async () => {
      apiFetchMock.mockResolvedValueOnce({ count: 5 })

      await getUnreadCount()

      expect(apiFetchMock).toHaveBeenCalledTimes(1)
      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/notifications/unread-count', { query: {} })
    })
  })

  describe('markNotificationAsRead()', () => {
    it('issues PATCH /api/v1/notifications/:id/read', async () => {
      apiFetchMock.mockResolvedValueOnce({
        ...SAMPLE_NOTIFICATION,
        status: 'read',
        read_at: '2026-07-02T13:00:00.000Z',
      })

      const result = await markNotificationAsRead(SAMPLE_NOTIFICATION.id)

      expect(apiFetchMock).toHaveBeenCalledTimes(1)
      expect(apiFetchMock).toHaveBeenCalledWith(
        `/api/v1/notifications/${SAMPLE_NOTIFICATION.id}/read`,
        { method: 'PATCH' },
      )
      expect(result.status).toBe('read')
    })
  })
})

describe('notifications hooks', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    apiFetchMock.mockReset()
  })
  afterEach(() => {
    queryClient.clear()
  })

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }

  describe('useNotifications()', () => {
    it('returns items + has_more from the wire payload', async () => {
      apiFetchMock.mockResolvedValueOnce({
        items: [SAMPLE_NOTIFICATION],
        page: 1,
        limit: 20,
        total: 1,
        has_more: false,
      })

      const { result } = renderHook(() => useNotifications(), { wrapper })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))

      expect(result.current.data?.items).toHaveLength(1)
      expect(result.current.data?.has_more).toBe(false)
    })

    it('serializes params into the query key + the apiFetch call', async () => {
      apiFetchMock.mockResolvedValueOnce({
        items: [],
        page: 1,
        limit: 20,
        total: 0,
        has_more: false,
      })

      const { result } = renderHook(() => useNotifications({ status: 'unread' }), { wrapper })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))

      expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/notifications', {
        query: { status: 'unread' },
      })
    })
  })

  describe('useUnreadCount()', () => {
    it('exposes the count value', async () => {
      apiFetchMock.mockResolvedValueOnce({ count: 12 })

      const { result } = renderHook(() => useUnreadCount(), { wrapper })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))

      expect(result.current.data).toEqual({ count: 12 })
    })
  })

  describe('useMarkNotificationAsRead()', () => {
    it('issues PATCH and invalidates the notifications query key on success', async () => {
      apiFetchMock.mockResolvedValueOnce({ ...SAMPLE_NOTIFICATION, status: 'read' })
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

      const { result } = renderHook(() => useMarkNotificationAsRead(), { wrapper })

      await act(async () => {
        result.current.mutate(SAMPLE_NOTIFICATION.id)
        await waitFor(() => expect(result.current.isSuccess).toBe(true))
      })

      expect(apiFetchMock).toHaveBeenCalledWith(
        `/api/v1/notifications/${SAMPLE_NOTIFICATION.id}/read`,
        { method: 'PATCH' },
      )
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['notifications'] })
    })
  })
})
