# Deployment/DevOps Specification

## Purpose

Define the deployment infrastructure, containerization, CI/CD pipeline, and operational procedures for Athlos. This ensures reproducible, auditable, and secure deployment across development, staging, and production environments.

---

## Requirements

### Requirement: Docker Setup

The system SHALL provide a multi-stage Dockerfile for the API service and a docker-compose.yml defining all runtime services.

#### Scenario: API Docker image build

- GIVEN the project root contains `Dockerfile`
- WHEN `docker build -t athlos-api:latest .` is executed
- THEN the build MUST complete without error
- AND produce a final image with only production dependencies installed (no devDependencies)
- AND the image MUST expose port 3001

#### Scenario: docker-compose services

- GIVEN `docker-compose.yml` is present
- WHEN `docker-compose up -d` is executed
- THEN services `api` and `db` MUST be defined (no separate `migrations` service — migrations run in `api` entrypoint)
- AND `api` MUST expose port 3001 to the host
- AND `db` MUST expose port 5432 to the host
- AND `api` MUST wait for `db` to be healthy before starting

#### Scenario: Health check configuration

- GIVEN the `api` service is defined in docker-compose
- WHEN the container starts
- THEN a health check MUST be configured using `curl` or `wget` against the `/health` endpoint
- AND the health check MUST have a 30-second timeout and 5-second interval
- AND `docker-compose ps` MUST show `healthy` status when the API is ready

---

### Requirement: Database Setup

The system SHALL use PostgreSQL with persistent storage, automatic migration execution, and environment-driven configuration.

#### Scenario: PostgreSQL container

- GIVEN the `db` service uses the `postgres:16-alpine` image
- WHEN the container starts
- THEN a volume MUST be mounted at `/var/lib/postgresql/data` for persistent storage
- AND the database MUST be initialized with the `athlos` database

#### Scenario: Database migrations on startup (rewritten by Slice C: 2026-06-19)

- GIVEN the `api` service has `RUN_MIGRATIONS=true` in its env
- WHEN `docker compose up -d` is executed
- THEN the `api` container's entrypoint SHALL wait for the `db` service healthcheck (`pg_isready`)
- AND SHALL run `pnpm --filter @athlos/db migrate` automatically (NOT a separate `migrations` service)
- AND if any migration fails, the `api` service MUST NOT start
- AND the `db` service MUST remain running for debugging
- AND alternative manual execution is `docker compose run --rm api sh -c 'pnpm --filter @athlos/db migrate'`

#### Scenario: Database environment variables

- GIVEN the `db` service requires `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`
- WHEN the container starts
- THEN these variables MUST be provided via docker-compose environment section
- AND `POSTGRES_PASSWORD` MUST NOT be hardcoded in the docker-compose.yml file

---

### Requirement: CI/CD Pipeline

The system SHALL provide a GitHub Actions-based CI/CD pipeline that builds, publishes, and deploys the API image to the production server on every push to `main`, with a pre-merge destructive-migration gate, an auto-labeler for migration PRs, and auto-rollback to the previous image tag on healthcheck failure.

#### Scenario: CI workflow file is `.github/workflows/deploy.yml` (rewritten by Slice D: 2026-06-24)

- GIVEN the project uses GitHub Actions for CI/CD
- WHEN the operator inspects `.github/workflows/`
- THEN the deploy workflow file SHALL be named `deploy.yml` (NOT the legacy `ci.yml` from the PR-7 design)
- AND the workflow SHALL run lint, test, build, push, and deploy stages sequentially
- AND a failure in any stage SHALL fail the workflow
- AND the workflow SHALL be triggered by `push` events to `main` (NOT by `pull_request` events to `staging`)

#### Scenario: Image is `ghcr.io/victor0451/athlos-api` (rewritten by Slice D: 2026-06-24)

- GIVEN a commit is pushed to `main`
- WHEN the `build` stage completes
- THEN the Docker image SHALL be published to `ghcr.io/victor0451/athlos-api` (NOT the bare `athlos-api:` short form)
- AND deployment SHALL target the production environment
- AND GHCR push credentials SHALL be sourced from `${{ secrets.GITHUB_TOKEN }}` (automatic, no manual secret rotation)

#### Scenario: Deploys on push to `main` branch (rewritten by Slice D: 2026-06-24)

- GIVEN the repository is configured for a single-environment production deploy
- WHEN a commit is pushed to `main`
- THEN the deploy workflow SHALL trigger
- AND the workflow SHALL NOT trigger on push to `staging` (the staging branch is explicitly out of scope for Slice D)
- AND a push to any non-`main` branch SHALL NOT trigger the deploy workflow

#### Scenario: Registry organization is `ghcr.io/victor0451` (rewritten by Slice D: 2026-06-24)

- GIVEN a commit with SHA `abc1234` is pushed to `main`
- WHEN the build stage completes
- THEN the image SHALL be tagged as `ghcr.io/victor0451/athlos-api:abc1234` (NOT `ghcr.io/athlos/...`)
- AND `ghcr.io/victor0451/athlos-api:latest` SHALL be updated
- AND `ghcr.io/victor0451/athlos-api:main-abc1234` SHALL be published (short-SHA tag for rollback anchoring)

#### Scenario: Image tags are `:latest`, `:vX.Y.Z`, `:main-<sha>`

- GIVEN `docker/metadata-action@v5` runs with `flavor: latest=regex=^v[0-9]+\.[0-9]+\.[0-9]+$`
- WHEN the build stage runs against a commit
- THEN the image SHALL always be tagged `:latest`
- AND SHALL be tagged `:main-<short-sha>` (7-char git SHA) for every push to `main`
- AND SHALL additionally be tagged `:vX.Y.Z` when the commit message OR a git tag matches the version regex
- AND `docker images ghcr.io/victor0451/athlos-api` on the server SHALL list all 3 tags after a release deploy

#### Scenario: Deploy SSH action uses `appleboy/ssh-action@v1` with `DEPLOY_SSH_KEY` + `DEPLOY_HOST` secrets

- GIVEN the `deploy` job in `.github/workflows/deploy.yml` needs to reach the production server
- WHEN the deploy step runs
- THEN it SHALL use `appleboy/ssh-action@v1` (NOT a custom SSH step, NOT `webfactory/ssh-agent`)
- AND the SSH key SHALL be sourced from `${{ secrets.DEPLOY_SSH_KEY }}` (a long-lived private key, no passphrase)
- AND the target host SHALL be `${{ secrets.DEPLOY_HOST }}` (the production server IP, e.g. `192.168.1.102`)
- AND the SSH command SHALL be `set -euo pipefail; cd /run/media/vlongo/Archivos/Projectos/Athlos && docker compose pull && docker compose up -d`
- AND the SSH key's `authorized_keys` entry SHALL restrict the key to `command="/usr/local/bin/athlos-deploy-wrapper.sh"` + `from="*.github.com,140.82.114.0/24,185.199.108.0/22,192.30.252.0/22"` + `no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty` (defense in depth)

#### Scenario: Auto-rollback: on `/health/ready` failure, redeploy previous image tag

- GIVEN the `deploy` job's SSH step has run `docker compose up -d` and the new image is starting
- WHEN the `/health/ready` poll loop does not return 200 within 60 seconds (12 attempts × 5s sleep)
- THEN the deploy job SHALL fail
- AND the failed container's logs SHALL be dumped to `/tmp/deploy-fail-<timestamp>.log` on the server before rollback
- AND the rollback step SHALL redeploy the previous image tag (captured via `git rev-parse --short HEAD~1`) via `docker compose pull && docker compose up -d`
- AND the workflow output SHALL log the previous and current image tags in the audit trail

#### Scenario: Concurrency: `group: deploy, cancel-in-progress: false` (queue, don't cancel mid-deploy)

- GIVEN two consecutive pushes to `main` could trigger overlapping deploy workflows
- WHEN the second push occurs while the first deploy is still running
- THEN the second deploy SHALL be queued (waiting for the first to complete)
- AND the `concurrency` block at the top of `deploy.yml` SHALL declare `group: deploy, cancel-in-progress: false`
- AND the second deploy SHALL NOT cancel the first (canceling mid-deploy leaves the server in an unknown state)
- AND the queued second deploy SHALL begin only after the first (and any rollback) completes

#### Scenario: Pre-merge destructive gate: `db-destructive` label required; backup artifact OR `/backup-skipped` directive

- GIVEN a PR is opened against `main` and the `db-destructive` label is present
- WHEN `.github/workflows/check-destructive.yml` runs
- THEN the workflow SHALL scan the diff for destructive SQL patterns (`DROP TABLE|COLUMN|INDEX|CONSTRAINT|SCHEMA`, `TRUNCATE`, `DELETE FROM <table>;`)
- AND if destructive patterns are found AND no migration files changed → the workflow SHALL pass (label is irrelevant)
- AND if destructive patterns are found AND migration files changed AND the PR body contains `/backup-skipped` → the workflow SHALL pass and the override SHALL be logged in workflow output
- AND if destructive patterns are found AND migration files changed AND a PR comment contains a `*.sql.gz` URL → the workflow SHALL pass
- AND otherwise → the workflow SHALL fail with `::error::Destructive migration detected — please run \`pnpm db:backup && pnpm db:status\` and paste the backup URL, or add \`/backup-skipped\` directive to PR body with justification`

#### Scenario: Auto-labeler: PRs touching `packages/db/migrations/**` or `packages/db/src/schema/**` get `db-destructive` label automatically

- GIVEN `.github/labeler.yml` declares the `db-destructive` label with glob patterns
- WHEN a PR is opened or synchronized that touches a matching file path
- THEN the `labeler` job in `.github/workflows/test.yml` SHALL run `actions/labeler@v5` within 1 minute
- AND the `db-destructive` label SHALL be auto-applied to the PR
- AND the matching globs SHALL include `packages/db/migrations/**`, `packages/db/src/schema/**`, and `drizzle/**`
- AND a test PR touching only `apps/api/src/foo.ts` SHALL NOT receive the `db-destructive` label

---

### Requirement: Promotion Pipeline

The system SHALL provide a manual promotion pipeline that moves validated data from `*_projection` tables into application master tables, triggered exclusively via CLI (no automatic promotion). Promotion is intentionally irreversible at the application-surface level — the operator reviews the projection data before committing it to master tables.

#### Scenario: CLI runner via `pnpm db:promote`

- GIVEN the pnpm workspace is installed
- WHEN the operator executes `pnpm db:promote`
- THEN the CLI SHALL run `packages/promotion/src/promote-cli.ts` against the database specified by `DATABASE_URL` (default: `postgresql://athlos:athlos@192.168.1.102:5432/athlos`)
- AND the CLI SHALL NOT require any additional arguments or flags for a full promotion run
- AND the CLI SHALL print per-domain summary lines showing `attempted`, `inserted`, `skipped`, `failed`, and `durationMs`
- AND the CLI SHALL exit with code 0 on success, or non-zero if any domain had `failed > 0`

#### Scenario: Domain promotion order respects FK dependencies

- GIVEN `pnpm db:promote` is executed
- WHEN domains are promoted in sequence
- THEN `socios` SHALL be promoted first (no FK dependencies)
- AND `escuela` SHALL be promoted second (independent FK tree — no required FK in v1.0)
- AND `deportes` SHALL be promoted third (independent FK tree — no required FK in v1.0)
- AND `locacion` SHALL be promoted fourth (independent FK tree — no required FK in v1.0)
- AND `caja` SHALL be promoted fifth (independent FK tree — no required FK in v1.0; header-only in v1.0, 122 detail columns deferred)
- AND `ctacte` SHALL be promoted sixth (depends on `socios.id`)
- AND `ctacte1` SHALL be promoted seventh (depends on `ctacte.id`)
- AND if any domain fails AND all attempted rows failed AND the domain is in `FK_BLOCKING_DOMAINS` (socios, ctacte), dependent domains SHALL NOT be attempted
- AND the 4 NEW domains (escuela, deportes, locacion, caja) do NOT block each other — their failures do NOT short-circuit each other

> **E1b1 (v0.5.2/v0.5.3) UPDATE (2026-06-24).** ctacte1 is wired. Migration 0013 added `cctcuenta` to `tesoreria.ctacte` + backfilled best-effort. Migration 0014 added `legacy_id text` + `UNIQUE INDEX` on `tesoreria.ctacte.legacy_id` and `tesoreria.ctacte1.legacy_id`. Cross-run idempotency works: re-running `pnpm db:promote` is a no-op (0 new inserts) via dedup pre-check + ON CONFLICT DO NOTHING.
>
> **E1b2a (v0.5.4) UPDATE (2026-06-25).** 4 NEW domains wired: escuela, deportes, locacion, caja. Migration 0014 (E1b2a) creates `socios.escuela` (per-school master, NO socio_id FK), adds `legacy_id` to `deportes.disciplinas` (table already existed), creates `socios.locacion` (per-socio address), and creates `tesoreria.caja_movimiento` (cash movement header with 4-tuple NK). Scope corrections: (C1) escuela is per-school master with NO `socio_id` FK — verified 0 of 66 projection rows have SOCNUMERO/SOCCARNET fields; (C3) caja NK is 4-tuple `(CAJNUMERO, CAJSECUENC, CAJFECHA, CAJHORA)` — the 3-tuple yields 7,957 distinct = 188 silent row losses, 4-tuple yields 8,145 distinct = 100% unique.

#### Scenario: Batched INSERT with deduplication

- GIVEN a domain is being promoted
- WHEN rows are inserted into the master table
- THEN inserts SHALL be batched at 1000 rows per batch
- AND each batch SHALL use `ON CONFLICT DO NOTHING` (idempotent — re-running is safe)
- AND the promotion SHALL be considered best-effort: individual row failures SHALL NOT stop the batch; a summary of failed rows SHALL be printed after each domain

#### Scenario: Projection tables are schema-qualified

- GIVEN the promotion query reads from `socios.socios_projection`
- WHEN the query executes
- THEN the SQL SHALL use `"socios"."socios_projection"` (schema-qualified, double-quoted identifiers)
- AND NOT `"socios.socios_projection"` (which PostgreSQL treats as a single identifier name, not schema.table)

#### Scenario: Escuela domain promotion (per-school master)

- GIVEN `escuela` domain is being promoted
- WHEN rows are read from `public."socios.escuela_projection"` and written to `socios.escuela`
- THEN each row SHALL be transformed with natural key `ESCCODIGO` → `codigo` (text, deterministic UUID5 via `legacy_id`)
- AND the transform SHALL compute `legacy_id = deterministicUuid('escuela:codigo')` where `codigo = ESCCODIGO`
- AND `nombre` SHALL be mapped from `ESCNOMBRE` (upstream alias, deferred to v1.1)
- AND there is NO `socio_id` FK column in `socios.escuela` (verified: 0 projection rows contain SOCNUMERO/SOCCARNET)
- AND the projection table `public."socios.escuela_projection"` is schema-qualified (NOT `socios."escuela_projection"`)
- AND idempotency is guaranteed via `ON CONFLICT DO NOTHING` on the natural key `(codigo)` + `legacy_id UNIQUE INDEX`

#### Scenario: Deportes domain promotion (disciplinas with legacy_id)

- GIVEN `deportes` domain is being promoted
- WHEN rows are read from `public."deportes.deportes_projection"` and written to `deportes.disciplinas`
- THEN each row SHALL be transformed with natural key `DEPCODIGO` → `codigo` (numeric → text coercion required)
- AND the transform SHALL compute `legacy_id = deterministicUuid('deporte:codigo')` where `codigo = DEPCODIGO`
- AND `nombre` SHALL be mapped from `DEPNOMBRE`
- AND the projection table `public."deportes.deportes_projection"` is schema-qualified
- AND idempotency is guaranteed via `ON CONFLICT DO NOTHING` on `(codigo)` + `legacy_id UNIQUE INDEX`

#### Scenario: Locacion domain promotion (per-socio address)

- GIVEN `locacion` domain is being promoted
- WHEN rows are read from `public."socios.locacion_projection"` and written to `socios.locacion`
- THEN each row SHALL be transformed with composite natural key `(LCNCTAPRIN, LCNNUMERO)` → `(tipo_principal, numero)`
- AND empty string `''` is a valid value for both NK components (verified: 15 of 89 projection rows have empty `LCNCTAPRIN`)
- AND `legacy_id = deterministicUuid('locacion:tipo_principal|numero')`
- AND the projection table `public."socios.locacion_projection"` is schema-qualified
- AND idempotency is guaranteed via `ON CONFLICT DO NOTHING` on the composite NK + `legacy_id UNIQUE INDEX`

#### Scenario: Caja domain promotion (cash movement header)

- GIVEN `caja` domain is being promoted
- WHEN rows are read from `public."tesoreria.caja_projection"` and written to `tesoreria.caja_movimiento`
- THEN each row SHALL be transformed with 4-tuple natural key `(CAJNUMERO, CAJSECUENC, CAJFECHA, CAJHORA)` → `(numero, secuencia, fecha, hora)`
- AND the 4-tuple NK is CRITICAL: the 3-tuple `(CAJNUMERO, CAJSECUENC, CAJFECHA)` yields only 7,957 distinct values (188 row losses), while the 4-tuple yields 8,145 distinct (100% unique, verified against live data)
- AND `legacy_id = deterministicUuid('caja:numero|secuencia|fecha|hora')` using all 4 NK components
- AND `descripcion` SHALL be mapped from `CAJDESC` (upstream alias, deferred to v1.1)
- AND the projection table `public."tesoreria.caja_projection"` is schema-qualified
- AND idempotency is guaranteed via `ON CONFLICT DO NOTHING` on the 4-tuple NK + `legacy_id UNIQUE INDEX`
- AND v1.0 scope is header-only (122 detail columns deferred to v1.1)

---

### Requirement: Environment Variables in Production

The system SHALL inject secrets via environment variables at runtime without rebuilding the Docker image.

#### Scenario: Production env var injection

- GIVEN `NODE_ENV=production`
- WHEN the API container starts
- THEN it MUST NOT look for a `.env` file
- AND all required secrets MUST be provided as environment variables by the orchestrator
- AND missing required secrets MUST cause the container to exit with code 1

#### Scenario: Updating env vars without rebuild

- GIVEN a running API container in production
- WHEN a secret value (e.g., `JWT_SECRET`) needs to be rotated
- THEN the operator MUST be able to update the secret via environment variable injection
- AND the container MUST be restarted to apply the new value
- AND no Docker image rebuild is required

#### Scenario: Non-secret configuration via .env.staging

- GIVEN `NODE_ENV=staging`
- WHEN the staging container starts
- THEN it MUST load non-secret configuration from `.env.staging`
- AND secrets MUST still be provided via environment variables

---

### Requirement: Database Migrations in Production

The system SHALL run migrations automatically on API startup and provide a mechanism for manual one-off migration execution.

#### Scenario: Automatic migration on startup

- GIVEN the API service has `RUN_MIGRATIONS=true` set
- WHEN the API starts
- THEN it MUST execute pending database migrations automatically
- AND if migrations fail, the API MUST halt with exit code 1
- AND the error MUST be logged with the migration name and error details

#### Scenario: Rollback procedure

- GIVEN a migration has been applied to production
- WHEN a rollback is required
- THEN the operator MUST redeploy the previous `athlos-api:<git-sha>` image tag (forward-only migration model per `database-migrations/spec.md` — there is NO down-migration path)
- AND the redeployment MUST be logged in the audit trail with the previous and current image tags
- AND a corrective forward-only data-fix migration MUST be authored to compensate; the previous image MUST remain redeployable as a fallback
- AND if redeploy of the previous image fails, the API MUST NOT start

#### Scenario: One-off migration execution

- GIVEN a specific migration needs to be run manually (e.g., after a manual data fix)
- WHEN the operator runs `docker compose run --rm api sh -c 'pnpm --filter @athlos/db migrate'`
- OR sets `RUN_MIGRATIONS=true` and runs `docker compose restart api`
- THEN the migration MUST execute against the production database
- AND the output MUST be logged
- AND the exit code MUST reflect success or failure

---

### Requirement: Containerized Deploy

The system SHALL be deployable as a containerized stack using a multi-stage Dockerfile plus a Docker Compose v2 stack that defines `api` and `db` services with healthchecks, environment-driven configuration via `env_file`, a non-root runtime user, and a `docker-entrypoint.sh` script that conditionally runs a pre-migration backup and then conditionally runs Drizzle migrations before `exec`-ing the API process as PID 1. Secrets SHALL be loaded from the orchestrator-provided environment (compose `env_file`) and the `dotenv/config` import SHALL be suppressed in production to comply with the "MUST NOT look for a `.env` file" requirement above.

#### Scenario: Multi-stage Dockerfile builds the API image as non-root, with tini PID-1 entrypoint

- GIVEN the `Dockerfile` at the repo root is a 2-stage build
- WHEN `docker build -t athlos-api:test .` is run
- THEN the build SHALL produce a `builder` stage (carries `node:22-alpine`, `pnpm@9.15.9` via corepack, source tree, runs `pnpm fetch` + `pnpm install --frozen-lockfile` + `pnpm build` + `pnpm deploy --filter @athlos/api --prod`)
- AND a `runtime` stage based on `node:22-alpine` SHALL copy the pruned `node_modules` and `dist` from the builder
- AND the runtime image SHALL install `tini` (for proper SIGTERM PID-1 handling) and `postgresql-client` (for `pg_dump` used by `BACKUP_BEFORE_MIGRATE`)
- AND a non-root user (UID `1001`, e.g. `athlos`) SHALL own the application files and the `docker-entrypoint.sh`
- AND the runtime image SHALL `EXPOSE 3001` (the API port)
- AND the runtime image SHALL set `ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]` (exec form)
- AND the final image size SHALL be `< 300 MB` (Alpine baseline target ~150 MB)

#### Scenario: Entrypoint runs migrations conditionally and execs the API as PID 1

- GIVEN `docker-entrypoint.sh` at the repo root is `chmod +x` and copied to `/usr/local/bin/docker-entrypoint.sh` in the runtime image
- WHEN the `api` container starts with `RUN_MIGRATIONS=true` in its env
- THEN the entrypoint SHALL source `scripts/lib/common.sh` (B1a shared helpers)
- AND SHALL wait for Postgres readiness via `pg_isready` (belt-and-suspenders for cold starts, in addition to compose `depends_on: db: condition: service_healthy`)
- AND SHALL run `pnpm --filter @athlos/db migrate` (the forward-only Drizzle migrator)
- AND on migration success SHALL `exec node dist/index.js` so the Node process becomes PID 1 and inherits SIGTERM
- AND on SIGTERM, the Node process SHALL receive SIGTERM directly (not the entrypoint shell), enabling Fastify's graceful-shutdown handler
- AND on any non-zero exit (`set -euo pipefail`), the entrypoint SHALL exit non-zero, which `docker compose` SHALL surface as a non-healthy container

#### Scenario: Entrypoint runs backup before migrations when BACKUP_BEFORE_MIGRATE=true

- GIVEN the `api` container starts with `RUN_MIGRATIONS=true` AND `BACKUP_BEFORE_MIGRATE=true` in its env
- AND `$BACKUP_DIR` is set (default `/var/backups/athlos`) and points to a writable path (host-mounted volume or named volume)
- WHEN the entrypoint begins the pre-migration sequence
- THEN the entrypoint SHALL run `scripts/backup.sh` to local `$BACKUP_DIR` (NOT to S3, NOT to any cloud object store) BEFORE running migrations
- AND the backup filename SHALL include the database name and a timestamp (e.g. `athlos-<UTC-timestamp>.sql.gz`) per the Backup Strategy requirement
- AND if the backup exits non-zero, the entrypoint SHALL exit `2` and SHALL NOT run migrations
- AND the order SHALL be observable in `docker compose logs api` (backup lines precede migration lines)

#### Scenario: docker-compose defines api+db with healthchecks, env_file, and json-file logs

- GIVEN `docker-compose.yml` at the repo root
- WHEN `docker compose up -d` is run
- THEN the file SHALL define exactly two services: `api` and `db` (the B1a/B1b `migrations` service SHALL be removed — migrations run inside the `api` entrypoint)
- AND the `db` service SHALL use `postgres:16-alpine` with a `pgdata` named volume mounted at `/var/lib/postgresql/data` and a `pg_isready` healthcheck (interval `10s`, timeout `5s`, retries `5`)
- AND the `api` service SHALL have a healthcheck hitting `/health/ready` (NOT `/health`) with `interval: 30s`, `timeout: 5s`, `retries: 5`, `start_period: 30s` (defaults per the explore decision)
- AND the `api` service SHALL declare `depends_on: db: condition: service_healthy` (not just `service_started`)
- AND both services SHALL load secrets via `env_file: .env.production` (the env file is host-mounted, NOT baked into the image)
- AND `POSTGRES_PASSWORD` SHALL be sourced from `env_file` and SHALL NOT be hardcoded in `docker-compose.yml`
- AND both services SHALL use the `json-file` logging driver with rotation `max-size: 10m, max-file: 3`
- AND `docker compose ps` SHALL show both `api` and `db` as `(healthy)` within 60s of `up -d`

#### Scenario: dotenv/config is loaded only in non-production environments

- GIVEN `apps/api/src/index.ts` originally had `import 'dotenv/config'` on line 3 (the B1a-era spec violation per the explore §6 finding)
- WHEN the code is changed in this change
- THEN `apps/api/src/index.ts` SHALL NOT load `dotenv/config` when `process.env.NODE_ENV === 'production'`
- AND SHALL load `dotenv/config` only when `process.env.NODE_ENV !== 'production'` (development, test, or unset)
- AND the API SHALL read all secrets from the compose-provided environment (`env_file: .env.production` in production, host env in dev)
- AND a vitest regression test SHALL exist at `apps/api/test/env.test.ts` that asserts the load behavior under both `NODE_ENV=production` and `NODE_ENV=development`
- AND the test SHALL be authored RED first (fails against the pre-change code) and turned GREEN by the source change, per strict TDD

---

### Requirement: Backup Strategy

The system SHALL perform automated PostgreSQL backups with defined frequency, retention, and storage location. Backups SHALL run on the HOST (not inside a compose container) via `scripts/backup.sh`, scheduled by `/etc/cron.d/athlos-backup`, and SHALL use only Ubuntu packages — no cloud SDK, no AWS CLI, no external service.

#### Scenario: Automated backup script

- GIVEN a backup script exists at `scripts/backup.sh`
- WHEN the script is executed
- THEN it MUST connect to the PostgreSQL database via `pg_dump`
- AND produce a gzip-compressed SQL dump file
- AND the filename MUST include the timestamp and database name

#### Scenario: Backup frequency

- GIVEN the backup script is configured in docker-compose or a cron job
- THEN backups MUST run at least once per day
- AND backups MUST run before any scheduled migration window

#### Scenario: Backup retention

- GIVEN backups are stored in a volume or object storage
- THEN the system MUST retain at least 7 daily backups
- AND the system MUST NOT delete backups less than 7 days old
- AND backups older than 30 days SHOULD be automatically deleted

#### Scenario: Backup storage location

- GIVEN backups are generated
- THEN they MUST be stored outside the PostgreSQL data volume
- AND they MUST be written to the local `$BACKUP_DIR` path (default `/var/backups/athlos`) — NOT to S3 and NOT to any cloud object store (S3 path was explicitly rejected by ADR #30; this is the S3→local reconciliation)
- AND they MUST be mirrored weekly to a LUKS-encrypted external USB drive per the USB Rotation requirement below
- AND `$BACKUP_DIR` MUST be a host-mounted path or named volume (e.g. `backup_data:/var/backups/athlos`) accessible to the API container so the `BACKUP_BEFORE_MIGRATE` entrypoint branch can write pre-deploy dumps
- AND the previous "SHOULD be replicated to offsite storage" language is satisfied by the USB Rotation weekly mirror (offsite = encrypted USB rotation, not cloud)

#### Scenario: backup.sh runs on host via cron, reads DATABASE_URL

- GIVEN `/etc/cron.d/athlos-backup` is installed on the host
- WHEN the daily cron entry triggers at 3 AM as the configured user (default `admin`)
- THEN `scripts/backup.sh` SHALL read `DATABASE_URL` from the environment
- AND SHALL write the dump to `$BACKUP_DIR` (also from environment, default `/var/backups/athlos`)
- AND SHALL NOT depend on any cloud SDK, AWS CLI, or external service
- AND SHALL exit non-zero on any failure so cron emails the operator

#### Scenario: backup-bats CI job runs on every PR

- GIVEN `.github/workflows/test.yml` includes a `backup-bats` job
- WHEN a pull request is opened
- THEN the job SHALL install `bats`, `shellcheck`, and `postgresql-client` via `sudo apt-get install`
- AND SHALL run `shellcheck scripts/*.sh scripts/lib/*.sh` (must be clean)
- AND SHALL run `bats scripts/tests/*.test.bats` against an ephemeral Postgres service
- AND the workflow SHALL exit non-zero if any bats test fails or any shellcheck warning is present
- AND the pull request SHALL be blocked from being merged while the job is red

---

### Requirement: USB Rotation (weekly)

The system SHALL provide weekly backup rotation to a LUKS-encrypted external USB drive. Every Sunday at 04:00 the host SHALL run `scripts/backup-to-usb.sh` as `root` (because LUKS requires root), which SHALL mount the USB via `scripts/mount-usb.sh`, mirror `$BACKUP_DIR` with `rsync -av --delete`, sweep files older than `$USB_RETENTION_DAYS` on the USB mount, and unmount via `scripts/unmount-usb.sh`. The mount step SHALL open the LUKS partition via a keyfile (`$USB_KEYFILE`) that MUST be readable only by root (mode `0600`, owner `root:root`) — defense in depth before `cryptsetup open`. Scripts SHALL use only Ubuntu packages (`cryptsetup`, `rsync`, `util-linux` for `flock`/`mount`/`umount`); no cloud SDK, no AWS CLI, no external service.

This requirement complements the **Backup Strategy** requirement (B1a, daily local backup) by adding the offsite rotation leg mandated by `5-Server-Infrastructure.md` ADR #30. The daily `backup.sh` output is the read-side source; B1b does NOT modify `backup.sh` or `restore.sh`.

#### Scenario: Weekly cron as root opens LUKS via keyfile and mirrors backups to USB

- GIVEN `/etc/cron.d/athlos-backup` contains a Sunday 04:00 entry with user `root`
- AND the LUKS keyfile at `$USB_KEYFILE` has mode `0600` and owner `root:root`
- AND the USB device at `$USB_DEVICE` (e.g. `/dev/disk/by-label/athlos-backup-usb`) is plugged in and reachable
- WHEN the cron entry triggers on Sunday at 04:00
- THEN `scripts/backup-to-usb.sh` SHALL run as `root` (EUID `0`)
- AND SHALL source `$USB_DEVICE`, `$USB_MAPPER`, `$USB_MOUNT_POINT`, `$USB_KEYFILE`, `$USB_RETENTION_DAYS` from the environment
- AND SHALL acquire `flock -n /var/lock/athlos-backup.lock` before any other action
- AND SHALL call `scripts/mount-usb.sh` which opens the LUKS partition via `cryptsetup open --key-file "$USB_KEYFILE"` and mounts the mapper to `$USB_MOUNT_POINT`
- AND SHALL run `rsync -av --delete "$BACKUP_DIR/" "$USB_MOUNT_POINT/"` to mirror the daily dumps produced by `backup.sh`
- AND SHALL run `cleanup_old_backups "$USB_MOUNT_POINT" "$USB_RETENTION_DAYS"` to delete files older than the retention window
- AND SHALL call `scripts/unmount-usb.sh` to `umount` the mapper then `cryptsetup close` it (in that order)
- AND SHALL exit `0` on success
- AND SHALL exit `2` if the USB device is not present
- AND SHALL exit `1` if the keyfile perms or owner are wrong

#### Scenario: mount-usb.sh rejects keyfile with wrong permissions before cryptsetup open

- GIVEN the LUKS keyfile at `$USB_KEYFILE` has mode != `0600` (e.g. accidentally `chmod 644`)
- WHEN `scripts/mount-usb.sh` runs
- THEN it SHALL exit `1` with a clear error message identifying the actual mode and expected mode (`600`)
- AND SHALL exit `1` with a clear error message if the owner is not `root:root`
- AND SHALL NOT call `cryptsetup open` (the check runs BEFORE the open step)
- AND the error SHALL be logged to stderr so cron can email the operator

#### Scenario: mount-usb.sh exits 2 when USB device is not present

- GIVEN the USB device at `$USB_DEVICE` does not exist (USB unplugged or not yet labeled)
- WHEN `scripts/mount-usb.sh` runs
- THEN it SHALL exit `2` with a clear error message identifying `$USB_DEVICE` as not found
- AND SHALL log the error to stderr
- AND SHALL NOT call `cryptsetup open` (no mapper exists to open)

#### Scenario: backup-to-usb.sh uses flock for concurrency safety

- GIVEN two `backup-to-usb.sh` invocations might overlap (e.g. daily backup still running when weekly fires)
- WHEN the first invocation starts
- THEN it SHALL acquire `flock -n /var/lock/athlos-backup.lock` (non-blocking)
- AND a concurrent invocation SHALL exit `0` silently (skip) without conflicting
- AND the lock file SHALL live in `/var/lock` so it is cleaned by the system on reboot
- AND the lock SHALL be released automatically when the first invocation exits (via `flock` fd-ownership semantics)

#### Scenario: unmount-usb.sh is cron-callable for emergency unmount

- GIVEN the operator (or an emergency cron entry) needs to manually unmount the USB during an incident
- WHEN `scripts/unmount-usb.sh` runs
- THEN it SHALL `umount` `$USB_MOUNT_POINT`
- AND SHALL `cryptsetup close` `$USB_MAPPER` (in that order — closing LUKS before umount corrupts the mapper)
- AND SHALL exit `0` on success
- AND SHALL be safe to call when nothing is mounted — exit `0` silently (idempotent)
- AND SHALL source `$USB_MOUNT_POINT` and `$USB_MAPPER` from the environment (no hard-coded paths)

---

### Requirement: Import Data Volume

The system SHALL mount the legacy data directory as a read-only volume for import operations.

#### Scenario: Legacy data volume mount

- GIVEN `LEGACY_DB_PATH` is set to a network share or local path
- WHEN the API container starts
- THEN the path MUST be mounted as a volume at the path specified by `LEGACY_DB_PATH`
- AND the mount MUST be read-only for the import process
- AND the volume MUST be accessible from within the container

#### Scenario: Import working directory

- GIVEN import operations require temporary working space
- WHEN an import job runs
- THEN a separate volume MUST be mounted for working files
- AND the working directory MUST be cleaned after each import job completes
- AND the working volume MUST NOT persist import artifacts between jobs

---

## Success Criteria

1. `docker build` produces a working API image without errors
2. `docker-compose up` starts all services with correct port mappings (3001, 5432)
3. Health checks report `healthy` status when API is ready
4. GitHub Actions CI pipeline runs lint, test, build, push stages on every PR
5. Main branch pushes to production with correct image tags
6. Staging branch pushes to staging environment
7. Production containers receive secrets via environment injection only
8. Rotating a secret does not require rebuilding the Docker image
9. Migrations run automatically on API startup when `RUN_MIGRATIONS=true`
10. Manual migration execution works via `docker compose run --rm api sh -c 'pnpm --filter @athlos/db migrate'`
11. Backup script produces valid gzip SQL dumps
12. Backups run daily and are retained for at least 7 days
13. `LEGACY_DB_PATH` is mounted read-only in the API container
14. Import working directory uses a separate volume
15. Weekly USB rotation runs as root via cron on Sunday 04:00 and mirrors `$BACKUP_DIR` to the LUKS-mounted USB via `rsync -av --delete`
16. `mount-usb.sh` refuses to call `cryptsetup open` if the LUKS keyfile mode is not `0600` or the owner is not `root:root`
17. `unmount-usb.sh` `umount`s before `cryptsetup close`s and is safe to call when nothing is mounted
18. `backup-to-usb.sh` uses `flock -n /var/lock/athlos-backup.lock` so overlapping invocations exit silently instead of corrupting the USB copy
19. Files on the USB older than `$USB_RETENTION_DAYS` are removed automatically after each successful rsync
20. Multi-stage `Dockerfile` builds a `< 300 MB` non-root Alpine image with `tini` PID-1 and a `docker-entrypoint.sh` exec-form entrypoint
21. `docker-entrypoint.sh` runs `pnpm --filter @athlos/db migrate` when `RUN_MIGRATIONS=true` and `exec`s the Node process as PID 1
22. `docker-entrypoint.sh` runs `scripts/backup.sh` to local `$BACKUP_DIR` (NOT S3) when `BACKUP_BEFORE_MIGRATE=true`, and exits `2` if the backup fails
23. `docker-compose.yml` defines `api` + `db` only, uses `env_file: .env.production`, `depends_on: db: condition: service_healthy`, `/health/ready` healthcheck (30s/5s/5/30s), and json-file log rotation
24. `apps/api/src/index.ts` does NOT load `dotenv/config` when `NODE_ENV=production`; verified by `apps/api/test/env.test.ts` (RED-first TDD)
25. Canonical `deployment-devops/spec.md` has zero S3 URI references (S3→local reconciliation per ADR #30) and zero references to the legacy migrations-service shape (forward-only Drizzle migrator in `api` entrypoint replaces the B1a-era placeholder `migrations` service)
26. **Slice D NEW**: `pnpm test:run` and `pnpm typecheck` and `pnpm lint` all pass inside the deploy job before any image is built or pushed (fail-fast on regressions)
27. **Slice D NEW**: `actionlint .github/workflows/deploy.yml` exits 0 and `actionlint .github/workflows/check-destructive.yml` exits 0 (workflow YAML is lint-clean)
28. **Slice D NEW**: After a successful deploy, `docker images ghcr.io/victor0451/athlos-api` on the server shows all 3 tags (`:latest`, `:vX.Y.Z` when applicable, `:main-<sha>`)
29. **Slice D NEW**: Auto-rollback restores the previous image tag on `/health/ready` failure within 60s; `/tmp/deploy-fail-<timestamp>.log` exists on the server with the failed container's logs; the workflow output logs previous and current image tags
30. **Slice D NEW**: Destructive gate fails the PR check when the `db-destructive` label is present AND migration files changed AND no `*.sql.gz` backup artifact URL is in PR comments AND no `/backup-skipped` directive is in the PR body; the `/backup-skipped` override is logged in workflow output for post-mortem audit
