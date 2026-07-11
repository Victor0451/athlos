-- Migration 0031: ctacte_movement_notes + tesoreria.ctacte.comprobante_attachment_id
-- (athlos-ctacte-mutations, PR A1a + R3 corrective batch)
--
-- Adds the per-movement notes table for the `/ctacte/[cuenta]` page, the
-- nullable comprobante_attachment_id column on the existing ctacte ledger,
-- and the caller-supplied idempotency_key column + UNIQUE partial index
-- for durable note retries.
--
-- Hand-written (drizzle migrate is broken in prod per handover #253).
-- Deploy runbook:
--   docker exec -i athlos-db-1 psql -U athlos -d athlos \
--     < packages/db/drizzle/0031_ctacte_movement_notes.sql
--
-- Idempotent: every CREATE / CREATE INDEX / ADD COLUMN uses IF NOT EXISTS
-- so a re-run after a partial apply is a no-op.

CREATE TABLE IF NOT EXISTS "socios"."ctacte_movement_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ctacte_movement_id" uuid NOT NULL REFERENCES "tesoreria"."ctacte"("id") ON DELETE restrict ON UPDATE no action,
  "body" text NOT NULL,
  "author_operator_id" uuid NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_ctacte_movement_notes_movement"
  ON "socios"."ctacte_movement_notes" USING btree ("ctacte_movement_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_ctacte_movement_notes_created"
  ON "socios"."ctacte_movement_notes" USING btree ("created_at" DESC);
--> statement-breakpoint

-- R3 fix #2: caller-supplied opaque Idempotency-Key. Mirrors the
-- durable pattern already established for `tesoreria.ctacte` rows
-- (migration 0032 + UNIQUE partial index). Replaces the previous
-- 10s SHA-256 timestamp bucket fallback which did not survive
-- process restarts or cross-instance routing.
ALTER TABLE "socios"."ctacte_movement_notes"
  ADD COLUMN IF NOT EXISTS "idempotency_key" text;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "ctacte_movement_notes_idempotency_key_unique"
  ON "socios"."ctacte_movement_notes" ("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint

ALTER TABLE "tesoreria"."ctacte"
  ADD COLUMN IF NOT EXISTS "comprobante_attachment_id" uuid
  REFERENCES "socios"."socio_attachments"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "tesoreria"."ctacte"
  ADD COLUMN IF NOT EXISTS "idempotency_key" text;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "ctacte_idempotency_key_unique"
  ON "tesoreria"."ctacte" ("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
