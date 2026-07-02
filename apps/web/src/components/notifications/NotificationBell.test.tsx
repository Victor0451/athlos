import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

import NotificationBell from './NotificationBell'

vi.mock('@/lib/api/notifications', () => ({
  useUnreadCount: vi.fn(() => ({ data: { count: 0 } }) as never),
  useNotifications: vi.fn(
    () =>
      ({
        data: { items: [], page: 1, limit: 20, total: 0, has_more: false },
        isPending: false,
        isError: false,
        error: null,
      }) as never,
  ),
  useMarkNotificationAsRead: vi.fn(() => ({ mutate: vi.fn() }) as never),
}))

const { useUnreadCount } = await import('@/lib/api/notifications')

describe('NotificationBell', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    vi.mocked(useUnreadCount).mockReset()
  })
  afterEach(() => {
    queryClient.clear()
    vi.restoreAllMocks()
  })

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }

  it('renders a bell button with aria-label including the unread count', () => {
    vi.mocked(useUnreadCount).mockReturnValue({ data: { count: 0 } } as never)

    render(<NotificationBell />, { wrapper })

    const bell = screen.getByTestId('notification-bell')
    expect(bell).toHaveAttribute('aria-label', 'Notificaciones (0 sin leer)')
    expect(bell).toHaveAttribute('aria-haspopup', 'menu')
    expect(bell).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument()
  })

  it('renders a badge with the count when there are unread notifications', () => {
    vi.mocked(useUnreadCount).mockReturnValue({ data: { count: 3 } } as never)

    render(<NotificationBell />, { wrapper })

    expect(screen.getByTestId('notification-badge')).toHaveTextContent('3')
    expect(screen.getByTestId('notification-bell')).toHaveAttribute(
      'aria-label',
      'Notificaciones (3 sin leer)',
    )
  })

  it('caps the badge display at "99+"', () => {
    vi.mocked(useUnreadCount).mockReturnValue({ data: { count: 250 } } as never)

    render(<NotificationBell />, { wrapper })

    expect(screen.getByTestId('notification-badge')).toHaveTextContent('99+')
  })

  it('opens the panel on click and closes on outside click', async () => {
    vi.mocked(useUnreadCount).mockReturnValue({ data: { count: 0 } } as never)

    render(
      <div>
        <div data-testid="outside">outside</div>
        <NotificationBell />
      </div>,
      { wrapper },
    )

    expect(screen.queryByTestId('notification-panel')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('notification-bell'))

    expect(await screen.findByTestId('notification-panel')).toBeInTheDocument()
    expect(screen.getByTestId('notification-bell')).toHaveAttribute('aria-expanded', 'true')

    fireEvent.pointerDown(screen.getByTestId('outside'))

    await waitFor(() => expect(screen.queryByTestId('notification-panel')).not.toBeInTheDocument())
  })

  it('closes the panel on Escape', async () => {
    vi.mocked(useUnreadCount).mockReturnValue({ data: { count: 0 } } as never)

    render(<NotificationBell />, { wrapper })

    fireEvent.click(screen.getByTestId('notification-bell'))
    expect(await screen.findByTestId('notification-panel')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByTestId('notification-panel')).not.toBeInTheDocument())
  })
})
