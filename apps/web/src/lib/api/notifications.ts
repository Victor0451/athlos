import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'

/**
 * Notifications API + hooks (PR 8d / 2026-07-02).
 *
 * The frontend polls `/api/v1/notifications/unread-count` every 30s
 * for the bell badge and `/api/v1/notifications` on panel-open + every
 * 30s while the panel is open. Mark-as-read fires on item click.
 *
 * Backend (PR1) enforces ownership at the repo layer
 * (`UPDATE ... WHERE id = ? AND recipient_id = ?`) so the frontend
 * can't accidentally mark another operator's notification. The
 * service returns `null` for "not found OR not owned" — both surface
 * as a 404 to the caller.
 *
 * Wire shape: snake_case (matches backend Drizzle types). Timestamps
 * are ISO-8601 strings from Postgres.
 */

export type NotificationChannel = 'email' | 'in_app' | 'whatsapp'

/**
 * Backend `Notification.status` values. The frontend only cares about
 * `'read'` vs the rest (unread = status != 'read'). The full enum is
 * exported so a future settings panel can render per-channel counters.
 */
export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'read'

export interface Notification {
  id: string
  channel: NotificationChannel
  recipient_id: string | null
  recipient_address: string | null
  /** Short subject for email/whatsapp; null for in-app (we render body only). */
  subject: string | null
  body: string
  /** Dispatcher context — drift count, approval link id, etc. */
  metadata: Record<string, unknown>
  event_id: string | null
  status: NotificationStatus
  /** ISO-8601 timestamp; null until marked read. */
  read_at: string | null
  /** ISO-8601 timestamp. */
  created_at: string
}

export interface ListNotificationsParams {
  /** `unread` is the default for the bell badge; `all` for the full history. */
  status?: 'unread' | 'read' | 'all'
  /** 1-indexed page. Backend defaults to 1. */
  page?: number
  /** Max 100; backend defaults to 20. */
  limit?: number
}

export interface ListNotificationsResponse {
  items: Notification[]
  page: number
  limit: number
  total: number
  has_more: boolean
}

export interface UnreadCountResponse {
  count: number
}

/**
 * `getNotifications(params?)` — paginated list of the operator's
 * notifications. Backend filters by `recipient_id = current operator`
 * so the response is always scoped.
 */
export async function getNotifications(
  params: ListNotificationsParams = {},
): Promise<ListNotificationsResponse> {
  return apiFetch<ListNotificationsResponse>('/api/v1/notifications', { query: { ...params } })
}

/**
 * `getUnreadCount()` — cheap `SELECT count(*)` for the bell badge.
 * Excludes rows with `status = 'read'`.
 */
export async function getUnreadCount(): Promise<UnreadCountResponse> {
  return apiFetch<UnreadCountResponse>('/api/v1/notifications/unread-count', { query: {} })
}

/**
 * `markNotificationAsRead(id)` — PATCH single notification.
 * Idempotent: re-marking an already-read row returns 200.
 * Throws `ApiError(404)` if the id is unknown OR not owned by caller.
 */
export async function markNotificationAsRead(id: string): Promise<Notification> {
  return apiFetch<Notification>(`/api/v1/notifications/${id}/read`, { method: 'PATCH' })
}

/* ── TanStack Query hooks ────────────────────────────────────────────── */

/** `useNotifications(params)` — list query, polls every 30s. */
export function useNotifications(params: ListNotificationsParams = {}) {
  return useQuery({
    queryKey: ['notifications', 'list', params],
    queryFn: () => getNotifications(params),
    refetchInterval: 30_000,
    staleTime: 25_000,
  })
}

/** `useUnreadCount()` — bell-badge count, polls every 30s. */
export function useUnreadCount() {
  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: getUnreadCount,
    refetchInterval: 30_000,
    staleTime: 25_000,
  })
}

/**
 * `useMarkNotificationAsRead()` — mutation that invalidates the
 * `notifications` query-key on success so the bell badge and panel
 * refetch with the new state.
 */
export function useMarkNotificationAsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: markNotificationAsRead,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}
