-- Migration 0018: Backfill raw_events.legacy_id for ctacte + ctacte1 (E3 — N14 closure)
--
-- Computes the same hash that packages/promotion/src/transform-helpers.ts deterministicUuid()
-- produces (UUIDv5-like per RFC 4122 §4.3). Verified byte-for-byte by hash parity test in
-- apply phase BEFORE this migration runs.
--
-- Coverage:
--   ctacte:  326,275 rows → ~291,441 get legacy_id (rest are duplicates)
--   ctacte1: 245,370 rows → ~170,281 get legacy_id (rest are duplicates)
--
-- Duplicate handling: Only ONE row per natural key gets a legacy_id (the first by imported_at).
-- Subsequent duplicates get NULL legacy_id — they are "shadow rows" that cannot be promoted
-- due to the UNIQUE INDEX. This matches the expected ~88% promotion rate (not 100%).
--
-- Idempotent: WHERE legacy_id IS NULL makes re-running a no-op.

BEGIN;
SET LOCAL statement_timeout = '120s';

-- Backfill ctacte (5-tuple: cuenta fecha nrocomp mes talonar)
-- Use CTE with row_number to assign legacy_id to only ONE row per natural key
WITH ranked AS (
  SELECT
    id,
    "promotion_deterministic_uuid"(
      coalesce(payload->>'CCTCUENTA', '') || '|' ||
      coalesce(payload->>'CCTFECHA', '') || '|' ||
      coalesce(payload->>'CCTNROCOMP', '') || '|' ||
      coalesce(payload->>'CCTMES', '') || '|' ||
      coalesce(payload->>'CCTTALONAR', '')
    ) AS computed_legacy_id,
    ROW_NUMBER() OVER (
      PARTITION BY (
        coalesce(payload->>'CCTCUENTA', '') || '|' ||
        coalesce(payload->>'CCTFECHA', '') || '|' ||
        coalesce(payload->>'CCTNROCOMP', '') || '|' ||
        coalesce(payload->>'CCTMES', '') || '|' ||
        coalesce(payload->>'CCTTALONAR', '')
      )
      ORDER BY imported_at ASC
    ) AS rn
  FROM "public"."raw_events"
  WHERE source_table = 'ctacte' AND legacy_id IS NULL
)
UPDATE "public"."raw_events" re
SET legacy_id = ranked.computed_legacy_id
FROM ranked
WHERE ranked.id = re.id AND ranked.rn = 1;
--> statement-breakpoint

-- Backfill ctacte1 (5-tuple: pagonro pagosec pagotal pagofam cuenta)
WITH ranked AS (
  SELECT
    id,
    "promotion_deterministic_uuid"(
      coalesce(payload->>'CCTPAGONRO', '') || '|' ||
      coalesce(payload->>'CCTPAGOSEC', '') || '|' ||
      coalesce(payload->>'CCTPAGOTAL', '') || '|' ||
      coalesce(payload->>'CCTPAGOFAM', '') || '|' ||
      coalesce(payload->>'CCTCUENTA', '')
    ) AS computed_legacy_id,
    ROW_NUMBER() OVER (
      PARTITION BY (
        coalesce(payload->>'CCTPAGONRO', '') || '|' ||
        coalesce(payload->>'CCTPAGOSEC', '') || '|' ||
        coalesce(payload->>'CCTPAGOTAL', '') || '|' ||
        coalesce(payload->>'CCTPAGOFAM', '') || '|' ||
        coalesce(payload->>'CCTCUENTA', '')
      )
      ORDER BY imported_at ASC
    ) AS rn
  FROM "public"."raw_events"
  WHERE source_table = 'ctacte1' AND legacy_id IS NULL
)
UPDATE "public"."raw_events" re
SET legacy_id = ranked.computed_legacy_id
FROM ranked
WHERE ranked.id = re.id AND ranked.rn = 1;

COMMIT;
