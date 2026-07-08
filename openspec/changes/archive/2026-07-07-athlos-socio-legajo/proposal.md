# Proposal: Socio Legajo (per-socio attachments)

## Why

A "legajo virtual" per socio — drag-and-drop upload + categorised list + soft delete — gives the operator one place for everything related to a socio (DNI scans, comprobantes, fotos, contratos). The existing `file-storage` spec is dormant prose; this change realises it for the first time, scoped to the `socio_attachments` resource. Soft delete with audit trail matches the rest of the modulo Socios (notes, audit events).

## What changes

- Realises the dormant `file-storage` spec: `LocalFileStorage` (atomic-rename writes, streaming SHA-256, content-addressed dedup), `STORAGE_LOCAL_ROOT` env var, `storage` named Docker volume, magic-byte validation, soft-delete + 90-day retention deferred.
- New table `socios.socio_attachments` (UUID PK, FK to socio + operator, file metadata, `deleted_at`).
- 5 API routes under `/api/v1/socios/:id/attachments/*`:
  - `POST` (multipart upload, single file) → 201
  - `GET` (list active, optional `?category=`) → 200
  - `GET /:attachmentId` (metadata)
  - `GET /:attachmentId/file` (stream bytes, Content-Type + Content-Disposition)
  - `DELETE /:attachmentId` (soft delete; releases quota immediately)
- Quota enforcement: 100 files OR 500 MB per socio, in a transaction with `SELECT … FOR SHARE` to avoid concurrent-upload races; reject 413 `QUOTA_EXCEEDED`.
- Magic-byte validation: sniff first 4 KB + PDF trailer before accepting; reject 415 + roll back row + unlink file on mismatch.
- Audit: extend `emitAudit()` to accept `metadata`. Emit `SOCIO_ATTACHMENT_UPLOADED` + `SOCIO_ATTACHMENT_DELETED` with `{ attachment_id, filename, category, size_bytes }`.
- UI: new `LegajoTab` on `/socios/[id]` with drag-and-drop zone, file picker, thumbnail grid (images) + PDF icon, preview modal, delete with confirm.
- Toasts: existing `notify()` helper from `athlos-toast-primitivo`.
- Docker: `docker-compose.yml` adds `volumes: { storage: {} }` top-level + mounts at `api` service.
- Migration: hand-written `packages/db/migrations/0021_socio_attachments.sql` (drizzle pipeline is broken in prod).

## Scope

**In (production code):**
- `apps/api/src/modules/file-storage/{storage,attachments,repository}.ts` (NEW).
- `apps/api/src/routes/socios-attachments.ts` (NEW) — 5 routes.
- `apps/api/src/server.ts` — register `@fastify/multipart`.
- `packages/config/src/schema.ts` — add storage env vars.
- `packages/db/src/schema/socios.ts` — add `socioAttachments` table.
- `packages/db/migrations/0021_socio_attachments.sql` (NEW, hand-written).
- `packages/audit/src/emitter.ts` — extend `emitAudit()` with `metadata`.
- `docker-compose.yml` — `storage` volume + mount.
- `apps/web/src/components/socios/{LegajoTab,AttachmentCard,AttachmentUpload,AttachmentPreviewModal}.tsx` (NEW).
- `apps/web/src/app/(authed)/socios/[id]/page.tsx` — new `legajo` tab.
- `apps/web/src/lib/api/attachments.ts` + `apps/web/src/lib/api.ts` `FormData` branch.
- Tests at every production file (1:1 source:test ratio for new files; extend existing tests at touched files).
- `.env.production.example` updates.

**Out:**
- No PDF first-page thumbnail (deferred).
- No image resizing / thumbnailing (deferred).
- No `/ctacte` or `/padrones` attachments (out of scope; pattern reusable later).
- No admin-only delete (locked: any authenticated operator).
- No CRDT / streaming for very large files (10 MB cap covers the locked decision).
- No quota-over-quota UI flow (just reject 413).
- No generic `POST /api/v1/files` endpoint (deferred to a future change; this lands the storage layer so it's incremental).

## Approach

**Backend.** `LocalFileStorage` class: `saveStream(stream) → { storagePath, sha256, sizeBytes }`, `readStream(path)`, `unlink(path)`. Atomic-rename (`<base>/.tmp/<uuid>` → `<base>/socios/<socioId>/<attachmentId>.<ext>`). SHA-256 computed in the same pass. Magic-byte validator: PDF requires `%PDF-` at byte 0 + `%%EOF` in trailing 1024 B; images checked against the 4-byte magic table (`FF D8 FF`, `89 50 4E 47`, `47 49 46 38`, `RIFF....WEBP`).

`socio_attachments` schema (UUID PK):
```
id uuid pk            filename text        category enum(dni|comprobante|foto|contrato|otro)
socio_id uuid fk      mime_type text       description text null
storage_path text     storage_sha256 text  size_bytes bigint
uploaded_by uuid fk   uploaded_at tstz     deleted_at tstz null  deleted_by uuid null
```
Indexes: `(socio_id, deleted_at)` (list + quota), `(socio_id, category)` (filter), `(storage_sha256)` (dedup probe), `uploaded_at desc` (ordering).

Quota transaction:
```sql
BEGIN;
SELECT count(*), coalesce(sum(size_bytes), 0)
  FROM socio_attachments
 WHERE socio_id = $1 AND deleted_at IS NULL FOR SHARE;
-- pass → INSERT → COMMIT; fail → ROLLBACK → 413
COMMIT;
```

Audit: extend `emitAudit()` to accept `{ actorId, action, resourceType, resourceId, metadata }`. Emit `SOCIO_ATTACHMENT_UPLOADED` + `SOCIO_ATTACHMENT_DELETED`.

**Frontend.** `LegajoTab` mirrors `AuditTab` shape (TanStack `useQuery`, skeleton/empty/list). `AttachmentUpload` has drop-zone + picker; uses `useMutation` with `FormData` (3-line `apiFetch` patch to detect `FormData`). `AttachmentCard` shows image thumbnail via `…/file` endpoint or PDF icon. `AttachmentPreviewModal` uses `<Modal>`. Each mutation calls `notify('success'|'error', '…')`.

**Migration.** Hand-written `0021_socio_attachments.sql` from the Drizzle schema. Apply via `docker exec -i athlos-db-1 psql -U athlos -d athlos < 0021_socio_attachments.sql`. Documented in the PR body.

**Docker.** `volumes: { storage: {} }` at top + `volumes: - storage:/app/storage` on `api`. Deploy-relevant: rolling deploy required (existing containers won't pick up the volume).

## Capabilities

**New:** `socio-attachments` — read/write/delete attachment rows for a socio + realise the dormant `file-storage` storage layer.

**Modified at spec level:**
- `file-storage/spec.md` — delta: (i) PK is `uuid`, not ULID (codebase consistency override — all `socios.*` tables use `uuid defaultRandom()`); (ii) v1 per-socio quota = 100 files / 500 MB (locked values, overrides spec's 10 MB per-socio); (iii) per-file cap = 10 MB (locked, overrides spec's 5 MB); (iv) any-authenticated authz (overrides spec's admin/assigned-operador matrix); (v) `POST /api/v1/files` deferred; (vi) webp + gif added to allowed image MIMEs.
- `ui-design/spec.md` — minor delta: new "Legajo" tab visual contract (icon + label + panel shape; mirrors the `Auditoría` tab).

## User-visible behaviour

Operator opens `/socios/[id]`, sees the new "Legajo" tab. Drops / picks a file → uploads; appears in the grid (image thumbnail or PDF icon). Each row: filename, category badge, description (if any), uploader + date, size. Click → preview modal (full image or PDF download link). Delete → confirm → soft delete (file disappears, audit event emitted, quota released). Errors (quota / size / type) → toast + no upload.

## Risks & mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | Drizzle migration pipeline broken in prod | Hand-written SQL + `docker exec psql` (workaround established in PR 8b.4). |
| R2 | `storage` Docker volume absent | Add to `docker-compose.yml`; rolling deploy required (existing containers won't pick up). |
| R3 | `@fastify/multipart` not registered | Register in `server.ts` between audit plugin and route plugins; pin already in `package.json`. |
| R4 | Quota race (two operators upload simultaneously) | `SELECT … FOR SHARE` inside transaction; second tx blocks then re-reads. |
| R5 | Magic-byte spoofing | Sniff first 4 KB + PDF trailer; reject 415 + roll back row + unlink file. |
| R6 | Dedup across socio boundaries | Content-addressed storage (`<base>/<shard>/<sha256>.<ext>`); per-row exclusive DB rows; retention cron uses `count_active_pointers(storage_path)`. |
| R7 | Pre-existing CI failures (`gastos.test.ts:134` lint, deploy workflow path) | Unrelated; document in PR; out of scope. |
| R8 | Audit `metadata` shape drift | Assert in test that `audit_events.metadata` contains `{ attachment_id, filename, category, size_bytes }`. |

## Rollback plan

- Additive within each PR.
- Migration rolled back via `ALTER TABLE socio_attachments …` (the `deleted_at` column makes rollback cheap).
- Docker volume removed → existing uploads orphaned but recoverable from `/app/storage` outside the container.
- Each PR independently revertible.

## Dependencies

None new at runtime (`@fastify/multipart@^9.0.2` already in `apps/api/package.json`). New env vars: `STORAGE_LOCAL_ROOT` (default `/app/storage`), `STORAGE_MAX_FILE_SIZE_BYTES` (default 10485760), `STORAGE_ALLOWED_MIME_TYPES`, `STORAGE_ATTACHMENT_PER_SOCIO_MAX_FILES` (default 100), `STORAGE_ATTACHMENT_PER_SOCIO_MAX_BYTES` (default 524288000), `STORAGE_RETENTION_DAYS` (default 90; deferred behaviour).

## Open questions

None. See `sdd/athlos-socio-legajo/explore` (#296) for the question trail.

## Success criteria

- [ ] All 5 backend routes pass their scenarios.
- [ ] Quota enforced (413 `QUOTA_EXCEEDED` when over cap).
- [ ] Magic-byte validator rejects mismatched MIME (415 + row rollback + file unlink).
- [ ] `SELECT … FOR SHARE` blocks concurrent uploads correctly (covered by tx integration test).
- [ ] `LegajoTab` renders grid + drop zone + preview modal.
- [ ] Drag-and-drop + file picker both work.
- [ ] Soft delete removes from grid + emits `SOCIO_ATTACHMENT_DELETED` audit event with full `metadata`.
- [ ] Toast feedback on success / error via existing `notify()`.
- [ ] Migration `0021_socio_attachments.sql` hand-written + applied via `docker exec psql`.
- [ ] Docker volume + mount added to `docker-compose.yml`.
- [ ] 1:1 source:test file ratio for all new files.
- [ ] `pnpm typecheck` + `pnpm lint` clean; full web + API test suites pass (no regressions).
- [ ] Spec deltas for `file-storage/spec.md` (UUID + v1 quota/MIME/authz values + deferred generic endpoint) and `ui-design/spec.md` (Legajo tab) committed.
- [ ] Pre-existing CI failures documented as unrelated in PR body.