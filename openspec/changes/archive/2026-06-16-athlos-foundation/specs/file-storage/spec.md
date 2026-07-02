# File Storage Specification

## Purpose

Define the file storage subsystem for Athlos — how user-uploaded files (scanned membership cards, imported documents, generated reports) are received, persisted, retrieved, secured, and eventually removed. This spec covers the v1 local-filesystem backend with a swappable abstraction so the system can migrate to S3-compatible object storage (AWS S3, MinIO, Cloudflare R2) without changing call sites.

This spec addresses Gap #20 (BAJA) from the gaps analysis: uploads, storage backend choice, and size limits are explicitly defined here.

**Scope (v1)**: local filesystem backend only, supporting the core use case of scanned membership cards attached to `socios`. CSV imports and generated reports use the same primitive but are not the primary driver.

**Out of scope (v1)**: virus scanning, S3-compatible backends, public CDN delivery, image transformations, resumable uploads.

---

## Requirements

### Requirement: Use Cases for File Storage

The file storage subsystem SHALL support the following v1 use cases:

- **Scanned membership cards (carnets)**: PDF, JPG, or PNG files attached to a `socio` record, uploaded by an authenticated operator from the operator dashboard.
- **Imported documents**: CSV and other data files dropped into the import working directory by operators, not uploaded via the API (handled by `legacy-import` spec).
- **Generated reports**: PDF reports produced by the API and written to the storage volume, later downloaded by operators (read-only from the API's perspective).
- **Approval link attachments** (rare, future): reserved for v2 — no v1 API surface.

The system MUST NOT expose a generic public file browser. Every file MUST be addressable by ID and gated by authorization.

#### Scenario: Operator uploads a scanned carnet

- GIVEN an authenticated operator with role `admin` or `operador`
- WHEN they POST a PDF/JPG/PNG file via `POST /api/v1/files` with `owner_type=socio` and `owner_id=42`
- THEN the file SHALL be persisted to the storage backend
- AND a metadata row SHALL be created linking the file to socio 42

#### Scenario: Generated report is written by the API

- GIVEN a scheduled report job runs
- WHEN the report is generated
- THEN the report PDF SHALL be written to the storage backend at a path under `/reports/{year}/{month}/`
- AND a metadata row SHALL be created with `owner_type=report`

#### Scenario: CSV import file is NOT uploaded via the file API

- GIVEN an operator wants to import a CSV
- WHEN they attempt `POST /api/v1/files` with a `.csv` MIME type
- THEN the request MUST be rejected with `415 Unsupported Media Type` because CSV imports use the `legacy-import` working directory, not the file API

---

### Requirement: Storage Backend Abstraction

The system SHALL define a `FileStorage` interface that the application code depends on. v1 provides a `LocalFileStorage` implementation. v2 SHALL provide an `S3FileStorage` implementation for S3-compatible backends (AWS S3, MinIO, Cloudflare R2).

The interface MUST expose at minimum: `put(key, stream, metadata)`, `get(key) -> stream`, `delete(key)`, `exists(key)`, `getMetadata(key)`.

The backend selection MUST be driven by the `STORAGE_BACKEND` environment variable: `local` (default in v1) or `s3` (v2).

#### Scenario: Application code uses the abstraction

- GIVEN the application needs to read a file
- WHEN the application calls `fileStorage.get(fileKey)`
- THEN it SHALL NOT know or care whether the backend is local filesystem or S3

#### Scenario: Backend selection via env var

- GIVEN `STORAGE_BACKEND=local`
- WHEN the application starts
- THEN the `LocalFileStorage` implementation MUST be instantiated
- AND `STORAGE_LOCAL_ROOT` MUST be required and point to an existing directory

#### Scenario: S3 backend is not yet implemented

- GIVEN `STORAGE_BACKEND=s3`
- WHEN the application starts in v1
- THEN startup MUST fail with a clear error "S3 backend not yet implemented; use STORAGE_BACKEND=local"

---

### Requirement: Local Filesystem Backend (v1)

The v1 backend MUST store files on a Docker-mounted volume at the path defined by `STORAGE_LOCAL_ROOT` (default: `/app/storage` inside the container).

Files SHALL be organized in a deterministic, owner-scoped path layout to prevent collisions and to make backup operations simple:

```
{STORAGE_LOCAL_ROOT}/
├── socios/{socio_id}/{file_id}.{ext}
├── reports/{year}/{month}/{file_id}.pdf
└── misc/{owner_type}/{owner_id}/{file_id}.{ext}
```

The container MUST run with a non-root user that has read/write access to `STORAGE_LOCAL_ROOT` (permissions 0755 directories, 0644 files).

#### Scenario: File is written to the correct path

- GIVEN a file is uploaded for socio 42 with `file_id=01HX5K...` and `.pdf` extension
- WHEN the storage layer writes the file
- THEN the on-disk path MUST be `{STORAGE_LOCAL_ROOT}/socios/42/01HX5K....pdf`

#### Scenario: Storage volume is mounted in docker-compose

- GIVEN `docker-compose.yml` defines a `storage` named volume
- WHEN the `api` service starts
- THEN the volume MUST be mounted at `/app/storage` inside the container
- AND data MUST persist across container restarts

#### Scenario: Storage root is not writable

- GIVEN `STORAGE_LOCAL_ROOT=/app/storage` is mounted read-only
- WHEN an upload is attempted
- THEN the upload MUST fail with `500 STORAGE_UNAVAILABLE`
- AND the failure MUST be logged with the path and error

---

### Requirement: File Upload API

The system SHALL expose `POST /api/v1/files` for authenticated operators to upload files. The endpoint MUST accept `multipart/form-data` with the following fields:

- `file` (required): the binary file content
- `owner_type` (required): one of `socio`, `report`, `misc`
- `owner_id` (required): the ID of the owning entity (positive integer for numeric owners, ULID string otherwise)

The system MUST return `201 Created` with a JSON body containing `file_id`, `original_name`, `mime_type`, `size`, `uploaded_at`, and the download URL.

#### Scenario: Successful upload

- GIVEN an authenticated operator uploads a 2MB PDF with `owner_type=socio, owner_id=42`
- WHEN the request is processed
- THEN the response MUST be `201 Created` with a JSON body
- AND the file SHALL be persisted to `{STORAGE_LOCAL_ROOT}/socios/42/{file_id}.pdf`
- AND a metadata row SHALL be created with `uploaded_by` = the operator's ID

#### Scenario: Missing file field

- GIVEN an upload request without a `file` field
- WHEN the request is processed
- THEN the response MUST be `400 VALIDATION_ERROR` with details listing the missing field

#### Scenario: Missing owner_type or owner_id

- GIVEN an upload request missing `owner_type`
- WHEN the request is processed
- THEN the response MUST be `400 VALIDATION_ERROR`

#### Scenario: Operator is not authenticated

- GIVEN a request to `POST /api/v1/files` without a valid JWT
- WHEN the request is processed
- THEN the response MUST be `401 UNAUTHORIZED`

#### Scenario: Operator lacks permission for the owner

- GIVEN an operator with role `operador` uploads a file with `owner_type=socio, owner_id=42`
- AND the operator is NOT assigned to socio 42
- WHEN the request is processed
- THEN the response MUST be `403 FORBIDDEN`

---

### Requirement: File Size and MIME Type Limits

The system SHALL enforce the following limits:

- **Per file**: 5 MB maximum (configurable via `STORAGE_MAX_FILE_SIZE_BYTES`, default `5242880`).
- **Allowed MIME types (v1)**: `application/pdf`, `image/jpeg`, `image/png`. Configurable via `STORAGE_ALLOWED_MIME_TYPES` env var (comma-separated).
- **Per operator total quota**: 1 GB across all files owned by that operator. Enforced at upload time.
- **Per socio total quota**: 10 MB across all files attached to that socio. Enforced at upload time.

Requests exceeding any limit MUST be rejected with `413 PAYLOAD_TOO_LARGE` (size) or `415 UNSUPPORTED_MEDIA_TYPE` (MIME).

#### Scenario: File within size limit

- GIVEN a 3 MB PDF is uploaded
- WHEN the request is processed
- THEN the upload MUST succeed (3 MB < 5 MB)

#### Scenario: File exceeds size limit

- GIVEN a 6 MB PDF is uploaded
- WHEN the request is processed
- THEN the response MUST be `413 PAYLOAD_TOO_LARGE` with message "File exceeds 5 MB limit"
- AND no metadata row SHALL be created
- AND no file SHALL be persisted

#### Scenario: Disallowed MIME type

- GIVEN a `.exe` file is uploaded (MIME `application/octet-stream`)
- WHEN the request is processed
- THEN the response MUST be `415 UNSUPPORTED_MEDIA_TYPE`

#### Scenario: Operator quota exceeded

- GIVEN an operator has already uploaded 999 MB of files
- WHEN they attempt to upload a 2 MB file
- THEN the response MUST be `413 PAYLOAD_TOO_LARGE` with code `QUOTA_EXCEEDED`
- AND the message MUST mention operator quota

#### Scenario: Socio quota exceeded

- GIVEN socio 42 already has 9 MB of attached files
- WHEN an operator uploads a 2 MB file for socio 42
- THEN the response MUST be `413 PAYLOAD_TOO_LARGE` with code `QUOTA_EXCEEDED`
- AND the message MUST mention socio quota

---

### Requirement: File Retrieval API

The system SHALL expose `GET /api/v1/files/{id}` for downloading a file. The response MUST stream the file binary with the correct `Content-Type` and `Content-Disposition: attachment; filename="{original_name}"` headers.

Authorization SHALL be enforced as follows:

- The requesting operator MUST be authenticated.
- The operator MUST be allowed to read the owning entity (e.g., allowed to view socio 42 if the file is attached to socio 42).
- `admin` role MAY download any file.
- `operador` role MAY download files whose owner they have read access to.

#### Scenario: Authorized download

- GIVEN an operator assigned to socio 42 uploads a file
- WHEN they request `GET /api/v1/files/{id}`
- THEN the response MUST be `200 OK` with the file binary streamed
- AND `Content-Type` MUST match the stored MIME type
- AND `Content-Disposition` MUST include the original filename

#### Scenario: Unauthorized download

- GIVEN a file attached to socio 42
- WHEN an operator not assigned to socio 42 requests the file
- THEN the response MUST be `403 FORBIDDEN`

#### Scenario: File not found

- GIVEN a request for `GET /api/v1/files/nonexistent-id`
- WHEN the request is processed
- THEN the response MUST be `404 NOT_FOUND`

#### Scenario: File was soft-deleted

- GIVEN a file is soft-deleted (`deleted_at IS NOT NULL`)
- WHEN a download is requested
- THEN the response MUST be `404 NOT_FOUND` (soft-deleted files are invisible to all callers)

---

### Requirement: File Metadata

The system SHALL persist file metadata in a `files` table with the following columns:

| Column | Type | Description |
|---|---|---|
| `file_id` | ULID (primary key) | Public identifier, used in URLs |
| `original_name` | TEXT | Filename from the upload |
| `mime_type` | TEXT | Detected MIME type |
| `size_bytes` | BIGINT | File size in bytes |
| `storage_key` | TEXT | Internal path/key in the storage backend (e.g., `socios/42/01HX5K....pdf`) |
| `content_hash` | CHAR(64) | SHA-256 of file content, hex-encoded |
| `owner_type` | TEXT | `socio`, `report`, or `misc` |
| `owner_id` | TEXT | ID of the owning entity (TEXT to support both numeric and ULID owners) |
| `uploaded_by` | INT (FK to operators) | Operator who performed the upload |
| `uploaded_at` | TIMESTAMPTZ | Upload timestamp |
| `deleted_at` | TIMESTAMPTZ (nullable) | Soft-delete timestamp; NULL means active |
| `deleted_by` | INT (FK to operators, nullable) | Operator who performed the soft-delete |

A composite index on `(owner_type, owner_id)` MUST exist for fast owner-scoped queries. An index on `uploaded_by` MUST exist for operator-scoped queries. An index on `deleted_at` MUST exist for retention cleanup.

#### Scenario: Metadata row is created on upload

- GIVEN a successful upload
- WHEN the upload completes
- THEN a `files` row MUST exist with all required columns populated
- AND `uploaded_at` MUST be the current UTC timestamp

#### Scenario: List files attached to a socio

- GIVEN a socio has 3 attached files
- WHEN `GET /api/v1/socios/{id}/files` is called
- THEN the response MUST list only files where `owner_type=socio AND owner_id={id} AND deleted_at IS NULL`

#### Scenario: Content hash is computed

- GIVEN a file is uploaded with content bytes `B`
- WHEN the upload completes
- THEN `content_hash` MUST equal `SHA-256(B)` hex-encoded

---

### Requirement: File Deletion

The system SHALL use **soft delete** as the default. `DELETE /api/v1/files/{id}` MUST set `deleted_at` and `deleted_by`, leaving the file on disk.

Hard delete (physical removal) MUST only occur via the retention cleanup job described below. Operators MUST NOT have an API to hard-delete files.

Authorization for delete:
- The requesting operator MUST be authenticated.
- The operator MUST have upload permission for the file's owner (same as the upload authorization rule).
- Every delete MUST be recorded in the audit log with: `actor_id`, `file_id`, `owner_type`, `owner_id`, `timestamp`.

#### Scenario: Operator soft-deletes a file

- GIVEN a file attached to socio 42
- WHEN an authorized operator calls `DELETE /api/v1/files/{id}`
- THEN the response MUST be `204 No Content`
- AND `files.deleted_at` MUST be set to the current timestamp
- AND `files.deleted_by` MUST be set to the operator's ID
- AND the on-disk file MUST still exist

#### Scenario: Unauthorized delete

- GIVEN a file attached to socio 42
- WHEN an operator not assigned to socio 42 calls `DELETE /api/v1/files/{id}`
- THEN the response MUST be `403 FORBIDDEN`

#### Scenario: Audit log entry

- GIVEN a file is soft-deleted
- WHEN the operation completes
- THEN an audit log entry MUST exist with action `FILE_DELETE`, `actor_id`, `file_id`, `owner_type`, `owner_id`, `timestamp`

#### Scenario: Hard delete via retention job

- GIVEN a file has `deleted_at` older than the retention period (90 days)
- WHEN the retention cleanup job runs
- THEN the file MUST be physically removed from the storage backend
- AND the `files` row MUST be hard-deleted
- AND a separate audit log entry MUST be created with action `FILE_PURGE`

---

### Requirement: Retention Policy

Soft-deleted files SHALL be retained for **90 days** after deletion (configurable via `STORAGE_RETENTION_DAYS`, default `90`). After the retention period, the cleanup job MUST hard-delete them.

A scheduled job (defined in the `scheduler-jobs` spec) MUST run daily to purge expired soft-deleted files. The job MUST log the number of files purged and any errors.

Files that are NOT soft-deleted (active files) MUST NOT be purged by the retention job under any circumstance — the job operates exclusively on `deleted_at IS NOT NULL` rows.

#### Scenario: File is within retention period

- GIVEN a file was soft-deleted 30 days ago
- WHEN the retention job runs
- THEN the file MUST NOT be purged (30 < 90)

#### Scenario: File is past retention period

- GIVEN a file was soft-deleted 100 days ago
- WHEN the retention job runs
- THEN the file MUST be hard-deleted from storage
- AND the `files` row MUST be removed
- AND an audit log entry MUST be created

#### Scenario: Active files are never purged

- GIVEN an active file (no `deleted_at`) exists
- WHEN the retention job runs
- THEN the file MUST NOT be touched

---

### Requirement: Path Traversal Prevention

The system SHALL defend against path traversal attacks at every input boundary. Specifically:

- The `original_name` field MUST be sanitized to strip directory components (`/`, `\`, `..`) and replaced with a safe fallback (`"file_{file_id}.{ext}"`) if the sanitized name is empty or contains dangerous characters.
- The `storage_key` MUST be constructed by the system, NOT derived from user input. The `file_id` is server-generated (ULID) and `ext` is derived from the validated MIME type.
- Any attempt by a user to influence the on-disk path MUST be ignored.

#### Scenario: Filename contains directory traversal

- GIVEN a file is uploaded with `original_name="../../etc/passwd"`
- WHEN the upload completes
- THEN the stored `original_name` MUST be sanitized to `"file_{file_id}"` (or similar safe default)
- AND the `storage_key` MUST be of the form `socios/{owner_id}/{file_id}.{ext}` regardless of the original name

#### Scenario: Filename contains backslashes

- GIVEN `original_name="..\\..\\windows\\system32\\config\\sam"`
- WHEN the upload completes
- THEN the filename MUST be sanitized to remove all backslashes and directory components

#### Scenario: Storage key is server-controlled

- GIVEN any upload
- WHEN the file is persisted
- THEN the `storage_key` MUST be constructed from `{owner_type}/{owner_id}/{file_id}.{ext}` using only server-generated values

---

### Requirement: MIME Type Validation by Content

The system SHALL validate file type by **inspecting the file's magic bytes**, not by trusting the client-provided `Content-Type` header or the file extension.

The validator MUST use `file-type` (or equivalent) library to detect the actual MIME type from the first 4 KB of file content. If the detected MIME type is not in the allowed list, the upload MUST be rejected with `415 UNSUPPORTED_MEDIA_TYPE` even if the extension or Content-Type header claims a valid type.

#### Scenario: Client lies about content type

- GIVEN a file with `Content-Type: application/pdf` in the request
- BUT the actual content is a Windows executable (magic bytes `MZ`)
- WHEN the upload is processed
- THEN the validator MUST detect the actual type as `application/octet-stream`
- AND the upload MUST be rejected with `415 UNSUPPORTED_MEDIA_TYPE`

#### Scenario: Client lies about extension

- GIVEN a file named `carnet.pdf` with `Content-Type: application/pdf`
- BUT the content is a JPEG (magic bytes `FF D8 FF`)
- WHEN the upload is processed
- THEN the validator MUST detect the actual type as `image/jpeg`
- AND the upload MUST be allowed (image/jpeg is in the allowed list)
- AND the stored MIME type MUST be `image/jpeg`, not `application/pdf`

#### Scenario: File content matches declared type

- GIVEN a valid PDF (magic bytes `%PDF-`)
- WHEN the upload is processed
- THEN validation MUST pass and the upload MUST succeed

---

### Requirement: File Integrity Hashing

The system SHALL compute a SHA-256 hash of every uploaded file's content at upload time and store it in `files.content_hash`.

The hash MUST be computed as bytes are written to the storage backend (streaming hash, not load-then-hash) to support large files without memory pressure.

The hash SHALL be used for:
- **Deduplication detection** (future, not v1): if a file with the same hash is uploaded again, the system MAY short-circuit. v1 always stores the new copy.
- **Audit trail integrity**: the hash proves which bytes were stored at upload time.

#### Scenario: Hash is computed during write

- GIVEN a 4 MB file is uploaded
- WHEN the file is being persisted
- THEN the hash MUST be computed incrementally as bytes are written
- AND the in-memory peak MUST NOT exceed the configured buffer size (default 64 KB)

#### Scenario: Hash is verified on read (defensive)

- GIVEN a file is downloaded
- WHEN the file is read from storage
- THEN the system MAY verify the hash matches `files.content_hash` in a sample check (e.g., 1% of reads in dev, disabled in prod for performance)

---

### Requirement: File Listing Per Owner

The system SHALL expose `GET /api/v1/{owner_type}/{owner_id}/files` for listing files attached to a specific owner. For v1, the supported owner type is `socio` (via `GET /api/v1/socios/{socio_id}/files`).

The response MUST be a paginated list (cursor-based, per `api-design` spec) of file metadata objects (id, original_name, mime_type, size, uploaded_at, uploaded_by).

Authorization: the operator MUST have read access to the owner entity (same rules as download).

Soft-deleted files MUST NOT appear in listing responses.

#### Scenario: List files for a socio

- GIVEN socio 42 has 3 active files
- WHEN an authorized operator calls `GET /api/v1/socios/42/files`
- THEN the response MUST list exactly 3 file metadata objects
- AND no soft-deleted files MUST appear

#### Scenario: Empty list

- GIVEN socio 99 has 0 files
- WHEN `GET /api/v1/socios/99/files` is called
- THEN the response MUST be `200 OK` with an empty array

#### Scenario: Pagination

- GIVEN socio 42 has 150 files
- WHEN the operator calls with `?limit=50`
- THEN the response MUST contain 50 items and a `next_cursor` for the next page

---

### Requirement: Authorization Model

The system SHALL enforce a role-based authorization model for file operations:

| Role | Upload for self-assigned socio | Upload for any socio | Download any file | List files | Delete |
|---|---|---|---|---|---|
| `admin` | YES | YES | YES | YES | YES |
| `operador` | YES (only for assigned socios) | NO | YES (only for assigned socio files) | YES (only for assigned socios) | YES (only for assigned socio files) |
| `consulta` | NO | NO | YES (only for assigned socio files) | YES (only for assigned socios) | NO |
| Unauthenticated | NO | NO | NO | NO | NO |

Assignment of operators to socios is defined by the `user-management-rbac` spec.

#### Scenario: Consulta role cannot delete

- GIVEN an operator with role `consulta` assigned to socio 42
- WHEN they call `DELETE /api/v1/files/{id}` for a file on socio 42
- THEN the response MUST be `403 FORBIDDEN` with message "Role 'consulta' cannot delete files"

#### Scenario: Admin can act on any file

- GIVEN an admin operator
- WHEN they upload, download, or delete a file for any socio
- THEN the operation MUST succeed regardless of socio assignment

---

### Requirement: Volume Mount in Docker

The `deployment-devops` spec defines a `storage` named volume that SHALL be mounted at `/app/storage` inside the `api` container. The `STORAGE_LOCAL_ROOT` env var SHALL default to `/app/storage`.

The volume MUST be declared in `docker-compose.yml` as a named volume (not a bind mount) so that data persists across container recreations and is easy to back up via standard Docker tooling.

A backup of the storage volume SHOULD be included in the backup strategy alongside the PostgreSQL backup (see `deployment-devops` spec, Backup Strategy). The backup script SHOULD tar the storage volume daily and retain the tarball for 30 days.

#### Scenario: Storage volume is declared in docker-compose

- GIVEN `docker-compose.yml` defines the `api` service
- WHEN the compose file is parsed
- THEN a `storage` named volume MUST be declared at the top level
- AND the `api` service MUST mount `storage:/app/storage`

#### Scenario: Data persists across restarts

- GIVEN a file is uploaded to `/app/storage/socios/42/...`
- WHEN the `api` container is stopped and restarted
- THEN the file MUST still be accessible at the same path

#### Scenario: Storage backup is in backup strategy

- GIVEN the backup script `scripts/backup.sh` runs
- WHEN it executes
- THEN it MUST also tar the `storage` volume and store it at `/backups/storage-{timestamp}.tar.gz`

---

### Requirement: No Virus Scanning in v1

The system SHALL NOT include virus scanning in v1. This is an explicit non-goal deferred to v2.

The rationale: the file API is restricted to authenticated operators from a known IP range (configured at the reverse proxy level), file types are restricted to PDF/JPG/PNG, and operators are trusted club staff. The risk is low for v1.

This decision MUST be revisited before exposing the file API to external consumers or to mobile clients (planned for v2).

#### Scenario: File is accepted without virus scan

- GIVEN a PDF is uploaded in v1
- WHEN the upload completes
- THEN no virus scan MUST be performed
- AND the file MUST be stored as-is

---

### Requirement: No Public/Signed URLs in v1

The system SHALL NOT expose public or signed URLs in v1. All downloads MUST go through the authenticated `GET /api/v1/files/{id}` endpoint with the standard JWT in the `Authorization` header.

Signed URLs with expiry are deferred to v2. The rationale: the API is consumed by the operator dashboard only in v1, the dashboard already holds a valid JWT, and adding signed URLs is unnecessary complexity for the current threat model.

#### Scenario: Download requires authentication

- GIVEN a file is uploaded and has a stable `file_id`
- WHEN an unauthenticated client requests the file at any URL
- THEN the response MUST be `401 UNAUTHORIZED`

---

## Success Criteria

1. Operators can upload PDF/JPG/PNG files up to 5 MB and attach them to a socio via `POST /api/v1/files`.
2. Files are persisted to `/app/storage/socios/{socio_id}/{file_id}.{ext}` on the storage volume.
3. The `files` table contains all required metadata columns and indices.
4. The system rejects uploads exceeding 5 MB with `413 PAYLOAD_TOO_LARGE`.
5. The system rejects uploads with disallowed MIME types (validated by magic bytes) with `415 UNSUPPORTED_MEDIA_TYPE`.
6. The system enforces per-operator (1 GB) and per-socio (10 MB) quotas.
7. Authorized operators can download files via `GET /api/v1/files/{id}` with correct `Content-Type` and `Content-Disposition` headers.
8. Unauthorized operators receive `403 FORBIDDEN` on download and delete attempts.
9. `DELETE /api/v1/files/{id}` soft-deletes the file and creates an audit log entry.
10. The retention job hard-deletes soft-deleted files older than 90 days.
11. Path traversal attempts in `original_name` are sanitized; `storage_key` is always server-controlled.
12. MIME type validation uses magic bytes, not the client `Content-Type` header.
13. Content hash (SHA-256) is computed and stored for every uploaded file.
14. The `storage` volume is declared in `docker-compose.yml` and data persists across restarts.
15. The `FileStorage` interface allows swapping `LocalFileStorage` for `S3FileStorage` (v2) without changing call sites.
16. No virus scanning is performed in v1 (explicitly documented as a v2 enhancement).
17. No signed URLs are exposed in v1 (all downloads go through the authenticated API).
