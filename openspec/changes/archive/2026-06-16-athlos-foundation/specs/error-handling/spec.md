# Error Handling Specification

## Purpose

Define consistent error handling across the Athlos API — covering error response structure, categorization, HTTP status mapping, logging strategy, validation error formatting, and import pipeline error reporting.

---

## 1. Error Response Structure

### Requirement: ApiError Interface

All error responses MUST use the `ApiError` interface defined in `api-design/spec.md`:

```typescript
interface ApiError {
  error: string;           // Machine-readable error code
  message: string;         // Human-readable description
  details?: unknown;       // Optional additional context
  request_id: string;      // Unique request ID for tracing
}
```

### Requirement: request_id Generation and Propagation

The system MUST generate a unique `request_id` (format: `req_<uuid>`) at the start of every request. This ID MUST be:
- Included in every error response (both 4xx and 5xx)
- Propagated to all log entries for the request
- Returned in the `X-Request-ID` response header

### Requirement: Error Code Enumeration

Error codes MUST be one of:

| Code | Category | Description |
|------|----------|-------------|
| `VALIDATION_ERROR` | Business | Request body/params failed validation |
| `INVALID_CREDENTIALS` | Business | Wrong username or password |
| `TOKEN_EXPIRED` | Business | JWT or refresh token has expired |
| `TOKEN_INVALID` | Business | JWT or refresh token is malformed |
| `NOT_FOUND` | Business | Resource does not exist |
| `CONFLICT` | Business | Duplicate resource (e.g., username exists) |
| `APPROVAL_LINK_EXPIRED` | Business | Approval token has expired |
| `APPROVAL_ALREADY_USED` | Business | Approval token was already consumed |
| `REASON_REQUIRED` | Business | Approval rejection requires a reason |
| `INSUFFICIENT_PERMISSIONS` | Business | Valid JWT but wrong role |
| `ACCOUNT_LOCKED` | Business | Too many failed login attempts |
| `RATE_LIMIT_EXCEEDED` | Business | Request rate limit hit |
| `INTERNAL_ERROR` | Technical | Unexpected server error |
| `SERVICE_UNAVAILABLE` | Technical | Dependency (DB, legacy) is down |

### Requirement: details Field for Field-Level Errors

When `error` is `VALIDATION_ERROR`, the `details` field MUST contain an array of field-level errors:

```typescript
interface FieldError {
  field: string;    // Path to invalid field (e.g., "body.email" or "params.id")
  message: string;  // Human-readable description
  code?: string;   // Optional Zod error code
}
```

---

## 2. Error Categories

### Requirement: Business Errors

Business errors are expected failures from violating business rules. The system MUST:
- Return HTTP 4xx status codes
- Include `request_id` but NO stack trace
- Log at WARN level with context (operator_id, endpoint, input summary)
- Never expose internal implementation details in `message`

### Requirement: Technical Errors

Technical errors are unexpected failures (bugs, DB failures, network timeouts). The system MUST:
- Return HTTP 500 (or 503 for dependency failures)
- Include `request_id` in response
- Log at ERROR level with full stack trace
- Return a generic `message` to client (e.g., "An unexpected error occurred")

---

## 3. HTTP Status Code Mapping

| Scenario | Status | Error Code |
|----------|--------|------------|
| Invalid request body, missing required fields | 400 | `VALIDATION_ERROR` |
| Missing or invalid JWT, wrong credentials | 401 | `INVALID_CREDENTIALS` or `TOKEN_EXPIRED` or `TOKEN_INVALID` |
| Valid JWT but insufficient role | 403 | `INSUFFICIENT_PERMISSIONS` |
| Resource does not exist | 404 | `NOT_FOUND` |
| Duplicate resource | 409 | `CONFLICT` |
| Approval link expired | 410 | `APPROVAL_LINK_EXPIRED` |
| Approval link already used | 410 | `APPROVAL_ALREADY_USED` |
| Valid syntax but semantic errors | 422 | Semantically appropriate code (e.g., `APPROVAL_LINK_EXPIRED`) |
| Rate limit exceeded, account locked | 429 | `RATE_LIMIT_EXCEEDED` or `ACCOUNT_LOCKED` |
| Unexpected server error | 500 | `INTERNAL_ERROR` |
| Database or legacy system unavailable | 503 | `SERVICE_UNAVAILABLE` |

---

## 4. Error Logging Strategy

### Requirement: Log Levels by Error Category

- Business errors: WARN level
- Technical errors: ERROR level

### Requirement: Required Log Context

Every error log entry MUST include:

| Field | Description |
|-------|-------------|
| `request_id` | The request's unique ID |
| `operator_id` | Authenticated operator ID (or `null`) |
| `endpoint` | Full path (e.g., `POST /api/v1/socios`) |
| `method` | HTTP method |
| `duration_ms` | Request duration in milliseconds |
| `status_code` | HTTP response status |
| `error_code` | Machine-readable error code |
| `message` | Log message |

### Requirement: Sensitive Data Redaction

The system MUST redact in logs:
- `password` — replaced with `[REDACTED]`
- `refresh_token` and `access_token` — replaced with `[REDACTED]`
- `Authorization` header — replaced with `[REDACTED]`

### Requirement: Import Pipeline Error Logging

Import errors MUST be logged with:
- `job_id` — the import job UUID
- `table` — target table name (e.g., `socios`, `CTACTE`)
- `legacy_key` — source record identifier (if available)
- `error_code` — `VALIDATION_ERROR`, `CONFLICT`, etc.
- `error_message` — human-readable description
- `row_data` — original row data (redacted of sensitive fields)

---

## 5. Zod Validation Errors

### Requirement: Zod to ApiError Mapping

When Zod validation fails, the system MUST map each Zod error to a `FieldError`:

- `field`: The JSON path to the invalid field (e.g., `body.numero_socio`)
- `message`: Human-readable Zod message (e.g., "Required")
- `code`: Zod error code (e.g., `invalid_type`, `required`, `too_small`)

### Scenario: Multiple Field Validation Failure

- GIVEN a POST /api/v1/socios request with `numero_socio` missing and `email` invalid
- WHEN Zod validation fails
- THEN response MUST be 400 with `VALIDATION_ERROR`
- AND `details` MUST contain `[{"field":"body.numero_socio","message":"Required"},{"field":"body.email","message":"Invalid email"}]`

---

## 6. Import Pipeline Errors

### Requirement: Import Job Failure Status

Import jobs MUST track failure state:

```typescript
interface ImportJobStatus {
  job_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'partial';
  tables_imported: string[];
  records_imported: number;
  errors_count: number;
  started_at: string;
  finished_at: string | null;
  errors: ImportError[];
}
```

### Requirement: Per-Record Error Tracking

Each error in `errors` MUST contain:

```typescript
interface ImportError {
  table: string;
  legacy_key: string | null;
  field: string | null;
  error_code: string;
  message: string;
  row_data?: Record<string, unknown>; // Redacted
}
```

### Requirement: Batch vs Per-Record Errors

- Batch-level errors (e.g., DB connection lost mid-import) MUST fail the entire job with `status: 'failed'`
- Per-record validation errors MUST be collected with `status: 'partial'` and continue processing remaining records
- The job MUST stop on first conflict error (duplicate legacy key) unless configured to skip

---

## Success Criteria

- [ ] All error responses follow `ApiError` interface
- [ ] `request_id` is generated, propagated, and returned in all responses
- [ ] Error codes match the defined enumeration
- [ ] Business errors return 4xx, log at WARN, no stack trace in response
- [ ] Technical errors return 5xx, log at ERROR with stack trace
- [ ] HTTP status codes match the defined mapping table
- [ ] Log entries include all required context fields
- [ ] Sensitive data (passwords, tokens) is redacted in logs
- [ ] Zod validation failures map to field-level `FieldError[]` in `details`
- [ ] Import job status tracks `errors_count` and `errors` array
- [ ] Batch errors fail the job; per-record errors allow partial completion