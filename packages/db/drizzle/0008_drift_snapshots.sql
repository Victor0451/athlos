-- Migration: 0008_drift_snapshots
-- Purpose: Snapshot table for drift detection — stores the last content_hash
-- seen per entity_uuid so subsequent imports can compare for drift.
-- Primary key is entity_uuid (references entity_uuids.entity_uuid).
-- A follow-up migration will add the FK constraint once entity_uuids exists.

CREATE TABLE "drift_snapshots" (
  "entity_uuid"   uuid PRIMARY KEY,
  "domain"        varchar(32) NOT NULL,
  "last_hash"     varchar(64) NOT NULL,
  "last_event_id" uuid NOT NULL,
  "snapshot_at"   timestamptz NOT NULL DEFAULT now()
);
