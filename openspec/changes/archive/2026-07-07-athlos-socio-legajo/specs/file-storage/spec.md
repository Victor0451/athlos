# Delta for `file-storage`

This delta realises the dormant `file-storage` spec for the `socio_attachments` resource in v1 of `athlos-socio-legajo`. It locks the v1 scope and codifies the codebase-consistency overrides identified during exploration.

## ADDED Requirements

### Requirement: Primary Key is UUID (Not ULID) for v1

The v1 `socio_attachments` primary key SHALL be a PostgreSQL `UUID` with `default gen_random_uuid()`, NOT a ULID. (Reason: all sibling tables in `packages/db/src/schema/socios.ts` — `socios`, `socio_notes`, `operators` — already use `uuid defaultRandom()`. The spec's ULID choice was aspirational prose predating implementation; switching would require a new dependency with no functional payoff.)

The `LocalFileStorage` abstraction remains generic over the identifier type, so the storage layer SHALL be re-abstracted when the codebase as a whole migrates to ULID (a future change can lift the underlying type back to `string` with no call-site changes).

#### Scenario: V1 attachment row has a UUID primary key

- **WHEN** a successful upload creates a `socio_attachments` row
- **THEN** the `id` column SHALL be a UUIDv4 (random) value
- **AND** the value SHALL match `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`
- **AND** the URL path `/api/v1/socios/<socioId>/attachments/<attachmentId>` SHALL echo that value verbatim

#### Scenario: Storage layer does not depend on the PK type

- **WHEN** the codebase later migrates the `socio_attachments.id` column to ULID
- **THEN** the `LocalFileStorage` interface SHALL accept the new type with no signature changes
- **AND** only the schema column type and the route param parser SHALL change

### Requirement: V1 Per-Socio Quota — 100 Files OR 500 MB

The v1 per-socio quota SHALL be:

- **Files**: at most 100 active (non-soft-deleted) attachments per `socio_id`.
- **Bytes**: at most 524 288 000 bytes (500 MB) of total `size_bytes` per `socio_id`.

The first cap reached SHALL cause the next upload to be rejected. The spec's prior values (10 MB per-socio; 1 GB per-operator) are SUPERSEDED for v1; the per-operator quota (1 GB) is NOT implemented in v1 — per-operator caps are deferred to a future change.

#### Scenario: File count cap rejects the 101st upload

- **GIVEN** a socio with 100 active attachments
- **WHEN** an upload of a 100 KB file is requested
- **THEN** the response status SHALL be `400 QUOTA_EXCEEDED` with `details: { cap: "files", limit: 100 }`
- **AND** no row SHALL be inserted
- **AND** no on-disk file SHALL remain

#### Scenario: Bytes cap rejects the upload that would exceed 500 MB

- **GIVEN** a socio whose active attachments total 499 999 000 bytes
- **WHEN** an upload of 2 MB is requested
- **THEN** the response status SHALL be `400 QUOTA_EXCEEDED` with `details: { cap: "bytes", limit: 524288000 }`

#### Scenario: Per-operator quota is not enforced in v1

- **WHEN** an operator uploads files that exceed 1 GB cumulative across all their uploads
- **THEN** the upload SHALL succeed (no per-operator cap is checked)
- **AND** the per-socio caps still apply

### Requirement: V1 Per-File Size Cap — 10 MB

The v1 per-file size cap SHALL be 10 485 760 bytes (10 MB), configurable via `STORAGE_MAX_FILE_SIZE_BYTES`. This supersedes the spec's prior 5 MB cap; the increase accommodates scanned comprobantes and small contracts that frequently exceed 5 MB.

#### Scenario: 10 MB file is accepted

- **WHEN** a request posts a file whose size is exactly 10 485 760 bytes
- **THEN** the upload SHALL proceed to MIME validation and quota checks

#### Scenario: 10 MB + 1 byte is rejected with 413

- **WHEN** a request posts a file whose size is 10 485 761 bytes
- **THEN** the response status SHALL be `413 PAYLOAD_TOO_LARGE`

### Requirement: V1 Magic-Byte Table — JPEG / PNG / GIF / WEBP / PDF

The v1 magic-byte validator SHALL accept only the following types via this exact byte table:

| Detected MIME | Leading magic bytes | Additional trailer check |
|---|---|---|
| `image/jpeg` | `FF D8 FF` | none |
| `image/png` | `89 50 4E 47 0D 0A 1A 0A` | none |
| `image/gif` | `47 49 46 38` followed by `37 61` or `38 61` | none |
| `image/webp` | `52 49 46 46 ?? ?? ?? ?? 57 45 42 50` (RIFF at 0, WEBP at 8) | none |
| `application/pdf` | `25 50 44 46 2D` (`%PDF-`) | `25 25 45 4F 46` (`%%EOF`) in trailing 1 024 bytes |

The validator SHALL sniff the leading bytes from the first 4 KB (or the whole file if smaller) and, for PDFs only, also confirm a `%%EOF` marker in the trailing 1 024 bytes. Client-declared `Content-Type` and filename extension SHALL be IGNORED — only the sniffed result counts.

#### Scenario: Valid PDF passes both checks

- **WHEN** a file's first bytes are `25 50 44 46 2D` AND its trailing 1 024 bytes contain `25 25 45 4F 46`
- **THEN** the validator SHALL classify the file as `application/pdf`
- **AND** the upload SHALL continue

#### Scenario: Mismatched extension is detected

- **WHEN** a request posts a file named `carnet.pdf` with `Content-Type: application/pdf`
- **AND** the actual content begins with `FF D8 FF` (JPEG magic)
- **THEN** the validator SHALL classify the file as `image/jpeg`
- **AND** the upload SHALL continue as an image
- **AND** the stored `mime_type` SHALL be `image/jpeg`

### Requirement: V1 Authentication — Any Authenticated Operator (No Role Gate)

In v1 the file/attachment operations SHALL require JWT authentication (`requireAuth()`) but SHALL NOT check role or socio-assignment. Any authenticated operator may upload, list, retrieve, download, and soft-delete any attachment. This matches the existing `/socios/:id/notes` semantic and avoids an RBAC matrix that the codebase does not currently model.

The spec's prior "admin OR assigned-operador" matrix is SUPERSEDED for v1. Role gating (if reintroduced later) is a backend-only change; no call sites need to change.

#### Scenario: OPERADOR role can delete an attachment

- **WHEN** an authenticated operator with role `OPERADOR` calls `DELETE /api/v1/socios/<socioId>/attachments/<attachmentId>`
- **THEN** the response status SHALL be `204 No Content`
- **AND** no role-mismatch error SHALL be raised

#### Scenario: CONSULTA role can download

- **WHEN** an authenticated operator with role `CONSULTA` calls `GET /api/v1/socios/<socioId>/attachments/<attachmentId>/file`
- **THEN** the response status SHALL be `200 OK` with the file stream
- **AND** no role-mismatch error SHALL be raised

#### Scenario: Missing JWT is rejected regardless of role

- **WHEN** a request arrives with no `Authorization: Bearer <token>` header
- **THEN** the response status SHALL be `401 UNAUTHORIZED`

### Requirement: V1 Deferral — Generic `POST /api/v1/files` Endpoint

The generic `POST /api/v1/files` endpoint (with `owner_type` / `owner_id` polymorphism) that the `file-storage` spec describes SHALL NOT be exposed in v1. The v1 surface is the five `socio_attachments` routes under `/api/v1/socios/:socioId/attachments/*` only. Routes for `owner_type = report` and `owner_type = misc` are deferred to a future change.

The `LocalFileStorage` abstraction, content-addressed layout, magic-byte validator, and quota transaction are all still built to be reusable when the generic endpoint lands; no design decision in this delta SHALL lock out future work.

#### Scenario: Generic `POST /api/v1/files` returns 404 in v1

- **WHEN** a client calls `POST /api/v1/files` with multipart payload
- **THEN** the response status SHALL be `404 NOT_FOUND` (route is not registered)

#### Scenario: Generic `GET /api/v1/files/:id` returns 404 in v1

- **WHEN** a client calls `GET /api/v1/files/<any-id>`
- **THEN** the response status SHALL be `404 NOT_FOUND` (route is not registered)
- **AND** callers SHALL use `GET /api/v1/socios/<socioId>/attachments/<attachmentId>/file` instead

## MODIFIED Requirements

### Requirement: Authorization Model

(Previously: the spec defined a full role matrix — `admin` MAY, `operador` only-for-assigned-socios, `consulta` no-delete, unauthenticated no-access.)

The system SHALL enforce a minimal authorization model for the `socio_attachments` resource in v1: any authenticated operator may perform any of the five CRUD operations (upload, list, metadata, download, soft-delete). Role gating (if reintroduced in a future change) SHALL be defined as a separate, additive requirement so existing call sites continue to compile.

#### Scenario: Any authenticated operator uploads

- **WHEN** an authenticated operator calls `POST /api/v1/socios/<socioId>/attachments` with a valid payload
- **THEN** the upload SHALL succeed (no role check is performed)

#### Scenario: Missing JWT is rejected

- **WHEN** a request arrives without an `Authorization` header
- **THEN** the response status SHALL be `401 UNAUTHORIZED`
- **AND** no file SHALL be written

#### Scenario: Role semantics of notes apply (consultative match)

- **WHEN** the project's `/socios/:id/notes` endpoint accepts a write from the same operator
- **THEN** the corresponding `/socios/<socioId>/attachments/*` write SHALL also accept it
- **AND** the two endpoints SHALL share the same authz model (`requireAuth()` only)
