# Database Migrations Specification

## Purpose

Define how Athlos manages PostgreSQL schema changes: toolchain, generation, review, application, locking, history, rollback, and schema snapshot. Aligns with the `deployment-devops` spec's entrypoint-driven startup and with `data-access-layer` (Drizzle ORM).

---

## Requirements

### Requirement: Migration Toolchain

The system SHALL use `drizzle-kit` for schema diff and migration generation and `drizzle-orm` runtime migrator for execution. Migration files SHALL be plain `.sql` in `packages/db/migrations/` and SHALL be timestamp-prefixed (`YYYYMMDDHHMMSS_name.sql`) to guarantee global ordering and avoid rename collisions.

#### Scenario: Developer generates a migration

- GIVEN the developer changed a Drizzle schema in `packages/db/src/schema/`
- WHEN they run `pnpm --filter @athlos/db generate`
- THEN `drizzle-kit` SHALL diff against the committed snapshot
- AND SHALL write a timestamped `.sql` file into `packages/db/migrations/`
- AND SHALL update `packages/db/migrations/meta/_journal.json`

#### Scenario: CI runs the migration

- GIVEN the GitHub Actions pipeline
- WHEN it reaches the `db:migrate` step
- THEN it SHALL run `drizzle-kit migrate` against an ephemeral Postgres service
- AND the step SHALL fail if any migration errors

---

### Requirement: Startup Auto-Apply

The entrypoint script SHALL apply all pending migrations before starting the API. Each migration SHALL run in a transaction. The migration runner SHALL have a 30s default timeout, configurable per migration via `--statement-timeout` for data backfills. On failure, the API SHALL NOT start and the previous transaction SHALL roll back.

#### Scenario: Clean startup

- GIVEN the DB has no `__drizzle_migrations` entries
- WHEN the entrypoint runs `drizzle-kit migrate`
- THEN all migrations SHALL apply in order
- AND each SHALL commit independently
- AND the API SHALL start only after the last migration succeeds

#### Scenario: Migration fails mid-run

- GIVEN migration 0042 fails on its third statement
- WHEN the runner catches the error
- THEN it SHALL roll back the open transaction
- AND the API process SHALL exit non-zero
- AND the operator SHALL see the failing migration filename and SQLSTATE in logs

---

### Requirement: Production Migration Discipline

Production migrations SHALL run via the same entrypoint on every deploy. Destructive changes (DROP COLUMN, DROP TABLE, mass UPDATE without WHERE) SHALL require an explicit PR label `db-destructive` and a backup taken with `pg_dump` immediately before the deploy. Rollback SHALL be forward-only — no down migrations.

#### Scenario: Forward-fix rollback

- GIVEN a migration accidentally renames a column
- WHEN the team detects the regression
- THEN a new migration SHALL be authored that re-adds the column and back-fills
- AND the original migration SHALL NOT be edited post-merge

#### Scenario: Pre-migration backup

- GIVEN a `db-destructive` label on a PR
- WHEN the deploy job reaches the migration step
- THEN the deploy script SHALL run `pg_dump` and write the dump to `$BACKUP_DIR/athlos-<YYYY-MM-DD-HHMM>.sql.gz`
- AND the deploy SHALL abort if the dump fails

---

### Requirement: Data Migrations

Backfills and other data-only changes SHALL live in the same `migrations/` folder, SHALL be idempotent (`ON CONFLICT DO NOTHING`, `WHERE NOT EXISTS`), and SHALL be clearly named (`*_backfill_<purpose>.sql`). They SHALL NOT mix DDL with DML.

#### Scenario: Backfill idempotency

- GIVEN a backfill migration that sets `socios.email` from legacy
- WHEN it is applied twice (e.g., a failed deploy re-runs)
- THEN the second run SHALL be a no-op
- AND no rows SHALL be duplicated or overwritten incorrectly

---

### Requirement: Migration Locking

Concurrent migration attempts SHALL be blocked. The runner SHALL acquire `pg_advisory_lock(<lock_id>)` before reading `__drizzle_migrations` and release it on exit. If a migration holds the lock for more than 5 minutes, the second runner SHALL abort with `MIGRATION_LOCK_TIMEOUT`.

#### Scenario: Parallel deploys collide

- GIVEN two API instances start at the same time
- WHEN both call the migration runner
- THEN instance A SHALL acquire the advisory lock
- AND instance B SHALL wait up to 30s
- AND if B times out, B SHALL exit non-zero without starting the API

---

### Requirement: Migration History

Drizzle's built-in `__drizzle_migrations` table SHALL be the single source of truth for applied migrations. Status queries SHALL use the Drizzle migrator API or a read-only `SELECT hash, created_at FROM __drizzle_migrations ORDER BY id`.

#### Scenario: Operator inspects history

- GIVEN a production incident
- WHEN an operator runs `pnpm --filter @athlos/db status`
- THEN the command SHALL print applied vs pending migrations
- AND exit non-zero if the DB schema drifts from the committed snapshot

#### Scenario: Operator requests machine-readable status via `--json` flag

- GIVEN an operator or downstream CI tool needs a structured payload
- WHEN they run `pnpm db:migrate:status --json`
- THEN the command SHALL emit a JSON object whose shape is validated by a Zod schema
- AND the JSON object SHALL contain exactly four fields: `applied: string[]`, `pending: string[]`, `divergence: string[]`, `exitCode: 0 | 1`
- AND the command SHALL exit 0 when `applied` equals the local filesystem set AND `divergence` is empty
- AND the command SHALL exit 1 when `pending` is non-empty OR `divergence` is non-empty

#### Scenario: Status command reports divergence (DB rows missing from filesystem)

- GIVEN `__drizzle_migrations` contains a row for migration `0012_xxx` but no `0012_xxx.sql` exists in `packages/db/drizzle/`
- WHEN an operator runs `pnpm db:migrate:status`
- THEN the command SHALL list `0012_xxx` under the divergence (applied − local) set
- AND the command SHALL exit non-zero so CI and operators detect the unsynced database row
- AND the divergence set SHALL be distinct from the pending set (pending = local − applied; divergence = applied − local)

#### Scenario: Runbook documents forward-only migrations (no rollback command)

- GIVEN the database-migrations spec mandates forward-only migrations
- WHEN an operator reads `docs/runbook.md` for rollback instructions during a production incident
- THEN the runbook MUST NOT reference `db:migrate:rollback` or any other reversal command
- AND the runbook MUST instruct: "re-deploy a previous image tag; migrations are forward-only by spec"

---

### Requirement: Schema Snapshot

The Drizzle schema snapshot SHALL be committed to git at `packages/db/src/schema/`. `drizzle-kit` SHALL read this snapshot to compute diffs. Snapshots SHALL NEVER be edited by hand.

#### Scenario: Drift detected

- GIVEN a developer modified the DB via psql
- WHEN CI runs `drizzle-kit check`
- THEN the check SHALL fail
- AND the developer SHALL author a migration to reconcile

#### Scenario: CI drift gate blocks merge on schema drift

- GIVEN the workflow `.github/workflows/test.yml` runs on every pull request
- WHEN the `drift-check` job executes `pnpm --filter @athlos/db exec drizzle-kit check` against the existing Postgres service after `pnpm test:run` and `pnpm typecheck` succeed
- AND `drizzle-kit check` detects drift between the committed snapshot and the migration folder
- THEN the workflow SHALL exit non-zero
- AND the pull request SHALL be blocked from being merged until the drift is resolved by authoring and committing a migration

---

## Success Criteria

- [ ] Migrations apply cleanly on a fresh database via entrypoint
- [ ] Failed migration rolls back and prevents API start
- [ ] Forward-only rollback documented in `CONTRIBUTING.md`
- [ ] `pnpm --filter @athlos/db status` exits non-zero on drift
- [ ] CI blocks merges when `drizzle-kit check` fails
- [ ] Destructive PRs require `db-destructive` label and pre-deploy backup
