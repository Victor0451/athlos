# Delta for database-migrations

This change adds 3 new scenarios under 2 existing requirements in `database-migrations`. No requirement text changes, no new requirements, no removed or renamed requirements.

## MODIFIED Requirements

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