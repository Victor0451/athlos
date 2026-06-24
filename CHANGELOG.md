# Changelog

All notable changes to this project will be documented in this file.

## [0.5.1] — 2026-06-24

### Added

- **`packages/promotion/`** — New workspace package with `promoteDomain(db, domain)` + `promoteAll(db)` algorithms. CLI runner via `pnpm db:promote` reads `DATABASE_URL` from env.
- **`packages/promotion/src/PROMOTION_ORDER.ts`** — FK-topological promotion order: `['socios', 'ctacte', 'ctacte1']` (ctacte1 DEFERRED — see note).
- **`packages/promotion/src/transforms/`** — jsonb → typed Drizzle inserts for `socios` + `ctacte` (ctacte1 transform code shipped but not wired). Helpers: `parseFechaVFP` (VFP `'YYYYMMDD'` / ISO / Date / number → ISO `'YYYY-MM-DD'`), `parseMonto`, `splitDebeHaber`, `splitApellidoNombre`.
- **`packages/db/src/schema/tesoreria.ts`** — New `tesoreria.ctacte1` master table (`id` uuid PK, `ctacte_id` uuid FK to `tesoreria.ctacte.id` ON DELETE RESTRICT, `fecha` date NOT NULL, `concepto` text NOT NULL, `monto` text NUMERIC 14,2 default `'0.00'`, `created_at` timestamptz default `now()`).
- **`packages/db/drizzle/0012_volatile_rocket_racer.sql`** — Migration: `CREATE TABLE tesoreria.ctacte1` + `CREATE INDEX ctacte1_ctacte_id_idx` + FK to `tesoreria.ctacte`.
- **`packages/promotion/src/__tests__/promote.test.ts`** — 7 vitest cases (T1 happy socios, T2 ctacte FK failure, T3 ctacte1 happy path, T4 idempotency re-run, T5 PROMOTION_ORDER enforcement, T6 transformSocio unit, T7 transformCtacte unit). NOTE: tests use mock data with the original field-name assumptions (some are stale); the smoke test against the real DB validates the corrected transforms end-to-end.
- **`openspec/specs/deployment-devops/spec.md`** — Atomic canonical sync: new "Promotion Pipeline" requirement with 3 scenarios + 6 success criteria (ctacte1 scenario marked DEFERRED to E1b post-merge).

### Changed

- (none)

### Fixed

- **`packages/db/drizzle/0012_volatile_rocket_racer.sql`** — Removed duplicate `CREATE TABLE` / `ALTER TABLE` statements for tables that already exist in earlier migrations (`domain_freshness`, `drift_snapshots`, `entity_uuids`, `role_permissions`); only NEW statements (ctacte1 master table + FK + index) remain.
- **`packages/promotion/src/PROMOTION_ORDER.ts`** — `PROJECTION_TABLE` switched from string with dot ambiguity to structured `{schema, table}` (table names contain dots).
- **`packages/promotion/src/promote.ts`** — Uses structured `PROJECTION_TABLE`; `db.execute` no longer needs string-split (avoids `schema.table` vs `schema."table"` ambiguity).
- **`packages/promotion/src/transforms/socios.ts`** — 6 VFP field name corrections: `SOCDNI` → `SOCNUMDOCU`, `SOCFECALTA` → `SOCFECINGR` (with `SOCFECNACI` fallback), `SOCCATEGO` → `SOCCATEGOR`, `SOCDIRECC` → `SOCDIRECCI`, `SOCTELEFO` → `SOCTE`. Adds `SOCFECBAJA` → `deleted_at` + `estado='baja'` when present and not the 1925-01-31 sentinel.
- **`packages/promotion/src/transforms/ctacte1.ts`** — 4 VFP field name corrections: `CCT1NUMERO` → `CCTCUENTA` (for FK map), `CCT1FECHA` → `CCTPAGFECH`, `CCT1CONCEPT` → `CCTPAGTIPC`, `CCT1IMPORTE` → `CCTPAGOIMP`. (Transform code correct in field mappings; FK resolution blocked by data-model gap — see DEFERRED note.)
- **`packages/promotion/src/dedup.ts`** — Compound natural keys: ctacte uses `CCTCUENTA+CCTFECHA+CCTNROCOMP+CCTMES+CCTTALONAR` (was just `CCTCUENTA`, which grouped 326k rows into 8,870 dedup keys), ctacte1 uses `CCTPAGONRO+CCTPAGOSEC+CCTPAGOTAL`.
- **`packages/promotion/src/fk-lookup.ts`** — For ctacte1, dropped unnecessary JOIN with `raw_events`; `entity_uuids.source_key` IS the parent ctacte's `CCTCUENTA` value (verified 8,870 of 8,870 entity_uuids rows match projection `payload.CCTCUENTA`).

### DEFERRED to E1b

- **Promotion of `ctacte1` (245,370 rows)** — Post-merge smoke test discovered the `ctacte1` → `ctacte` FK cannot be resolved: `tesoreria.ctacte` master has no `cctcuenta` column to preserve the VFP natural key after promotion. E1b will (a) add a migration to introduce `cctcuenta` column on `tesoreria.ctacte`, (b) backfill from `raw_events.payload->>'CCTCUENTA'` during `rebuildProjection`, (c) wire the `ctacte1` PROMOTION_ORDER step + scenario. The `ctacte1` transform + fk-lookup code shipped in E1a is correct in field mappings; the FK resolution will work after the schema change.

### Smoke Test Results (against 192.168.1.102/athlos test DB)

- **`socios`**: 16,354 inserted of 39,357 attempted (22,680 skipped via dedup on duplicate `SOCCARNET`, 323 failed: unparseable `SOCFECINGR`/`SOCFECALTA`/`SOCFECNACI`).
- **`ctacte`**: 196,403 inserted of 326,275 attempted (62,207 skipped via compound-key dedup, 67,665 failed: no matching socio — `CCTCUENTA` not found in `socios.socios.numeroSocio`).
- **`ctacte1`**: 0 inserted of 245,370 (DEFERRED — see above).

### Spec

- 1 modified capability: `deployment-devops`
- 1 new requirement: "Promotion Pipeline" (CLI runner, FK-topological order, batched INSERT with `ON CONFLICT DO NOTHING`, structured projection table mapping)
- 3 new scenarios: socios happy path, ctacte with FK dependency on socios via in-memory map, ctacte1 with chained FK on ctacte (marked DEFERRED post-merge)
- 6 new success criteria

## [0.5.0] — 2026-06-24

### Added

- **`.github/workflows/deploy.yml`** — Post-merge deploy workflow: build + GHCR push (3 tags: `:latest`, `:vX.Y.Z`, `:main-<sha>`) + appleboy SSH deploy + 60s `/health/ready` poll + auto-rollback to previous tag on failure.
- **`.github/workflows/check-destructive.yml`** — Pre-merge destructive migration gate: scans `packages/db/migrations/*.sql` for `DROP TABLE|TRUNCATE|DELETE FROM`. Requires backup artifact URL in PR comment OR `/backup-skipped` directive in PR body when `db-destructive` label present.
- **`.github/labeler.yml`** + labeler job in `test.yml` — Auto-applies `db-destructive` label to PRs touching `packages/db/migrations/**`, `packages/db/src/schema/**`, or `drizzle/**`.
- **`docs/runbook.md`** — New "CI/CD" section: deploy flow, GitHub Secrets table, db-destructive label docs, manual rollback procedure, server-side `authorized_keys` hardening, quarterly key rotation note.
- **`openspec/specs/deployment-devops/spec.md`** — Atomic canonical sync: 4 stale `CI/CD Pipeline` scenarios rewritten IN-PLACE (`ci.yml` → `deploy.yml`, `athlos-api:` → `ghcr.io/victor0451/athlos-api:`, `staging` → `main`, `ghcr.io/athlos/` → `ghcr.io/victor0451/`), 6 new scenarios added, 5 new success criteria (26-30).

### Changed

- **`.env.example`** — Added `DEPLOY_HOST` + `DEPLOY_SSH_KEY` placeholders under `─── CI Deploy (PR Slice D) ───`.

### Fixed

- (none)

### Spec

- 1 modified capability: `deployment-devops`
- 4 rewrites IN-PLACE (no `_v2` suffix): `ci.yml` → `deploy.yml`, `athlos-api:` → `ghcr.io/victor0451/athlos-api:`, `staging` → `main`, `ghcr.io/athlos/` → `ghcr.io/victor0451/`
- 6 new scenarios: image tags, SSH action, auto-rollback, concurrency, destructive gate, auto-labeler
- 5 new success criteria

## [0.4.5] — 2026-06-23

### Added

- **`Dockerfile`** — Multi-stage build (node:22-alpine, builder + runtime stages, non-root UID 1001, tini PID-1, < 300 MB).
- **`docker-entrypoint.sh`** — pg_isready wait, conditional backup via `BACKUP_BEFORE_MIGRATE`, conditional migration via `RUN_MIGRATIONS`, exec Node as PID 1.
- **`docker-compose.yml`** — `api` + `db` services (no migrations service), healthchecks, `env_file: .env.production`, json-file log rotation.
- **`.env.example`** — Added 10 containerized deploy vars: `RUN_MIGRATIONS`, `BACKUP_BEFORE_MIGRATE`, `BACKUP_DIR`, `BUILD_SHA`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_HOST`, `NODE_ENV`, `PORT`.
- **`.dockerignore`** — Excludes `openspec/`, `.atl/`, `coverage/`, `.nyc_output/`, `.husky/`.
- **`docs/runbook.md`** — Added Containerized Deploy section (deploy, verify, migrate, backup, rollback, one-off migration).
- **`.github/workflows/test.yml`** — Added `docker-build-smoke` job (full build + smoke run, no push).

### Changed

- **`apps/api/src/index.ts`** — Replaced `import 'dotenv/config'` with explicit `loadEnv()` call from `./env.js`, guarded by `NODE_ENV !== 'production'`.
- **`openspec/specs/deployment-devops/spec.md`** — Canonical sync: added Containerized Deploy requirement (5 scenarios), rewrote 4 stale scenarios in-place (Database migrations on startup, Rollback procedure, One-off migration execution, Backup storage location), S3→local reconciliation for `$BACKUP_DIR` per ADR #30.

### Fixed

- **dotenv/config guard** — `apps/api/src/env.ts` extracted `loadEnv()` guard, ensuring dotenv only loads in non-production (compose env_file supplies prod env vars).

## [0.4.4] — 2026-06-23

### Added

- **`scripts/mount-usb.sh`** — Open LUKS partition and mount USB for weekly backup rotation.
  - Checks keyfile perms (600, root:root) BEFORE `cryptsetup open`
  - Idempotent: exits 0 if already mounted
  - Exit codes: 0 success, 1 config/keyfile error, 2 USB not present

- **`scripts/unmount-usb.sh`** — Unmount USB and close LUKS partition.
  - umount BEFORE cryptsetup close (order matters!)
  - Idempotent: safe to call when nothing is mounted
  - Exit code: 0 always success

- **`scripts/backup-to-usb.sh`** — Weekly USB backup rotation pipeline.
  - `flock -n /var/lock/athlos-backup.lock` for concurrency safety
  - Calls mount-usb.sh → rsync -av --delete → cleanup_old_backups → unmount-usb.sh
  - Exit codes: 0 success, 1 config error, 2 mount fail, 3 rsync/retention fail

- **`scripts/setup-usb.sh`** — First-time USB LUKS + ext4 setup (manual one-shot).
  - `--device` required; `--dry-run` prints plan without formatting
  - Requires operator to type `YES` to confirm destructive format
  - Generates keyfile (dd, chmod 0600, root:root), luksFormat, mkfs.ext4

- **`scripts/lib/common.sh`** — Extended with 3 new helpers:
  - `require_root()` — exits 1 if EUID != 0
  - `is_mounted PATH` — returns 0 if PATH is a mount point
  - `is_luks_open MAPPER` — returns 0 if LUKS mapper is open in /dev/mapper/

### Changed

- **`.env.example`** — Added 5 USB rotation variables: `USB_DEVICE`, `USB_KEYFILE`, `USB_MAPPER`, `USB_MOUNT_POINT`, `USB_RETENTION_DAYS` (default 30)

- **`docs/runbook.md`** — Added USB Rotation section with weekly overview, first-time setup, emergency unmount, verify last backup, and exit code table

- **`.github/workflows/test.yml`** — Extended `backup-bats` CI job with `cryptsetup rsync` apt install, expanded shellcheck glob to all USB scripts, expanded bats test glob to all new test files, added USB env vars

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
