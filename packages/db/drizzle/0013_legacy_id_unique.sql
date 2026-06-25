-- Migration 0014: Add cctcuenta column + legacy_id column + UNIQUE constraints
-- for tesoreria.ctacte + tesoreria.ctacte1, enabling:
--   1. ctacte1 FK lookup via cctcuenta column (E1b1/v0.5.2/v0.5.3)
--   2. Cross-run idempotency via legacy_id UNIQUE INDEX (E1b1+v0.5.3)
--
-- This is a COMBINED migration replacing E1b1/v0.5.2's separate 0013 (cctcuenta)
-- + 0014 (legacy_id) split — combining them avoids migration history split when
-- fresh DBs boot from origin/main.
--
-- cctcuenta: VFP natural key (CCTCUENTA = socio number). NULL-able.
-- legacy_id: deterministic UUID5 from natural key (5-tuple for ctacte,
-- 5-tuple for ctacte1). UNIQUE INDEX enables ON CONFLICT DO NOTHING on re-runs.
--
-- Backfill is best-effort: entity_uuids.source_key may be stale (verified live
-- 2026-06-24: 0 overlap with current master UUIDs). Backfill yields 0 rows
-- in practice. The 129,872 missing ctacte rows are populated by the
-- E1b1+ ctacte transform update + re-promotion (documented as N14 limitation).
--
-- Idempotent: re-running is a no-op (ADD COLUMN IF NOT EXISTS +
-- CREATE UNIQUE INDEX IF NOT EXISTS + UPDATE...WHERE cctcuenta IS NULL).

ALTER TABLE "tesoreria"."ctacte" ADD COLUMN IF NOT EXISTS "cctcuenta" text;
--> statement-breakpoint
ALTER TABLE "tesoreria"."ctacte" ADD COLUMN IF NOT EXISTS "legacy_id" text;
--> statement-breakpoint
ALTER TABLE "tesoreria"."ctacte1" ADD COLUMN IF NOT EXISTS "legacy_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ctacte_cctcuenta_idx" ON "tesoreria"."ctacte" USING btree ("cctcuenta");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ctacte_legacy_id_unique" ON "tesoreria"."ctacte" ("legacy_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ctacte1_legacy_id_unique" ON "tesoreria"."ctacte1" ("legacy_id");
