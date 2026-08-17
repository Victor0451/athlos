/**
 * @athlos/audit/query — queryAudit with pagination.
 *
 * Reads from audit_events with optional filters:
 *   - operatorId: exact match
 *   - entityId: exact match
 *   - entityType: exact match
 *   - from/to: ISO8601 datetime range
 *   - page: 1-indexed, default 1
 *   - limit: 1..500, default 100
 *
 * Returns items + total count for pagination metadata.
 * Results ordered by created_at DESC (most recent first).
 */
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import type { Db } from '@athlos/db'
import { auditEvents } from '@athlos/db/schema'

export interface AuditQueryFilters {
  operatorId?: string
  entityId?: string
  entityType?: string
  from?: string
  to?: string
}

export interface AuditPage {
  items: Array<{
    id: string
    operatorId: string | null
    action: string
    entityType: string
    entityId: string
    oldValue: unknown
    newValue: unknown
    sourceIp: string | null
    metadata: unknown
    createdAt: Date
  }>
  total: number
  page: number
  limit: number
  pages: number
}

export async function queryAudit(
  db: Db,
  filters: AuditQueryFilters & { page?: number; limit?: number },
): Promise<AuditPage> {
  const page = Math.max(1, filters.page ?? 1)
  const limit = Math.min(500, Math.max(1, filters.limit ?? 100))
  const offset = (page - 1) * limit

  // Build WHERE conditions
  const conditions = []
  if (filters.operatorId) {
    conditions.push(eq(auditEvents.operatorId, filters.operatorId))
  }
  if (filters.entityId) {
    conditions.push(eq(auditEvents.entityId, filters.entityId))
  }
  if (filters.entityType) {
    conditions.push(eq(auditEvents.entityType, filters.entityType))
  }
  if (filters.from) {
    conditions.push(gte(auditEvents.createdAt, new Date(filters.from)))
  }
  if (filters.to) {
    conditions.push(lte(auditEvents.createdAt, new Date(filters.to)))
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined

  // Total count (unfiltered by pagination)
  const [countRow] = await db
    .select({ total: sql`count(*)::int` })
    .from(auditEvents)
    .where(where)
  const total = Number(countRow?.total ?? 0)

  // Paginated results
  const items = await db
    .select({
      id: auditEvents.id,
      operatorId: auditEvents.operatorId,
      action: auditEvents.action,
      entityType: auditEvents.entityType,
      entityId: auditEvents.entityId,
      oldValue: auditEvents.oldValue,
      newValue: auditEvents.newValue,
      sourceIp: auditEvents.sourceIp,
      metadata: auditEvents.metadata,
      createdAt: auditEvents.createdAt,
    })
    .from(auditEvents)
    .where(where)
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit)
    .offset(offset)

  return {
    items: items as AuditPage['items'],
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  }
}
