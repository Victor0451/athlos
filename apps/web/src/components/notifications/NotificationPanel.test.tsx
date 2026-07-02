import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

import NotificationPanel from './NotificationPanel'
import type { Notification } from '@/lib/api/notifications'

vi.mock('@/lib/api/notifications', () => ({
  useNotifications: vi.fn(),
  useUnreadCount: vi.fn(() => ({ data: { count: 0 } })),
  useMarkNotificationAsRead: vi.fn(),
}))

const { useNotifications, useMarkNotificationAsRead } = await import('@/lib/api/notifications')

// `useNotifications` and `useMarkNotificationAsRead` are typed as plain
// functions in the module, so TS doesn't know they're mocks. Cast once
// at the top of the file to the vitest spy shape.
const useNotificationsMock = useNotifications as unknown as ReturnType<typeof vi.fn>
const useMarkNotificationAsReadMock = useMarkNotificationAsRead as unknown as ReturnType<
  typeof vi.fn
>

const SAMPLE: Notification = {
  id: '11111111-2222-3333-4444-555555555555',
  channel: 'in_app',
  recipient_id: null,
  recipient_address: null,
  subject: null,
  body: 'Drift detectado en raw_events.legacy_id',
  metadata: {},
  event_id: null,
  status: 'sent',
  read_at: null,
  created_at: new Date().toISOString(),
}

describe('NotificationPanel', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    useNotificationsMock.mockReset()
    useMarkNotificationAsReadMock.mockReset()
  })
  afterEach(() => {
    queryClient.clear()
  })

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }

  it('renders a loading status while the list query is pending', () => {
    useNotificationsMock.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      error: null,
    })

    render(<NotificationPanel onClose={() => {}} enabled />, { wrapper })

    expect(screen.getByTestId('notification-panel-loading')).toBeInTheDocument()
    expect(screen.getByText(/Cargando…/)).toBeInTheDocument()
  })

  it('renders an error alert when the query fails', () => {
    useNotificationsMock.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error('boom'),
    })

    render(<NotificationPanel onClose={() => {}} enabled />, { wrapper })

    expect(screen.getByTestId('notification-panel-error')).toBeInTheDocument()
    expect(screen.getByText(/boom/)).toBeInTheDocument()
  })

  it('renders the empty state when there are no items', () => {
    useNotificationsMock.mockReturnValue({
      data: { items: [], page: 1, limit: 20, total: 0, has_more: false },
      isPending: false,
      isError: false,
      error: null,
    })

    render(<NotificationPanel onClose={() => {}} enabled />, { wrapper })

    expect(screen.getByTestId('notification-panel-empty')).toBeInTheDocument()
    expect(screen.getByText(/Sin notificaciones/)).toBeInTheDocument()
  })

  it('renders one menuitem per notification and triggers mark-as-read on click', async () => {
    const mutate = vi.fn()
    useNotificationsMock.mockReturnValue({
      data: {
        items: [SAMPLE, { ...SAMPLE, id: '22222222-3333-4444-5555-666666666666', body: 'Otra' }],
        page: 1,
        limit: 20,
        total: 2,
        has_more: false,
      },
      isPending: false,
      isError: false,
      error: null,
    })
    useMarkNotificationAsReadMock.mockReturnValue({ mutate })

    render(<NotificationPanel onClose={() => {}} enabled />, { wrapper })

    const items = await screen.findAllByRole('menuitem')
    expect(items).toHaveLength(2)

    const first = items[0]
    expect(first).toBeDefined()
    fireEvent.click(first!)

    await waitFor(() => expect(mutate).toHaveBeenCalledWith(SAMPLE.id))
  })
})
