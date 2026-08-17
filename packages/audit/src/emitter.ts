/**
 * @athlos/audit/emitter — two idempotency modes (S2.a — PR A1b):
 *
 *   1. `callerKey` (covered CTACTE callers):
 *      SHA-256(operatorId + action + entityId + callerKey) — no time
 *      bucket; durable across any delay. The caller supplies the key
 *      (typically the request's `Idempotency-Key` header); two retries
 *      of the same caller-key tuple collapse to a single row at the
 *      DB UNIQUE constraint.
 *
 *   2. Legacy (non-CTACTE callers, no `callerKey`):
 *      SHA-256(operatorId + action + entityId + JSON(payload) +
 *      10s_bucket) — 10-second window dedup. Preserved for
 *      backwards-compat.
 *
 * The partial unique index `uq_audit_events_idempotency_key` enforces
 * dedup at the DB layer; the SELECT-then-INSERT + 23505 catch cover
 * concurrent writes that slip past the SELECT.
 */
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Db } from '@athlos/db'
import { auditEvents } from '@athlos/db/schema'

/** Drizzle transaction handle. Shares `Db`'s query surface, so the
 *  repository and `emitAudit` accept either indifferently. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

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
   * entityId + callerKey|payload`, so identical calls within the
   * dedup window still collapse to a single row even if the
   * metadata bag differs.
   */
  metadata?: Record<string, unknown>
  /**
   * Durable caller-supplied idempotency key (S2.a). When present,
   * the audit row's `idempotency_key` is
   * `sha256(operatorId|action|entityId|callerKey)` with NO time
   * bucket — the same tuple across any delay collapses to one
   * row. Actor scope is enforced via `operatorId` in the hash
   * input. Legacy callers MUST omit this field; their calls
   * continue to use the 10-second bucket window.
   */
  callerKey?: string
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
  INSCRIPCION_CREATED: 'INSCRIPCION_CREATED',
  INSCRIPCION_STATUS_CHANGED: 'INSCRIPCION_STATUS_CHANGED',
  DUES_PRICE_CREATED: 'DUES_PRICE_CREATED',
  DUES_PRICE_REVOKED: 'DUES_PRICE_REVOKED',
  DUES_PERIOD_GENERATED: 'DUES_PERIOD_GENERATED',
} as const

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction]
export type SocioAttachmentAuditAction = (typeof AuditAction)[keyof typeof AuditAction]

export type EmitAuditResult = { inserted: true; id: string } | { inserted: false; deduped: true }

/**
 * Compute the idempotency key. Exported so the two modes
 * (durable caller-key vs legacy 10s bucket) are unit-testable
 * without a DB. Pure function — same input → same output.
 *
 * When `callerKey` is supplied, the bucket is dropped so retries
 * at any delay collapse to the same key. Otherwise the legacy
 * 10s bucket is preserved for backwards-compat with non-CTACTE
 * callers.
 */
export function computeIdempotencyKey(r: AuditRecord): string {
  const actor = r.operatorId ?? ''
  if (r.callerKey) {
    return createHash('sha256')
      .update(`${actor}|${r.action}|${r.entityId}|${r.callerKey}`)
      .digest('hex')
  }
  const bucket = Math.floor(Date.now() / 10_000)
  return createHash('sha256')
    .update(`${actor}|${r.action}|${r.entityId}|${JSON.stringify(r.payload)}|${bucket}`)
    .digest('hex')
}

/**
 * Insert an audit event. Accepts a Drizzle client OR transaction
 * handle (`Db | Tx`) so callers running inside `db.transaction(...)`
 * can compose `insert + emitAudit` in one atomic outcome (S2.c/d/e).
 */
export async function emitAudit(dbOrTx: Db | Tx, r: AuditRecord): Promise<EmitAuditResult> {
  const key = computeIdempotencyKey(r)

  // SELECT-1: check for existing idempotency key
  const [existing] = await dbOrTx
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(eq(auditEvents.idempotencyKey, key))
    .limit(1)

  if (existing) {
    return { inserted: false, deduped: true }
  }

  // INSERT with idempotency key
  try {
    const [row] = await dbOrTx
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
