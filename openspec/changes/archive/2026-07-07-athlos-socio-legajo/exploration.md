# Exploration: `athlos-socio-legajo`

## Goal

Add a "Legajo" tab to `/socios/[id]` that lets an authenticated operator
upload, list, preview and delete per-socio attachments (DNI scan, comprobante
de pago, foto, contrato, etc.). Soft-delete + audit trail; v1 has no PDF
thumbnail. Heavy metal: build atop the **project's existing `file-storage`
spec**, which is currently prose-only — this change is also the change that
realises the `file-storage` subsystem for the first time, scoped to the
`socio_attachments` resource only.

The product decisions below are FROZEN. The exploration below maps the
gaps between the spec's assumptions and the actual codebase today so the
propose phase can scope the work accurately.

## Current State (codebase today)

What is in place:

| Artefact | Status | Notes |
|---|---|---|
| `openspec/specs/file-storage/spec.md` | prose only | Fully written spec covering abstract `FileStorage`, `LocalFileStorage`, multipart upload, retention, soft delete, magic-byte validation, etc. Never implemented. |
| `apps/api/src/modules/file-storage/` | MISSING | No module folder exists. |
| `apps/api/src/routes/files.ts` | MISSING | No route file. The spec's `POST /api/v1/files` does not exist. |
| `@fastify/multipart` in `apps/api/package.json` | installed (^9.0.2) | Pin registered, but plugin not registered in `server.ts`. |
| `STORAGE_LOCAL_ROOT` env var | MISSING | `packages/config/src/schema.ts` does not declare it. |
| `storage` named volume in `docker-compose.yml` | MISSING | Only `backups:/var/backups/athlos` is mounted today. The spec presupposes `storage:/app/storage`. |
| `socio_attachments` table | MISSING | No `attachments.*` files in `packages/db/src/schema/`. |
| `EmptyState` UI primitive | MISSING | Confirmed in `apps/web/src/components/ui/` (only `Modal`, `Tabs`, `Badge`, `Monogram`, `Toast`). AuditTab renders its empty state inline. |
| Audit emission pattern | working | Two paths: direct `db.insert(auditEvents)` (notes.ts) + exported `emitAudit()` helper from `@athlos/audit/emitter`. `metadata JSONB` column is on `audit_events`. |
| Toast helper | ready | `notify(kind, message)` from `apps/web/src/lib/notifications.ts` (archived `athlos-toast-primitivo`). All 7 existing mutations on `/socios/[id]` already wired. |
| Modal primitive | ready | `<Modal open size role size footer descriptionId>` API. Header sticky / body scroll / footer sticky. |

What this means: **this change lands the first realisation of `file-storage`,
but only the socio-attachment surface**. A future change can add
`owner_type=report` and `owner_type=misc` by adding a second route module —
the underlying `LocalFileStorage` and `files` schema should be designed
upfront to support it, even though the v1 surface is socio-only.

## Locked product decisions (DO NOT RE-LITIGATE)

| # | Decision | Frozen value |
|---|----------|--------------|
| 1 | Accepted MIME types | images (`image/jpeg`, `image/png`, `image/webp`, `image/gif`) + PDFs (`application/pdf`) |
| 2 | Storage backend | `LocalFileStorage` per `file-storage/spec.md`. SHA-256 dedup at content level, atomic-rename writes, FOR SHARE row locks for quota checks, ULID-ish PKs. |
| 3 | UI placement | NEW tab "Legajo" in `/socios/[id]`, alongside `Datos` / `Contacto` / `Cuenta` / `Auditoría`. |
| 4 | Permissions | any authenticated operator can upload AND delete. No role gate for either. |
| 5 | Metadata | `filename` (original) + optional `description` (text, max 500 chars) + `category` (enum `dni` \| `comprobante` \| `foto` \| `contrato` \| `otro`) |
| 6 | Per-file size cap | 10 MB (`STORAGE_MAX_FILE_SIZE_BYTES=10485760`). |
| 7 | Per-socio quota | 100 files OR 500 MB total — whichever first. Soft-delete releases quota immediately. |
| 8 | Delete | soft delete (`deleted_at` timestamp); row + storage file kept for audit, retention job physical-purges after 90 days. |
| 9 | Upload UX | drag-and-drop zone + classic file picker button (both supported). |
| 10 | Audit integration | each upload + delete emits an `audit_event` row; `metadata` includes `attachment_id`, `filename`, `category`, `size_bytes`. |
| 11 | Toasts | use the project's `notify()` helper. |
| 12 | PDF preview | v1 = PDF icon + filename + download link. No first-page thumbnail. |

## Decisions the spec commits to that the codebase contradicts

| # | Spec says | Codebase does | Reconciliation |
|---|---|---|---|
| R1 | `file_id` is a `ULID` | All PKs in `socios.*` and `operators` are `uuid` with `defaultRandom()` (see `packages/db/src/schema/socios.ts:48-67`, `operators.ts:26-40`). | Follow the **codebase** — use `uuid('id').primaryKey().defaultRandom()`. Reasoning: (a) keeps the new table consistent with its sibling `socio_notes` and the entire `socios` schema; (b) the existing schema has no `ulid` package imported (let alone used); (c) UUIDv4 server-generated is sufficient for URL addressing. The spec's "ULID" was aspirational prose predating implementation; not a hard technical requirement. Spec delta will note this. |
| R2 | `storage_key` layout `socios/{id}/{file_id}.{ext}` | Not backed by any code path (no `LocalFileStorage` impl). | Realise exactly as the spec describes: `<STORAGE_LOCAL_ROOT>/socios/<socio_id>/<attachment_id>.<ext>`. |
| R3 | `files.content_hash` for dedup | Same — only spec-level. | Realise as the spec describes. **Deduplication boundary**: the file-storage spec says "if a file with the same hash is uploaded again, the system MAY short-circuit. v1 always stores the new copy." For this change, we go with the v1 "always store new copy" interpretation, BUT with content-addressed storage layout: if two uploads from different socios hash the same bytes, they share a single on-disk blob and create two DB rows. Two uploads from the **same** socio with the same hash create two DB rows (different attachment_ids, same `storage_key`). This is "per-row exclusive storage, per-content shareable" — it matches the spec's content_hash dedup hint without breaking the per-socio row semantics. |
| R4 | `STORAGE_LOCAL_ROOT` defaults to `/app/storage` and is required | Env schema does not declare it | Add to `packages/config/src/schema.ts` with `default('/app/storage')`. Validate directory exists in production (mirrors `LEGACY_DB_PATH` check). |
| R5 | `docker-compose.yml` declares a `storage` named volume | Not declared today | Add `volumes: [storage:]` to `api` service and a `volumes: { storage: {} }` top-level block. |
| R6 | Authorization: admin OR assigned-operador | Notes service uses **any authenticated operator** (no assigned-socio notion). Authz model isn't even mentioned in the current codebase for socio-scoped ops. | Follow the locked decision #4: **any authenticated operator** can upload/delete. This matches existing `/socios/:id/notes` semantics and avoids a follow-up RBAC matrix. |
| R7 | `@fastify/multipart` is required | Already in `package.json`; not registered in `server.ts` | Register it (`app.register(multipart, { limits: { fileSize: STORAGE_MAX_FILE_SIZE_BYTES, files: 1 } })`). |

## Affected Areas

### Backend (`apps/api`)

- `apps/api/src/server.ts` — register `@fastify/multipart` BEFORE the route plugins (likely between audit plugin and route plugins). Register the new `attachmentsRoutes` and the foundational `fileStorageRoutes` if the spec is to be honoured at the API surface.
- `apps/api/src/modules/file-storage/` — NEW. Three files minimum: `storage.ts` (the `LocalFileStorage` class), `attachments.ts` (socio-attachment service: list/upload/delete + quota check), `repository.ts` (Drizzle queries against `socio_attachments`).
- `apps/api/src/routes/socios.ts` — append 5 new routes under `/api/v1/socios/:id/attachments/*`. Mirror the existing notes block shape (AUTH gate; route-level Zod; service-layer business rules; best-effort audit emission).
- `apps/api/src/container.ts` — wire `LocalFileStorage` instance into the container (or pass `STORAGE_LOCAL_ROOT` + a constructor into routes). Mirror how the existing modules reach dependencies via `request.server.container`.
- `packages/config/src/schema.ts` — add `STORAGE_LOCAL_ROOT`, `STORAGE_MAX_FILE_SIZE_BYTES`, `STORAGE_ALLOWED_MIME_TYPES`, `STORAGE_RETENTION_DAYS`, `STORAGE_ATTACHMENT_PER_SOCIO_MAX_FILES`, `STORAGE_ATTACHMENT_PER_SOCIO_MAX_BYTES`.
- `packages/db/src/schema/socios.ts` — add `socioAttachments` table (see schema sketch below). Re-export from `schema/index.ts`.
- `packages/db/drizzle/0021_socio_attachments.sql` — NEW migration file. **Apply manually via `docker exec -i athlos-db-1 psql -U athlos -d athlos < 0021_socio_attachments.sql`** — drizzle migrate is broken in prod.
- `apps/api/src/modules/file-storage/file-storage.test.ts` + `attachments.test.ts` + `attachments-repository.test.ts` — unit tests for the new module. Mirror the `apps/api/src/modules/socios/*.test.ts` pattern (in-memory pg, real Drizzle, no mocks for the DB).
- `apps/api/src/routes/socios.test.ts` (or NEW `attachments.routes.test.ts`) — supertest-style integration tests for the 5 new routes.

### Frontend (`apps/web`)

- `apps/web/src/app/(authed)/socios/[id]/page.tsx` — add the "Legajo" tab next to "Auditoría". Resolve the active-tab union type to include `'legajo'`. Mount `<LegajoTab socioId={id} />` inside the panel-conditional.
- `apps/web/src/components/socios/LegajoTab.tsx` — NEW. Container that orchestrates the upload zone, attachment grid, and preview modal. Mirrors the shape of `AuditTab.tsx`: `useQuery` for the list + skeleton/empty/list states.
- `apps/web/src/components/socios/AttachmentGrid.tsx` — NEW. Pure presentation: thumbnails for images, PDF icon + filename for PDFs. Click opens preview `<Modal>`.
- `apps/web/src/components/socios/AttachmentUploadZone.tsx` — NEW. Drag-and-drop + classic picker. Handles validation client-side (`<= 10 MB`, mime in allowed list) BEFORE calling the API.
- `apps/web/src/components/socios/AttachmentPreviewModal.tsx` — NEW. Uses `<Modal>` primitive. Image = `<img src="…/file">`, PDF = `<a href="…/file" download>` (per locked decision #12).
- `apps/web/src/lib/api/socios.ts` — add `listSocioAttachments`, `uploadSocioAttachment`, `deleteSocioAttachment`. Export DTO types.
- `apps/web/src/lib/notifications.ts` — re-use; no change.
- `apps/web/src/components/ui/EmptyState.tsx` — **OPTIONAL NEW PRIMITIVE** (see "Cross-cutting decisions"). The Legajo empty state can ship inline (matching the `audit-tab-empty` pattern) if we don't want to expand scope.
- `apps/web/src/lib/api.ts` — **needs a multipart-aware helper**. Today's `apiFetch` always sets `content-type: application/json`. The propose phase will pick a strategy: (a) `apiFetch<T>(path, { body: formData })` detects `FormData` and skips the content-type header, or (b) a dedicated `apiUpload<T>(path, formData)` helper. (a) is preferred — minimal surface change, follows the existing `skipAuth` opt-out pattern.

### Cross-cutting

- `docker-compose.yml` — add the `storage` named volume mount + declare the named volume (per R5).
- `apps/api/.env.production` (operational) — add `STORAGE_LOCAL_ROOT=/app/storage` to the env_file. NOT code, but document so the deploy refresh is on the radar.
- `openspec/specs/file-storage/spec.md` — delta appended that (i) records PK convention as `uuid`, not ULID, for consistency with the `socios` schema; (ii) clarifies the `socios.attachments` resource block (categories enum, 10 MB cap, 100 files / 500 MB per-socio quota) as v1-specific; (iii) defers `owner_type=report` / `misc` to a future change.
- `openspec/specs/ui-design/spec.md` — minor delta for the new "Legajo" tab visual contract (icon + label + panel shape). Mirror the existing `Auditoría` tab pattern.

## Approaches considered

### A1: Stand up the full `file-storage` spec surface in this change

Build `LocalFileStorage`, the `files` table, `POST /api/v1/files` with
`owner_type` enums, AND the new `socio_attachments` table+routes — all in
one PR chain.

- Pros: spec becomes real; reuse for future `report` / `misc` owners.
- Cons: 1_500-2_500 LoC across backend + frontend + migration + deploy.
  Three PRs minimum; 400-line budget blows up multiple times; chained
  PRs required.
- Effort: **High**. Risk: high (touches storage layout, deploy, migration
  system that's already broken).

### A2: Scope THIS change to socio attachments only, but **build the storage abstraction layers as defined in the spec**

Build `LocalFileStorage` (the implementation), the `files` content-hash
index table (optional), the `socio_attachments` row table, and the 5 socio
attachment routes — but **defer** the generic `POST /api/v1/files`
endpoint until a future change actually needs `owner_type=report` / `misc`.
This is what the orchestrator is steering toward.

- Pros: lands ONE concrete user-visible feature; the spec is mostly
  realised (the parts that matter for socio attachments); future change
  can add the generic `POST /api/v1/files` endpoint with minimal new code
  — just a new route + a Zod schema variant.
- Cons: the `files` table the spec describes doesn't exist yet — we
  inline its columns (`storage_path`, `storage_sha256`) into the
  `socio_attachments` row directly. Refactor cost when the generic spec
  lands.
- Effort: **Medium**. 800-1_200 LoC total. Two PRs (backend PR + frontend
  PR) is achievable.

### A3: Bypass the spec — let routes own the file I/O directly

No `LocalFileStorage` class. Each route handler reads the stream, writes
to disk, hashes, and inserts the row.

- Pros: minimal abstraction. Quickest to land.
- Cons: no testable seam for the I/O layer; duplicate code the moment a
  second resource needs uploads (reports); violates the project's
  hexagonal architecture preference.
- Effort: **Low**. **REJECTED**: the spec exists for a reason and the
  project has consistently extracted storage into modules (`storage.ts`
  style) for testability.

### Recommendation

**A2** is the right call. We realise the spec's storage layer (A1 would
also, but it's too big in one swing) and defer the generic endpoint.
Inline `storage_path` + `storage_sha256` into `socio_attachments` —
that column set IS the spec's `files` table for v1. When a future change
needs `owner_type=report`, the schema can be normalised via a
`file_objects` table with `socio_attachments` as a thin join table —
or, more pragmatically, the per-resource fields just stay inline. This
is a known minor cost we pay now to ship the feature.

## Architecture sketch (source of truth for propose phase)

### Schema (`socio_attachments`)

```
pgSchema('socios').table('socio_attachments', {
  id:               uuid('id').primaryKey().defaultRandom(),
  socioId:          uuid('socio_id').notNull()
                      .references(() => socios.id, { onDelete: 'restrict' }),
  filename:         text('filename').notNull(),                       // sanitized server-side
  description:      text('description'),                              // nullable, 500 chars client-side
  category:         text('category').notNull(),                       // dni|comprobante|foto|contrato|otro
  mimeType:         text('mime_type').notNull(),                      // AFTER magic-byte detection
  sizeBytes:        bigint('size_bytes', { mode: 'number' }).notNull(),
  storagePath:      text('storage_path').notNull(),                   // socios/<socio_id>/<attachment_id>.<ext>
  storageSha256:    text('storage_sha256').notNull(),                 // char(64) hex
  uploadedBy:       uuid('uploaded_by').notNull(),                    // loose FK — no cross-schema constraint
  uploadedAt:       timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt:        timestamp('deleted_at', { withTimezone: true }),  // nullable
  deletedBy:        uuid('deleted_by'),                               // nullable
}, (t) => ({
  socioIdIdx:       index().on(t.socioId),
  socioActiveIdx:   index().on(t.socioId, t.deletedAt),
  storageShaIdx:    index().on(t.storageSha256),                      // for dedup lookup
  uploadedAtIdx:    index().on(t.uploadedAt),                         // for sorted list
}));
```

Indexes designed for:
- Active list per socio: `WHERE socio_id = $1 AND deleted_at IS NULL ORDER BY uploaded_at DESC` → uses `socioActiveIdx` + `uploadedAtIdx`.
- Dedup probe: `SELECT 1 FROM socio_attachments WHERE storage_sha256 = $1 LIMIT 1` → uses `storageShaIdx`.
- Quota count + sum: same `socioActiveIdx` filter → fast.

### Backend route shape (`apps/api/src/routes/socios.ts`, notes-shaped block)

```
GET    /api/v1/socios/:id/attachments                       list active attachments (any auth)
POST   /api/v1/socios/:id/attachments                       multipart upload (any auth, max 10 MB)
DELETE /api/v1/socios/:id/attachments/:attachmentId         soft-delete (any auth)
GET    /api/v1/socios/:id/attachments/:attachmentId         attachment metadata (any auth)
GET    /api/v1/socios/:id/attachments/:attachmentId/file    stream file bytes (any auth)
```

All under `AUTH` (any authenticated operator — no role gate, matches
notes). Each handler delegates to `apps/api/src/modules/file-storage/attachments.ts`
which combines: (a) socio existence check (`sociaRepo.findById`), (b)
quota precheck (count + size, in a `BEGIN; SELECT … FOR SHARE;
SELECT … ; INSERT/UPDATE; COMMIT;` transaction so concurrent uploads
from two operators can't blow past the limit — this is what "FOR SHARE
quotas" in the locked decision means), (c) write to disk via
`LocalFileStorage`, (d) Drizzle insert with `storage_path` + `sha256`,
(e) best-effort audit emit.

### Storage layout

```
{STORAGE_LOCAL_ROOT}/socios/{socio_id}/{attachment_id}.{ext}
```

Write flow (matches spec):
1. Stream from `@fastify/multipart` to a temp file at
   `{STORAGE_LOCAL_ROOT}/.tmp/{uuid}.part`.
2. Compute streaming SHA-256 as bytes are written (64 KB buffer; no full-
   file memory pressure — spec requirement).
3. Probe `socio_attachments.storage_sha256` for dedup. If hit AND the
   existing row belongs to a different socio, reuse the on-disk blob
   (no new write); just create the new row pointing to the same path.
4. If no hit, `rename` the temp file to
   `{STORAGE_LOCAL_ROOT}/socios/{socio_id}/{attachment_id}.{ext}`
   (atomic on POSIX — `rename(2)`).
5. Insert row with `storage_path` + `storage_sha256`.
6. Magic-byte validation: the request body's first 4KB (or the full
   file if smaller than 4 KB) gets sniffed via `file-type` to confirm
   the client-declared mime matches reality. If mismatch, **delete the
   just-written row AND the on-disk file**, return 415.

### Quota enforcement

Per-socio limits: 100 files OR 500 MB. Enforced BEFORE accepting the
upload write:

```sql
BEGIN;
SELECT COUNT(*) FROM socio_attachments
  WHERE socio_id = $1 AND deleted_at IS NULL FOR SHARE;
SELECT COALESCE(SUM(size_bytes), 0) FROM socio_attachments
  WHERE socio_id = $1 AND deleted_at IS NULL FOR SHARE;
-- compute (count + 1) <= 100 AND (sum + newBytes) <= 524_288_000
-- if pass: stream + write + INSERT; commit
-- if fail: ROLLBACK; return 413 QUOTA_EXCEEDED
COMMIT;
```

The `FOR SHARE` lock is critical: two concurrent uploads from two
operators would otherwise both see `count = 99`, both succeed, and end
up at 101. With `FOR SHARE` the second transaction blocks until the
first commits, then re-reads and sees the new row.

Per-file `10 MB` cap is enforced by `@fastify/multipart`'s
`limits.fileSize: 10 * 1024 * 1024` (returns 413 automatically) +
a second check inside the route via `request.headers['content-length']`
to fail early with a friendly Spanish error.

### Audit emission

Two options analysed:

1. Direct insert (notes.ts pattern) — simpler; no idempotency.
2. `emitAudit()` helper from `@athlos/audit/emitter` — has 10s bucket
   idempotency, but doesn't expose a `metadata` column.

**Recommendation**: extend the `emitAudit()` helper to accept an
optional `metadata: Record<string, unknown>` field that's persisted into
`audit_events.metadata`. Same change as `athlos-toast-primitivo` did for
its wrapper — localise new defaults rather than scatter logic at call
sites. The two new audit actions are:

- `SOCIO_ATTACHMENT_UPLOADED` — `metadata: { attachment_id, filename, category, size_bytes, mime_type }`, `newValue`: small summary row.
- `SOCIO_ATTACHMENT_DELETED` — `metadata: { attachment_id, filename, category, size_bytes }`, `oldValue`: summary row.

The audit timeline tab (`AuditTab.tsx` on `/socios/[id]`) gets two new
`actionLabel` entries + a small per-event body (filename + size +
category chip). The existing `AuditTab` already handles `default` actions
with a generic "history" icon, so the rendering work is local.

### Frontend wiring

`page.tsx`:
- Add `'legajo'` to the active-tab union type.
- Add a Tabs entry with `FolderOpen` Lucide icon and the same icon-tile
  header pattern as Auditoría.
- Render `<LegajoTab socioId={id} />` in the `legajo` panel.

`LegajoTab.tsx`:
- `useQuery({ queryKey: ['socio-attachments', socioId], queryFn: listSocioAttachments, staleTime: 30_000 })`.
- Skeleton / error / empty / list states, mirroring `AuditTab`.
- Inline `EmptyState` (matches `audit-tab-empty` style — icon + title +
  subtitle) instead of introducing a new primitive. **Reconsider** during
  propose if the team agrees the EmptyState primitive belongs in
  `components/ui/`.

`AttachmentUploadZone.tsx`:
- `<input type="file" multiple={false} accept={ACCEPTED_MIME_LIST}>` +
  a styled `<div role="button" aria-label="Subir archivo">` that proxies
  to the input click.
- `onDrop` handler: `preventDefault`, validate type + size, build
  `FormData`, hand to the upload mutation.
- Drag-over visual: `border-accent bg-accent-soft` (matches UI tokens).
- Progress: not a hard requirement — `useMutation.isPending` is enough.

`AttachmentPreviewModal.tsx`:
- `<Modal open={...} size="xl" role="dialog" title={filename}>`.
- Image: `<img src={`/api/v1/socios/${id}/attachments/${aid}/file`} alt=...>`
- PDF: `<a href={...} target="_blank" rel="noreferrer" download>{filename}</a>` (forces download per locked decision #12).

`socios.ts` api wrapper additions:
- `listSocioAttachments(id): Promise<Attachment[]>`
- `uploadSocioAttachment(id, file: File): Promise<Attachment>` — builds
  `FormData`, sets `body: formData`. Requires the `apiFetch` multipart
  patch (see Cross-cutting).
- `deleteSocioAttachment(id, attachmentId): Promise<void>`
- `attachmentFileUrl(id, attachmentId): string` — for `<img src>` /
  `<a href>` (with the JWT in the cookie via `credentials: 'include'`
  which `apiFetch` already sets).

### apiFetch multipart patch

Two strategies:

1. **Make `apiFetch` FormData-aware**:

   ```diff
   - if (body !== undefined) {
   -   ;(requestInit.headers as Record<string, string>)['content-type'] = 'application/json'
   -   requestInit.body = JSON.stringify(body)
   - }
   + if (body instanceof FormData) {
   +   requestInit.body = body  // browser sets the multipart boundary
   + } else if (body !== undefined) {
   +   ;(requestInit.headers as Record<string, string>)['content-type'] = 'application/json'
   +   requestInit.body = JSON.stringify(body)
   + }
   ```

   - Pros: minimal surface (one diff in `api.ts`), zero learning curve
     for callers, `get/post/patch/put/del` helpers inherit the new
     behaviour.
   - Cons: subtle type narrowing needed in tests / call sites that pass
     arbitrary objects.

2. **Add a dedicated `apiUpload<T>(path, formData)` helper**.

   - Pros: explicit; the upload path is well-isolated; tests can mock
     `apiUpload` directly.
   - Cons: yet another public surface; signal that "uploads are special".

   **Recommendation**: **option 1**. The `body instanceof FormData`
   branch is a 3-line change that mirrors how the same wrapper handles
   `FormData` in browser DevTools today (the user agent already does
   the right thing). It also keeps the test surface uniform — a call
   site that wants JSON still gets JSON; the type system stays the same
   (we widen the signature to `unknown` and rely on the runtime check).

## Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Drizzle migration system is broken in prod.** No `__drizzle_migrations` table; journal 0013-0019 missing. Applying `pnpm --filter @athlos/db migrate` produces a catch-up that re-creates existing tables. | HIGH (deploy blocker) | Write `0021_socio_attachments.sql` by hand (column-by-column from the drizzle schema), apply via `docker exec -i athlos-db-1 psql -U athlos -d athlos < 0021_socio_attachments.sql`, capture the output, document in the apply-phase tasks.md as "DO NOT use `pnpm migrate`". |
| R2 | **`storage` volume NOT declared in `docker-compose.yml`.** Files uploaded to `/app/storage` inside the container die when the container is recreated. | HIGH (data loss) | Add `volumes: storage:/app/storage` to the `api` service + top-level `volumes: { storage: {} }` named-volume declaration in this change's deploy chore PR. The handover #253 noted the docker pipeline is a workaround (`--network host`); we follow the same deployment flow but with the new volume baked into compose. |
| R3 | **`STORAGE_LOCAL_ROOT` env var missing.** `packages/config/src/schema.ts` would crash with "Environment validation failed" on boot if added naively. | MEDIUM | Add to `envSchema` with `default('/app/storage')` + a non-production read-only check (mirrors `LEGACY_DB_PATH` check). Document `STORAGE_LOCAL_ROOT` in `apps/api/.env.production.example`. |
| R4 | **`@fastify/multipart` is installed but NOT registered in `server.ts`.** Without registration the `multipart` request body parser won't fire. | HIGH (upload broken) | Register `await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } })` between the audit plugin and the route plugins. The pinned package is already in `apps/api/package.json` — no install needed. |
| R5 | **Quota race conditions.** Two operators uploading the same socio simultaneously could both pass a count/sum check before either inserts. | MEDIUM | Use `SELECT … FOR SHARE` on the count + sum reads inside a transaction. The lock is held until COMMIT so the second transaction blocks; on unblock it re-reads the updated state and rejects with 413 QUOTA_EXCEEDED. |
| R6 | **Audit emission consistency.** The notes service uses direct `db.insert(auditEvents)`; other routes use the `emitAudit()` helper with idempotency. Mixing again is a maintenance smell. | LOW | Extend `emitAudit()` to accept an optional `metadata` field; use it for both new audit actions so the timeline query path is uniform. |
| R7 | **Dedup across socio boundaries.** Two different socios uploading the same bytes produces two rows pointing at one on-disk file. Soft-delete on row A must NOT remove the on-disk file if row B is still active. | MEDIUM | Implement content-addressed storage with row-level pointers. Soft-delete sets `deleted_at` on the row only. The retention cron (already in the spec; not part of this PR) later purges rows + files whose `deleted_at` is > 90 days AND no other active row points to the file. Add a `count_active_pointers(storage_path)` helper to drive the retention check in a future change. |
| R8 | **Magic-byte spoofing.** A client can upload `evil.exe` with `Content-Type: application/pdf`. Without magic-byte validation we store the bytes as a PDF (MIME column reflects the lie). | MEDIUM | Use `file-type` (or `mime-types` + manual sniffing — already in the spec). Sniff the first 4 KB and the trailing 8 bytes for the PDF trailer. Reject 415 on mismatch AND roll back the partial write (delete the just-written row + unlink the file). |
| R9 | **Large-file memory pressure.** Streaming the whole request into RAM would OOM a 500 MB upload (even though we cap at 10 MB, ten concurrent 10 MB uploads × 5 concurrent tabs = 50 MB RAM). | LOW | `@fastify/multipart` already streams to disk if you provide a `tmpDir` option or use the `saveRequestFiles` pattern. The spec already mandated streaming SHA-256 (not load-then-hash) — keep that constraint. |
| R10 | **Pre-existing CI failures in the codebase.** handover #253 listed `apps/api/src/routes/admin/gastos.test.ts:134` lint debt and a known deploy workflow bug. | LOW (not blocking) | Out of scope for this change. Mentioned only so the propose phase doesn't promise green-CI without acknowledging the pre-existing debt. |
| R11 | **`EmptyState` UI primitive missing.** AuditTab's inline empty state is the precedent; matching that pattern keeps scope small but the codebase is one decision away from wanting a central primitive. | LOW (decision, not risk) | Recommendation: stay inline for this change, matching `AuditTab`'s `audit-tab-empty` div. A future change can centralise. |
| R12 | **Spec-vs-codebase ULID-vs-UUID drift.** `openspec/specs/file-storage/spec.md:253` says `file_id ULID PK`. Codebase convention is UUID. | LOW (decision) | Use UUID (matches all `socios.*` tables) and append a delta to the spec explaining the convention override. |

## Open questions worth flagging at propose

None. Every lock-able decision in the request has been confirmed against
the codebase. The only ambiguities are surface-level (e.g. exact Spanish
copy for empty/loading states) and are scoped to `sdd-design`, not
proposal.

## Ready for Proposal

YES. The propose phase can scope this change as:

- Backend PR (1): env schema additions + multipart plugin register +
  new `socio_attachments` table + `LocalFileStorage` impl +
  `attachments.ts` service + 5 routes under `/api/v1/socios/:id/attachments`
  + `0021_socio_attachments.sql` migration + emit-audit metadata
  extension + comprehensive tests.
- Frontend PR (2): api.ts `FormData` branch + `LegajoTab` +
  `AttachmentUploadZone` + `AttachmentPreviewModal` +
  `AttachmentGrid` + extension to `page.tsx` + `apps/web/src/lib/api/socios.ts`
  additions + tests.
- Deploy chore PR (3): `docker-compose.yml` storage volume declaration +
  `.env.production.example` updates.

Forecast ~1_000-1_400 LoC across the two main PRs (within the 400-line
per-PR budget, comfortably — chained not required). The deploy chore
PR is ~10 LoC; it can be folded into backend PR if the team prefers
(single delivery is also a defensible call given the deploy chore is
small and tightly coupled to the backend PR).

The user should be told that **the file-storage spec has been the
active blocker for `report` and `misc` resources too** — landing this
change partially realises the spec, and the next change that needs the
generic `POST /api/v1/files` endpoint will be a much smaller surface
incremental on top of what we build here.
