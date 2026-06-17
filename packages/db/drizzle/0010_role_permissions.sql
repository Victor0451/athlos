-- Migration: 0010_role_permissions
-- Purpose: Operator permission grants via role_permissions table.
-- Composite PK (operator_id, permission_key).
-- Zero default grants — DATA_STEWARD drift alerts are SILENT until
-- an admin explicitly grants via an internal endpoint.
-- See design §9 (DATA_STEWARD Permission Wiring, OI-1 B).

CREATE TABLE "role_permissions" (
  "operator_id"    uuid NOT NULL REFERENCES "operators"("id") ON DELETE CASCADE,
  "permission_key" text NOT NULL,
  "granted_at"    timestamptz NOT NULL DEFAULT now(),
  "granted_by"    uuid REFERENCES "operators"("id"),
  PRIMARY KEY ("operator_id", "permission_key")
);
