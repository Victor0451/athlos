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
- THEN services `api`, `db`, and `migrations` MUST be defined
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

#### Scenario: Database migrations on startup

- GIVEN the `migrations` service runs before `api` in startup order
- WHEN `docker-compose up` is executed
- THEN migrations MUST be executed automatically via the migrations service
- AND if any migration fails, the `api` service MUST NOT start
- AND the `db` service MUST remain running for debugging

#### Scenario: Database environment variables

- GIVEN the `db` service requires `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`
- WHEN the container starts
- THEN these variables MUST be provided via docker-compose environment section
- AND `POSTGRES_PASSWORD` MUST NOT be hardcoded in the docker-compose.yml file

---

### Requirement: CI/CD Pipeline

The system SHALL use GitHub Actions for continuous integration and deployment with branch-based environment targeting.

#### Scenario: GitHub Actions workflow structure

- GIVEN `.github/workflows/ci.yml` exists
- WHEN a push or pull request occurs
- THEN the workflow MUST run stages: `lint`, `test`, `build`, `push`
- AND each stage MUST pass before the next executes
- AND a failure in any stage MUST fail the workflow

#### Scenario: Branch-based deployment

- GIVEN the branch is `main`
- WHEN the `push` stage completes
- THEN the Docker image MUST be tagged as `athlos-api:latest` and `athlos-api:<git-sha>`
- AND deployment MUST target the production environment
- AND GITHUB_ENV secrets for production MUST be available

#### Scenario: Staging deployment

- GIVEN the branch is `staging`
- WHEN the `push` stage completes
- THEN the Docker image MUST be tagged as `athlos-api:staging`
- AND deployment MUST target the staging environment

#### Scenario: Docker image tagging

- GIVEN a commit with SHA `abc1234` is pushed to `main`
- WHEN the build stage completes
- THEN the image MUST be tagged as `ghcr.io/athlos/athlos-api:abc1234`
- AND `ghcr.io/athlos/athlos-api:latest` MUST be updated

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
- THEN the operator MUST execute `docker-compose run migrations rollback <migration-name>`
- AND the rollback MUST be logged in the audit trail
- AND if rollback fails, the API MUST NOT start

#### Scenario: One-off migration execution

- GIVEN a specific migration needs to be run manually (e.g., after manual data fix)
- WHEN the operator runs `docker-compose run migrations run <migration-name>`
- THEN the migration MUST execute against the production database
- AND the output MUST be logged
- AND the exit code MUST reflect success or failure

---

### Requirement: Backup Strategy

The system SHALL perform automated PostgreSQL backups with defined frequency, retention, and storage location.

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
- AND they MUST be accessible for restore operations
- AND they SHOULD be replicated to offsite storage

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
10. Manual migration execution works via `docker-compose run migrations`
11. Backup script produces valid gzip SQL dumps
12. Backups run daily and are retained for at least 7 days
13. `LEGACY_DB_PATH` is mounted read-only in the API container
14. Import working directory uses a separate volume
