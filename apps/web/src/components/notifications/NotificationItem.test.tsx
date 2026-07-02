import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import NotificationItem from './NotificationItem'
import type { Notification } from '@/lib/api/notifications'

const BASE_NOTIFICATION: Notification = {
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

describe('NotificationItem', () => {
  it('renders the notification body in a menuitem role', () => {
    render(
      <ul>
        <NotificationItem notification={BASE_NOTIFICATION} onRead={() => {}} />
      </ul>,
    )

    const item = screen.getByRole('menuitem', { name: /notificaci[oó]n sin leer/i })
    expect(item).toBeInTheDocument()
    expect(screen.getByText(/Drift detectado en raw_events.legacy_id/)).toBeInTheDocument()
  })

  it('calls onRead with the notification id when clicked', () => {
    const onRead = vi.fn()
    render(
      <ul>
        <NotificationItem notification={BASE_NOTIFICATION} onRead={onRead} />
      </ul>,
    )

    fireEvent.click(screen.getByRole('menuitem'))

    expect(onRead).toHaveBeenCalledTimes(1)
    expect(onRead).toHaveBeenCalledWith(BASE_NOTIFICATION.id)
  })

  it('calls onRead on Enter key', () => {
    const onRead = vi.fn()
    render(
      <ul>
        <NotificationItem notification={BASE_NOTIFICATION} onRead={onRead} />
      </ul>,
    )

    fireEvent.keyDown(screen.getByRole('menuitem'), { key: 'Enter' })

    expect(onRead).toHaveBeenCalledWith(BASE_NOTIFICATION.id)
  })

  it('calls onRead on Space key', () => {
    const onRead = vi.fn()
    render(
      <ul>
        <NotificationItem notification={BASE_NOTIFICATION} onRead={onRead} />
      </ul>,
    )

    fireEvent.keyDown(screen.getByRole('menuitem'), { key: ' ' })

    expect(onRead).toHaveBeenCalledWith(BASE_NOTIFICATION.id)
  })

  it('labels itself as "leída" when status is read', () => {
    render(
      <ul>
        <NotificationItem
          notification={{ ...BASE_NOTIFICATION, status: 'read', read_at: new Date().toISOString() }}
          onRead={() => {}}
        />
      </ul>,
    )

    expect(screen.getByRole('menuitem', { name: /notificaci[oó]n le[ií]da/i })).toBeInTheDocument()
  })
})
