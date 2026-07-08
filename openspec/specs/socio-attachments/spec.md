# Socio Attachments Specification

> Synced from change `athlos-socio-legajo` (2026-07-07).

## Purpose

Per-socio attachment management — drag-and-drop upload, categorised list, preview, soft delete — at `/socios/[id]` via a new "Legajo" tab. Each attachment is validated against a magic-byte table (JPEG/PNG/GIF/WEBP/PDF), persisted to the local filesystem with a content-addressable on-disk layout, governed by a per-socio quota (100 active files OR 500 MB total), and every upload + soft delete emits an `audit_event` row. The feature realises the dormant `file-storage` spec for the `socio_attachments` resource only; a generic `POST /api/v1/files` is deferred.

## Requirements

### Requirement: Five Socio-Attachment Routes

The system SHALL expose five routes under `/api/v1/socios/:socioId/attachments`:

| Method | Path | Purpose | Success |
|---|---|---|---|
| `POST` | `/api/v1/socios/:socioId/attachments` | Multipart upload (single file ≤ 10 MB) | `201 Created` |
| `GET` | `/api/v1/socios/:socioId/attachments` | List active attachments, optional `?category=` | `200 OK` |
| `GET` | `/api/v1/socios/:socioId/attachments/:attachmentId` | Single attachment metadata | `200 OK` |
| `GET` | `/api/v1/socios/:socioId/attachments/:attachmentId/file` | Stream file bytes | `200 OK` |
| `DELETE` | `/api/v1/socios/:socioId/attachments/:attachmentId` | Soft delete | `204 No Content` |

#### Scenario: Upload returns 201 with new metadata

- **WHEN** a valid 2 MB JPEG is posted via `multipart/form-data` with field `file`
- **THEN** the response status SHALL be `201 Created`
- **AND** the body SHALL contain `id`, `socioId`, `filename`, `description`, `category`, `mimeType`, `sizeBytes`, `uploadedAt`, `uploadedBy`

#### Scenario: GET list returns active attachments only

- **WHEN** `GET /api/v1/socios/<socioId>/attachments` is called and the socio has 3 active + 2 soft-deleted attachments
- **THEN** the response SHALL be `200 OK` and return exactly 3 items
- **AND** no soft-deleted row SHALL appear in the response

#### Scenario: GET list with `?category=` filter

- **WHEN** `GET /api/v1/socios/<socioId>/attachments?category=dni` is called
- **THEN** the response SHALL include ONLY attachments with `category = "dni"`
- **AND** attachments of other categories SHALL be excluded

#### Scenario: GET single metadata returns 200 for active, 404 for soft-deleted

- **WHEN** `GET /api/v1/socios/<socioId>/attachments/<attachmentId>` is called for an active attachment
- **THEN** the response SHALL be `200 OK` with the metadata JSON
- **WHEN** the same call is made after the attachment has been soft-deleted
- **THEN** the response SHALL be `404 NOT_FOUND`

#### Scenario: GET file stream returns 200 with Content-Type + Content-Disposition

- **WHEN** `GET /api/v1/socios/<socioId>/attachments/<attachmentId>/file` is called for an active PDF
- **THEN** the response SHALL be `200 OK` with the file bytes streamed
- **AND** the `Content-Type` header SHALL match the stored `mime_type` (e.g., `application/pdf`)
- **AND** the `Content-Disposition` header SHALL equal `attachment; filename="<original filename>"`

#### Scenario: GET file stream returns 404 for soft-deleted

- **WHEN** `GET /api/v1/socios/<socioId>/attachments/<attachmentId>/file` is called after the attachment has been soft-deleted
- **THEN** the response SHALL be `404 NOT_FOUND`

### Requirement: JWT Authentication on All Five Routes (No Role Gate)

The system SHALL require a valid JWT on every one of the five attachment routes. There SHALL be no role gate — any authenticated operator may upload, list, retrieve, download, and soft-delete any attachment (matches `/socios/:id/notes` semantics). Requests missing a Bearer token SHALL be rejected with `401 UNAUTHORIZED`.

#### Scenario: Missing JWT is rejected on POST upload

- **WHEN** a file is posted without an `Authorization: Bearer <token>` header
- **THEN** the response status SHALL be `401 UNAUTHORIZED`
- **AND** no file SHALL be written
- **AND** no row SHALL be inserted

#### Scenario: Missing JWT is rejected on GET list

- **WHEN** `GET /api/v1/socios/<socioId>/attachments` is called without an Authorization header
- **THEN** the response status SHALL be `401 UNAUTHORIZED`

#### Scenario: Any authenticated operator may delete (no role gate)

- **WHEN** an operator with role `OPERADOR` and valid JWT calls `DELETE /api/v1/socios/<socioId>/attachments/<attachmentId>`
- **THEN** the response status SHALL be `204 No Content`

### Requirement: MIME Allow-List of Five Types

The system SHALL accept only files whose detected MIME is one of: `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `application/pdf`. Files whose sniffed MIME is not on the list SHALL be rejected with `415 UNSUPPORTED_MEDIA_TYPE` regardless of the client-declared `Content-Type` or filename extension.

#### Scenario: Disallowed type is rejected

- **WHEN** a file whose sniffed type is `application/zip` is uploaded
- **THEN** the response status SHALL be `415 UNSUPPORTED_MEDIA_TYPE`
- **AND** no row SHALL be inserted
- **AND** no file SHALL remain on disk

### Requirement: 10 MB Per-File Size Cap With 413 Rejection

The system SHALL reject any single upload whose size exceeds 10 485 760 bytes (10 MB) with `413 PAYLOAD_TOO_LARGE`. The cap SHALL be enforced both by `@fastify/multipart`'s `limits.fileSize` AND by an explicit route-level check before any disk write or DB insert.

#### Scenario: File above 10 MB is rejected with 413

- **WHEN** a file of 10 485 761 bytes is uploaded
- **THEN** the response status SHALL be `413 PAYLOAD_TOO_LARGE`
- **AND** no row SHALL be inserted
- **AND** no file SHALL remain on disk

### Requirement: Magic-Byte MIME Validation With Rollback

The system SHALL sniff the first 4 KB (or full file if smaller) PLUS the trailing 1 024 bytes for the PDF trailer, comparing against this table:

| Detected MIME | Leading magic bytes | Trailer |
|---|---|---|
| `image/jpeg` | `FF D8 FF` | — |
| `image/png` | `89 50 4E 47 0D 0A 1A 0A` | — |
| `image/gif` | `47 49 46 38` then `37 61` or `38 61` | — |
| `image/webp` | `52 49 46 46 ?? ?? ?? ?? 57 45 42 50` (RIFF + WEBP at offset 8) | — |
| `application/pdf` | `25 50 44 46 2D` (`%PDF-`) | `25 25 45 4F 46` (`%%EOF`) in trailing 1 024 bytes |

Mismatches SHALL trigger a full rollback: partial file unlinked, row deleted, response `415 UNSUPPORTED_MEDIA_TYPE`.

#### Scenario: Client lies — declared JPEG, actual PDF

- **WHEN** a file with `Content-Type: image/jpeg` whose sniffed type is `application/pdf` is uploaded
- **THEN** the response status SHALL be `415 UNSUPPORTED_MEDIA_TYPE`
- **AND** the DB row (if any) SHALL be deleted
- **AND** the on-disk file SHALL be unlinked

#### Scenario: Valid PDF passes both leading and trailer checks

- **WHEN** a file's first bytes are `%PDF-` AND its trailing 1 024 bytes contain `%%EOF`
- **THEN** the validation SHALL pass
- **AND** the upload SHALL continue

### Requirement: Content-Addressed Storage Layout With Atomic Rename

The system SHALL persist each attachment to `<STORAGE_LOCAL_ROOT>/socios/<socio_id>/<attachment_id>.<ext>` via atomic-rename: stream to `<STORAGE_LOCAL_ROOT>/.tmp/<uuid>.part`, then `rename(2)` to the final path. The streaming pass SHALL compute SHA-256 incrementally over a 64 KB buffer; the in-memory peak SHALL NOT exceed 64 KB. The DB row SHALL store `storage_path` and `storage_sha256` (hex, 64 chars).

#### Scenario: File is written via atomic rename

- **WHEN** a successful upload completes
- **THEN** no `.tmp/<uuid>.part` file SHALL remain on disk
- **AND** the file SHALL exist at `<STORAGE_LOCAL_ROOT>/socios/<socio_id>/<attachment_id>.<ext>`
- **AND** the row's `storage_path` SHALL equal that server-controlled path

### Requirement: Per-Socio Quota — 100 Files OR 500 MB

The system SHALL enforce a per-socio quota: at most 100 active (non-soft-deleted) attachments OR 500 MB (524 288 000 bytes) total — whichever first. Exceeding either SHALL cause the upload to be rejected with `400 QUOTA_EXCEEDED` and `details: { cap: "files" | "bytes", limit, current }`. Soft-deleting an attachment releases its quota immediately.

#### Scenario: File count cap rejects the 101st upload

- **GIVEN** a socio with 100 active attachments
- **WHEN** a 100 KB file is uploaded
- **THEN** the response status SHALL be `400 QUOTA_EXCEEDED` with `details: { cap: "files", limit: 100 }`
- **AND** no row SHALL be inserted
- **AND** no file SHALL remain on disk

#### Scenario: Bytes cap rejects upload that would exceed 500 MB

- **GIVEN** a socio with active attachments totalling 499 999 000 bytes
- **WHEN** a 2 MB upload is requested (would push total to ~502 MB)
- **THEN** the response status SHALL be `400 QUOTA_EXCEEDED` with `details: { cap: "bytes", limit: 524288000 }`

#### Scenario: Soft delete releases quota immediately

- **GIVEN** a socio at 100/100 files
- **WHEN** one attachment is soft-deleted
- **THEN** a subsequent upload of a small file SHALL be accepted
- **AND** the active row count SHALL be 100 again

### Requirement: Quota Enforced In a Transaction With FOR SHARE

The system SHALL enforce the quota inside a transaction in which `SELECT COUNT(*)` and `SELECT COALESCE(SUM(size_bytes), 0)` from `socio_attachments` filtered by `socio_id = $1 AND deleted_at IS NULL` carry `FOR SHARE` row locks. The locks SHALL hold until COMMIT. A second concurrent transaction SHALL block on the lock, re-read on unblock, and reject with `400 QUOTA_EXCEEDED`. Without these locks concurrent uploads can collectively exceed the cap.

#### Scenario: Two simultaneous uploads — one wins, one fails

- **GIVEN** a socio at 99/100 files
- **WHEN** two uploads from different sessions start in parallel
- **THEN** exactly one SHALL succeed (count becomes 100)
- **AND** the other SHALL be rejected with `400 QUOTA_EXCEEDED`
- **AND** the rejection SHALL NOT depend on which request arrived first (deterministic `FOR SHARE` outcome)

#### Scenario: FOR SHARE blocks concurrent quota checks

- **WHEN** two transactions both read the count for the same socio at the same time
- **THEN** the second `SELECT ... FOR SHARE` SHALL block until the first commits
- **AND** the second transaction SHALL observe the first transaction's insert on re-read

### Requirement: `socio_attachments` Table — UUID PK, FK to Socio and Operator

The system SHALL store attachments in `socios.socio_attachments` with:

- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` (NOT ULID — codebase consistency)
- `socio_id UUID NOT NULL` referencing `socios.socios.id`
- `filename TEXT NOT NULL` (server-sanitized, ≤ 255)
- `description TEXT` (nullable, ≤ 500)
- `category TEXT NOT NULL` — `dni | comprobante | foto | contrato | otro`
- `mime_type TEXT NOT NULL`, `size_bytes BIGINT NOT NULL`
- `storage_path TEXT NOT NULL`, `storage_sha256 TEXT NOT NULL` (char(64) hex)
- `uploaded_by UUID NOT NULL`, `uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `deleted_at TIMESTAMPTZ` (nullable), `deleted_by UUID` (nullable)

Indexes SHALL include `(socio_id, deleted_at)`, `(socio_id, category)`, `(storage_sha256)`, and `uploaded_at DESC`.

#### Scenario: Duplicate bytes from same socio create separate rows

- **GIVEN** a socio with one active JPEG attachment (`storage_sha256 = X`)
- **WHEN** the same JPEG bytes are uploaded again for the same socio
- **THEN** a second active row SHALL exist with a different `id`
- **AND** both rows SHALL count toward the 100-file quota

#### Scenario: Same bytes from different socio share disk

- **GIVEN** socio A has an active attachment with `storage_sha256 = X`
- **WHEN** socio B uploads the same bytes
- **THEN** a new active row SHALL exist for socio B (separate `id`, separate `socio_id`)
- **AND** soft-deleting socio A's row SHALL NOT remove the on-disk file while socio B's row is still active

### Requirement: Soft Delete — Set `deleted_at`, Defer Physical Purge

The system SHALL perform soft delete by setting `deleted_at = now()` and `deleted_by = <operator>` on the matching row. The on-disk file SHALL remain intact until a future retention cron (out of scope here) verifies `count_active_pointers(storage_path) = 0`.

#### Scenario: Soft delete sets `deleted_at` and returns 204

- **WHEN** an authenticated operator calls `DELETE /api/v1/socios/<socioId>/attachments/<attachmentId>` for an active row
- **THEN** the row's `deleted_at` SHALL equal `now()`
- **AND** the row's `deleted_by` SHALL equal the caller's operator id
- **AND** the on-disk file SHALL still exist
- **AND** the response status SHALL be `204 No Content`

#### Scenario: Soft-deleted row is invisible to metadata, file, and list

- **WHEN** any of `GET /api/v1/socios/<socioId>/attachments/<attachmentId>`, `GET .../file`, or `GET .../attachments` references a soft-deleted attachment id
- **THEN** the response SHALL be `404 NOT_FOUND` for the per-id endpoints
- **AND** the list endpoint SHALL NOT include the soft-deleted row

### Requirement: Audit Events on Upload and Soft Delete With Full Metadata

The system SHALL emit an `audit_event` row on each successful upload AND each successful soft delete via the extended `emitAudit()` helper from `@athlos/audit/emitter`, which accepts an optional `metadata` field persisted into `audit_events.metadata`:

| Action | Entity Type | Required `metadata` keys |
|---|---|---|
| `SOCIO_ATTACHMENT_UPLOADED` | `socio_attachment` | `attachment_id`, `filename`, `category`, `size_bytes` |
| `SOCIO_ATTACHMENT_DELETED` | `socio_attachment` | `attachment_id`, `filename`, `category`, `size_bytes` |

Missing any of the four required keys SHALL fail the audit test. Audit emission is best-effort — a failed audit insert MUST NOT roll back the upload or delete.

#### Scenario: Upload audit row contains full metadata

- **WHEN** a successful upload completes for `attachmentId = "abc"`, `category = "dni"`, `filename = "front.jpg"`, `size_bytes = 524288`
- **THEN** exactly one `audit_events` row SHALL exist with `action = "SOCIO_ATTACHMENT_UPLOADED"`
- **AND** `metadata` SHALL be a JSON object containing `attachment_id = "abc"`, `filename = "front.jpg"`, `category = "dni"`, `size_bytes = 524288`

#### Scenario: Soft delete audit row contains full metadata

- **WHEN** a successful soft delete completes
- **THEN** exactly one `audit_events` row SHALL exist with `action = "SOCIO_ATTACHMENT_DELETED"`
- **AND** `metadata` SHALL be a JSON object containing `attachment_id`, `filename`, `category`, `size_bytes`

#### Scenario: Failed audit emission does not roll back the upload

- **WHEN** an upload succeeds but the audit insert throws
- **THEN** the file SHALL remain on disk
- **AND** the row SHALL remain in `socio_attachments`
- **AND** the API response SHALL still be `201 Created`

### Requirement: Docker `storage` Volume Mounted at `/app/storage`

The system SHALL declare a `storage` named volume in `docker-compose.yml` at the top level and mount it at `/app/storage` inside the `api` service. The container SHALL be able to read and write under `/app/storage`. Data SHALL persist across container restarts.

#### Scenario: Storage volume is declared and mounted

- **WHEN** `docker-compose.yml` is parsed
- **THEN** a top-level `volumes: { storage: {} }` declaration SHALL exist
- **AND** the `api` service SHALL mount `storage:/app/storage`
- **AND** files written to `/app/storage` SHALL persist across `docker compose restart api`

### Requirement: UI — "Legajo" Tab + Drag-and-Drop + Picker

The system SHALL add a `legajo` tab to `/socios/[id]` (after `Auditoría`), rendering `<LegajoTab socioId={id} />`. The panel SHALL provide a drag-and-drop zone and a file picker button (both supported), accept only the allow-list MIME types, and validate client-side (MIME + size ≤ 10 MB) BEFORE calling the API. Drop visuals: `border-accent bg-accent-soft` on `dragover`.

#### Scenario: Drag-and-drop triggers upload

- **WHEN** the operator drops a valid 2 MB JPEG onto the drop zone
- **THEN** `POST /api/v1/socios/<socioId>/attachments` SHALL be called via `FormData` with field `file`
- **AND** the new attachment SHALL appear in the grid without a full page refresh

#### Scenario: File picker triggers upload

- **WHEN** the operator clicks the picker button and selects a valid 500 KB PDF
- **THEN** `POST /api/v1/socios/<socioId>/attachments` SHALL be called via `FormData`
- **AND** the new attachment SHALL appear in the grid

#### Scenario: Oversize file shows inline error and does NOT call the API

- **WHEN** the operator drops a 12 MB file
- **THEN** the API SHALL NOT be called
- **AND** an inline error message ("Archivo excede 10 MB") SHALL display

#### Scenario: Disallowed MIME shows inline error and does NOT call the API

- **WHEN** the operator drops a `.txt` file
- **THEN** the API SHALL NOT be called
- **AND** an inline error message ("Tipo de archivo no permitido") SHALL display

### Requirement: UI — Attachment Grid + Image Thumbnail + PDF Icon

The system SHALL render active attachments as a grid where image attachments display a thumbnail via `<img src="…/file">`, PDF attachments display a Lucide `FileText` icon + filename + download link (NO thumbnail in v1), and every card shows filename, category badge, uploader + date, and size in KB/MB.

#### Scenario: Image card shows thumbnail

- **WHEN** the grid renders an active image attachment
- **THEN** the card SHALL include an `<img>` whose `src` is the file-stream endpoint
- **AND** the image SHALL load successfully while authenticated

#### Scenario: PDF card shows icon and download link

- **WHEN** the grid renders an active PDF attachment
- **THEN** the card SHALL show a Lucide `FileText` icon and the original filename
- **AND** SHALL include a download `<a href=".../file" download>` link
- **AND** SHALL NOT render an `<img>` thumbnail

### Requirement: UI — Preview Modal + Delete Confirm + Toast Feedback

The system SHALL provide a preview `<Modal>` (image inline for images, `<a download>` for PDFs), a delete confirmation `<Modal>` (reuse the existing primitive; destructive button), and post-mutation toast feedback via the existing `notify('success' | 'error', …)` wrapper.

#### Scenario: Click on image card opens preview modal

- **WHEN** the operator clicks an image attachment card
- **THEN** a `<Modal>` SHALL open with the image rendered at full size
- **AND** clicking close SHALL close the modal

#### Scenario: Delete confirm triggers soft delete and toast on success

- **WHEN** the operator confirms the delete dialog
- **THEN** `DELETE /api/v1/socios/<socioId>/attachments/<attachmentId>` SHALL be called
- **AND** on `204`, the card SHALL disappear from the grid
- **AND** `notify('success', 'Archivo eliminado')` SHALL fire

#### Scenario: Delete failure shows error toast and preserves the card

- **WHEN** the delete call rejects
- **THEN** `notify('error', 'No se pudo eliminar el archivo')` SHALL fire
- **AND** the card SHALL remain in the grid

#### Scenario: Upload success shows success toast

- **WHEN** an upload resolves with `201`
- **THEN** `notify('success', 'Archivo subido')` SHALL fire
- **AND** the new card SHALL appear in the grid

## Success Criteria

- All 14 requirements pass their scenarios (≥ 30 scenarios).
- Backend tests cover: 5 routes, JWT gating, MIME allow-list, size cap, magic-byte table, quota transaction with `FOR SHARE` concurrency, soft delete.
- Frontend tests cover: drop zone, picker, oversized/disallowed client-side check, preview modal, delete confirm, toast wiring.
- Migration `packages/db/drizzle/0021_socio_attachments.sql` is hand-written, applied via `docker exec` (NOT `pnpm migrate`).
- `docker-compose.yml` declares `volumes: { storage: {} }` and mounts `storage:/app/storage` on the `api` service.
- 1:1 source:test ratio on all new files; `pnpm typecheck` + `pnpm lint` clean.
- Audit metadata shape asserted in test: `audit_events.metadata` contains `attachment_id`, `filename`, `category`, `size_bytes` for both `SOCIO_ATTACHMENT_UPLOADED` and `SOCIO_ATTACHMENT_DELETED`.