import type { InferInsertModel } from 'drizzle-orm'
import type { auditEvents } from '@athlos/db/schema'
import { defaults } from '../defaults.ts'

/**
 * Insert shape for an `audit_events` row.
 */
type AuditEventInsert = InferInsertModel<typeof auditEvents>

/**
 * Fluent builder for `audit_events` rows. The audit table is
 * append-only (writes go through `packages/audit` in PR 7) but
 * tests that exercise the audit middleware, the cross-tab
 * invalidator, or the admin `/audit` endpoint can use this builder
 * to seed fixture rows.
 *
 * Example:
 *   const ev = aAuditEvent()
 *     .withAction('SOCIO_UPDATED')
 *     .withEntity('socio', socioId)
 *     .withDiff({ before: oldSocio, after: newSocio })
 *     .build()
 */
export class AuditEventBuilder {
  private readonly data: AuditEventInsert

  constructor() {
    this.data = {
      id: defaults.uuid(),
      operatorId: null,
      action: defaults.auditEvent.action,
      entityType: defaults.auditEvent.entityType,
      entityId: defaults.auditEvent.entityId,
      oldValue: defaults.auditEvent.oldValue,
      newValue: defaults.auditEvent.newValue,
      sourceIp: defaults.auditEvent.sourceIp,
      metadata: defaults.auditEvent.metadata,
      idempotencyKey: defaults.auditEvent.idempotencyKey,
      createdAt: defaults.now(),
    }
  }

  withId(id: string): this {
    this.data.id = id
    return this
  }

  withOperatorId(id: string | null): this {
    this.data.operatorId = id
    return this
  }

  withAction(action: string): this {
    this.data.action = action
    return this
  }

  withEntity(type: string, id: string): this {
    this.data.entityType = type
    this.data.entityId = id
    return this
  }

  withDiff(diff: { before: unknown; after: unknown }): this {
    this.data.oldValue = diff.before as AuditEventInsert['oldValue']
    this.data.newValue = diff.after as AuditEventInsert['newValue']
    return this
  }

  withOldValue(v: unknown): this {
    this.data.oldValue = v as AuditEventInsert['oldValue']
    return this
  }

  withNewValue(v: unknown): this {
    this.data.newValue = v as AuditEventInsert['newValue']
    return this
  }

  withSourceIp(ip: string | null): this {
    this.data.sourceIp = ip
    return this
  }

  withMetadata(meta: Record<string, unknown> | null): this {
    this.data.metadata = meta as AuditEventInsert['metadata']
    return this
  }

  withIdempotencyKey(key: string | null): this {
    this.data.idempotencyKey = key
    return this
  }

  build(): AuditEventInsert {
    return { ...this.data }
  }
}

export const aAuditEvent = (): AuditEventBuilder => new AuditEventBuilder()
