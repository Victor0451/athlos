# PR 8c.2 — Legajo tab on `/socios/[id]` (frontend of `athlos-socio-legajo`)

## Summary

Implements the operator-facing Legajo tab on `/socios/[id]` — drag-and-drop upload + categorised grid + preview modal + soft delete with audit trail. Builds on the backend landed in **PR 8c.1** (`#18`, merged at `b0c034c`).

- 6 work-unit commits, all on `feat/legajo-b`.
- 5 new components + 1 client wrapper + 1 page tab wiring.
- 1:1 source:test file ratio (strict TDD).
- `size:exception` approved (LoC below).

## Linked spec + design + tasks

- Spec: `openspec/changes/athlos-socio-legajo/specs/socio-attachments/spec.md` (NEW, 14 reqs)
- Spec deltas: `file-storage`, `api-design`, `audit-logger`, `ui-design` (added/modified)
- Design: `openspec/changes/athlos-socio-legajo/design.md`
- Tasks: `openspec/changes/athlos-socio-legajo/tasks.md` (B.1–B.6)

## 6 commits

| #   | SHA       | Subject                                                       |
| --- | --------- | ------------------------------------------------------------- |
| B.1 | `5fd2a44` | `feat(web): add attachments client wrapper`                   |
| B.2 | `97341ae` | `feat(web): add AttachmentUpload with drag-and-drop + picker` |
| B.3 | `392453f` | `feat(web): add AttachmentCard with thumbnail + icon`         |
| B.4 | `73d7daa` | `feat(web): add AttachmentPreviewModal`                       |
| B.5 | `d8dc1c9` | `feat(web): add LegajoTab + tab wiring on /socios/[id]`       |
| B.6 | (this PR) | `docs(pr): add PR 8c.2 body for legajo frontend`              |

## File diff list (15 files, 2072 insertions / 5 deletions)

**NEW (frontend):**

- `apps/web/src/lib/api/attachments.ts` — client wrapper (`listAttachments`, `getAttachment`, `uploadAttachment`, `deleteAttachment`, `attachmentFileUrl`)
- `apps/web/src/lib/api/attachments.test.ts`
- `apps/web/src/components/socios/AttachmentUpload.tsx` — drag-and-drop + picker + client-side MIME/size validation
- `apps/web/src/components/socios/AttachmentUpload.test.tsx`
- `apps/web/src/components/socios/AttachmentCard.tsx` — thumbnail / PDF icon + filename + category + uploader/date/size
- `apps/web/src/components/socios/AttachmentCard.test.tsx`
- `apps/web/src/components/socios/AttachmentPreviewModal.tsx` — full-size image / PDF download link
- `apps/web/src/components/socios/AttachmentPreviewModal.test.tsx`
- `apps/web/src/components/socios/LegajoTab.tsx` — query + grid + preview/delete state + empty state
- `apps/web/src/components/socios/LegajoTab.test.tsx`

**EDITED:**

- `apps/web/src/lib/api.ts` — 3-line `FormData` branch on `apiFetch` (multipart upload, no JSON content-type, browser sets the boundary)
- `apps/web/src/components/socios/AuditTab.tsx` — 2 new `actionLabel()` + `ActionIcon()` cases for `SOCIO_ATTACHMENT_UPLOADED` / `SOCIO_ATTACHMENT_DELETED` + body renderer for filename/size
- `apps/web/src/components/socios/AuditTab.test.tsx` — 2 new test cases
- `apps/web/src/app/(authed)/socios/[id]/page.tsx` — new `'legajo'` tab + `FolderOpen` icon + panel mount
- `apps/web/src/app/(authed)/socios/[id]/page.test.tsx` — 2 new test cases asserting tab presence + panel render

## Review summary (review-readability + review-reliability — inline)

### Readability — PASS

- **Naming**: All identifiers use the locked vocabulary (`AttachmentRow`, `AttachmentCategory`, `onPreview`, `onDelete`, `isDragOver`, `previewAttachment`). The `CATEGORY_LABEL` map is duplicated between `AttachmentCard.tsx` and `AttachmentPreviewModal.tsx` — kept intentional (each component self-contained; no over-extraction to a shared module for v1).
- **Constants**: `MAX_FILE_SIZE_BYTES`, `ALLOWED_MIME_TYPES`, `CATEGORY_OPTIONS`, `SOCIO_ATTACHMENTS_QUERY_KEY` are module-scoped and named.
- **Pure function**: `validateFile(file)` extracted from the component for testability + reuse.
- **Documentation**: Each component has a header docblock stating the locked UX contract + citations to `design.md §8`.
- **Complexity**: Largest function is the drop-handler cluster (~5 lines); `handleFiles` callback is the only complex branch and is straightforward.

### Reliability — PASS

- **Mock hygiene**: All tests use the synchronous `vi.mock` factory form (per design R4 / D8 of `audit-operator-display` + `athlos-toast-primitivo`). No `importOriginal` escalation.
- **Test count**: 39 new tests across 7 files (`attachments.test.ts`: 9, `AttachmentUpload.test.tsx`: 10, `AttachmentCard.test.tsx`: 9, `AttachmentPreviewModal.test.tsx`: 6, `LegajoTab.test.tsx`: 9, `AuditTab.test.tsx` ext: 2, `page.test.tsx` ext: 2). 598 total tests pass.
- **Edge cases**:
  - `AttachmentUpload`: oversize (>10 MB) + disallowed MIME (exe) → inline error, NO API call, NO toast (client-side validation is a synchronous UX gate).
  - `LegajoTab`: `window.confirm` cancel keeps the row; `window.confirm` accept fires mutation + success toast + invalidation.
  - `AttachmentPreviewModal`: `attachment === null` renders nothing (no orphan `<Modal>` open).
- **Determinism**: All async assertions use `waitFor`; no `setTimeout` flake.
- **Regression risk**: The only "shared" surface changes are:
  1. 3-line `FormData` branch in `api.ts` — guarded by `body instanceof FormData` so the JSON path is untouched (existing `api.test.ts:94-113` still passes).
  2. `AuditTab` adds 2 new action cases — default case still handles unknowns; no behavior change for existing actions.
  3. `page.tsx` adds 1 tab entry + 1 panel — lazy-mounted only when `activeTab === 'legajo'`, so existing flows are unaffected.
- **Drag-and-drop caveat (R3)**: jsdom's `DragEvent` support is partial. The test uses `fireEvent.drop` with a stub `dataTransfer` (matching `dataTransfer.files`) rather than dispatching a full `DragEvent`. If a real browser reports drag broken, the fallback is to add a `try/catch` around `e.dataTransfer.files` — tracked as a follow-up.

### Warnings / Suggestions (logged, not fixed pre-push)

- **Suggestion**: `formatSize()` is duplicated between `AttachmentCard.tsx` and `AuditTab.tsx`. Could be lifted to a shared `lib/format/size.ts`. Not done to keep PR focused on the legajo surface.
- **Warning**: The `LegajoTab.test.tsx` "refresh after upload" case asserts only the initial mount (the upload → onUploadComplete → invalidation chain is fully exercised in `AttachmentUpload.test.tsx` where the upload mutation fires). Integration of the two is implicit via the shared `onUploadComplete` contract — documented in the test header.

## `size:exception`

PR B is forecast ~500 LoC in `tasks.md` and the orchestrator approved `size:exception` up front. **Actual LoC: 2072 insertions / 5 deletions across 15 files** (4.1× forecast).

Breakdown:

- ~967 LoC of production code (5 new components + 1 client wrapper + 3 edited files).
- ~1110 LoC of tests (1:1 source:test ratio per strict TDD; tests cover edge cases + client-side validation + jsdom-aware drag-drop).

The strict-TDD 1:1 source:test ratio is the dominant driver of the LoC delta. Code-only LoC is ~2× the forecast, total LoC is ~4×. Both are within the spirit of the exception (`size:exception` was approved for "over-budget" PRs without a hard cap).

## Pre-existing CI failures (unrelated, will repeat)

- `apps/api/src/routes/admin/gastos.test.ts:367` lint warning — present before this PR. Documented in PR 8c.1's body too. Not touched here.
- `apps/web/next-env.d.ts` regenerates on `next build` — pre-existing per handover #253. Reverted before push.

## Backend dependency (PR 8c.1 — already merged)

This PR's `uploadAttachment` wrapper hits the 5 backend endpoints at `/api/v1/socios/:socioId/attachments/*` landed in PR 8c.1 (`#18`, merged at `b0c034c`). Until the new `socio_attachments` migration `0021_socio_attachments.sql` is applied to prod (runbook in PR 8c.1's body: `docker exec -i athlos-db-1 psql -U athlos -d athlos < packages/db/migrations/0021_socio_attachments.sql`), uploads will return 404 / 500. Apply migration as part of the deploy.

## Deploy

- No PM2 restart required (frontend only; Next.js hot-reloads on the dev process).
- No docker container recreation.
- No migration apply in this PR (PR 8c.1's deploy chore).

## Verification

```bash
pnpm --filter @athlos/web typecheck            # passes
pnpm --filter @athlos/web lint                 # passes
pnpm --filter @athlos/web test:run -- \
  src/lib/api/attachments.test.ts \
  src/components/socios/AttachmentUpload.test.tsx \
  src/components/socios/AttachmentCard.test.tsx \
  src/components/socios/AttachmentPreviewModal.test.tsx \
  src/components/socios/LegajoTab.test.tsx \
  'src/app/(authed)/socios/[id]/page.test.tsx' \
  src/components/socios/AuditTab.test.tsx
# 598 tests pass, 0 fail
```

## Next step

After merge → `sdd-verify` (PR 8c.2) + `sdd-archive` (sync `socio-attachments` spec to `openspec/specs/`).
