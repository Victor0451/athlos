-- Migration 0017: Add raw_events.legacy_id column + promotion_deterministic_uuid() SQL function (E3 — N14 closure)
--
-- Purpose: per-row dedup key at the source-event level. Enables promote.ts to filter
-- ctacte/ctacte1 by legacy_id (the source_key is degenerate for these domains: 634 distinct
-- values for 326k ctacte rows, 1 distinct for 245k ctacte1 rows — verified live 2026-06-25).
--
-- The partial UNIQUE INDEX (WHERE legacy_id IS NOT NULL) accommodates domains that don't have
-- a natural key (asiento, paramet, plancue, etc.).
--
-- pgcrypto is required for the backfill migration (0018). One-time install.
-- Pre-checked via: SELECT * FROM pg_available_extensions WHERE name = 'pgcrypto'; — AVAILABLE
--
-- The promotion_deterministic_uuid() function mirrors packages/promotion/src/transform-helpers.ts:19-26
-- deterministicUuid() byte-for-byte: SHA-256 + version=5 nibble + variant=10 bits + UUID formatting.
-- Verified by hash parity test in apply phase (5 known inputs through TypeScript AND PostgreSQL,
-- byte-for-byte equality asserted BEFORE migration 0018 is applied).
--
-- Idempotent: re-running is a no-op.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "promotion_deterministic_uuid"(natural_key text)
  RETURNS text
  LANGUAGE plpgsql
  IMMUTABLE PARALLEL SAFE
AS $$
DECLARE
  hash bytea := digest(natural_key, 'sha256');
  hex_str text := encode(substring(hash, 1, 16), 'hex');
  byte6 int := get_byte(hash, 6);
  byte8 int := get_byte(hash, 8);
  version_byte int := (byte6 & 15) | 80;
  variant_byte int := (byte8 & 63) | 128;
  part3_hex text := lpad(to_hex(version_byte), 2, '0');
  part4_hex text := lpad(to_hex(variant_byte), 2, '0');
BEGIN
  RETURN substring(hex_str, 1, 8) || '-' ||
         substring(hex_str, 9, 4) || '-' ||
         substring(part3_hex, 1, 1) || substring(hex_str, 14, 3) || '-' ||
         substring(part4_hex, 1, 1) || substring(hex_str, 18, 3) || '-' ||
         substring(hex_str, 21, 12);
END;
$$;
--> statement-breakpoint

ALTER TABLE "public"."raw_events"
  ADD COLUMN IF NOT EXISTS "legacy_id" text;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "raw_events_legacy_id_unique"
  ON "public"."raw_events" ("legacy_id")
  WHERE "legacy_id" IS NOT NULL;
