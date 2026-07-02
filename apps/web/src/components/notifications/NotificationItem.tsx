'use client'

import { type Notification } from '@/lib/api/notifications'

/**
 * NotificationItem — single row in the bell dropdown.
 *
 * Renders the notification body, a relative-time label, and a small
 * unread dot. Click anywhere on the row (or Enter/Space when focused)
 * to mark-as-read via the parent-supplied `onRead` callback.
 *
 * Accessibility:
 *   - `role="menuitem"` so screen readers announce as part of the
 *     panel's menu semantics (panel uses `role="menu"`).
 *   - `tabIndex={0}` + keyboard handler matches the clickable-row
 *     pattern from `apps/web/src/app/(authed)/admin/gastos/page.tsx:218-232`
 *     that the audit called out as a good template.
 *   - `aria-label` provides the full notification context for AT users.
 *
 * Visual contract (dark mode only — Topbar is night-900):
 *   - Read:  ink-300 body, no left border, no dot
 *   - Unread: white body, accent left border, small accent dot
 */

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diffSec = Math.round((now - then) / 1000)
  if (diffSec < 60) return 'hace un momento'
  if (diffSec < 3600) return `hace ${Math.floor(diffSec / 60)} min`
  if (diffSec < 86_400) return `hace ${Math.floor(diffSec / 3600)} h`
  if (diffSec < 86_400 * 30) return `hace ${Math.floor(diffSec / 86_400)} d`
  // Absolute date for anything older than a month.
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  })
}

interface NotificationItemProps {
  notification: Notification
  onRead: (id: string) => void
}

export default function NotificationItem({ notification, onRead }: NotificationItemProps) {
  const isUnread = notification.status !== 'read'
  const handleActivate = () => onRead(notification.id)
  const handleKey = (e: React.KeyboardEvent<HTMLLIElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleActivate()
    }
  }

  return (
    <li
      role="menuitem"
      tabIndex={0}
      onClick={handleActivate}
      onKeyDown={handleKey}
      aria-label={`Notificación ${isUnread ? 'sin leer' : 'leída'}: ${notification.body}`}
      data-testid={`notification-item-${notification.id}`}
      className={[
        'flex items-start gap-2 px-4 py-3 cursor-pointer transition-colors duration-fast',
        'border-l-2',
        isUnread
          ? 'bg-night-800/40 border-l-accent hover:bg-night-800'
          : 'border-l-transparent hover:bg-night-800/60',
      ].join(' ')}
    >
      {isUnread ? (
        <span
          aria-hidden="true"
          className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
        />
      ) : (
        <span aria-hidden="true" className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className={`text-sm leading-snug ${isUnread ? 'text-white' : 'text-ink-300'}`}>
          {notification.body}
        </p>
        <p className="mt-1 text-[10px] uppercase tracking-wider text-ink-300/70">
          {relativeTime(notification.created_at)}
        </p>
      </div>
    </li>
  )
}
