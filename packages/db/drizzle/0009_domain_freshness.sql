-- Migration: 0009_domain_freshness
-- Purpose: Cache table for per-domain freshness status.
-- Written by the freshness-refresh job every 60s.
-- Read by the GET /api/v1/freshness endpoint.

CREATE TABLE "domain_freshness" (
  "domain"          varchar(32) PRIMARY KEY,
  "last_import_at" timestamptz,
  "record_count"   integer NOT NULL DEFAULT 0,
  "refreshed_at"   timestamptz NOT NULL DEFAULT now()
);
