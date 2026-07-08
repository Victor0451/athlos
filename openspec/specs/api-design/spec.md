# API Design Specification

## Purpose

Complete API contract for Athlos — covering conventions, auth endpoints, approval links, core business endpoints, admin endpoints, and health check. This spec is the authoritative reference for all API consumers (UI, integrations, external systems).

---

## 1. API Conventions

### Requirement: Base URL Structure

All API endpoints MUST be prefixed with `/api/v1`. The health check endpoint is exempt at `/health`.

```
/api/v1/{resource}
/api/v1/{resource}/{id}
/health
```

### Requirement: API Versioning Strategy

The API MUST use path-based versioning (`/api/v1/`). Version is part of the URL contract. A new major version (`/api/v2/`) is released only for breaking changes. Non-breaking additions (new optional fields, new endpoints) do not increment the version.

### Requirement: Error Response Format

All error responses MUST use a consistent JSON structure:

```typescript
interface ApiError {
  error: string;           // Machine-readable error code (e.g., "INVALID_CREDENTIALS")
  message: string;         // Human-readable description
  details?: unknown;       // Optional additional context (field-level validation errors, etc.)
  request_id: string;      // Unique request ID for tracing
}
```

Example:
```json
{
  "error": "VALIDATION_ERROR",
  "message": "Request body is invalid",
  "details": [
    { "field": "username", "message": "username is required" }
  ],
  "request_id": "req_01HX5K..."
}
```

### Requirement: HTTP Status Code Usage

The API MUST return the following status codes:

| Code | Meaning | When Used |
|------|---------|-----------|
| 200 | OK | Successful read, update, action |
| 201 | Created | Successful resource creation |
| 204 | No Content | Successful deletion (no body) |
| 400 | Bad Request | Invalid request body, missing required fields |
| 401 | Unauthorized | Missing or invalid JWT, invalid credentials |
| 403 | Forbidden | Valid JWT but insufficient role/permission |
| 404 | Not Found | Resource does not exist |
| 409 | Conflict | Duplicate resource (e.g., username already exists) |
| 410 | Gone | Approval token already used or expired |
| 422 | Unprocessable Entity | Valid syntax but semantic errors (e.g., approval link expired) |
| 429 | Too Many Requests | Rate limit exceeded or account locked |
| 500 | Internal Server Error | Unexpected server error (request_id returned) |

### Requirement: Pagination Strategy

List endpoints that return collections MUST support cursor-based pagination with the following query parameters:

```typescript
// Request
interface PaginationParams {
  cursor?: string;   // Opaque cursor from previous response
  limit?: number;    // Page size (default: 50, max: 200)
}

// Response
interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    has_more: boolean;
    next_cursor: string | null;
    total_count?: number;  // Included when feasible (may be expensive for large tables)
  };
}
```

List endpoints affected: `/api/v1/socios`, `/api/v1/cuenta-corriente`, `/api/v1/padrones`, `/api/v1/audit`.

### Requirement: Request/Response Content Type

All request and response bodies MUST be `application/json`. File downloads (reports, exports) MAY return `application/octet-stream` or the appropriate MIME type with a `Content-Disposition` header.

### Requirement: Authentication Header Format

Authenticated endpoints MUST receive the JWT access token via the `Authorization` header using the Bearer scheme:

```
Authorization: Bearer <access_token>
```

---

## 2. Auth Endpoints

### Requirement: POST /api/v1/auth/login

Operator login with username and password. Returns JWT access token + refresh token.

#### Scenario: Successful login

- GIVEN operator exists with username="operador1" and password="correct-password"
- WHEN POST /api/v1/auth/login is called with `{"username":"operador1","password":"correct-password"}`
- THEN response MUST be 200 OK with `access_token`, `refresh_token`, `expires_in`, `operator_id`, `role`, `permissions`

#### Scenario: Failed login — wrong password

- GIVEN operator exists with username="operador1" and password="correct-password"
- WHEN POST /api/v1/auth/login is called with `{"username":"operador1","password":"wrong-password"}`
- THEN response MUST be 401 Unauthorized with `{"error":"INVALID_CREDENTIALS"}`

#### Scenario: Failed login — unknown user

- GIVEN no operator exists with username="unknown"
- WHEN POST /api/v1/auth/login is called with `{"username":"unknown","password":"any-password"}`
- THEN response MUST be 401 Unauthorized with `{"error":"INVALID_CREDENTIALS"}`

#### Scenario: Account locked

- GIVEN operator "operador1" has had 5 failed login attempts within the last 15 minutes
- WHEN POST /api/v1/auth/login is called with correct credentials
- THEN response MUST be 429 Too Many Requests with `{"error":"ACCOUNT_LOCKED","locked_until":"<timestamp>"}`

### Requirement: POST /api/v1/auth/refresh

Exchange a valid refresh token for a new access + refresh token pair. Old refresh token is revoked (rotation).

#### Scenario: Successful refresh

- GIVEN a valid unexpired refresh_token
- WHEN POST /api/v1/auth/refresh is called with `{"refresh_token":"<valid-token>"}`
- THEN response MUST be 200 OK with new `access_token`, new `refresh_token`, `expires_in`
- AND the old refresh_token MUST be revoked

#### Scenario: Expired refresh token

- GIVEN a refresh_token with expiry in the past
- WHEN POST /api/v1/auth/refresh is called with that token
- THEN response MUST be 401 Unauthorized with `{"error":"TOKEN_EXPIRED"}`

### Requirement: POST /api/v1/auth/logout

Revoke the provided refresh token.

#### Scenario: Successful logout

- GIVEN a refresh_token was issued to operator
- WHEN POST /api/v1/auth/logout is called with `{"refresh_token":"<token>"}`
- THEN that refresh_token MUST be marked as revoked
- AND subsequent /api/v1/auth/refresh with it MUST fail with 401

---

## 3. Approval Link Endpoints

### Requirement: GET /api/v1/approval/{token}

Read-only view of the approval context. No JWT required — the token itself is the authorization.

#### Scenario: Valid approval link

- GIVEN an approval link token exists, is unused, and not expired
- WHEN GET /api/v1/approval/{token} is called
- THEN response MUST be 200 OK with `action_type`, `action_id`, `context_summary`, `entity_preview`, `created_by`, `created_at`, `expires_at`, `status`

#### Scenario: Expired approval link

- GIVEN an approval link has passed its `expires_at`
- WHEN GET /api/v1/approval/{token} is called
- THEN response MUST be 410 Gone with `{"error":"APPROVAL_LINK_EXPIRED"}`

#### Scenario: Already-used approval link

- GIVEN an approval link was already used (approved or rejected)
- WHEN GET /api/v1/approval/{token} is called
- THEN response MUST be 410 Gone with `{"error":"APPROVAL_ALREADY_USED"}`

### Requirement: POST /api/v1/approval/{token}

Submit an approval decision (approve or reject). Executes the underlying business action synchronously.

#### Scenario: Approver approves

- GIVEN a valid unused approval link for action_type="payment_order", action_id="1234"
- WHEN POST /api/v1/approval/{token} is called with `{"decision":"approve"}`
- THEN the underlying action MUST be executed (e.g., payment order marked approved)
- AND the token MUST be marked as used (`used_at` set)
- AND an audit event MUST be recorded
- AND response MUST be 200 OK with `{"decision":"approved","action_type":"payment_order","action_id":"1234","decided_at":"<timestamp>"}`

#### Scenario: Approver rejects

- GIVEN a valid unused approval link for action_type="payment_order", action_id="1234"
- WHEN POST /api/v1/approval/{token} is called with `{"decision":"reject","reason":"Monto incorrecto"}`
- THEN the underlying action MUST be cancelled/rejected
- AND the token MUST be marked as used
- AND an audit event MUST be recorded with the reason
- AND response MUST be 200 OK with `{"decision":"rejected","action_type":"payment_order","action_id":"1234","decided_at":"<timestamp>"}`

#### Scenario: Reject without reason

- GIVEN a valid unused approval link
- WHEN POST /api/v1/approval/{token} is called with `{"decision":"reject"}` (no reason)
- THEN response MUST be 400 Bad Request with `{"error":"REASON_REQUIRED"}`

### Requirement: POST /api/v1/internal/approval-links

Internal-only endpoint to generate an approval link. Requires valid operator JWT with appropriate role.

#### Scenario: Generate approval link

- GIVEN authenticated operator with role=ADMIN or TESORERO
- WHEN POST /api/v1/internal/approval-links is called with valid `CreateApprovalLinkRequest`
- THEN a new approval token MUST be created
- AND response MUST be 201 Created with `{"token":"<raw-token>","link":"<full-url>","expires_at":"<timestamp>"}`
- AND an audit event MUST be recorded

---

## 4. Core Business Endpoints

### Requirement: Socios CRUD

Socios (members) are read during Phase 1 (legacy is the writer). Full CRUD is prepared for Phase 2 cutover.

#### GET /api/v1/socios

List all socios with cursor-based pagination.

- GIVEN socios exist in the system
- WHEN GET /api/v1/socios is called with optional `?cursor=&limit=`
- THEN response MUST be 200 OK with paginated `PaginatedResponse<Socio>`

#### GET /api/v1/socios/{id}

Get a single socio by ID.

- GIVEN a socio with id="uuid-123" exists
- WHEN GET /api/v1/socios/uuid-123 is called
- THEN response MUST be 200 OK with the full `Socio` object

#### POST /api/v1/socios

Create a new socio. Requires ADMIN or TESORERO role.

- GIVEN authenticated operator with role=ADMIN or TESORERO
- WHEN POST /api/v1/socios is called with valid `SocioCreateRequest` body
- THEN a new socio MUST be created
- AND response MUST be 201 Created with the created `Socio` object

#### PUT /api/v1/socios/{id}

Update an existing socio. Requires ADMIN or TESORERO role.

- GIVEN a socio with id="uuid-123" exists
- WHEN PUT /api/v1/socios/uuid-123 is called with valid update body
- THEN the socio MUST be updated
- AND response MUST be 200 OK with the updated `Socio` object

#### DELETE /api/v1/socios/{id}

Soft-delete a socio (mark as inactive). Requires ADMIN role.

- GIVEN a socio with id="uuid-123" exists and is active
- WHEN DELETE /api/v1/socios/uuid-123 is called by ADMIN
- THEN the socio MUST be marked as inactive
- AND response MUST be 204 No Content

### Requirement: Cuenta Corriente Query

Query the current account (cuenta corriente) for a socio — listing all movements (charges and payments).

#### GET /api/v1/cuenta-corriente/{socio_id}

List all movements for a socio ordered by date descending.

- GIVEN a socio with id="uuid-123" exists
- WHEN GET /api/v1/cuenta-corriente/uuid-123 is called with optional `?cursor=&limit=`
- THEN response MUST be 200 OK with paginated `PaginatedResponse<CuentaCorrienteMovimiento>`
- AND each movimiento MUST include: `id`, `fecha`, `tipo` (cargo/pago), `descripcion`, `monto`, `saldo_resultante`

#### GET /api/v1/cuenta-corriente/{socio_id}/saldo

Get the current balance for a socio.

- GIVEN a socio with id="uuid-123"
- WHEN GET /api/v1/cuenta-corriente/uuid-123/saldo is called
- THEN response MUST be 200 OK with `{"socio_id":"uuid-123","saldo":<number>,"as_of":"<timestamp>"}`
- AND saldo MUST be recalculated from raw CTACTE records (never trusted from cached fields)

### Requirement: Padrones Query

Query the padrones (electoral rolls) — read-only lists of socio categories.

#### GET /api/v1/padrones

List all available padrones.

- GIVEN padrones exist in the system
- WHEN GET /api/v1/padrones is called
- THEN response MUST be 200 OK with `Padrón[]` — each containing `id`, `nombre`, `descripcion`, `cantidad_socios`, `ultima_actualizacion`

#### GET /api/v1/padrones/{id}/socios

List all socios in a padrón.

- GIVEN a padrón with id="padron-2024" exists
- WHEN GET /api/v1/padrones/padron-2024/socios is called with optional `?cursor=&limit=`
- THEN response MUST be 200 OK with paginated `PaginatedResponse<Socio>` — socios belonging to that padrón

### Requirement: Import Trigger

Trigger a manual import of legacy data.

#### POST /api/v1/import/trigger

Trigger a full or partial import run. Requires ADMIN role.

- GIVEN authenticated operator with role=ADMIN
- WHEN POST /api/v1/import/trigger is called with optional `{"tables":["socios","CTACTE"],"full":false}`
- THEN an import job MUST be queued
- AND response MUST be 202 Accepted with `{"job_id":"<uuid>","status":"queued"}`

#### GET /api/v1/import/status

Get the status of the most recent import run.

- GIVEN an import job was triggered
- WHEN GET /api/v1/import/status is called
- THEN response MUST be 200 OK with `{"job_id","status","tables_imported","records_imported","started_at","finished_at","errors"}`

### Requirement: Freshness

Return the freshness (import recency) per domain.

#### GET /api/v1/freshness

Return last import timestamp per domain.

- WHEN GET /api/v1/freshness is called
- THEN response MUST be 200 OK with `DomainFreshness[]` — each containing `domain`, `last_import_at`, `records_count`, `status` (fresh|stale|unknown)

### Requirement: Lineage

Return the source lineage for a specific record.

#### GET /api/v1/lineage

Query lineage records with optional filters.

- WHEN GET /api/v1/lineage is called with `?domain=socios&legacy_key=1234`
- THEN response MUST be 200 OK with `LineageResponse[]` — each containing `athlos_id`, `domain`, `source_table`, `legacy_key`, `hash`, `imported_at`

### Requirement: Audit Query

Query the audit log.

#### GET /api/v1/audit

Query audit events with filters.

- WHEN GET /api/v1/audit is called with `?entity_type=socio&entity_id=1234&from=2024-01-01&to=2024-12-31&cursor=&limit=`
- THEN response MUST be 200 OK with paginated `PaginatedResponse<AuditEvent>`
- AND each event MUST contain: `id`, `action`, `entity_type`, `entity_id`, `operator_id`, `details`, `created_at`

---

## 5. Admin Endpoints

### Requirement: Admin-Only Endpoints

The following endpoints MUST require ADMIN role exclusively:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/admin/operators` | GET | List all operators |
| `/api/v1/admin/operators` | POST | Create a new operator |
| `/api/v1/admin/operators/{id}` | PUT | Update an operator |
| `/api/v1/admin/operators/{id}` | DELETE | Deactivate an operator |
| `/api/v1/admin/roles` | GET | List roles and their permissions |
| `/api/v1/admin/import/reconcile` | POST | Trigger a reconciliation job |
| `/api/v1/admin/import/rollback` | POST | Rollback a specific import batch |

#### Scenario: Non-admin cannot access admin endpoints

- GIVEN authenticated operator with role=OPERADOR
- WHEN GET /api/v1/admin/operators is called
- THEN response MUST be 403 Forbidden with `{"error":"INSUFFICIENT_PERMISSIONS"}`

---

## 6. Health Check

### Requirement: GET /health

Return API health status. No authentication required.

#### Scenario: Healthy API

- WHEN GET /health is called
- THEN response MUST be 200 OK with `{"status":"ok","version":"1.0.0","timestamp":"<ISO>","dependencies":{"db":"ok","legacy":"ok"}}`

#### Scenario: Degraded (DB down)

- WHEN GET /health is called but the database is unreachable
- THEN response MUST be 503 Service Unavailable with `{"status":"degraded","db":"error","legacy":"ok"}`

---

## Input/Output Contracts

### Socio

```typescript
interface Socio {
  id: string;
  numero_socio: number;      // Legacy socio number
  nombre: string;
  apellido: string;
  dni: string;
  fecha_alta: string;        // ISO date
  estado: 'activo' | 'inactivo' | 'suspendido';
  categoria: string;
  direccion?: string;
  telefono?: string;
  email?: string;
  created_at: string;
  updated_at: string;
}

interface SocioCreateRequest {
  numero_socio: number;
  nombre: string;
  apellido: string;
  dni: string;
  fecha_alta: string;
  categoria: string;
  direccion?: string;
  telefono?: string;
  email?: string;
}
```

### Cuenta Corriente

```typescript
interface CuentaCorrienteMovimiento {
  id: string;
  socio_id: string;
  fecha: string;             // ISO date
  tipo: 'cargo' | 'pago';
  descripcion: string;
  monto: number;             // Positive always
  saldo_resultante: number;
  lineage_id: string;       // Reference to raw CTACTE record
}

interface SaldoResponse {
  socio_id: string;
  saldo: number;
  as_of: string;            // Timestamp of calculation
}
```

### Padrón

```typescript
interface Padrón {
  id: string;
  nombre: string;
  descripcion: string;
  cantidad_socios: number;
  ultima_actualizacion: string;
}
```

### Freshness

```typescript
interface DomainFreshness {
  domain: string;            // e.g., "socios", "CTACTE", "CONTABLE"
  last_import_at: string | null;
  records_count: number;
  status: 'fresh' | 'stale' | 'unknown';
}
```

### Lineage

```typescript
interface LineageResponse {
  athlos_id: string;
  domain: string;
  source_table: string;
  legacy_key: string;
  hash: string;
  imported_at: string;
}
```

### Audit

```typescript
interface AuditEvent {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  operator_id: string | null;  // null for system-generated events
  details: Record<string, unknown>;
  created_at: string;
}
```

### Operator (Admin)

```typescript
interface Operator {
  id: string;
  username: string;
  role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA';
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
}

interface CreateOperatorRequest {
  username: string;
  password: string;
  role: 'ADMIN' | 'TESORERO' | 'OPERADOR' | 'CONSULTA';
  can_reprint: boolean;
  can_anulate: boolean;
}
```

---

## Success Criteria

- [ ] All endpoints follow `/api/v1/` base path (except `/health`)
- [ ] Error responses are consistent: `error`, `message`, `details?`, `request_id`
- [ ] HTTP status codes match the defined usage table
- [ ] List endpoints support cursor-based pagination with `cursor`, `limit`, `has_more`, `next_cursor`
- [ ] Auth endpoints return defined contracts (login, refresh, logout)
- [ ] Approval link endpoints (GET/POST `/api/v1/approval/{token}`, POST `/api/v1/internal/approval-links`) are fully defined
- [ ] Socios CRUD endpoints are defined with proper role requirements
- [ ] Cuenta Corriente query and saldo endpoints are defined
- [ ] Padrones query endpoints are defined
- [ ] Import trigger and status endpoints are defined
- [ ] Freshness, Lineage, and Audit query endpoints are defined
- [ ] Admin-only endpoints require ADMIN role
- [ ] Health check returns status and dependency health
- [ ] All request/response contracts are defined as TypeScript interfaces

---

## Delta — Synced from change `athlos-socio-legajo` (2026-07-07)

> Synced from change `athlos-socio-legajo` (2026-07-07).

This delta extends the API Design Specification with two changes required by the `athlos-socio-legajo` change: (i) two new status codes for uploads (413 / 415) and (ii) an exception to the JSON-only content-type rule for `multipart/form-data` upload endpoints.

## MODIFIED Requirements

### Requirement: HTTP Status Code Usage

(Previously: the status code table covered `200 | 201 | 204 | 400 | 401 | 403 | 404 | 409 | 410 | 422 | 429 | 500`.)

The API MUST return the following status codes:

| Code | Meaning | When Used |
|------|---------|-----------|
| 200 | OK | Successful read, update, action |
| 201 | Created | Successful resource creation |
| 204 | No Content | Successful deletion (no body) |
| 400 | Bad Request | Invalid request body, missing required fields, quota exceeded |
| 401 | Unauthorized | Missing or invalid JWT, invalid credentials |
| 403 | Forbidden | Valid JWT but insufficient role/permission |
| 404 | Not Found | Resource does not exist (incl. soft-deleted file metadata) |
| 409 | Conflict | Duplicate resource (e.g., username already exists) |
| 410 | Gone | Approval token already used or expired |
| 413 | Payload Too Large | Upload exceeds the configured size cap (`PAYLOAD_TOO_LARGE`) |
| 415 | Unsupported Media Type | Upload's actual MIME does not pass magic-byte validation (`UNSUPPORTED_MEDIA_TYPE`) |
| 422 | Unprocessable Entity | Valid syntax but semantic errors (e.g., approval link expired) |
| 429 | Too Many Requests | Rate limit exceeded or account locked |
| 500 | Internal Server Error | Unexpected server error (request_id returned) |

The two new codes (`413`, `415`) are added for upload endpoints (`/api/v1/socios/:socioId/attachments/*` for v1, future generic `/api/v1/files`). Both carry the standard `ApiError` envelope (`error`, `message`, `request_id`, optional `details`).

#### Scenario: 413 returned on oversize upload

- **WHEN** the body length exceeds the per-file cap (default 10 MB)
- **THEN** the response status SHALL be `413`
- **AND** the envelope SHALL carry `error: "PAYLOAD_TOO_LARGE"`
- **AND** the envelope MAY carry a `details: { field: "file", limit_bytes: 10485760 }` value

#### Scenario: 415 returned on bad MIME

- **WHEN** the multipart upload's actual sniffed MIME does not match the allowed list
- **THEN** the response status SHALL be `415`
- **AND** the envelope SHALL carry `error: "UNSUPPORTED_MEDIA_TYPE"`
- **AND** the envelope MAY carry a `details: { detected: "...", allowed: [...] }` value

#### Scenario: 413 and 415 use the standard envelope

- **WHEN** a request returns `413` or `415`
- **THEN** the body SHALL conform to `interface ApiError` (status code compatibility check)
- **AND** `request_id` SHALL be present

### Requirement: Request/Response Content Type

(Previously: "All request and response bodies MUST be `application/json`." The Note about `application/octet-stream` for downloads remains unchanged.)

All request and response bodies SHALL use `application/json` as the default. Two exceptions apply:

- **Multipart upload endpoints** (e.g., `POST /api/v1/socios/:socioId/attachments` and future generic `POST /api/v1/files`) SHALL accept `multipart/form-data` as their request content type. Responses SHALL still be `application/json`.
- **File download endpoints** (e.g., `GET /api/v1/socios/:socioId/attachments/:attachmentId/file`) MAY return `application/octet-stream` or the stored `mime_type` with a `Content-Disposition: attachment; filename="<original>"` header.

`Content-Type` MUST be set on every response that has a body. Multipart requests MUST set the boundary parameter; clients SHALL NOT set `Content-Type` manually on multipart payloads (the browser / `FormData` API sets it automatically with the correct boundary).

#### Scenario: Multipart upload is accepted

- **WHEN** a client posts `multipart/form-data` with a `file` field to a registered upload endpoint
- **THEN** the request SHALL be parsed correctly
- **AND** the file part SHALL be available to the route handler

#### Scenario: Multipart request without boundary is rejected

- **WHEN** a client sets `Content-Type: multipart/form-data` without a boundary parameter
- **THEN** the request SHALL be rejected with `400 VALIDATION_ERROR`

#### Scenario: JSON-only endpoints remain unchanged

- **WHEN** a client posts JSON to a non-upload endpoint (e.g., `POST /socios`)
- **THEN** the JSON content-type contract SHALL continue to apply
- **AND** the upload exception SHALL NOT bleed into JSON-only routes
