'use client'

import { useQuery } from '@tanstack/react-query'
import { getNotifications } from '@/lib/api/notifications'

export function NotificationSummary() {
  const notifications = useQuery({
    queryKey: ['notifications', 'dashboard'],
    queryFn: () => getNotifications({ status: 'unread' }),
  })

  return (
    <section
      aria-label="Notificaciones"
      className="rounded-lg border border-ink-100 bg-surface p-4 shadow-sm"
    >
      <p className="font-mono text-xs uppercase tracking-widest text-accent">Bandeja operativa</p>
      <h2 className="mt-1 font-display text-lg font-bold text-ink-900">Notificaciones</h2>
      {notifications.isPending ? (
        <span
          role="status"
          aria-live="polite"
          className="mt-3 block h-8 animate-pulse rounded bg-surface-sunken"
        >
          <span className="sr-only">Cargando notificaciones…</span>
        </span>
      ) : null}
      {notifications.isError ? (
        <p role="alert" aria-label="Notificaciones" className="mt-2 text-sm text-ink-500">
          No se pudieron cargar las notificaciones. Intentá nuevamente.
        </p>
      ) : null}
      {notifications.data?.items.length === 0 ? (
        <p className="mt-2 text-sm text-ink-500">No hay notificaciones pendientes.</p>
      ) : null}
      {notifications.data && notifications.data.items.length > 0 ? (
        <>
          <span className="mt-3 inline-block rounded border border-warning bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">
            {notifications.data.items.length} pendientes
          </span>
          {notifications.data.items.map((notification) => (
            <p key={notification.id} className="mt-2 text-sm text-ink-700">
              {notification.body}
            </p>
          ))}
        </>
      ) : null}
    </section>
  )
}
