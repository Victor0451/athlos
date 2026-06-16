# Config/Environment Specification

## Purpose

Define how Athlos manages configuration across environment tiers, with focus on secrets management, environment variable validation, and startup safety. This ensures the application fails fast on misconfiguration rather than running in an undefined state.

---

## Requirements

### Requirement: Environment Variable Schema

The system SHALL define a Zod schema validating all environment variables at startup. The schema MUST enumerate each variable's name, type, required/optional status, and secret flag. Variables marked as secret MUST be redacted from logs and error messages.

**Environment Variables:**

| Variable | Description | Example | Required | Secret |
|----------|-------------|---------|----------|--------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/athlos` | Yes | Yes |
| `JWT_SECRET` | Secret for signing JWTs | `openssl rand -hex 32` output | Yes | Yes |
| `LEGACY_DB_PATH` | Path to legacy DBF directory | `\\ServidorGorriti\AplicacionGorriti` | Yes | No |
| `SMTP_HOST` | SMTP server hostname | `smtp.gorriti.org` | Yes | No |
| `SMTP_PORT` | SMTP server port | `587` | Yes | No |
| `SMTP_USER` | SMTP authentication username | `alerts@gorriti.org` | Yes | Yes |
| `SMTP_PASS` | SMTP authentication password | (secret) | Yes | Yes |
| `SMTP_FROM` | Sender address for alerts | `alerts@gorriti.org` | Yes | No |
| `CORS_ORIGINS` | Allowed CORS origins | `https://app.gorriti.org,https://admin.gorriti.org` | Yes | No |
| `NODE_ENV` | Environment tier | `development`, `staging`, `production` | Yes | No |

#### Scenario: All required variables present

- GIVEN the application starts with all required environment variables set
- WHEN the Zod schema validation runs
- THEN the application proceeds to normal startup
- AND logs `Environment validation passed` at info level

#### Scenario: Missing required variable

- GIVEN `DATABASE_URL` is not set
- WHEN the application starts
- THEN it MUST halt immediately with exit code 1
- AND log `FATAL: Missing required env var DATABASE_URL`
- AND NOT expose the variable name in the error message to avoid log injection

#### Scenario: Invalid variable type

- GIVEN `SMTP_PORT` is set to `not-a-number`
- WHEN the application starts
- THEN it MUST halt immediately with exit code 1
- AND log `FATAL: SMTP_PORT must be a valid integer`

---

### Requirement: Environment Tiers

The system SHALL support three environment tiers: `development`, `staging`, and `production`. Each tier has distinct configuration sources and secret injection strategies.

| Tier | Config Source | Secret Injection | Debug Logging |
|------|--------------|------------------|---------------|
| `development` | `.env` file in project root | Via `.env` file | Verbose |
| `staging` | `.env.staging` file | Via `.env.staging` | Info level |
| `production` | Environment variables injected by orchestrator | Docker secrets or env injection | Error only |

#### Scenario: Development loads from .env file

- GIVEN `NODE_ENV=development`
- WHEN the application starts
- THEN it MUST load variables from `.env` in the project root
- AND merge with any already-set environment variables (shell vars override `.env`)

#### Scenario: Production uses injected secrets

- GIVEN `NODE_ENV=production`
- WHEN the application starts
- THEN it MUST NOT look for a `.env` file
- AND all secrets MUST be injected via environment variables from the orchestrator
- AND the application MUST fail if any secret is empty or missing

---

### Requirement: Secrets Management Strategy

The system SHALL NOT hardcode secrets in source code. Secrets MUST be provided via environment variables. The application MUST validate secrets are non-empty at startup for required secrets.

#### Scenario: Production secret is empty string

- GIVEN `NODE_ENV=production`
- AND `JWT_SECRET` is set to an empty string `""`
- WHEN the application starts
- THEN it MUST halt immediately with exit code 1
- AND log `FATAL: JWT_SECRET cannot be empty in production`

#### Scenario: Secret redaction in logs

- GIVEN a database connection error occurs
- WHEN the error is logged
- THEN any secret values in the error context MUST be replaced with `[REDACTED]`
- AND the original secret values MUST NOT appear in logs

---

### Requirement: Legacy DB Path Configuration

The system SHALL configure `LEGACY_DB_PATH` via environment variable. The path MUST be validated to exist and be accessible at startup. The legacy path is NOT environment-specific—it remains fixed across tiers.

#### Scenario: Legacy path points to valid share

- GIVEN `LEGACY_DB_PATH=\\ServidorGorriti\AplicacionGorriti`
- WHEN the application starts
- THEN it MUST verify the path exists and is readable
- AND proceed if validation succeeds

#### Scenario: Legacy path does not exist

- GIVEN `LEGACY_DB_PATH=\\InvalidServer\MissingShare`
- WHEN the application starts
- THEN it MUST halt immediately with exit code 1
- AND log `FATAL: LEGACY_DB_PATH is not accessible`

#### Scenario: Legacy path in Docker

- GIVEN the application runs in Docker
- THEN `LEGACY_DB_PATH` SHOULD be a volume mount path
- AND the volume MUST be mounted to the container at startup

---

### Requirement: CORS Configuration

The system SHALL parse `CORS_ORIGINS` as a comma-separated list of URLs. Wildcard origins are NOT permitted in production. Development MAY use `http://localhost:*` patterns.

#### Scenario: Valid comma-separated origins

- GIVEN `CORS_ORIGINS=https://app.gorriti.org,https://admin.gorriti.org`
- WHEN the CORS middleware initializes
- THEN it MUST parse both origins
- AND allow requests from both domains

#### Scenario: Wildcard origin in development

- GIVEN `NODE_ENV=development`
- AND `CORS_ORIGINS=http://localhost:*`
- WHEN the CORS middleware initializes
- THEN it MUST expand `localhost:*` to match any localhost port
- AND allow requests from any localhost origin

#### Scenario: Wildcard origin in production (forbidden)

- GIVEN `NODE_ENV=production`
- AND `CORS_ORIGINS=*`
- WHEN the application starts
- THEN it MUST halt immediately with exit code 1
- AND log `FATAL: Wildcard CORS origin is not allowed in production`

---

### Requirement: Startup Validation

The system SHALL run environment validation as the first step of application startup. Validation MUST be synchronous and blocking. The application MUST NOT begin accepting connections until validation passes.

#### Scenario: Successful startup flow

- GIVEN all environment variables are valid
- WHEN the application starts
- THEN it MUST run validation before any other initialization
- AND proceed to initialize database connections
- AND proceed to start the HTTP server

#### Scenario: Validation failure halts startup

- GIVEN any required environment variable is missing or invalid
- WHEN the application starts
- THEN it MUST NOT initialize database connections
- AND it MUST NOT start the HTTP server
- AND it MUST exit with code 1

---

## Success Criteria

1. Application fails fast with descriptive error when `DATABASE_URL` is missing
2. Application fails fast when `JWT_SECRET` is empty in production
3. `LEGACY_DB_PATH` is validated to exist before any import job runs
4. CORS origins are parsed correctly from comma-separated format
5. Wildcard CORS is rejected in production with clear error
6. All secrets are redacted from any log output
7. Development uses `.env` file; production uses injected environment variables
8. Zod schema validation runs synchronously at startup before any I/O