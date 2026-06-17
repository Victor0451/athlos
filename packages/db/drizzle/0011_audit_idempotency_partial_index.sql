-- Migration: 0011_audit_idempotency_partial_index
-- Purpose: Partial unique index on audit_events.idempotency_key.
-- System events (drift alerts, import completions) write NULL for
-- idempotency_key and are excluded from this constraint.
-- Operator events via the audit middleware always carry a non-NULL key.
-- The 10s-bucket SHA-256 key is computed by emitAudit() in @athlos/audit.

CREATE UNIQUE INDEX uq_audit_events_idempotency_key
  ON "audit_events"("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
