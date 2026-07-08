# Tasks: athlos-socio-legajo (FINALIZED)

**Change**: `athlos-socio-legajo`
**Phase**: tasks (finalized by sdd-tasks executor)
**Date**: 2026-07-07
**Artifact store**: both (engram + openspec)
**Strict TDD**: YES (vitest, `pnpm --filter @athlos/{api,web} test:run`)
**Review budget**: 400 changed lines per PR
**Delivery strategy**: cached `ask-always` (this surface is `ask-on-risk`)
**Spec sources**:
- Proposal: `openspec/changes/athlos-socio-legajo/proposal.md`
- Design: `openspec/changes/athlos-socio-legajo/design.md`
- Spec (NEW): `openspec/changes/athlos-socio-legajo/specs/socio-attachments/spec.md`
- Spec (DELTA): `openspec/changes/athlos-socio-legajo/specs/{file-storage,api-design,audit-logger,ui-design}/spec.md`

---

## Review Workload Forecast

| Slice | Code LoC | Test LoC | Total | Risk |
|-------|---------:|---------:|------:|------|
| PR A backend | ~360 | ~340 | **~700** | HIGH (over budget) |
| PR B frontend | ~250 | ~250 | **~500** | HIGH (over budget) |

- PR A backend estimated changed lines: ~700 (design forecast 600-800)
- PR B frontend estimated changed lines: ~500 (design forecast 400-600)
- 400-line budget risk: HIGH (both PRs exceed)
- Chained PRs recommended: Yes (split each PR further if needed)
- Decision needed before apply: Yes — user must choose between `size:exception` for both PRs OR chained split
- Chain strategy: pending
- Notes: chained option: split PR A into A1 (storage + migration + audit extension, ~400 LoC) and A2 (service + repository + routes + multipart, ~300 LoC). Split PR B into B1 (client wrapper + Upload + Card components, ~300 LoC) and B2 (LegajoTab + PreviewModal + page wiring, ~200 LoC). Stacking: stacked-to-main (project default).

```
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High
```

---

## PR Plan

- **PR A** (`feat/legajo-a`) — backend storage layer + schema + audit extension + service + repository + 5 routes + multipart registration + docker volume. Branch base = `main`.
- **PR B** (`feat/legajo-b`) — frontend client wrapper + 4 components + tab wiring + AuditTab action extensions. Branch base = `main` (after A merges).
- **If chained** (preferred per forecast):
  - PR A1 = storage + migration + audit ext (`feat/legajo-a1`, base = `main`).
  - PR A2 = service + repository + routes + multipart registration (`feat/legajo-a2`, base = `main` after A1 merges; OR stacked on A1).
  - PR B1 = client wrapper + `AttachmentUpload` + `AttachmentCard` (`feat/legajo-b1`, base = `main` after A merges).
  - PR B2 = `AttachmentPreviewModal` + `LegajoTab` + page wiring (`feat/legajo-b2`, base = `main` after B1 merges; OR stacked on B1).
- Stacking strategy default: **stacked-to-main** (project standard). Surface `feature-branch-chain` as the alternative if reviewer wants a tracker branch.

PR A unblocks PR B (PR B can ship with a mocked backend, then full integration once A is merged). Strict-TDD applies to every task.

---

## Dependency Graph

```
PR A
  A.1 migration + schema (socioAttachments + attachmentCategory enum)
    └─> A.2 LocalFileStorage class + magic-byte validator
         └─> A.3 audit emitter metadata extension + 2 new actions
              └─> A.4 attachments-repository
                   └─> A.5 attachments service (with FOR SHARE transaction)
                        └─> A.6 socios-attachments routes (5 endpoints)
                             └─> A.7 @fastify/multipart registration + docker volume + .env.example

PR B (depends on PR A being merged; can be developed against a stubbed apiFetch)
  B.1 lib/api/attachments.ts wrapper + apiFetch FormData branch
    └─> B.2 AttachmentUpload (drag-and-drop + picker)
         └─> B.3 AttachmentCard (thumbnail/icon)
              └─> B.4 AttachmentPreviewModal
                   └─> B.5 LegajoTab + page.tsx tab wiring
                        └─> B.6 toast integration (notify() calls)
```

Strict order. Each commit is the smallest reviewable unit. RED → GREEN in the same commit per project convention.

---

## Work Unit Commits

### PR A — backend

| Commit | Scope | Approx LoC | TDD stage |
|--------|-------|-----------|-----------|
| A.1    | Migration SQL + schema `socioAttachments` in `packages/db/src/schema/socios.ts` | ~80-120 | RED→GREEN (migration applied manually) |
| A.2    | `LocalFileStorage` class + `magic-byte.ts` validator + tests | ~120-160 | RED→GREEN |
| A.3    | Audit emitter extension (`metadata`) + 2 new action constants | ~30-50 | RED→GREEN |
| A.4    | `attachments-repository.ts` + tests | ~60-90 | RED→GREEN |
| A.5    | `attachments.ts` service (with FOR SHARE transaction) + tests | ~150-200 | RED→GREEN |
| A.6    | `socios-attachments.ts` route + 5 endpoints + tests | ~120-160 | RED→GREEN |
| A.7    | `@fastify/multipart` registration in `server.ts` + `docker-compose.yml` storage volume + `.env.production.example` | ~20-40 | integration smoke |
| **PR A total** | | **~700 (range 600-800)** | **HIGH — exceeds 400 budget** |

### PR B — frontend

| Commit | Scope | Approx LoC | TDD stage |
|--------|-------|-----------|-----------|
| B.1    | Client wrapper `attachments.ts` + `apiFetch` FormData branch + tests | ~40-70 | RED→GREEN |
| B.2    | `AttachmentUpload` component (drag-and-drop + picker) + tests | ~80-120 | RED→GREEN |
| B.3    | `AttachmentCard` component (thumbnail/icon) + tests | ~50-80 | RED→GREEN |
| B.4    | `AttachmentPreviewModal` + tests | ~50-80 | RED→GREEN |
| B.5    | `LegajoTab` + tab wiring in `/socios/[id]/page.tsx` + tests | ~80-120 | RED→GREEN |
| B.6    | Toast integration (calls to `notify()` for upload/delete success/error) | ~20-30 | test-extend |
| **PR B total** | | **~500 (range 400-600)** | **HIGH — may exceed 400 budget** |

---

## Phase A: Backend (`feat(api): socio attachments + file-storage spec realisation (PR 8c.1)`)

Branch: `feat/legajo-a`. Base: `main`.

---

### Task A.1 — Migration SQL + `socioAttachments` schema

- **File(s):** `packages/db/migrations/0021_socio_attachments.sql` (NEW); `packages/db/src/schema/socios.ts` (edit — add `attachmentCategory` pgEnum + `socioAttachments` table + re-export); `packages/db/src/schema/index.ts` (re-export)
- **Behavior:** Define the `socio_attachments` table with UUID PK, FKs, soft-delete columns, indexes for `(socio_id, deleted_at)`, `(socio_id, category)`, `(storage_sha256)`, and `uploaded_at desc`. Ship a hand-written SQL migration matching the Drizzle schema (drizzle pipeline is broken in prod per handover #253).
- **Tests added (RED):** None for the schema itself (Drizzle schemas are not unit-tested in this repo); the schema is exercised in A.4's repository tests. The migration SQL is verified by `psql --dry-run` or by inspection.
- **Run order:**
  ```bash
  pnpm --filter @athlos/db typecheck
  pnpm --filter @athlos/api typecheck
  pnpm --filter @athlos/api lint
  ```
- **Commit:** `feat(db): add socio_attachments table + 0021 migration`

---

### Task A.2 — `LocalFileStorage` class + `magic-byte` validator

- **File(s):** `apps/api/src/modules/file-storage/local-file-storage.ts` (NEW); `apps/api/src/modules/file-storage/local-file-storage.test.ts` (NEW); `apps/api/src/modules/file-storage/magic-byte.ts` (NEW); `apps/api/src/modules/file-storage/magic-byte.test.ts` (NEW); `apps/api/src/modules/file-storage/index.ts` (NEW barrel)
- **Behavior:** `LocalFileStorage.saveStream` writes via atomic rename (`.tmp/<uuid>.part` → final path), computes SHA-256 over 64 KB chunks, returns `{ storagePath, sha256, sizeBytes }`. `readStream` and `unlink` complete the API. `validateMagic(declared, buffer)` returns `true` only when the buffer's first bytes match the locked table (JPEG `FF D8 FF`; PNG `89 50 4E 47 0D 0A 1A 0A`; GIF `47 49 46 38` + `7a/8a` at offset 4 + `61` at offset 5; WEBP `RIFF` at 0 + `WEBP` at offset 8; PDF `%PDF-` + `%%EOF` in trailing 1024 bytes).
- **Tests added (RED):** `local-file-storage.test.ts` covers atomic rename, SHA-256 correctness, unlink, stream back-pressure. `magic-byte.test.ts` covers each MIME accepting a valid buffer; rejecting an invalid buffer; WEBP offset 8 check; PDF trailer in last 1024 B; GIF `7a`/`8a` byte at offset 4. Use `os.tmpdir()` for storage base; `afterEach` cleans `.tmp/` + `socios/<socioId>/` directories.
- **Run order:**
  ```bash
  pnpm --filter @athlos/api typecheck
  pnpm --filter @athlos/api lint
  pnpm --filter @athlos/api test:run -- src/modules/file-storage/local-file-storage.test.ts
  pnpm --filter @athlos/api test:run -- src/modules/file-storage/magic-byte.test.ts
  ```
- **Commit:** `feat(api): LocalFileStorage + magic-byte validator`

---

### Task A.3 — Audit emitter `metadata` extension + 2 new action constants

- **File(s):** `packages/audit/src/emitter.ts` (edit — widen `AuditRecord.action` union, add `metadata?: Record<string, unknown>`, persist into existing `audit_events.metadata` jsonb); `packages/audit/src/emitter.test.ts` (extend — metadata persists; new action constants valid)
- **Behavior:** Add two new audit actions: `SOCIO_ATTACHMENT_UPLOADED` and `SOCIO_ATTACHMENT_DELETED`. Add `metadata` field to `AuditRecord` that persists into the existing `audit_events.metadata` jsonb column (no schema change needed — column already exists per `packages/db/src/schema/public.ts:59`).
- **Tests added (RED):** Extend `emitter.test.ts` with cases that verify (a) `metadata` field reaches the INSERT; (b) the two new action constants are emitted without TypeScript narrowing failures; (c) the audit row's metadata column contains the expected JSON shape.
- **Run order:**
  ```bash
  pnpm --filter @athlos/audit typecheck
  pnpm --filter @athlos/audit lint
  pnpm --filter @athlos/audit test:run
  pnpm --filter @athlos/api typecheck
  ```
- **Commit:** `feat(audit): metadata field + SOCIO_ATTACHMENT_* actions`

---

### Task A.4 — `attachments-repository.ts` + tests

- **File(s):** `apps/api/src/modules/socios/attachments-repository.ts` (NEW); `apps/api/src/modules/socios/attachments-repository.test.ts` (NEW)
- **Behavior:** Drizzle queries against `socio_attachments`. Exports `listBySocio(db, socioId, opts: { category? })`, `findById(db, id)`, `insert(db, values)`, `softDelete(db, id, operatorId)` (sets `deletedAt` + `deletedBy`). All queries filter out soft-deleted rows unless explicitly requested.
- **Tests added (RED):** Standin-DB cases: `listBySocio` returns only active (deleted_at IS NULL) and applies the `?category=` filter; `findById` returns the row; `softDelete` sets `deleted_at` + `deleted_by` and the row disappears from `listBySocio`. Use `createStandinDb()` per `apps/api/src/test-standins/db.ts`.
- **Run order:**
  ```bash
  pnpm --filter @athlos/api typecheck
  pnpm --filter @athlos/api lint
  pnpm --filter @athlos/api test:run -- src/modules/socios/attachments-repository.test.ts
  ```
- **Commit:** `feat(api): attachments repository for socio_attachments`

---

### Task A.5 — `attachments.ts` service (with FOR SHARE transaction)

- **File(s):** `apps/api/src/modules/socios/attachments.ts` (NEW); `apps/api/src/modules/socios/attachments.test.ts` (NEW)
- **Behavior:** Service-layer business logic. `uploadAttachment` does: socio existence check → quota tx (`SELECT COUNT(*) + SUM(size_bytes) FOR SHARE`) → `LocalFileStorage.saveStream` → magic-byte validation against the sniffed buffer (read back the temp file) → INSERT row → best-effort audit emit. `listAttachments`, `getAttachment`, `streamAttachment`, `softDeleteAttachment` round out the API. `QuotaError` is a typed error mapped to `400 VALIDATION_ERROR` with `{ cap, limit, current }`.
- **Tests added (RED):** Integration cases using a standin DB + real on-disk temp storage: happy path; quota `count` exceeded (`count >= 100`); quota `bytes` exceeded (`sum + newBytes > 500 MB`); FOR SHARE race (two parallel `uploadAttachment` calls — one wins, the other rejects with `QuotaError`); magic-byte rejection (row deleted + file unlinked); soft delete + audit row exists; audit metadata shape `{ attachment_id, filename, category, size_bytes }` asserted exactly.
- **Run order:**
  ```bash
  pnpm --filter @athlos/api typecheck
  pnpm --filter @athlos/api lint
  pnpm --filter @athlos/api test:run -- src/modules/socios/attachments.test.ts
  ```
- **Commit:** `feat(api): attachments service with FOR SHARE quota tx`

---

### Task A.6 — `socios-attachments.ts` route + 5 endpoints

- **File(s):** `apps/api/src/routes/socios-attachments.ts` (NEW); `apps/api/src/routes/socios-attachments.test.ts` (NEW)
- **Behavior:** 5 routes under `/api/v1/socios/:socioId/attachments/*`: `POST` (multipart upload), `GET` (list, optional `?category=`), `GET /:attachmentId` (metadata), `GET /:attachmentId/file` (stream with Content-Type + Content-Disposition), `DELETE /:attachmentId` (soft delete). All under `requireAuth()` (no role gate per locked decision #4). Zod validation via co-located `attachmentParamsSchema` + `attachmentMetaSchema`.
- **Tests added (RED):** End-to-end with `fastify.inject()` + JWT: POST happy path 201; POST missing JWT 401; POST wrong MIME 415 + file unlinked + row deleted; POST oversize 413; POST quota exceeded 400 VALIDATION_ERROR with `details.cap`/`details.limit`/`details.current`; GET list active only; GET metadata found 200; GET metadata soft-deleted 404; GET file stream sets Content-Type + Content-Disposition; DELETE 204 + `deleted_at` set + audit row emitted.
- **Run order:**
  ```bash
  pnpm --filter @athlos/api typecheck
  pnpm --filter @athlos/api lint
  pnpm --filter @athlos/api test:run -- src/routes/socios-attachments.test.ts
  ```
- **Commit:** `feat(api): 5 attachment routes under /socios/:id/attachments`

---

### Task A.7 — Multipart plugin + Docker volume + env example

- **File(s):** `apps/api/src/server.ts` (edit — register `@fastify/multipart` between `auditPlugin` and route registration; `limits: { fileSize: 10 * 1024 * 1024, files: 1 }`); `docker-compose.yml` (edit — add `volumes: { storage: {} }` top-level + `volumes: - storage:/app/storage` on `api` service); `apps/api/.env.production.example` (edit — document `STORAGE_LOCAL_ROOT=/app/storage`, `STORAGE_MAX_FILE_SIZE_BYTES=10485760`, etc.); `packages/config/src/schema.ts` (edit — add storage env vars per design §9).
- **Behavior:** Multipart plugin is registered exactly once with the locked size cap. Docker compose gains a `storage` named volume so uploaded files survive container restarts. Env schema documents the new vars with the locked defaults (`/app/storage`, 10485760, 100, 524288000).
- **Tests added (RED):** Integration smoke — the existing route test suite (A.6) covers the multipart registration end-to-end. No new unit tests; the docker-compose change is configuration-only.
- **Run order:**
  ```bash
  pnpm --filter @athlos/api typecheck
  pnpm --filter @athlos/api lint
  pnpm --filter @athlos/api test:run -- src/routes/socios-attachments.test.ts
  pnpm --filter @athlos/config typecheck
  ```
- **Commit:** `chore(api): register multipart plugin + storage docker volume`

---

### A.wrap — Backend PR wrap

Verification (run after A.7 lands, before pushing):

```bash
pnpm --filter @athlos/api typecheck
pnpm --filter @athlos/api lint
pnpm --filter @athlos/api test:run -- src/modules/file-storage src/modules/socios/attachments src/modules/socios/attachments-repository src/routes/socios-attachments
git log --oneline -10
git checkout -- apps/web/next-env.d.ts 2>/dev/null || true
```

Branch: `feat/legajo-a`. Push + open PR with title `feat(api): socio attachments + file-storage spec realisation (PR 8c.1)`. PR body MUST document the pre-existing CI debt (`gastos.test.ts:134` lint) as unrelated, and the migration deploy runbook:

```bash
# Migration apply (post-merge only, NOT in this PR):
docker exec -i athlos-db-1 psql -U athlos -d athlos < packages/db/migrations/0021_socio_attachments.sql
```

---

## Phase B: Frontend (`feat(web): Legajo tab on /socios/[id] (PR 8c.2)`)

Branch: `feat/legajo-b`. Base: `main` (after A merges).

---

### Task B.1 — Client wrapper + `apiFetch` FormData branch

- **File(s):** `apps/web/src/lib/api/attachments.ts` (NEW); `apps/web/src/lib/api/attachments.test.ts` (NEW); `apps/web/src/lib/api.ts` (edit — 3-line `FormData` branch: when `body instanceof FormData`, skip the JSON content-type and pass the FormData through)
- **Behavior:** `listAttachments(socioId)` wraps `apiFetch('/api/v1/socios/<id>/attachments')`. `uploadAttachment(socioId, file, opts)` builds `FormData` and calls `apiFetch` with the multipart body. `deleteAttachment(socioId, attachmentId)` returns `Promise<void>`. `attachmentFileUrl(socioId, attachmentId)` returns the URL for `<img src>` / `<a href>`. The `apiFetch` `FormData` branch is a 3-line diff — no signature widening needed (`body: unknown` already).
- **Tests added (RED):** Mock `apiFetch` (synchronous factory form, per design R4 of audit-operator-display #265). Cases: `listAttachments` unwraps `{ items }`; `uploadAttachment` builds a `FormData` with the file + `category` + `description` fields and calls `apiFetch` with `body instanceof FormData`; `deleteAttachment` returns void on 204; `attachmentFileUrl` builds the right path. Mock factory pattern: `vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }))` synchronous form.
- **Run order:**
  ```bash
  pnpm --filter @athlos/web typecheck
  pnpm --filter @athlos/web lint
  pnpm --filter @athlos/web test:run -- src/lib/api/attachments.test.ts
  ```
- **Commit:** `feat(web): attachments client wrapper + FormData apiFetch branch`

---

### Task B.2 — `AttachmentUpload` component (drag-and-drop + picker)

- **File(s):** `apps/web/src/components/socios/AttachmentUpload.tsx` (NEW); `apps/web/src/components/socios/AttachmentUpload.test.tsx` (NEW)
- **Behavior:** Drop zone (`border-accent bg-accent-soft` on dragover per design D in ui-design delta) + classic `<input type="file">` picker. Client-side validates MIME + size (10 MB) BEFORE the API call — inline error message on rejection (no toast for client-side validation). Calls `useMutation` with `FormData`. On success, calls `notify('success', '…')` and `onUploadComplete()`. On API error, calls `notify('error', '…')`.
- **Tests added (RED):** Cases: drop fires mutation; picker fires mutation; oversize shows inline error WITHOUT calling the API; bad MIME shows inline error WITHOUT calling the API; success triggers `notify('success', …)` + `onUploadComplete`. **Drag-and-drop caveat (R3 in critical tasks)**: jsdom drag events are partial — tests may need to mock or use a different assertion (e.g., assert on `onDrop` prop being passed rather than dispatching synthetic DragEvents).
- **Run order:**
  ```bash
  pnpm --filter @athlos/web typecheck
  pnpm --filter @athlos/web lint
  pnpm --filter @athlos/web test:run -- src/components/socios/AttachmentUpload.test.tsx
  ```
- **Commit:** `feat(web): AttachmentUpload drag-and-drop + picker`

---

### Task B.3 — `AttachmentCard` component (thumbnail/icon)

- **File(s):** `apps/web/src/components/socios/AttachmentCard.tsx` (NEW); `apps/web/src/components/socios/AttachmentCard.test.tsx` (NEW)
- **Behavior:** Pure presentation. Props: `{ attachment: SocioAttachment; onPreview: () => void; onDelete: () => void }`. Image MIMEs: `<img src={attachmentFileUrl(...)} loading="lazy">` thumbnail. PDF: Lucide `FileText` icon + filename + `<a download>` link. Trash icon → opens delete confirm `<Modal role="alertdialog">`. Renders category `<Badge>` + uploader + date + size.
- **Tests added (RED):** Cases: image MIME → `<img>` with `loading="lazy"` and the right `src`; PDF → `FileText` icon + filename + `<a download>` link; click on card body fires `onPreview`; click on trash fires `onDelete`; category badge text matches the enum value.
- **Run order:**
  ```bash
  pnpm --filter @athlos/web typecheck
  pnpm --filter @athlos/web lint
  pnpm --filter @athlos/web test:run -- src/components/socios/AttachmentCard.test.tsx
  ```
- **Commit:** `feat(web): AttachmentCard thumbnail + icon`

---

### Task B.4 — `AttachmentPreviewModal`

- **File(s):** `apps/web/src/components/socios/AttachmentPreviewModal.tsx` (NEW); `apps/web/src/components/socios/AttachmentPreviewModal.test.tsx` (NEW)
- **Behavior:** Reuses the project's `<Modal size="2xl">` primitive. Props: `{ attachment: SocioAttachment | null; onClose: () => void }`. Image: inline `<img src={attachmentFileUrl(...)}>`. PDF: download `<a download>` link (per locked decision #12 — no first-page thumbnail in v1). Close via Esc / overlay click / explicit close button.
- **Tests added (RED):** Cases: renders nothing when `attachment === null`; renders `<img>` for image MIMEs with the right `src`; renders `<a download>` for PDFs; close button fires `onClose`; `Modal` primitive receives `role="dialog"` (or default per project).
- **Run order:**
  ```bash
  pnpm --filter @athlos/web typecheck
  pnpm --filter @athlos/web lint
  pnpm --filter @athlos/web test:run -- src/components/socios/AttachmentPreviewModal.test.tsx
  ```
- **Commit:** `feat(web): AttachmentPreviewModal`

---

### Task B.5 — `LegajoTab` + tab wiring in `/socios/[id]/page.tsx`

- **File(s):** `apps/web/src/components/socios/LegajoTab.tsx` (NEW); `apps/web/src/components/socios/LegajoTab.test.tsx` (NEW); `apps/web/src/app/(authed)/socios/[id]/page.tsx` (edit — add `'legajo'` to active-tab union, new `<Tabs.Tab>` entry with `FolderOpen` Lucide icon, mount `<LegajoTab socioId={id} />` in the panel); `apps/web/src/components/socios/AuditTab.tsx` (edit — 2 new `actionLabel()` + `ActionIcon()` cases for `SOCIO_ATTACHMENT_UPLOADED` and `SOCIO_ATTACHMENT_DELETED` with `FolderOpen` icon)
- **Behavior:** `LegajoTab` mirrors `AuditTab` shape — TanStack `useQuery(['socio-attachments', socioId], () => listAttachments(socioId), { staleTime: 30_000 })`. Renders `<AttachmentUpload>` + grid of `<AttachmentCard>` (or inline empty state matching `audit-tab-empty` — `Pin` icon + "Sin archivos" + body-sm). Manages preview modal state. `useMutation` for delete + `notify()` for feedback. The page-level wiring adds the new tab after `Auditoría`. `AuditTab` learns to render the two new action types.
- **Tests added (RED):** `LegajoTab.test.tsx` cases: renders grid when API returns items; renders empty state when API returns `[]`; opens preview modal when a card is clicked; opens delete confirm when trash icon is clicked; calls `deleteAttachment` + `notify('success', …)` on confirm. `page.tsx` and `AuditTab.tsx` changes are integration-tested by the existing snapshot + a 2-line extension to `AuditTab.test.tsx` for the new action cases.
- **Run order:**
  ```bash
  pnpm --filter @athlos/web typecheck
  pnpm --filter @athlos/web lint
  pnpm --filter @athlos/web test:run -- src/components/socios/LegajoTab.test.tsx
  pnpm --filter @athlos/web test:run -- src/components/socios/AuditTab.test.tsx
  ```
- **Commit:** `feat(web): LegajoTab + tab wiring + AuditTab attachment actions`

---

### Task B.6 — Toast integration (`notify()` calls for upload/delete)

- **File(s):** `apps/web/src/components/socios/LegajoTab.tsx` (edit — toast calls already in place from B.2 + B.5, this task is the test extension to pin them); `apps/web/src/components/socios/LegajoTab.test.tsx` (extend — assert `notify` called with `'success'` on upload, `'error'` on upload failure, `'success'` on delete, `'error'` on delete failure)
- **Behavior:** Every mutation in `LegajoTab` + `AttachmentUpload` calls `notify('success'|'error', '…')`. The toast helper comes from `apps/web/src/lib/notifications.ts` (archived `athlos-toast-primitivo` change).
- **Tests added (RED):** Extend `LegajoTab.test.tsx` with cases that mock `notify` and assert it fires the right kind + message on each mutation outcome.
- **Run order:**
  ```bash
  pnpm --filter @athlos/web typecheck
  pnpm --filter @athlos/web lint
  pnpm --filter @athlos/web test:run -- src/components/socios/LegajoTab.test.tsx
  ```
- **Commit:** `test(web): pin toast integration in LegajoTab + AttachmentUpload`

---

### B.wrap — Frontend PR wrap

Verification (run after B.6 lands, before pushing):

```bash
pnpm --filter @athlos/web typecheck
pnpm --filter @athlos/web lint
pnpm --filter @athlos/web test:run -- src/lib/api/attachments.test.ts src/components/socios/LegajoTab.test.tsx src/components/socios/AttachmentUpload.test.tsx src/components/socios/AttachmentCard.test.tsx src/components/socios/AttachmentPreviewModal.test.tsx
git log --oneline -10
git checkout -- apps/web/next-env.d.ts 2>/dev/null || true
```

Branch: `feat/legajo-b`. Push + open PR with title `feat(web): Legajo tab on /socios/[id] (PR 8c.2)`. PR body MUST document the pre-existing CI debt (`gastos.test.ts:134` lint) as unrelated.

---

## Apply Handoff

The apply agent MUST follow strict-TDD for every NEW source file:

1. **RED** — write the test file with failing assertions (or extend existing test file with new failing cases).
2. **GREEN** — implement the smallest change that turns the test green (in the SAME commit per project convention — see audit-operator-display #265).
3. **REFACTOR** — only when needed; never split refactoring into its own task.

**Test runner commands** (per file to avoid RAM saturation — handover #253 / #255):

- Backend: `pnpm --filter @athlos/api test:run -- <relative-path>` (e.g. `src/modules/file-storage/local-file-storage.test.ts`, `src/modules/socios/attachments.test.ts`). Full suite only at the end.
- Frontend: `pnpm --filter @athlos/web test:run -- <relative-path>` (e.g. `src/components/socios/LegajoTab.test.tsx`). Full suite only at the end.

**Mock pattern reminder (design R4 of audit-operator-display #265)**:

- This codebase uses the **synchronous** `vi.mock('module-path', () => ({ … }))` factory form (see `AuditTab.test.tsx:15–28` and `SocioNotesCard.test.tsx:21–34`).
- Do NOT use `async (importOriginal) => …` unless additional exports beyond the locked list land in the module later.

**Migration apply (post-merge only, NOT in this PR)**:

```bash
docker exec -i athlos-db-1 psql -U athlos -d athlos < packages/db/migrations/0021_socio_attachments.sql
```

**Pre-existing dirty file** (handover #255 / #253):

- `apps/web/next-env.d.ts` regenerates on Next build. Before any `git pull` after frontend commits, run `git checkout -- apps/web/next-env.d.ts` so it does not get staged.

**Files NOT to touch** (per design "NOT changed" + locked decisions):

- `packages/db/src/schema/operators.ts` (no migration on operators).
- `packages/errors`, `packages/auth`, `packages/validation` (use public exports only).
- Other routes under `apps/api/src/routes/` (socios, ctacte, padrones — untouched).
- `apps/api/src/services/notes.ts` audit emission pattern (we use `emitAudit()` from `@athlos/audit/emitter` exclusively for the new actions).

**Branch names and PR titles**:

- PR A: branch `feat/legajo-a`, title `feat(api): socio attachments + file-storage spec realisation (PR 8c.1)`.
- PR B: branch `feat/legajo-b`, title `feat(web): Legajo tab on /socios/[id] (PR 8c.2)`.

**No deploy in either PR**: no PM2 restart, no docker container recreation, no migration apply. Pre-existing CI failures (`gastos.test.ts:134` lint) will reappear — document in PR body. Orchestrator merges with `--admin`.

---

## Critical Tasks (Highest Risk)

- **A.5 — `attachments.ts` service with `FOR SHARE` transaction** — race correctness depends on the lock being held until COMMIT. If the lock is released early (e.g., by reading outside the tx), two concurrent uploads could both pass the quota check and one would exceed the cap. The test must drive TWO parallel `uploadAttachment` calls and assert exactly one rejects with `QuotaError`.
- **A.2 — `magic-byte.ts` validator** — exact byte tables must be verified, especially:
  - WEBP requires `RIFF` at offset 0 AND `WEBP` at offset 8 (not just one or the other).
  - PDF requires `%PDF-` at offset 0 AND `%%EOF` in the trailing 1024 bytes (a truncated PDF without trailer must reject).
  - GIF requires `47 49 46 38` (the first 4 bytes "GIF8") AND `7a`/`8a` at offset 4 AND `61` ("a") at offset 5 (i.e., "GIF87a" or "GIF89a").
- **B.2 — drag-and-drop handler** — jsdom drag events are partial; tests may need to mock or use a different assertion (e.g., assert the `onDrop` prop is wired correctly rather than dispatching synthetic DragEvents through `fireEvent.drop()`). If jsdom proves too incomplete, the fallback is to assert the underlying state mutation (`onFiles(files)`) without going through the drag UI.

---

## Out-of-Scope (deferred per locked decisions)

- PDF first-page thumbnail (deferred per locked decision #12).
- Image resizing / thumbnailing (deferred).
- `/ctacte` or `/padrones` attachments (out of scope; pattern reusable later).
- Admin-only delete (locked: any authenticated operator).
- CRDT / streaming for very large files (10 MB cap covers the locked decision).
- Quota-over-quota UI flow (just reject 413/400 with details).
- Generic `POST /api/v1/files` endpoint (deferred to a future change; `LocalFileStorage` + magic-byte + quota transaction are all built for reuse).
- Per-operator 1 GB quota (NOT implemented in v1).
- Retention cron for soft-deleted files (deferred; soft-delete is preserved for audit).
- Schema changes to existing `socios.*` tables beyond adding `socioAttachments`.
- `display_name` column for operators (kept `username` to avoid the broken drizzle migration pipeline).

---

## Risks (this task breakdown's own risks)

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | **Budget overrun on both PRs** — PR A ~700 LoC and PR B ~500 LoC both exceed the 400-line review budget. | Forecast is HIGH for both; offer the chained option (split each PR into A1/A2 and B1/B2). User picks before `sdd-apply`. |
| R2 | **Chained-vs-exception decision** — user must choose before apply; orchestrator cannot auto-resolve. | Forecast flags `Decision needed before apply: Yes`; orchestrator surfaces the chained option to the user with the LoC breakdown for each split. |
| R3 | **Drag-and-drop test reliability** — jsdom partial DragEvent support may yield flaky tests in B.2. | Fallback to assert the `onFiles` callback rather than dispatching synthetic drag events; pin via explicit prop assertions. |
| R4 | **Lockfile resolution of any new deps** — probably none (`@fastify/multipart@^9.0.2` already in `apps/api/package.json`), but if `file-type` or similar is added for sniffing it would touch the lockfile. | Prefer the pure-function `validateMagic` table (already pinned in design §5) over a `file-type` package dependency. If a dep is added, document the rationale in the PR body. |
| R5 | **Docker volume mounting** — `storage:/app/storage` mount on `api` service requires a rolling deploy in prod (existing containers won't pick up the volume). | Apply does NOT touch prod containers; PR A only ships the compose change. The orchestrator notes in the PR body that the deploy chore is separate and requires the orchestrator's deployment plan. |

---

## Notes for the Orchestrator

- **Decision gate**: before `sdd-apply`, surface the forecast block to the user and ask them to choose between:
  1. `size:exception` for both PRs (single PR per slice, each over 400 LoC).
  2. Chained split: A1+A2 for backend, B1+B2 for frontend (each PR well under 400 LoC; stacking = stacked-to-main by default).
- If the user picks the chained split, update `chain_strategy` from `pending` to `stacked-to-main` (or `feature-branch-chain` if they prefer a tracker branch) and rewrite `Work Unit Commits` to group commits by their new PR boundary.
- Pre-existing CI debt (`gastos.test.ts:134`) is acknowledged in the proposal and design; do NOT try to fix it as part of this change.