-- Migration 0021: socio_attachments (athlos-socio-legajo, PR 8c.1)
--
-- Per-socio attachments for the Legajo tab. Realises the v1 surface
-- of the dormant file-storage spec, scoped to the socio_attachments
-- resource. UUID PK (NOT ULID — codebase consistency override per
-- file-storage delta R1). Magic-byte validation, 10 MB per-file cap,
-- 100 files / 500 MB per-socio quota enforced at the application
-- layer via FOR SHARE transaction.
--
-- Hand-written (drizzle migrate is broken in prod per handover #253).
-- Deploy runbook:
--   docker exec -i athlos-db-1 psql -U athlos -d athlos \
--     < packages/db/drizzle/0021_socio_attachments.sql
--
-- Idempotent: every CREATE / CREATE INDEX uses IF NOT EXISTS so a
-- re-run after a partial apply is a no-op.

CREATE TYPE IF NOT EXISTS "socios"."attachment_category" AS ENUM (
  'dni',
  'comprobante',
  'foto',
  'contrato',
  'otro'
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "socios"."socio_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "socio_id" uuid NOT NULL REFERENCES "socios"."socios"("id") ON DELETE restrict ON UPDATE no action,
  "filename" text NOT NULL,
  "description" text,
  "category" "socios"."attachment_category" NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" bigint NOT NULL,
  "storage_path" text NOT NULL,
  "storage_sha256" text NOT NULL,
  "uploaded_by" uuid NOT NULL,
  "uploaded_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone,
  "deleted_by" uuid,
  CONSTRAINT "socio_attachments_filename_length" CHECK (char_length("filename") <= 255),
  CONSTRAINT "socio_attachments_description_length" CHECK ("description" IS NULL OR char_length("description") <= 500),
  CONSTRAINT "socio_attachments_sha256_hex" CHECK ("storage_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint

-- Quota lookup: active rows for a socio (list + count/sum FOR SHARE).
CREATE INDEX IF NOT EXISTS "socio_attachments_socio_active_idx"
  ON "socios"."socio_attachments" USING btree ("socio_id","deleted_at");
--> statement-breakpoint

-- Category filter on the list endpoint.
CREATE INDEX IF NOT EXISTS "socio_attachments_socio_category_idx"
  ON "socios"."socio_attachments" USING btree ("socio_id","category");
--> statement-breakpoint

-- Dedup probe: storage_sha256 index lets a future dedup query find
-- existing bytes across (or within) a socio without scanning the table.
CREATE INDEX IF NOT EXISTS "socio_attachments_storage_sha_idx"
  ON "socios"."socio_attachments" USING btree ("storage_sha256");
--> statement-breakpoint

-- Ordering for the grid view (newest first).
CREATE INDEX IF NOT EXISTS "socio_attachments_uploaded_at_idx"
  ON "socios"."socio_attachments" USING btree ("uploaded_at" DESC);