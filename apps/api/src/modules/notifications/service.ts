import type { Db } from '@athlos/db'
import type { Notification } from '@athlos/db/schema'
import { BusinessError, ErrorCode } from '@athlos/errors'
import * as repo from './repository.ts'
import type { ListNotificationsResult, NotificationStatusFilter } from './repository.ts'

/**
 * Notifications service — thin orchestration over the repository.
 *
 * The service enforces two contracts the repository can't:
 *
 *   1. **Ownership binding.** Every function takes the caller
 *      `operatorId` and threads it into the repository as
 *      `recipientId`. The repository is the only place that knows
 *      which column is the FK, but the service is the gate that
 *      prevents an operator from seeing / mutating another
 *      operator's rows.
 *
 *   2. **404 translation.** When `markAsRead` finds no row (either
 *      the id doesn't exist or it belongs to a different operator),
 *      the service throws `BusinessError(NOT_FOUND)`. The route
 *      layer maps that to 404 without inspecting the repository's
 *      `null` return — the repository's `null` is a private signal
 *      between repo and service.
 *
 * DTOs: the service returns the raw `Notification` rows. The route
 * layer (PR bell-N1) maps each row to the public snake-cased wire
 * shape (id, channel, subject, body, metadata, status, read_at,
 * created_at).
 */

export type { ListNotificationsInput, ListNotificationsResult } from './repository.ts'
export type { NotificationStatusFilter } from './repository.ts'

/**
 * DTO for the result of `markAsRead`. The route layer's PATCH
 * response wraps this in the snake-cased wire shape; the service
 * returns the raw `Notification` row.
 */
export type MarkAsReadResult = Notification

/**
 * Page through the caller's in-app notifications. The `operatorId`
 * is required: there is no way to list another operator's
 * notifications through this service.
 */
export async function list(
  db: Db,
  operatorId: string,
  input: { statusFilter?: NotificationStatusFilter; page: number; limit: number },
): Promise<ListNotificationsResult> {
  return repo.list(db, {
    recipientId: operatorId,
    ...(input.statusFilter ? { statusFilter: input.statusFilter } : {}),
    page: input.page,
    limit: input.limit,
  })
}

/**
 * Mark a single notification as read. Throws NOT_FOUND when the
 * row either doesn't exist OR belongs to another operator — the
 * two cases are indistinguishable to the caller on purpose (we
 * don't want to leak the existence of another operator's
 * notification row by returning 200 vs 404).
 */
export async function markAsRead(
  db: Db,
  operatorId: string,
  notificationId: string,
): Promise<Notification> {
  const row = await repo.markAsRead(db, notificationId, operatorId)
  if (!row) {
    throw BusinessError(ErrorCode.NOT_FOUND, 'Notification not found')
  }
  return row
}

/**
 * Cheap count of the caller's unread rows. Powers the bell badge
 * in the operator UI; the frontend polls this on a short interval
 * so the count is small and bounded.
 */
export async function unreadCount(db: Db, operatorId: string): Promise<number> {
  return repo.countUnread(db, operatorId)
}
