-- Migration 0034: ctacte_movement_notes idempotency_key — full UNIQUE index
-- (R3 corrective batch — fix defect #1)
--
-- Migration 0031 created the `ctacte_movement_notes.idempotency_key` column
-- and a PARTIAL UNIQUE INDEX (`WHERE idempotency_key IS NOT NULL`). The
-- repository's `ON CONFLICT (idempotency_key) DO NOTHING` cannot INFER that
-- partial index in PostgreSQL — bare column inference requires either an
-- unconditional unique index or a matching partial index declaration in
-- the `ON CONFLICT` clause. With the partial index in place, every
-- note POST 5xx's with:
--
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--    specification"
--
-- This forward-only migration replaces the partial UNIQUE INDEX with a
-- full (unconditional) UNIQUE INDEX on the same column. PostgreSQL now
-- infers the index for `ON CONFLICT (idempotency_key) DO NOTHING`, while
-- the unique constraint (and its NULL-handling — multiple NULL rows are
-- allowed, but two non-NULL rows cannot collide) is preserved.
--
-- Idempotency is split across two cases:
--   - Pre-deploy (0031 NOT yet applied): the column/index creation in 0031
--     runs first, 0034 then no-ops the DROP and creates a fresh full index.
--     This is the safe state found in production at the time of this fix.
--   - Post-deploy (0031 ALREADY applied): 0034 drops the partial index
--     and creates the full one with the same name (idempotent via
--     `IF EXISTS` + `IF NOT EXISTS`).
--
-- Hand-written (drizzle migrate is broken in prod per handover #253).
-- Deploy runbook:
--   docker exec -i athlos-db-1 psql -U athlos -d athlos \
--     < packages/db/drizzle/0034_ctacte_movement_notes_idempotency_key_full_unique.sql
--
-- Apply order (per docs/runbook.md migration checklist):
--   1. 0020, 0021, 0030, 0031, 0032, 0033 (existing migrations)
--   2. THIS FILE (0034)

DROP INDEX IF EXISTS "socios"."ctacte_movement_notes_idempotency_key_unique";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "ctacte_movement_notes_idempotency_key_unique"
  ON "socios"."ctacte_movement_notes" ("idempotency_key");
