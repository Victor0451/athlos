-- Migration 0016: raw_events.promoted_at audit column (E2 — Slice E closure)
-- Per-row idempotency tracking. Belt-and-suspenders with master.legacy_id UNIQUE INDEX.
-- Backfill: socios ONLY in v1 (~16,383 rows).
-- ctacte/ctacte1 backfill deferred to E3+ (requires raw_events.legacy_id).
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS + WHERE promoted_at IS NULL.

BEGIN;
SET LOCAL statement_timeout = '60s';

ALTER TABLE "public"."raw_events"
  ADD COLUMN IF NOT EXISTS "promoted_at" timestamptz;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "raw_events_promoted_at_idx"
  ON "public"."raw_events" ("promoted_at");
--> statement-breakpoint
UPDATE "public"."raw_events" re
SET "promoted_at" = now()
FROM "socios"."socios" s
WHERE re.source_table = 'socios'
  AND re.source_key = s.numero_socio
  AND re.promoted_at IS NULL;
COMMIT;
