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
  /**
   * Free-form JSON object persisted into `audit_events.metadata`.
   *
   * Added in PR 8c.1 (athlos-socio-legajo) so the new
   * `SOCIO_ATTACHMENT_*` actions can carry action-specific keys
   * (e.g. `{ attachment_id, filename, category, size_bytes }`)
   * without piggy-backing on the legacy `old_value` / `new_value`
   * diff snapshot. The column already exists in the public
   * schema (see `packages/db/src/schema/public.ts`); no migration
   * is needed.
   *
   * `metadata` is intentionally NOT part of the idempotency key:
   * the SHA-256 bucket is computed from `operatorId + action +
   * entityId + payload`, so identical uploads within 10s still
   * collapse to a single row even if the metadata bag differs.
   */
  metadata?: Record<string, unknown>
}

/**
 * Canonical action constants for the socio-attachment lifecycle, the
 * PDF form-emit endpoint, and the ctacte mutation lifecycle.
 *
 * PR 8c.1 (athlos-socio-legajo) added `SOCIO_ATTACHMENT_UPLOADED` /
 * `SOCIO_ATTACHMENT_DELETED` — see
 * `openspec/changes/athlos-socio-legajo/specs/audit-logger/spec.md`
 * §"Audit Record Schema — Action Union Widened".
 *
 * PR 8d.1 (athlos-socio-form-emit) adds `SOCIO_FORM_EMITTED` for the
 * `GET /api/v1/socios/:socioId/forms/solicitud-inscripcion.pdf` endpoint.
 * The matching `metadata` bag MUST carry exactly 4 keys:
 * `socio_id`, `form_id`, `sha256`, `byte_size` — see
 * `openspec/changes/athlos-socio-form-emit/specs/audit-logger/spec.md`
 * §"Form Emission Audit Action".
 *
 * PR A1a (athlos-ctacte-mutations) adds the four `CTACTE_*` actions
 * for the `/ctacte/[cuenta]` mutation surface. The matching `metadata`
 * keys are pinned per action by
 * `openspec/changes/athlos-ctacte-mutations/specs/audit-logger/spec.md`
 * §"CTACTE Movement Audit Actions":
 *   - CTACTE_PAYMENT_REGISTERED    → 6 keys (ctacte_id, movement_id,
 *                                     monto, fecha, concepto,
 *                                     comprobante_attachment_id)
 *   - CTACTE_DEBIT_REGISTERED      → 5 keys (ctacte_id, movement_id,
 *                                     monto, fecha, motivo)
 *   - CTACTE_MOVEMENT_NOTE_ADDED   → 5 keys (ctacte_id, movement_id,
 *                                     note_id, body, author_operator_id)
 *   - CTACTE_COMPROBANTE_PRINTED   → 7 keys (socio_id, ctacte_id, from,
 *                                     to, movement_count, sha256,
 *                                     byte_size)
 *
 * The action remains server-emitted (NEVER client-supplied). The
 * `metadata` field is intentionally NOT part of the idempotency key
 * (see `emitAudit()`).
 */
export const AuditAction = {
  SOCIO_ATTACHMENT_UPLOADED: 'SOCIO_ATTACHMENT_UPLOADED',
  SOCIO_ATTACHMENT_DELETED: 'SOCIO_ATTACHMENT_DELETED',
  SOCIO_FORM_EMITTED: 'SOCIO_FORM_EMITTED',
  CTACTE_PAYMENT_REGISTERED: 'CTACTE_PAYMENT_REGISTERED',
  CTACTE_DEBIT_REGISTERED: 'CTACTE_DEBIT_REGISTERED',
  CTACTE_MOVEMENT_NOTE_ADDED: 'CTACTE_MOVEMENT_NOTE_ADDED',
  CTACTE_COMPROBANTE_PRINTED: 'CTACTE_COMPROBANTE_PRINTED',
} as const

export type SocioAttachmentAuditAction = (typeof AuditAction)[keyof typeof AuditAction]

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
        metadata: (r.metadata ?? null) as never,
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
