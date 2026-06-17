# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] — 2026-06-17

### Added

- **`@athlos/drift`** — New package for schema drift detection.
  - `detect()` — compares latest `raw_events.content_hash` per entity against `drift_snapshots` using `IS DISTINCT FROM`; new entities (no snapshot) are excluded.
  - `emitDriftAlert()` — writes a direct `audit_events` row with `operator_id: null` (system event path) and fires a `drift_alert` notification dispatch.
  - `DriftReport` type with per-entity drift details (`entityUuid`, `oldHash`, `newHash`, `lastImportedAt`).

- **`@athlos/freshness`** — New package for domain freshness monitoring.
  - `DOMAIN_THRESHOLDS` — hard-coded per-domain staleness thresholds (11 domains, ISO 8601 durations).
  - `ageToStatus(ageMs, thresholdMs)` — maps age to `'current' | 'stale' | 'unknown'` with 1.5× grace zone.
  - `ageDisplay(ageMs)` — Spanish human-readable age formatter.
  - `getFreshness(db, opts?)` — reads `domain_freshness` cache, computes status + age display.
  - `refreshAll(db, opts?)` — recomputes MAX(imported_at) + COUNT(\*) per domain from `raw_events`, upserts `domain_freshness` cache.
  - `CONFIG_MISSING` error code for unknown domains.

- **`0008_drift_snapshots`** — Migration creating `drift_snapshots` table with composite PK on `(entity_uuid, source_table, source_key)`.

- **`0009_domain_freshness`** — Migration creating `domain_freshness` cache table.

- **`entity_uuids` schema extension** — Added `entityUuids` table with composite PK on `(sourceTable, sourceKey)`; required for drift detection.

- **`apps/api` job: drift-detection** — Full implementation replacing the PR 6a skeleton stub. Detects drift via `@athlos/drift.detect()` and emits alerts via `emitDriftAlert()`.

- **`apps/api` job: freshness-refresh** — Full implementation replacing the PR 6a skeleton stub. Recomputes freshness via `@athlos/freshness.refreshAll()` and logs `FRESHNESS_REFRESH_DONE`.

- **DI wiring** — `driftService` and `freshnessService` added to `AppContainer`; jobs receive services through the container.

- **`@athlos/errors`** — `CONFIG_MISSING` error code added (`500` status).

### Changed

- **`@athlos/db`** — Added `drizzle-orm` production dependency (required by `@athlos/freshness`).
- **`apps/api`** — Added `@athlos/drift` and `@athlos/freshness` as production dependencies.

## [0.1.0] — 2026-06-16

Initial released version. See archived `athlos-foundation` change for history.
