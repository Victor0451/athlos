# Changelog

All notable changes to this project will be documented in this file.

## [0.4.3] — 2026-06-22

### Added

- **`scripts/backup.sh`** — Daily `pg_dump` + `gzip` backup script with inline retention sweep.
  - Reads `DATABASE_URL`, `BACKUP_DIR`, `BACKUP_RETENTION_DAYS` from environment
  - Output: `$BACKUP_DIR/athlos-<YYYY-MM-DD-HHMM>.sql.gz`
  - `gunzip -t` integrity verification after each dump
  - `cleanup_old_backups()` removes files older than `BACKUP_RETENTION_DAYS` days
  - Partial `pg_dump` failure removes the corrupt output file before exit 3

- **`scripts/restore.sh`** — Assisted restore with `--confirm` safety gates.
  - Mandatory: `--source <path>` (must be `.sql.gz`) and `--confirm`
  - Optional: `--target <connstring>`, `--dry-run`, `--force-allow-active`
  - Safety gates: `--confirm` → source valid → banner (stderr) → `gunzip -t` → active-conn check → apply
  - Exit codes: 0 success, 1 bad argv, 2 safety refused, 3 psql failure

- **`scripts/lib/common.sh`** — Shared bash helpers for backup and restore scripts.
  - `log()`, `die()`, `require_env()`, `require_cmd()`, `get_timestamp()`, `cleanup_old_backups()`

- **bats test suites** — `scripts/tests/common.test.bats`, `backup.test.bats`, `restore.test.bats`
  - 19 test cases covering positive and negative paths for all three scripts

- **`backup-bats` CI job** — `.github/workflows/test.yml` runs `bats` + `shellcheck` on every PR

- **`.env.example`** — Added `BACKUP_DIR` and `BACKUP_RETENTION_DAYS` under new `─── Backup (PR Slice B1a) ───` section

- **`docs/runbook.md`** — Added `## Backup & Restore` section with daily backup procedure, restore invocations, and exit code table

### Changed

- **`openspec/specs/database-migrations/spec.md`** — Replaced `s3://athlos-backups/pre-deploy-<sha>.sql.gz` literal with `$BACKUP_DIR/pre-deploy-<sha>.sql.gz` (per ADR #30 — local + USB only, no S3)

- **`openspec/specs/deployment-devops/spec.md`** — Updated `Backup Strategy` requirement text to reflect local backup approach

## [0.4.2] — 2026-06-19

### Added

- **`@athlos/db`** — `grant-data-steward` CLI: idempotent DATA_STEWARD permission grant with per-grant audit trail.
  - `pnpm ops:grant-data-steward --username <u>` (repeatable flag)
  - `DATA_STEWARD_OPERATOR_IDS=<uuid1>,<uuid2> pnpm ops:grant-data-steward --from-env`
  - `pnpm ops:grant-data-steward --username <u> --json` — Zod-validated JSON output
  - Pre-check `hasPermission()` before `grant()` for idempotency (safe to re-run)
  - Per-grant `db.transaction(grant + emitAudit)` — no orphan audit rows
  - Exit codes: 0 (success), 1 (unknown username/bad UUID), 2 (connection/args error)

- **`@athlos/db`** — `OperatorsRepo.findByUsername(username)` repository method
  - Factory pattern matching `makePermissionsRepo`
  - Used by `grant-data-steward.ts` for username → operator ID resolution

- **`docs/runbook.md`** — Replaced error-prone raw SQL `INSERT INTO role_permissions` block with idempotent, audited CLI command

## [0.4.1] — 2026-06-18

### Added

- **`@athlos/db`** — `migrate:status` command with drift detection.
  - `pnpm db:migrate:status` reads `__drizzle_migrations` table, compares against `drizzle/*.sql` filesystem entries
  - Reports applied, pending, and divergent migrations
  - Supports `--json` flag with Zod-validated output
  - Exit codes: 0 (clean), 1 (drift/pending), 2 (connection error)

- **CI drift gate** — `.github/workflows/test.yml` now runs `drizzle-kit check` as a `drift-check` job that blocks PR merge on drift

### Changed

- **`docs/runbook.md`** — Removed `db:migrate:rollback` block; migrations are now documented as forward-only per spec

## [0.4.0] — 2026-06-18

### Changed

- **README**: bilingual EN+ES with v0.3.1 truth (Next 16.2.9, Fastify 5, Postgres 16, pnpm 9.15.9, Node 22, TS 5.7.2 strict)
- **Obsidian entry points**: refreshed to v0.3.1 (`0-README.md`, `0-Index.md`, `3-Tech-Stack/0-Stack.md`, `7-Roadmap/0-Roadmap.md`)
- **Obsidian**: new `5-Modules/8-Module-Package-Map.md` (9 product modules × 20 packages/integrations)
- **OpenSpec hygiene notes**: `openspec/specs/RENAMED-validation.md` (validation-zod → validation), `openspec/specs/auth-login/FOLDED-rbac.md` (user-management-rbac → auth-login)

## [0.3.1] — 2026-06-18

### Fixed

- **`@athlos/notifications`** — `resolveDrift()` now routes `drift_alert` events to operators with the `data_steward` permission via `role_permissions` table (decision OI-1 B), instead of falling back to ADMINs. Added `PermissionsRepo.listOperatorsWithPermission(key)` to `packages/db/src/repositories/permissions.ts`; the dispatcher now consumes it via the new optional `permissionsRepo` field on `DispatcherDeps`. Legacy fallback to ADMINs when no `permissionsRepo` is wired (standalone / pre-deploy contexts) is preserved.
- **`CHANGELOG.md`** — Added the missing `[0.3.0]` and `[0.2.0]` comparison links at the bottom of the file (Keep a Changelog convention).
- **`openspec/changes/athlos-import-completion/tasks.md`** — Marked all 33 tasks (TASK-061..093) as `[x]` (the implementation is on main; the checkboxes were left unchecked after the sdd-apply sub-agents finished).

### Tests

- 5 new tests added (4 for `PermissionsRepo.listOperatorsWithPermission`, 1 for the dispatcher's DATA_STEWARD fan-out). **439/439 tests passing** (was 434, +5).

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

[0.3.1]: https://github.com/Victor0451/athlos/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/Victor0451/athlos/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Victor0451/athlos/compare/v0.1.0...v0.2.0
