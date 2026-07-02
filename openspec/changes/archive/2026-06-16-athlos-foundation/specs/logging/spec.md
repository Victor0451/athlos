# Logging Specification

## Purpose

Define structured logging for Athlos API covering library selection, log levels by category, required fields, sensitive data redaction, output destinations, and import batch logging. This spec complements the error-handling spec by providing a complete logging framework for all operational events.

---

## 1. Logging Library and Format

### Requirement: pino as Logging Library

The system MUST use `pino` as the logging library, via Fastify's built-in logger instance. All logging across the application MUST use the shared Fastify logger (`fastify.log.*`) to ensure consistent configuration, redaction, and output formatting.

### Requirement: JSON Output in Production

In production environments, the logger MUST output valid JSON lines (one JSON object per line). Each log entry MUST contain the fields defined in Section 3.

### Requirement: Human-Readable Output in Development

In non-production environments, the logger SHOULD use `pino-pretty` to format output as human-readable text with colorized log levels, timestamps, and structured field display. The `NODE_ENV` variable determines the environment.

### Requirement: Log Level Configuration

The system MUST support configurable log levels via the `LOG_LEVEL` environment variable. The default level MUST be `info`. Supported levels (in ascending priority): `trace`, `debug`, `info`, `warn`, `error`, `fatal`.

---

## 2. Log Levels by Category

### Requirement: DEBUG Level — Development and Diagnostic

The system SHOULD log at `DEBUG` level for:
- Detailed request/response body contents (excluding sensitive fields)
- Internal state transitions during complex operations
- Query execution details (SQL, parameters)

DEBUG level MUST NOT be enabled in production.

### Requirement: INFO Level — Normal Operations

The system MUST log at `INFO` level for:
- HTTP request/response lifecycle (start, completion)
- Authentication events (login success, logout, token refresh)
- Import batch progress (per-table start/completion)
- Approval link events (created, viewed, approved, rejected)
- Service startup and shutdown

### Requirement: WARN Level — Business Errors

The system MUST log at `WARN` level for:
- Business errors (validation failures, not found, conflicts)
- Authentication failures (invalid credentials, expired tokens)
- Approval link failures (expired, already used)
- Rate limit or lockout triggered
- Drift detected by reconciliation jobs

### Requirement: ERROR Level — Technical Failures

The system MUST log at `ERROR` level for:
- Database connection failures or query errors
- Uncaught exceptions in route handlers
- Import batch failures (batch-level, not per-record)
- External service failures (legacy DBF access errors)
- Configuration or startup validation failures

---

## 3. Required Log Fields

### Requirement: Base Log Fields

Every log entry MUST include these fields:

| Field | Type | Description |
|-------|------|-------------|
| `request_id` | string | Unique request ID (`req_<uuid>`), propagated from request |
| `timestamp` | string | ISO 8601 format (`YYYY-MM-DDTHH:mm:ss.sssZ`) |
| `level` | string | Log level label (`info`, `warn`, `error`) |
| `message` | string | Human-readable description of the event |
| `service` | string | Fixed value `athlos-api` |

### Requirement: HTTP Request/Response Fields

HTTP lifecycle log entries MUST include:

| Field | Type | Description |
|-------|------|-------------|
| `method` | string | HTTP method (GET, POST, etc.) |
| `url` | string | Request path (e.g., `/api/v1/socios`) |
| `status_code` | number | HTTP response status |
| `duration_ms` | number | Request duration in milliseconds |
| `operator_id` | string\|null | Authenticated operator ID or `null` |

### Requirement: Authentication Event Fields

Authentication log entries MUST include:

| Field | Type | Description |
|-------|------|-------------|
| `event` | string | Event type: `AUTH_LOGIN_SUCCESS`, `AUTH_LOGIN_FAILURE`, `AUTH_LOGOUT`, `AUTH_REFRESH`, `AUTH_TOKEN_EXPIRED` |
| `username` | string | Username attempted (for failures, even if not found) |
| `operator_id` | string\|null | Operator ID on success, `null` on failure |
| `request_id` | string | Request ID for correlation |

### Requirement: Business Error Fields

Business error log entries MUST include:

| Field | Type | Description |
|-------|------|-------------|
| `error_code` | string | Machine-readable error code (e.g., `VALIDATION_ERROR`) |
| `endpoint` | string | Request path |
| `method` | string | HTTP method |
| `duration_ms` | number | Request duration |
| `operator_id` | string\|null | Authenticated operator or `null` |

### Requirement: Technical Error Fields

Technical error log entries MUST include all base fields plus:

| Field | Type | Description |
|-------|------|-------------|
| `stack` | string | Full stack trace |
| `error_code` | string | `INTERNAL_ERROR` or `SERVICE_UNAVAILABLE` |
| `endpoint` | string | Request path |
| `method` | string | HTTP method |
| `duration_ms` | number | Request duration |

### Requirement: Import Batch Fields

Import batch log entries MUST include:

| Field | Type | Description |
|-------|------|-------------|
| `job_id` | string | Import job UUID |
| `event` | string | Event type (see below) |
| `table` | string | Target table name (for per-table events) |
| `records_total` | number | Total records in batch |
| `records_processed` | number | Records processed so far |
| `records_succeeded` | number | Successfully imported |
| `records_failed` | number | Failed imports |
| `duration_ms` | number | Batch duration |

Import batch event types:
- `IMPORT_BATCH_STARTED`: Job started
- `IMPORT_TABLE_STARTED`: Table import started
- `IMPORT_TABLE_COMPLETED`: Table import completed
- `IMPORT_RECORD_FAILED`: Per-record failure (logged individually)
- `IMPORT_BATCH_COMPLETED`: Job completed (success or partial)
- `IMPORT_BATCH_FAILED`: Batch-level failure

### Requirement: Approval Link Event Fields

Approval link log entries MUST include:

| Field | Type | Description |
|-------|------|-------------|
| `event` | string | Event type: `APPROVAL_LINK_CREATED`, `APPROVAL_LINK_VIEWED`, `APPROVAL_GRANTED`, `APPROVAL_REJECTED`, `APPROVAL_LINK_EXPIRED` |
| `token_hash` | string | SHA-256 hash of the token (never raw) |
| `action_type` | string | Action type (e.g., `PAGO_APPROVAL`) |
| `action_id` | string | Associated action ID |
| `decision` | string\|null | `approve` or `reject` (for decision events) |
| `reason` | string\|null | Rejection reason (if provided) |

---

## 4. Sensitive Data Handling

### Requirement: Redacted Fields

The system MUST redact the following fields in all log output using pino's `redact` option:

| Field Path | Replacement |
|------------|-------------|
| `password` | `[REDACTED]` |
| `refresh_token` | `[REDACTED]` |
| `access_token` | `[REDACTED]` |
| `Authorization` | `[REDACTED]` |
| `dni` | `[REDACTED]` |

### Requirement: Redaction Configuration

Redaction MUST be configured once at Fastify server initialization and MUST NOT be configurable per-log-call. The redact paths MUST cover nested occurrences (e.g., `body.password`, `query.refresh_token`).

### Requirement: Row Data Redaction in Import Errors

When logging import record failures, the system MUST redact sensitive fields from `row_data` before logging. The `redact()` utility from `packages/errors` MUST be called on row data before inclusion in log entries.

---

## 5. Log Destinations

### Requirement: stdout Only in v1

In v1, all log output MUST be written to `stdout`. The Docker container MUST be configured to capture `stdout` and forward to the container runtime's logging driver.

### Requirement: No File Logging in v1

The system MUST NOT write logs to files. File-based logging introduces rotation, retention, and disk space concerns that are better handled by the container runtime or log aggregation service.

### Requirement: Log Aggregation Interface

The system SHOULD be designed to support future log aggregation (e.g., Loki, CloudWatch, Datadog). To enable this:
- All logs MUST be JSON-formatted (machine-parseable)
- Each log entry MUST include `service: "athlos-api"` for fan-out filtering
- Structured fields (not embedded strings) enable queryable log aggregation
- The `request_id` field enables request correlation across services

The interface contract for v1 log aggregation readiness:
```
{ "request_id": "req_<uuid>", "timestamp": "ISO8601", "level": "info", "message": "...", "service": "athlos-api", ...additional_fields }
```

---

## 6. Import Batch Logging

### Requirement: Batch Start Logging

When an import batch starts, the system MUST log at INFO:
- `job_id`, `event: "IMPORT_BATCH_STARTED"`, `records_total`, `timestamp`

### Requirement: Per-Table Logging

When each table import begins and completes, the system MUST log at INFO:
- `job_id`, `event: "IMPORT_TABLE_STARTED"`, `table`, `records_in_table`, `timestamp`
- `job_id`, `event: "IMPORT_TABLE_COMPLETED"`, `table`, `records_succeeded`, `records_failed`, `duration_ms`, `timestamp`

### Requirement: Per-Record Error Logging

When a record fails validation or import, the system MUST log at WARN:
- `job_id`, `event: "IMPORT_RECORD_FAILED"`, `table`, `legacy_key`, `error_code`, `error_message`
- `row_data` (redacted of sensitive fields)

Per-record errors MUST NOT block the batch. The batch continues and aggregates errors for the completion summary.

### Requirement: Batch Completion Logging

When the batch completes (success, partial, or failed), the system MUST log at INFO (success) or ERROR (batch-level failure):
- `job_id`, `event: "IMPORT_BATCH_COMPLETED"`, `status: "completed|partial|failed"`, `records_total`, `records_succeeded`, `records_failed`, `duration_ms`, `timestamp`

### Requirement: Completion Summary

The batch completion log entry MUST include a summary of all tables processed and their individual stats:

```
{
  "job_id": "uuid",
  "event": "IMPORT_BATCH_COMPLETED",
  "status": "partial",
  "tables": [
    { "table": "socios", "records_succeeded": 100, "records_failed": 2 },
    { "table": "CTACTE", "records_succeeded": 5000, "records_failed": 0 }
  ],
  "records_total": 5100,
  "records_succeeded": 5098,
  "records_failed": 2,
  "duration_ms": 45000
}
```

---

## Scenarios

### Scenario: Successful HTTP Request

- GIVEN a GET /api/v1/socios request with valid operator session
- WHEN the request is processed and returns 200
- THEN the system MUST log at INFO with `event: "HTTP_REQUEST"`, `method: "GET"`, `url: "/api/v1/socios"`, `status_code: 200`, `duration_ms`, `operator_id`, `request_id`

### Scenario: Failed Login Attempt

- GIVEN a POST /api/auth/login request with invalid credentials
- WHEN the login fails with 401
- THEN the system MUST log at WARN with `event: "AUTH_LOGIN_FAILURE"`, `username: "attempted_user"`, `error_code: "INVALID_CREDENTIALS"`, `request_id`

### Scenario: Import Batch with Partial Success

- GIVEN an import batch of 1000 socios with 5 invalid records
- WHEN the batch completes with 995 succeeded and 5 failed
- THEN the system MUST log at INFO with `event: "IMPORT_BATCH_COMPLETED"`, `status: "partial"`, `records_succeeded: 995`, `records_failed: 5`
- AND log 5 individual `IMPORT_RECORD_FAILED` entries at WARN

### Scenario: Sensitive Data Redacted in Logs

- GIVEN a POST /api/auth/login request with `password: "secret123"`
- WHEN the request is logged
- THEN the log output MUST contain `[REDACTED]` for the password field
- AND the raw value `secret123` MUST NOT appear in any log entry

### Scenario: Request Correlation Across Services

- GIVEN a request with `request_id: "req_abc123"`
- WHEN the request is processed through multiple log-emitting operations
- THEN all log entries for that request MUST contain `request_id: "req_abc123"`
- AND a future log aggregation system can filter all entries by this ID

---

## Success Criteria

- [ ] All log entries include `request_id`, `timestamp`, `level`, `message`, `service`
- [ ] pino is used as the logging library via Fastify's built-in logger
- [ ] Production output is valid JSON (one JSON object per line)
- [ ] Development output is human-readable via pino-pretty
- [ ] Log level is configurable via `LOG_LEVEL` env var
- [ ] HTTP lifecycle events are logged at INFO
- [ ] Authentication events are logged with event type and username/operator_id
- [ ] Business errors are logged at WARN with error_code
- [ ] Technical errors are logged at ERROR with stack trace
- [ ] Import batch progress is logged per-table with stats
- [ ] Per-record import failures are logged individually at WARN
- [ ] Batch completion logs include full summary
- [ ] Sensitive fields (password, tokens, dni, Authorization) are redacted
- [ ] Logs are written to stdout only (no file logging in v1)
- [ ] Log format is structured JSON to support future log aggregation
