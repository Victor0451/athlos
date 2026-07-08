# Delta for `api-design`

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
