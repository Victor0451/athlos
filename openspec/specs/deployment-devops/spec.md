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

#### Scenario: Domain promotion order respects FK dependencies (8 domains — E1b2b rewrite)

- GIVEN `pnpm db:promote` is executed after E1b2b lands
- WHEN domains are promoted in sequence
- THEN `socios` SHALL be promoted first (no FK dependencies; populates 39,357 rows)
- AND `escuela` SHALL be promoted second (independent FK tree — no required FK in v1.0; populates 66 rows)
- AND `deportes` SHALL be promoted third (independent FK tree — no required FK in v1.0; populates 32 rows into existing `deportes.disciplinas` table)
- AND `locacion` SHALL be promoted fourth (independent FK tree — no required FK in v1.0; populates 89 rows)
- AND `caja` SHALL be promoted fifth (independent FK tree — no required FK in v1.0; header-only in v1.0, 122 detail columns deferred; populates 8,145 rows)
- AND **`gastos` SHALL be promoted sixth (NEW in E1b2b — flat expense ledger, no FK in v1.0; populates 2,114 rows; 5-tuple natural key verified 2,114/2,114 = 100% unique)**
- AND `ctacte` SHALL be promoted seventh (depends on `socios.id`; populates 326,275 rows)
- AND `ctacte1` SHALL be promoted eighth (depends on `ctacte.id` via `cctcuenta`; populates ~138,742 rows in v1.0, partial due to N14 stale `entity_uuids`)
- AND if any domain fails AND all attempted rows failed AND the domain is in `FK_BLOCKING_DOMAINS` (socios, ctacte), dependent domains SHALL NOT be attempted
- AND the 5 NEW independent domains (escuela, deportes, locacion, caja, gastos) do NOT block each other — their failures do NOT short-circuit each other (verified: `gastos` has no FK dependency on `socios` / `ctacte` / any sibling)

> **E1b1 (v0.5.2/v0.5.3) UPDATE (2026-06-24).** ctacte1 is wired. Migration 0013 added `cctcuenta` to `tesoreria.ctacte` + backfilled best-effort. Migration 0014 added `legacy_id text` + `UNIQUE INDEX` on `tesoreria.ctacte.legacy_id` and `tesoreria.ctacte1.legacy_id`. Cross-run idempotency works: re-running `pnpm db:promote` is a no-op (0 new inserts) via dedup pre-check + ON CONFLICT DO NOTHING.
>
> **E1b2a (v0.5.4) UPDATE (2026-06-25).** 4 NEW domains wired: escuela, deportes, locacion, caja. Migration 0014 (E1b2a) creates `socios.escuela` (per-school master, NO socio_id FK), adds `legacy_id` to `deportes.disciplinas` (table already existed), creates `socios.locacion` (per-socio address), and creates `tesoreria.caja_movimiento` (cash movement header with 4-tuple NK). Scope corrections: (C1) escuela is per-school master with NO `socio_id` FK — verified 0 of 66 projection rows have SOCNUMERO/SOCCARNET fields; (C3) caja NK is 4-tuple `(CAJNUMERO, CAJSECUENC, CAJFECHA, CAJHORA)` — the 3-tuple yields 7,957 distinct = 188 silent row losses, 4-tuple yields 8,145 distinct = 100% unique.
>
> **E1b2b (v0.5.5) UPDATE (2026-06-25) — FINAL SLICE E SYNC.** 8th domain wired: gastos. Migration `0015_gastos.sql` creates `tesoreria.gastos` (flat expense ledger, NO socio_id FK, NO ctacte FK in v1) + adds `legacy_id` column + 3 UNIQUE INDEXes (legacy_id, 5-tuple composite, cuenta+fecha) + 2 secondary INDEXes. Scope corrections: (C2) `gastos` NK is 5-tuple `(GASTIPGAST, GASCTAPRIN, GASSECUENC, GASFECHA, GASCOMPROB)` — the 3-tuple yields 346 distinct (84% duplicates → silent loss of 1,768 rows), 5-tuple yields 2,114 distinct = 100% unique; (C7) `gastos` has NO ctacte FK — verified 0 of 165 distinct `GASCTAPRIN` match any `tesoreria.ctacte.cctcuenta` (GASCTAPRIN is accounting-plan code, e.g., `1111001`, `6001015`); (C8) `gastos` has NO `socio_id` FK in v1 — no `GASNUMSOC` / `SOCNUMERO` / `SOCCARNET` field in the 11-field payload, `socio_id` column exists (nullable, FK constraint deferred to N16) for future backfill.

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

#### Scenario: Gastos domain promotion (flat expense ledger — NEW in E1b2b)

- GIVEN `gastos` domain is being promoted
- WHEN rows are read from `public."tesoreria.gastos_projection"` and written to `tesoreria.gastos`
- THEN each row SHALL be transformed with **5-tuple natural key** `(GASTIPGAST, GASCTAPRIN, GASSECUENC, GASFECHA, GASCOMPROB)` → `(tipo, cuenta, secuencia, fecha, comprob)`
- AND the 5-tuple NK is CRITICAL: the 3-tuple `(GASTIPGAST, GASCTAPRIN, GASSECUENC)` yields only **346 distinct** values (84% duplicates → silent loss of 1,768 rows via `legacy_id` UNIQUE collision), while the **5-tuple yields 2,114 distinct = 100% unique** (verified against live data 2026-06-25)
- AND `legacy_id = deterministicUuid('gastos:tipo|cuenta|secuencia|stadium|comprob')` using all 5 NK components
- AND `importe` SHALL be mapped from `GASIMPORTE` (NUMERIC(14,2), values 0.01..3000, no negatives)
- AND `iva` SHALL be mapped from `GASIVA` (NUMERIC(14,2), mostly 0; default `'0.00'`)
- AND `ingreso_bruto` SHALL be mapped from `GASINGBRUT` (20-character accounting-grid debit string; stored as `text`, NOT numeric)
- AND `concepto` SHALL be mapped from `GASCONCEPT` (free text — operator description; fallback `'(sin concepto)'` if empty)
- AND `tipo_cuenta` SHALL be mapped from `GASTIPCTA` (sentinel 0 for all 2,114 rows; nullable)
- AND `cuenta_auxiliar` SHALL be mapped from `GASCTAAUXI` (sentinel for most rows; nullable)
- AND **there is NO `socio_id` FK constraint** in `tesoreria.gastos` (column exists as nullable `uuid`, FK constraint deferred to N16 — verified live: 0 of 2,114 projection rows have `GASNUMSOC` / `SOCNUMERO` / `SOCCARNET` field; scope correction #C8)
- AND **there is NO `ctacte` FK constraint** in `tesoreria.gastos` (verified live: 0 of 165 distinct `GASCTAPRIN` match any `tesoreria.ctacte.cctcuenta`; `GASCTAPRIN` is accounting-plan code, NOT socio carnet; scope correction #C7)
- AND the projection table `public."tesoreria.gastos_projection"` is schema-qualified
- AND idempotency is guaranteed via `ON CONFLICT DO NOTHING` on the 5-tuple NK (`gastos_5tuple_unique` UNIQUE INDEX) + `gastos_legacy_id_unique` UNIQUE INDEX — defense in depth (3 layers: dedup pre-check → 5-tuple UNIQUE → legacy_id UNIQUE)
- AND `errors[]` SHALL be empty (no FK failures possible — flat ledger)

---

### Requirement: tesoreria.gastos master table (NEW in E1b2b)

The system SHALL provide a `tesoreria.gastos` master table as a flat accounting expense ledger populated from `public."tesoreria.gastos_projection"` via the `gastos` promotion domain. The table SHALL store per-row expense entries (VFP GAS* fields) with a 5-tuple natural key encoded as `legacy_id`, and SHALL have NO foreign key constraints to `socios.socios` or `tesoreria.ctacte` in v1 (flat-ledger scope per corrections #C7 and #C8).

The migration creating this table (`packages/db/drizzle/0015_gastos.sql`) SHALL be hand-written SQL (NOT drizzle-kit generated, per E1b1 LESSON re: `_journal.json` tracking mismatch with hand-written SQL), SHALL be idempotent (`CREATE TABLE IF NOT EXISTS` + `CREATE UNIQUE INDEX IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`), and SHALL be applied via `psql` against the target database. The migration SHALL create 1 NEW table + 3 UNIQUE INDEXes (`legacy_id`, 5-tuple composite, `cuenta+fecha` lookup) + 2 secondary INDEXes (`cuenta+fecha`, `socio_id` partial).

#### Scenario: gastos master table created via migration 0015

- GIVEN migration `0015_gastos.sql` has NOT been applied yet
- WHEN `PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -f packages/db/drizzle/0015_gastos.sql` is executed
- THEN the `tesoreria.gastos` table SHALL be created with 15 columns: `id` (uuid PK), `tipo` (int NOT NULL), `tipo_cuenta` (int NOT NULL), `cuenta_principal` (text NOT NULL), `cuenta_auxiliar` (int nullable), `secuencia` (int NOT NULL DEFAULT 0), `fecha` (date NOT NULL), `comprobante` (text NOT NULL DEFAULT ''), `concepto` (text nullable), `importe` (text NOT NULL DEFAULT '0.00'), `iva` (text DEFAULT '0.00' NOT NULL), `ingreso_bruto` (text nullable), `socio_id` (uuid nullable, NO FK constraint), `legacy_id` (text nullable), `created_at` (timestamptz NOT NULL DEFAULT now())
- AND 3 UNIQUE INDEXes SHALL be created: `gastos_legacy_id_unique` (on `legacy_id`), `gastos_5tuple_unique` (on `(tipo, cuenta_principal, secuencia, fecha, comprobante)`), `gastos_cuenta_fecha_idx` (on `(cuenta_principal, fecha)`)
- AND 1 partial INDEX SHALL be created: `gastos_socio_id_idx` on `socio_id` WHERE `socio_id IS NOT NULL`
- AND running the same SQL twice SHALL be a no-op (idempotent — `IF NOT EXISTS` guards)
- AND `\d tesoreria.gastos` SHALL show NO foreign key constraints (flat ledger)

#### Scenario: gastos promotion populates master table with 5-tuple NK

- GIVEN migration `0015_gastos.sql` has been applied and `tesoreria.gastos` table is empty
- AND `public."tesoreria.gastos_projection"` contains 2,114 rows
- WHEN `pnpm db:promote` runs the `gastos` domain (6th in PROMOTION_ORDER)
- THEN ~2,114 rows SHALL be inserted into `tesoreria.gastos` (1:1 with projection — no FK failures possible)
- AND `legacy_id` SHALL be a deterministic UUID5 from the 5-tuple `(GASTIPGAST, GASCTAPRIN, GASSECUENC, GASFECHA, GASCOMPROB)` via `deterministicUuid('gastos:tipo|cuenta|secuencia|fecha|comprob')`
- AND `SELECT count(DISTINCT legacy_id) FROM tesoreria.gastos` SHALL return 2,114 (100% unique — 5-tuple NK verified live)
- AND `SELECT count(*) FROM tesoreria.gastos WHERE socio_id IS NOT NULL` SHALL return 0 (no source field; per scope correction #C8)
- AND `errors[]` SHALL be empty (no FK failures possible)
- AND `pnpm db:promote` SHALL exit 0 on success

#### Scenario: gastos re-promotion is idempotent (no new inserts on 2nd/3rd run)

- GIVEN `pnpm db:promote` has been run once and `tesoreria.gastos` contains 2,114 rows
- WHEN `pnpm db:promote` is run a 2nd time
- THEN `gastos` SHALL appear in the per-domain output with `{domain: 'gastos', attempted: 2114, inserted: 0, skipped: 2114, failed: 0, errors: []}`
- AND `SELECT count(*) FROM tesoreria.gastos` SHALL STILL be 2,114 (no new rows; dedup pre-check + 5-tuple UNIQUE INDEX + legacy_id UNIQUE INDEX catch duplicates)
- AND `bash scripts/verify-slice.sh` SHALL exit 0 (TRUE idempotency verified)

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
47. **E1b2b NEW**: `pnpm db:promote` against the test DB (`192.168.1.102:5432/athlos`) populates `tesoreria.gastos` with exactly **2,114 rows**; the CLI stdout shows `{domain: 'gastos', inserted: 2114, skipped: 0, failed: 0, errors: []}` in the per-domain JSON output. The row count of 2,114 (NOT 346) verifies the 5-tuple NK is correctly applied (per scope correction #C2; 3-tuple would yield 346 distinct via `legacy_id` UNIQUE collision).
48. **E1b2b NEW**: `bash scripts/verify-slice.sh` exits 0 (PASS) after E1b2b lands — promotion works for all **8 domains** + TRUE idempotency verified on 2nd run (0 new inserts across all 8 master tables). `scripts/verify-slice.sh` already includes `tesoreria.gastos` in `MASTER_TABLES` (updated in commit `061be50`).

---

## E2 Delta: Slice E Closure (Admin API + Per-row Audit + Runbook)

> **ADDITIVE-ONLY ATOMIC SPEC SYNC (B1b LESSON #1, CRITICAL — closes Slice E permanently).** This delta adds 3 NEW requirements below. No existing requirement is modified, removed, or rewritten. The diff between this delta and the prior canonical spec SHALL be purely additive.

---

### Requirement: Admin Promotion Trigger (NEW in E2)

The system SHALL provide a `POST /api/v1/promote/trigger` HTTP endpoint on the Fastify v5.2.0 API server that allows an authenticated operator with the `ADMIN` role to trigger a synchronous promotion run from the API surface (mirroring the existing `pnpm db:promote` CLI runner) without SSHing into the server. The endpoint SHALL be per-operator rate-limited to 1 request per 60 seconds via `@fastify/rate-limit`'s `keyGenerator` extracting the JWT operator subject (`request.operator.sub`). The endpoint SHALL emit exactly 1 `audit_events` row per successful trigger with `action: 'PROMOTE_TRIGGER'`, and SHALL guard against concurrent triggers via an in-memory `promotionInFlight` boolean flag on the `AppContainer` (auto-released in `finally`). The response body SHALL be JSON with `{ status, inserted, skipped, failed, durationMs, domains: PromotionResult[] }` and HTTP status 200 on completion.

The endpoint SHALL be implemented in a new file `apps/api/src/routes/promote.ts` (~150 LoC), registered in `apps/api/src/server.ts` alongside `importRoutes`, and exposed via the `FastifyPluginCallback` pattern matching the existing import routes. The endpoint SHALL accept a request body `{ domain?: 'all' | Domain }` (default `'all'`) validated by a `zod` schema. The request SHALL have a 120-second timeout via `request.routeOptions.config.timeout = 120_000` to avoid NGINX `proxy_read_timeout 60s` mid-flight cut for full `domain: 'all'` promotions (~60-90s on live DB). The route SHALL also expose `GET /api/v1/promote/status` (ADMIN-only) returning the last 20 promotion runs read from `audit_events` where `action = 'PROMOTE_TRIGGER'`.

#### Scenario: Admin trigger succeeds (sync HTTP, returns 200)

- GIVEN the API server is running and connected to `192.168.1.102:5432/athlos`
- AND an operator with `role: 'ADMIN'` is authenticated via JWT
- WHEN the operator POSTs `/api/v1/promote/trigger` with body `{}` (defaults to `domain: 'all'`)
- THEN the API SHALL call `promoteAll(container.db)` synchronously
- AND the response HTTP status SHALL be 200
- AND the response body SHALL be `{ status: 'completed' | 'failed', inserted: number, skipped: number, failed: number, durationMs: number, domains: PromotionResult[] }`
- AND on a re-run after E1b2b (8 domains fully populated): `inserted` SHALL be 0 across all 8 domains (idempotent), `skipped` SHALL match the projected rows count (~613k total), and `failed` SHALL match the documented FK failures
- AND exactly 1 `audit_events` row SHALL be inserted with `action: 'PROMOTE_TRIGGER'`, `entity_type: 'promotion'`, `entity_id: 'promotion-<timestamp>'`, and `new_value: { domain: 'all', totals, durationMs }`

#### Scenario: Admin trigger rate-limited (returns 429)

- GIVEN an ADMIN operator just triggered `POST /api/v1/promote/trigger` 10 seconds ago
- WHEN they POST `/api/v1/promote/trigger` again
- THEN the API SHALL return HTTP 429 (Too Many Requests)
- AND the response SHALL include a `Retry-After` header indicating seconds until the window resets

#### Scenario: Non-admin operator blocked (returns 403)

- GIVEN an operator with `role: 'CONSULTA'` (NOT ADMIN) is authenticated via JWT
- WHEN they POST `/api/v1/promote/trigger`
- THEN the API SHALL return HTTP 403 (Forbidden) via `requireRole('ADMIN')` middleware

#### Scenario: Unauthenticated request blocked (returns 401)

- GIVEN no JWT is present in the `Authorization` header
- WHEN a request is made to `POST /api/v1/promote/trigger`
- THEN the API SHALL return HTTP 401 (Unauthorized) via `requireRole('ADMIN')` middleware chain

#### Scenario: Concurrent trigger returns `already_running`

- GIVEN `container.promotionInFlight` is `true` (a promotion is already executing from a previous trigger)
- WHEN a second ADMIN operator POSTs `/api/v1/promote/trigger`
- THEN the API SHALL return HTTP 200
- AND the response body SHALL be `{ status: 'already_running' }`
- AND the second promotion SHALL NOT execute

#### Scenario: `GET /api/v1/promote/status` returns last 20 promotion runs

- GIVEN an ADMIN operator is authenticated
- WHEN they GET `/api/v1/promote/status`
- THEN the API SHALL return HTTP 200
- AND the response body SHALL be `{ runs: AuditEvent[] }` containing the last 20 `audit_events` rows where `action = 'PROMOTE_TRIGGER'`, ordered by `created_at DESC`

---

### Requirement: Per-row Promotion Audit (`promoted_at` column) (NEW in E2)

The system SHALL provide a `raw_events.promoted_at timestamp with time zone` column for per-row promotion tracking at the source-event level (belt-and-suspenders with the `master.legacy_id` UNIQUE INDEX). The column SHALL be added via a new hand-written migration `packages/db/drizzle/0016_promoted_at.sql` applied via `psql` (NOT `drizzle-kit migrate` — per E1b1 LESSON re: `_journal.json` tracking mismatch). The migration SHALL also create an index `idx_raw_events_promoted_at` on `(promoted_at)` for fast `WHERE promoted_at IS NULL` queries, and SHALL include a best-effort backfill UPDATE for the `socios` source_table.

The promotion algorithm (`packages/promotion/src/promote.ts`) SHALL filter the projection scan by `WHERE raw_events.promoted_at IS NULL` via JOIN `(source_table, source_key)`, and SHALL bulk-update `raw_events.promoted_at = now()` for all successfully inserted `(source_table, source_key)` pairs after `insertMasterBatch` completes for the domain.

#### Scenario: Migration 0016 adds `promoted_at` column + INDEX (idempotent)

- GIVEN the test DB `192.168.1.102:5432/athlos` is running and `raw_events` has 652,661 rows
- WHEN `PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -f packages/db/drizzle/0016_promoted_at.sql` is executed
- THEN the migration SHALL add column `promoted_at timestamptz` to `public.raw_events` (nullable, no default)
- AND the migration SHALL create index `idx_raw_events_promoted_at` on `public.raw_events(promoted_at)`
- AND running the same SQL twice SHALL be a no-op (`ADD COLUMN IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` guards)

#### Scenario: `socios` backfill marks ~16,383 raw_events rows as promoted

- GIVEN migration 0016 has just been applied and `raw_events.promoted_at` is NULL for all rows
- WHEN the best-effort backfill UPDATE runs
- THEN approximately **16,383** `raw_events` rows SHALL be backfilled with `promoted_at = <migration timestamp>` (the count of `socios.socios` master rows verified live)
- AND ctacte/ctacte1 raw_events rows SHALL remain `promoted_at IS NULL` post-backfill (TODO E3+)

#### Scenario: `promote.ts` filters projection by `WHERE raw_events.promoted_at IS NULL`

- GIVEN some `raw_events` rows have `promoted_at IS NULL` (unpromoted) and some have `promoted_at IS NOT NULL` (already promoted)
- WHEN `promoteDomain(db, $domain)` runs against a projection table
- THEN the projection scan query SHALL include a JOIN clause filtering by `re.promoted_at IS NULL`
- AND only rows whose corresponding `raw_events` row has `promoted_at IS NULL` SHALL be considered for promotion

#### Scenario: Successful INSERT stamps `promoted_at = now()` (bulk UPDATE)

- GIVEN `promoteDomain` has just successfully inserted a batch of N rows into the master table
- WHEN `insertMasterBatch` returns
- THEN the handler SHALL execute a bulk UPDATE: `UPDATE public.raw_events SET promoted_at = now() WHERE source_table = $domain AND source_key = ANY($insertedKeys::varchar[])`

#### Scenario: Per-row audit query surfaces promotion status

- GIVEN the operator wants to inspect promotion coverage
- WHEN they run `SELECT source_table, count(*) AS total, count(promoted_at) AS promoted FROM public.raw_events GROUP BY source_table ORDER BY source_table;`
- THEN the result SHALL show per-source_table totals + promoted counts

---

### Requirement: Runbook Documentation (NEW in E2)

The system SHALL provide operator-facing documentation in `docs/runbook.md` under a NEW top-level section "Promotion Pipeline" (placed between "Containerized Deploy" and "CI/CD"). The section SHALL explain how to trigger a promotion (CLI vs API), document the 8 master tables + their natural keys + `legacy_id` pattern, describe the `promoted_at` audit column semantics, document the cross-run idempotency contract, detail the admin API `POST /promote/trigger` endpoint, and document known limitations (N7/N8/N14/N16).

#### Scenario: Runbook has "Promotion Pipeline" section with CLI + API examples

- GIVEN the runbook has the new "Promotion Pipeline" section
- WHEN an operator reads the "How to run promotion (CLI vs API)" sub-section
- THEN they SHALL see the CLI example: `DATABASE_URL=... pnpm db:promote`
- AND they SHALL see the API example: `curl -X POST http://localhost:3001/api/v1/promote/trigger -H "Authorization: Bearer $ADMIN_JWT" -H "Content-Type: application/json" -d '{}'`
- AND they SHALL see the verification command: `bash scripts/verify-slice.sh`

#### Scenario: Runbook documents the 8 master tables + their natural keys

- GIVEN the runbook has the "8 master tables + natural keys" sub-section
- THEN they SHALL see a table mapping each `Domain` to its master table + natural key + `legacy_id` source
- AND they SHALL see the `PROMOTION_ORDER` sequence: `socios → escuela → deportes → locacion → caja → gastos → ctacte → ctacte1`

#### Scenario: Runbook documents known limitations

- GIVEN the runbook has the "Known Limitations" sub-section
- THEN they SHALL see a table documenting N7 (caja_detalle), N8 (deportes.inscripciones rebuild), N14 (stale `entity_uuids` → ctacte1 promotion rate stuck at ~61%), N16 (gastos FK to ctacte)
- AND each limitation SHALL include a "Future slice" column

---

## Success Criteria (E2 additions)

49. **E2 NEW**: `POST /api/v1/promote/trigger` (ADMIN JWT) returns 200 with `{ status: 'completed', inserted, skipped, failed, durationMs, domains: PromotionResult[] }` after running `promoteAll(db)` synchronously. On a re-run after E1b2b, `inserted` SHALL be 0 across all 8 domains (idempotent).
50. **E2 NEW**: `SELECT count(*) FROM public.raw_events WHERE promoted_at IS NOT NULL` returns **~16,383** post-migration (the `socios` backfill count). ctacte/ctacte1 remain 0 (TODO E3+).
51. **E2 NEW**: `bash scripts/verify-slice.sh` exits 0 (PASS) — promotion works + TRUE idempotency verified on 2nd run (0 new inserts across all 8 master tables).

---

## E3 Delta: Slice E3 (N14 Closure — raw_events.legacy_id + ctacte/ctacte1 Direct Path)

> **ADDITIVE-ONLY ATOMIC SPEC SYNC (B1b LESSON #1).** This delta adds 2 NEW requirements below. No existing requirement is modified, removed, or rewritten. Closes limitation N14 (stale ctacte1 `entity_uuids` limiting promotion to ~61%) by computing `legacy_id` at the source-event level so promotion no longer depends on the deprecated `entity_uuids` table.

---

### Requirement: raw_events.legacy_id + SQL Hash Parity (NEW in E3)

The system SHALL provide a `public.raw_events.legacy_id text` column (computed by a SQL `promotion_deterministic_uuid()` function) for source-event-level deduplication of `ctacte` and `ctacte1` domains. The function SHALL mirror `packages/promotion/src/transform-helpers.ts::deterministicUuid()` byte-for-byte (SHA-256 + UUIDv5 version=5 nibble + variant=10 bits + UUID formatting per RFC 4122 §4.3), with hash parity verified by `packages/promotion/src/__tests__/uuid-parity.test.ts` (5 known inputs covering edge cases: 0-CCTCUENTA sentinel, real socio 5343, ctacte1 pagonro 179440, all-zero edge case, future date + max values). The partial UNIQUE INDEX `raw_events_legacy_id_unique` (`WHERE legacy_id IS NOT NULL`) accommodates domains that don't have a natural key (asiento, paramet, plancue, etc.).

The column SHALL be added via a new hand-written migration `packages/db/drizzle/0017_raw_events_legacy_id.sql` (creates `pgcrypto` extension + `promotion_deterministic_uuid()` SQL function + `legacy_id` column + partial UNIQUE INDEX). The column SHALL be backfilled via migration `packages/db/drizzle/0018_raw_events_legacy_id_backfill.sql` using a `ROW_NUMBER() OVER (PARTITION BY <5-tuple> ORDER BY imported_at ASC)` CTE that assigns `legacy_id` to **only ONE row per unique natural key** (subsequent duplicates get NULL legacy_id — "shadow rows" blocked by UNIQUE INDEX). Both migrations are applied via `psql` (NOT drizzle-kit per E1b1 LESSON) and are idempotent (`CREATE EXTENSION IF NOT EXISTS`, `ALTER TABLE ADD COLUMN IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS`).

#### Scenario: Migration 0017 adds `legacy_id` column + SQL function (idempotent)

- GIVEN the test DB `192.168.1.102:5432/athlos` is running with pgcrypto AVAILABLE
- WHEN `PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -f packages/db/drizzle/0017_raw_events_legacy_id.sql` is executed
- THEN `pgcrypto` extension SHALL be created (`CREATE EXTENSION IF NOT EXISTS`)
- AND `promotion_deterministic_uuid(text)` SQL function SHALL be created (SHA-256 + UUIDv5-like formatting)
- AND column `legacy_id text` SHALL be added to `public.raw_events` (nullable, no default)
- AND partial UNIQUE INDEX `raw_events_legacy_id_unique` SHALL be created (`WHERE legacy_id IS NOT NULL`)
- AND running the same SQL twice SHALL be a no-op (`IF NOT EXISTS` guards)

#### Scenario: Hash parity test passes BEFORE migration 0018 is applied

- GIVEN migration 0017 has been applied (so the SQL function exists in DB)
- WHEN `pnpm --filter @athlos/promotion test:run packages/promotion/src/__tests__/uuid-parity.test.ts` is executed
- THEN for each of the 5 known input natural keys, TypeScript `deterministicUuid()` and PostgreSQL `promotion_deterministic_uuid()` SHALL produce byte-for-byte identical UUIDs
- AND the test SHALL fail loudly (with the 5 mismatched pairs listed) if parity breaks
- AND migration 0018 MUST NOT be applied if parity fails — a mismatch would silently corrupt cross-run idempotency for ~571k rows

#### Scenario: Migration 0018 backfills ~426k rows (deduplicated 5-tuple)

- GIVEN migration 0017 has been applied and hash parity has been verified
- WHEN `PGPASSWORD=athlos psql -h 192.168.1.102 -U athlos -d athlos -f packages/db/drizzle/0018_raw_events_legacy_id_backfill.sql` is executed
- THEN ~256,088 ctacte raw_events rows SHALL get a non-NULL `legacy_id` (the count of unique 5-tuples; ~70,187 duplicates get NULL due to UNIQUE INDEX — one legacy_id per unique natural key)
- AND ~170,281 ctacte1 raw_events rows SHALL get a non-NULL `legacy_id` (~75,089 duplicates get NULL)
- AND total non-NULL `legacy_id` rows across ctacte+ctacte1 SHALL be **≥ 426,000** (the verifiable backfill floor)
- AND the migration SHALL be idempotent (`WHERE legacy_id IS NULL` guards)

---

### Requirement: ctacte/ctacte1 Direct-From-raw_events Promotion Path (NEW in E3)

The system SHALL provide a NEW branch in `promoteDomain()` (for `domain === 'ctacte' || domain === 'ctacte1'`) that reads DIRECTLY from `public.raw_events` (NOT from `*_projection` tables) using `legacy_id` as the dedup key. This branch bypasses the projection layer because the `ctacte` and `ctacte1` projection tables are EMPTY for these domains (verified: `source_key` is degenerate — 1 distinct value for all 245k ctacte1 rows). The branch SHALL build a `legacyId → rawEventId` map from the buffered master rows + their raw_events source IDs, and SHALL correlate `insertMasterBatch` returned rows back to `raw_events.id` via the map (precision fix — the E2 source_key-based correlation silently over-stamped promoted_at when `ON CONFLICT DO NOTHING` skipped rows within a batch).

The transform `packages/promotion/src/transforms/ctacte.ts` SHALL compute `legacy_id = deterministicUuid(<5-tuple>)` using **the RAW payload value of `CCTFECHA`** (NOT the parsed `fecha` date) — the parsed value is `'YYYY-MM-DD'` but the SQL `promotion_deterministic_uuid()` uses the raw ISO `'YYYY-MM-DDT00:00:00.000Z'`. Hash mismatch was the original Bug 2 that silently produced zero overlap between TypeScript and SQL hashes.

`insertMasterBatch` SHALL be extended (for ctacte + ctacte1 only) to return `{ id, legacyId }` so the flush correlation can look up the corresponding `raw_events.id` via the `legacyId → rawEventId` map. After successful insertion, the branch SHALL execute a bulk UPDATE: `UPDATE public.raw_events SET promoted_at = now() WHERE id = ANY(${insertedRawEventIds}::uuid[])` (precision fix — was a no-op due to missing `legacyId` return in the previous implementation).

#### Scenario: ctacte/ctacte1 promotion reads from raw_events directly (bypass projection)

- GIVEN the ctacte/ctacte1 projection tables are EMPTY (verified live 2026-06-25)
- WHEN `promoteDomain(db, 'ctacte')` runs
- THEN the projection-table scan branch SHALL be skipped
- AND the raw_events-direct branch SHALL execute: `SELECT id, source_key, payload, legacy_id FROM public.raw_events WHERE source_table = 'ctacte' AND legacy_id IS NOT NULL AND promoted_at IS NULL`
- AND rows in `tesoreria.ctacte` master SHALL be inserted with `legacy_id` matching `raw_events.legacy_id` (byte-for-byte)

#### Scenario: ctacte/ctacte1 promotion rate reaches ≥62% post-E3

- GIVEN the DB state pre-E3 had `tesoreria.ctacte` at 197,521 rows (~61% of natural keys) and `tesoreria.ctacte1` at 150,129 rows (~61%)
- AND ~70,187 ctacte + ~75,089 ctacte1 raw_events rows are duplicates (5-tuple collision, get NULL legacy_id) and CANNOT be promoted
- AND ~55,143 ctacte rows are orphaned (`CCTCUENTA=0` sentinel or socio not in master) and fail FK check
- AND ~17,484 ctacte1 rows are orphaned (parent ctacte missing — typically CCTCUENTA=0) and fail FK check
- WHEN `pnpm db:promote` runs post-E3 against the test DB
- THEN `tesoreria.ctacte` SHALL reach ~200,945 rows (~78% of 256,088 unique natural keys; limited by 55k orphan FK failures)
- AND `tesoreria.ctacte1` SHALL reach ~152,797 rows (~62.3% of 245,370 total raw_events rows; limited by 17k parent ctacte FK failures + 75k duplicates)
- AND `scripts/verify-slice.sh` Step 7 SHALL assert `ctacte1 promotion rate >= 62%` (PASS)

#### Scenario: ctacte/ctacte1 idempotency holds (2nd run = 0 inserts)

- GIVEN `pnpm db:promote` has been run once post-E3 and `tesoreria.ctacte` = 200,945 + `tesoreria.ctacte1` = 152,797
- WHEN `pnpm db:promote` runs a 2nd time
- THEN both domains SHALL appear in per-domain output with `inserted: 0`
- AND `tesoreria.ctacte` count SHALL STILL be 200,945 (no new rows; raw_events.promoted_at is fully stamped for all 200,945 ctacte raw_events)
- AND `tesoreria.ctacte1` count SHALL STILL be 152,797 (no new rows; raw_events.promoted_at is fully stamped for all 152,797 ctacte1 raw_events)
- AND `scripts/verify-slice.sh` SHALL exit 0 (TRUE idempotency verified across all 8 master tables)

#### Scenario: `promoted_at` audit is precise for ctacte/ctacte1 (E3 fix)

- GIVEN ctacte/ctacte1 promotion has completed
- WHEN the operator queries `SELECT source_table, count(*) AS total, count(promoted_at) AS promoted FROM public.raw_events WHERE source_table IN ('ctacte','ctacte1') GROUP BY source_table ORDER BY source_table`
- THEN ctacte promoted SHALL be `200,945` (= tesoreria.ctacte count)
- AND ctacte1 promoted SHALL be `152,797` (= tesoreria.ctacte1 count)
- AND the ratio promoted/total for each domain SHALL be exactly the same as master.count / raw_events.total_with_legacy_id (no over-stamping, no under-stamping)

---

## Success Criteria (E3 additions)

52. **E3 NEW**: `pnpm --filter @athlos/promotion test:run packages/promotion/src/__tests__/uuid-parity.test.ts` PASSES — TypeScript `deterministicUuid()` equals PostgreSQL `promotion_deterministic_uuid()` byte-for-byte for all 5 known inputs.
53. **E3 NEW**: `SELECT count(*) FROM public.raw_events WHERE source_table IN ('ctacte','ctacte1') AND legacy_id IS NOT NULL` returns **≥ 426,000** (the 426,369 verifiable backfill floor; 256,088 ctacte + 170,281 ctacte1 unique natural keys).
54. **E3 NEW**: `tesoreria.ctacte` master has **≥ 200,000 rows** post-promotion (was 197,521 pre-E3; +55,143 attempted - 55,143 FK failures = no net change in headcount, but with corrected legacy_id hashes). Realistic ceiling is ~200,945 (= 78% of unique natural keys, FK-limited).
55. **E3 NEW**: `tesoreria.ctacte1` master has **≥ 152,000 rows** post-promotion (was 150,129 pre-E3). Realistic ceiling is ~152,797 (= 62.3% of 245,370 total raw_events rows; limited by 17k parent ctacte FK failures + 75k duplicates).
56. **E3 NEW**: `SELECT count(*) FROM public.raw_events WHERE source_table IN ('ctacte','ctacte1') AND promoted_at IS NOT NULL` matches `SELECT sum(c) FROM (SELECT count(*) c FROM tesoreria.ctacte UNION ALL SELECT count(*) FROM tesoreria.ctacte1)` exactly — no over-stamping, no under-stamping (precision fix via legacyId→rawEventId map correlation).
57. **E3 NEW**: `bash scripts/verify-slice.sh` exits 0 (PASS) post-E3 — promotion works + TRUE idempotency verified on 2nd run (0 new inserts across all 8 master tables) + N14 closure verified (Step 7: legacy_id coverage ≥ 426k + ctacte1 promotion rate ≥ 62%, FK-limited).
58. **E3 NEW**: `docs/runbook.md` Known Limitations table no longer lists N14 (CLOSE — ctacte/ctacte1 now promote to ~62% via direct-from-raw_events path; remaining 38% is FK-blocked orphan rows + duplicates, both not addressable in MVP).

---

## E-Future Delta: Slice athlos-async-scheduler (Scheduled Promotion + Admin Endpoints)

> **ADDITIVE-ONLY ATOMIC SPEC SYNC (B1b LESSON #1).** This delta adds 1 NEW requirement below. No existing requirement is modified, removed, or rewritten. Closes the deferred async-promotion scope from E2 (sync-only) by adding a scheduled cron trigger + 3 admin endpoints for operator control.

---

### Requirement: Scheduled Promotion (NEW in athlos-async-scheduler)

The system SHALL run `promoteAll(db)` automatically every 6 hours via the in-process `@athlos/scheduler` (node-cron + DB-persisted `job_runs` + retry + dead-letter). The schedule SHALL be configurable via the `PROMOTION_CRON` environment variable (default `0 */6 * * *`, UTC timezone — node-cron default). The scheduler worker SHALL be started at API server startup. The slice also adds 3 admin endpoints under `/api/v1/scheduler/jobs` for operator-controlled manual trigger, status read, and enable/disable of registered jobs.

#### Scenario: scheduled promotion runs every 6 hours via PROMOTION_CRON

- GIVEN `PROMOTION_CRON=0 */6 * * *` is set in the API container env
- AND `@athlos/scheduler` is started in `apps/api/src/server.ts` after `buildScheduler(...)` returns
- WHEN the cron expression triggers (every 6h at minute 0)
- THEN the `scheduled-promotion` JobHandler SHALL execute
- AND it SHALL call `promoteAll(container.db)` synchronously inside the handler
- AND the result SHALL be persisted to `job_runs` with `status='succeeded' | 'failed'`
- AND 1 `audit_events` row SHALL be inserted with `action: 'PROMOTE_TRIGGER'`

#### Scenario: PROMOTION_CRON env var defaults to `0 */6 * * *` if unset

- GIVEN `PROMOTION_CRON` is NOT set in the API container env
- WHEN the API boots and `@athlos/config` parses `envSchema`
- THEN `env.PROMOTION_CRON` SHALL default to the string `'0 */6 * * *'`
- AND `validateCronExpression(env.PROMOTION_CRON)` SHALL pass at boot
- AND the scheduler SHALL register `scheduled-promotion` with that cron

#### Scenario: scheduler worker starts at API server startup

- GIVEN the API container starts and `apps/api/src/server.ts` boots
- WHEN `buildScheduler(...)` returns AND `app.listen()` is called
- THEN `app.scheduler.start()` SHALL have been called (registers all node-cron tasks)
- AND `GET /api/v1/admin/jobs/health` SHALL include `scheduled-promotion` with `scheduled: true`
- AND the registered job list SHALL contain 6 jobs (5 existing + 1 NEW `scheduled-promotion`)

#### Scenario: SIGTERM mid-promotion aborts cleanly (handler respects ctx.signal)

- GIVEN the API process receives SIGTERM mid-promotion (during a 60-90s `promoteAll` call)
- WHEN the scheduler's 30-second graceful shutdown window starts
- THEN the handler SHALL observe `ctx.signal.aborted === true` at the next domain boundary
- AND the in-flight `job_runs` row SHALL be marked `failed` with `error_message='process shutdown'`
- AND no orphaned `running` rows SHALL remain after the process exits
- AND the next boot SHALL call `reconcileOrphanedRuns()` to verify no leftover `running` rows

---

## Success Criteria (E-Future additions)

59. **E-Future NEW**: `POST /api/v1/scheduler/jobs/scheduled-promotion/run-now` (ADMIN JWT) returns 200 with `{ jobRunId, status }`. Per-operator rate limit 1/min via `@fastify/rate-limit`. A 2nd POST within 60s from the same operator SHALL return 429 with `Retry-After`.
60. **E-Future NEW**: `GET /api/v1/scheduler/jobs` returns last 20 runs from `job_runs` table, ordered by `started_at DESC`, each entry with `{ jobName, status, startedAt, finishedAt, durationMs, attempt, totals? }`.
61. **E-Future NEW**: `PATCH /api/v1/scheduler/jobs/scheduled-promotion` with `{ enabled: false }` stops future cron runs (in-flight jobs complete); re-enabling re-creates the node-cron task. `scheduler.setEnabled` is idempotent.
62. **E-Future NEW**: `bash scripts/verify-slice.sh` exits 0 (PASS) post-async-scheduler — scheduled-promotion visible in `/admin/jobs/health` + admin endpoints return 200/403/404 + audit row emitted on every trigger.
63. **E-Future NEW**: `JobScheduler.setEnabled(jobName, enabled)` is part of the public interface — BullMQ adapter (deferred E5+) SHALL implement the same contract without changing call sites.
64. **E-Future NEW**: Spec diff is ADDITIVE ONLY — no existing requirements in `deployment-devops/spec.md` or `scheduler-jobs/spec.md` are modified.
