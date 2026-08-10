'use client'

import { useQuery } from '@tanstack/react-query'
import { getNotifications } from '@/lib/api/notifications'

export function NotificationSummary() {
  const notifications = useQuery({
    queryKey: ['notifications', 'dashboard'],
    queryFn: () => getNotifications({ status: 'unread' }),
  })

  return (
    <section aria-label="Notificaciones" className="rounded-lg bg-surface-elevated p-4 shadow-sm">
      <h2 className="font-display text-sm font-semibold text-ink-900">Notificaciones</h2>
      {notifications.isPending ? (
        <p className="mt-2 text-sm text-ink-500">Cargando notificaciones…</p>
      ) : null}
      {notifications.isError ? (
        <p role="alert" aria-label="Notificaciones" className="mt-2 text-sm text-ink-500">
          No se pudieron cargar las notificaciones. Intentá nuevamente.
        </p>
      ) : null}
      {notifications.data?.items.length === 0 ? (
        <p className="mt-2 text-sm text-ink-500">No hay notificaciones pendientes.</p>
      ) : null}
      {notifications.data?.items.map((notification) => (
        <p key={notification.id} className="mt-2 text-sm text-ink-700">
          {notification.body}
        </p>
      ))}
    </section>
  )
}
