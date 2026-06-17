/**
 * @athlos/audit/emitter — emitAudit with SHA-256 10s bucket idempotency.
 *
 * TWO-WRITE-PATH (design §5):
 *   - Operator events: emitAudit() called by auditPlugin onResponse hook
 *   - System events: drift.emitDriftAlert() calls db.insert(auditEvents) directly
 *     with operator_id=NULL and idempotency_key=NULL (no dedup for system events)
 *
 * Idempotency: SHA-256(operatorId + action + entityId + JSON(payload) + 10s_bucket)
 * The bucket is floor(Date.now() / 10000) — same action within 10s = deduped.
 * The partial unique index uq_audit_events_idempotency_key enforces this at the DB layer.
 *
 * SELECT-then-INSERT: race window exists. If a concurrent request inserts the
 * same key between our SELECT and INSERT, the unique constraint violation (23505)
 * is caught and interpreted as "already deduped."
 */
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Db } from '@athlos/db'
import { auditEvents } from '@athlos/db/schema'

export interface AuditRecord {
  operatorId: string | null
  action: string
  entityType: string
  entityId: string
  oldValue: unknown
  newValue: unknown
  sourceIp: string | null
  payload: unknown
}

export type EmitAuditResult = { inserted: true; id: string } | { inserted: false; deduped: true }

export async function emitAudit(db: Db, r: AuditRecord): Promise<EmitAuditResult> {
  const bucket = Math.floor(Date.now() / 10_000)
  const key = createHash('sha256')
    .update(
      `${r.operatorId ?? ''}|${r.action}|${r.entityId}|${JSON.stringify(r.payload)}|${bucket}`,
    )
    .digest('hex')

  // SELECT-1: check for existing idempotency key
  const [existing] = await db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(eq(auditEvents.idempotencyKey, key))
    .limit(1)

  if (existing) {
    return { inserted: false, deduped: true }
  }

  // INSERT with idempotency key
  try {
    const [row] = await db
      .insert(auditEvents)
      .values({
        operatorId: r.operatorId,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        oldValue: r.oldValue as never,
        newValue: r.newValue as never,
        sourceIp: r.sourceIp,
        idempotencyKey: key,
      })
      .returning({ id: auditEvents.id })
    return { inserted: true, id: row!.id }
  } catch (e: unknown) {
    // PostgreSQL unique constraint violation (23505) — concurrent dedup
    if ((e as { code?: string })?.code === '23505') {
      return { inserted: false, deduped: true }
    }
    throw e
  }
}
