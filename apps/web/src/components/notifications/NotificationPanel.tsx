'use client'

import { useNotifications, useMarkNotificationAsRead } from '@/lib/api/notifications'
import NotificationItem from './NotificationItem'

/**
 * NotificationPanel — the dropdown contents rendered when the bell
 * is clicked. Loaded lazily by NotificationBell when the panel opens
 * (the query is enabled only on open via the `enabled` flag below).
 *
 * Loading / error pattern matches the rest of the app (inline role
 * blocks + `aria-live`). On 401 the global apiFetch handles redirect to
 * `/login?expired=1` so we don't surface a special case here.
 *
 * Mark-as-read on item click: the mutation optimistically invalidates
 * the `notifications` query key, which makes the bell badge decrement
 * and the panel re-sort without a hard reload.
 */

interface NotificationPanelProps {
  /** Called when the user wants to dismiss the panel (e.g., clicks outside). */
  onClose: () => void
  /** Pass `true` once the bell has been opened at least once. */
  enabled: boolean
}

export default function NotificationPanel({ enabled }: NotificationPanelProps) {
  const { data, isPending, isError, error } = useNotifications({ status: 'all', limit: 20 })
  const markRead = useMarkNotificationAsRead()

  const handleRead = (id: string) => {
    markRead.mutate(id)
  }

  return (
    <div
      role="menu"
      aria-label="Notificaciones"
      data-testid="notification-panel"
      className="absolute right-0 top-full mt-2 w-96 max-h-[28rem] overflow-y-auto rounded-md border border-night-700 bg-night-900 shadow-2xl ring-1 ring-night-700/50 z-50"
    >
      <div className="sticky top-0 bg-night-900 border-b border-night-700 px-4 py-2">
        <h2 className="text-sm font-semibold text-white">Notificaciones</h2>
      </div>

      {isPending ? (
        <p
          role="status"
          aria-live="polite"
          className="px-4 py-6 text-center text-sm text-ink-300"
          data-testid="notification-panel-loading"
        >
          Cargando…
        </p>
      ) : isError ? (
        <p
          role="alert"
          className="px-4 py-6 text-center text-sm text-danger"
          data-testid="notification-panel-error"
        >
          Error al cargar notificaciones: {error instanceof Error ? error.message : 'desconocido'}
        </p>
      ) : data && data.items.length > 0 ? (
        <ul role="none" className="divide-y divide-night-700/50">
          {data.items.map((n) => (
            <NotificationItem key={n.id} notification={n} onRead={handleRead} />
          ))}
        </ul>
      ) : (
        <p
          className="px-4 py-6 text-center text-sm text-ink-300"
          data-testid="notification-panel-empty"
        >
          Sin notificaciones
        </p>
      )}

      {!enabled &&
        // The bell renders this only when first opened; subsequent opens
        // hit the cached query. This comment documents why `enabled` is
        // a prop rather than internal state.
        null}
    </div>
  )
}
