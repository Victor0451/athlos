import { and, count, desc, eq, or, type SQL } from 'drizzle-orm'
import type { Db } from '@athlos/db'
import { notifications, type Notification } from '@athlos/db/schema'

/**
 * Notifications repository — read/write helpers for the
 * `notifications` table used by the in-app bell (PR bell-N1).
 *
 * The in-app channel is the slice that drives the frontend bell:
 *   - `list` powers the dropdown panel
 *   - `markAsRead` powers the "click to dismiss" action
 *   - `countUnread` powers the badge count
 *
 * Status lifecycle for in-app rows: `pending` → `sent` (the
 * dispatcher stamps `sent` on INSERT) → `read` (the API flips it
 * via PATCH .../read). "Unread" therefore means `status != 'read'`
 * and covers `pending`, `sent`, and `failed` (the dispatcher
 * surfaces a failed dispatch so the operator knows something went
 * wrong — we don't want to bury that under "read").
 *
 * The repository is the only place that knows about column names.
 * The service layer uses DTOs that are decoupled from the schema
 * (status filter, pagination) so the wire shape can evolve
 * independently.
 */

export type NotificationStatusFilter = 'unread' | 'read' | 'all'

export interface ListNotificationsInput {
  recipientId: string
  statusFilter?: NotificationStatusFilter
  page: number
  limit: number
}

export interface ListNotificationsResult {
  items: Notification[]
  total: number
  page: number
  limit: number
  has_more: boolean
}

/**
 * The set of statuses that count as "unread" for the in-app channel.
 * Encoded as a positive list (not `status != 'read'`) so the test
 * standin's filter parser can resolve it without needing a `ne`
 * operator. The set is exhaustive over the schema's documented
 * status values: 'pending' | 'sent' | 'failed' | 'read'.
 */
const UNREAD_STATUSES = ['pending', 'sent', 'failed'] as const

/**
 * Resolve a status filter into a Drizzle `WHERE` fragment. Returns
 * `undefined` for the `all` filter (no constraint) so the caller
 * can drop it from the AND chain without special-casing the array.
 */
function statusWhere(filter: NotificationStatusFilter | undefined): SQL | undefined {
  if (filter === undefined || filter === 'all') return undefined
  if (filter === 'read') return eq(notifications.status, 'read')
  // 'unread' — positive list of non-read statuses. Using `or(eq, eq, eq)`
  // rather than `ne(status, 'read')` keeps the filter resolvable by
  // the in-memory test standin (which only handles `eq`, `isNull`,
  // `gt`, `lt`, `ilike`, and `or(...)`).
  return or(
    eq(notifications.status, UNREAD_STATUSES[0]),
    eq(notifications.status, UNREAD_STATUSES[1]),
    eq(notifications.status, UNREAD_STATUSES[2]),
  )
}

/**
 * Page through an operator's in-app notifications, newest first.
 * Pagination is offset-based (`page` * `limit`); the @athlos/validation
 * route-level cap of 100 keeps the worst-case scan bounded.
 *
 * The `total` query re-uses the same `WHERE` so the count and the
 * page agree even when the status filter is active.
 */
export async function list(
  db: Db,
  input: ListNotificationsInput,
): Promise<ListNotificationsResult> {
  const limit = Math.min(Math.max(input.limit, 1), 100)
  const page = Math.max(input.page, 1)
  const offset = (page - 1) * limit

  const conds: Array<SQL | undefined> = [
    eq(notifications.recipientId, input.recipientId),
    statusWhere(input.statusFilter),
  ]
  const where = and(...conds.filter((c): c is SQL => c !== undefined))

  const totalRows = await db.select({ n: count() }).from(notifications).where(where)
  const total = Number(totalRows[0]?.n ?? 0)

  const items = await db
    .select()
    .from(notifications)
    .where(where)
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit)
    .offset(offset)

  return {
    items,
    total,
    page,
    limit,
    has_more: page * limit < total,
  }
}

/**
 * Mark a single notification as read. The `id` AND `recipientId`
 * predicates are both applied in the same `WHERE`, so a caller
 * cannot mark another operator's notification as read — the row
 * simply won't match and we return `null` (which the service
 * turns into a 404). This is the in-app security boundary.
 *
 * Idempotent: calling on an already-read row is a no-op write of
 * the same values, returning the row.
 */
export async function markAsRead(
  db: Db,
  id: string,
  recipientId: string,
): Promise<Notification | null> {
  const [row] = await db
    .update(notifications)
    .set({ status: 'read', readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.recipientId, recipientId)))
    .returning()
  return row ?? null
}

/**
 * Count unread rows for one operator. Mirrors `list`'s "unread"
 * filter (positive list) so the badge count matches the panel
 * list when the operator opens it with the `unread` filter active.
 */
export async function countUnread(db: Db, recipientId: string): Promise<number> {
  const conds: Array<SQL | undefined> = [
    eq(notifications.recipientId, recipientId),
    statusWhere('unread'),
  ]
  const where = and(...conds.filter((c): c is SQL => c !== undefined))
  const rows = await db.select({ n: count() }).from(notifications).where(where)
  return Number(rows[0]?.n ?? 0)
}
