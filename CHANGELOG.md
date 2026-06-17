# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] — 2026-06-17

### Added

- **`@athlos/audit`** — New package for operator-facing audit trail.
  - `auditPlugin` — `fp()`-wrapped Fastify plugin with `onRequest`/`onResponse` hooks; operator events via middleware, system events via `emitAudit()` direct insert.
  - `emitAudit(db, opts)` — inserts `audit_events` row; SHA-256 10-second idempotency bucket prevents double-writes on retries.
  - `queryAudit(db, filters, opts?)` — paginated audit trail query with operator/entity/action filters.
  - CI guard: `ci-check-audit-fp.sh` enforces `fp()` wrap in CI.

- **`role_permissions` table** (`00010_role_permissions`) — Composite PK on `(operator_id, permission_key)`; supports arbitrary permission keys beyond JWT payload flags.

- **`PermissionsRepo`** — Interface + `makePermissionsRepo` implementation for `hasPermission`, `grant`, `revoke`.

- **`audit_idempotency_partial_index`** (`00011_audit_idempotency_partial_index`) — Partial unique index on `(idempotency_key, created_at)` where `idempotency_key IS NOT NULL`.

- **`requirePermission`** middleware (updated) — Checks JWT payload first (`can_reprint`, `can_anulate`); falls through to `role_permissions` table for arbitrary keys like `data_steward`.

- **New HTTP routes:**
  - `GET /api/v1/lineage/:entityId` — any authenticated operator
  - `GET /api/v1/freshness` — any authenticated operator
  - `GET /api/v1/drift` — ADMIN or data_steward permission
  - `GET /api/v1/audit` — ADMIN or data_steward permission; paginated query with filters
  - `POST /api/v1/import/trigger` — ADMIN only
  - `DELETE /api/v1/import/trigger/:batchId` — ADMIN only; cancels queued batches
  - `GET /api/v1/import/status` — any authenticated operator
  - `GET /api/v1/import/status/:batchId` — any authenticated operator

- **`reconciliation` job body** — Full implementation: `projectionService.rebuildAll()` then `driftService.detectAll()`.

- **`cancelled` job run status** — Widened `$type<>` union in `job_runs` schema and `JobHealth.lastRun.status`; supported in scheduler health checks.

- **`docs/runbook.md`** — DATA_STEWARD grant procedure, import pipeline overview, rollback steps.

### Changed

- **`apps/api` container** — Added `permissionsRepo`, `projectionService`, `auditPlugin`.
- **`apps/api` server** — `auditPlugin` registered before routes; 5 new route registrations.
- **`apps/api` reconciliation job** — Takes `ProjectionService + DriftService` directly (not AppContainer); `makeProjectionSvc()` and `makeDriftSvc()` factory helpers in `register.ts`.
- **`apps/api` import route tests** — `authPlugin` registration + `JWT_ACCESS_TTL_SECONDS` in mock env.

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
