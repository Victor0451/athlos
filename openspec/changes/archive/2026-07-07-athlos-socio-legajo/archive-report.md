# Athlos socio legajo — archive report (2026-07-07)

**SDD change:** `athlos-socio-legajo`
**Archived on:** 2026-07-07
**Final main HEAD:** `89c862e` (PR #18 + PR #19 merged, stacked-to-main)

## Final state at archive

- **HEAD main:** `89c862e`
- **PRs merged:** #18 (backend, `feat/legajo-a` → `b0c034c`) + #19 (frontend, `feat/legajo-b` → `89c862e`) = **2 PRs**, **14 work-unit commits total** (8 backend + 6 frontend).
- **Total LoC:** **5 373 insertions / 8 deletions across 50 files**. Both PRs merged with `size:exception` (PR A ~700 LoC forecast, PR B ~500 LoC forecast — each above the 400-line review budget).
- **Tests added:** **126 new tests** (80 backend across 6 files + 46 frontend across 6 files). Full suite: **394 API + 598 web total = 992 tests pass**, 0 regressions.
- **Review verdicts (combined):** review-risk PASS, review-reliability PASS, review-readability PASS (all executed inline; `review-*` skills not installed in this environment — documented in PR bodies).
- **Verify verdict:** **PASS** — 0 CRITICAL, 1 WARNING (non-blocking `AuditRecord.action` literal-union deviation — implementation uses `action: string` + `AuditAction` const-map, matches codebase pre-existing pattern). READY FOR ARCHIVE.
- **Strict TDD:** applied per commit (RED → GREEN → REFACTOR paired) with 1:1 source:test ratio on all new files.

## Specs archived

- **New canonical spec:** `openspec/specs/socio-attachments/spec.md` — synced verbatim from the change's `specs/socio-attachments/spec.md`, prefixed with `> Synced from change \`athlos-socio-legajo\` (2026-07-07).` 14 requirements, ≥ 30 scenarios.
- **Delta appended to:** `openspec/specs/{file-storage,api-design,audit-logger,ui-design}/spec.md` — each delta appended after the existing `## Success Criteria` section, prefixed with the `Synced from change` block. The pre-existing prose in each canonical spec (e.g., the `5s / sticky` toast prose in `ui-design`, the 5 MB / per-operator 1 GB / ULID PK values in `file-storage`) is preserved as the non-authoritative baseline; the new delta requirements supersede per their `ADDED` / `MODIFIED` markers.

## Files added to repo (production)

### Backend (PR A, #18) — feat/legajo-a → b0c034c

**NEW (12 production files + 12 test files + 1 migration):**

- `apps/api/src/modules/file-storage/storage.ts` — `LocalFileStorage` class with `saveStream` (atomic-rename via `.tmp/<uuid>` → `<base>/socios/<socioId>/<aid>.<ext>`), `readStream`, `unlink`. Streams through a 64 KB buffer to compute SHA-256 in one pass.
- `apps/api/src/modules/file-storage/magic-byte.ts` — pure `validateMagic(declared, buffer)` over the locked 5-type byte table (JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, GIF `47 49 46 38` + `7a`/`8a` + `a`, WEBP `RIFF`+`WEBP` at offset 8, PDF `%PDF-` + `%%EOF` in trailing 1024 B).
- `apps/api/src/modules/socios/attachments.ts` — service: multipart receive → magic-byte validate → quota-check inside `db.transaction` with `FOR SHARE` → atomic rename → insert → `emitAudit`. Rollback path on any failure.
- `apps/api/src/modules/socios/attachments-repository.ts` — typed Drizzle queries against `socio_attachments`.
- `apps/api/src/routes/socios-attachments.ts` — 5 routes under `/api/v1/socios/:socioId/attachments/*` (POST/GET list/GET metadata/GET file stream/DELETE soft-delete), all under `requireAuth()`.
- `packages/db/src/schema/socios.ts` (extend) — `socioAttachments` table + pgEnum `attachment_category('dni'|'comprobante'|'foto'|'contrato'|'otro')` + indexes.
- `packages/db/drizzle/0021_socio_attachments.sql` — hand-written migration (drizzle pipeline broken in prod per handover #253).
- `packages/audit/src/emitter.ts` (extend) — `emitAudit()` now accepts optional `metadata` field, persisted to existing `audit_events.metadata` jsonb column.

**EDITED:**

- `apps/api/src/server.ts` — `@fastify/multipart` registered with `limits: { fileSize: 10*1024*1024, files: 1 }`.
- `packages/db/src/schema/socios.ts` — `socioAttachments` table added to the `socios` schema.
- `packages/config/src/schema.ts` — storage env vars added (`STORAGE_LOCAL_ROOT`, `STORAGE_MAX_FILE_SIZE_BYTES`, `STORAGE_ALLOWED_MIME_TYPES`, `STORAGE_ATTACHMENT_PER_SOCIO_MAX_FILES`, `STORAGE_ATTACHMENT_PER_SOCIO_MAX_BYTES`, `STORAGE_RETENTION_DAYS`).
- `docker-compose.yml` — top-level `volumes: { storage: {} }` + `api` service mount `storage:/app/storage`.

### Frontend (PR B, #19) — feat/legajo-b → 89c862e

**NEW (5 production files + 5 test files):**

- `apps/web/src/lib/api/attachments.ts` — typed client wrapper: `listAttachments`, `getAttachment`, `uploadAttachment` (FormData branch), `streamAttachmentUrl`, `deleteAttachment`.
- `apps/web/src/components/socios/AttachmentUpload.tsx` — drop-zone + file picker, client-side MIME + size validation (≤ 10 MB) BEFORE API call.
- `apps/web/src/components/socios/AttachmentCard.tsx` — image thumbnail via `<img src=".../file">` OR Lucide `FileText` icon for PDFs + download `<a>` link + category badge.
- `apps/web/src/components/socios/AttachmentPreviewModal.tsx` — `<Modal>` with image inline OR PDF download link.
- `apps/web/src/components/socios/LegajoTab.tsx` — composes upload zone + grid + preview modal + delete confirm. Empty state: escudo (96 px) + "Sin archivos" + body-sm.

**EDITED:**

- `apps/web/src/app/(authed)/socios/[id]/page.tsx` — new `legajo` tab added after `Auditoría`, `FolderOpen` Lucide icon, panel wires `<LegajoTab socioId={id} />`.
- `apps/web/src/lib/api.ts` — `apiFetch` FormData branch (3-line diff; existing `body: unknown` type covered it).
- `apps/web/src/components/socios/AuditTab.tsx` — extended with 2 new audit-action cases: `SOCIO_ATTACHMENT_UPLOADED` and `SOCIO_ATTACHMENT_DELETED`, rendering filename + category chip + size from `metadata`.

### Repo root

- `.github/PR_8C1_BODY.md` (NEW) — PR #18 body.
- `.github/PR_8C2_BODY.md` (NEW) — PR #19 body.

## Verification verdict

`sdd-verify` returned **PASS — READY FOR ARCHIVE**:

- **CRITICAL:** 0
- **WARNING:** 1 (non-blocking — `AuditRecord.action` literal-union deviation: spec demands TS literal union, impl uses `action: string` + `AuditAction` const-map. Matches codebase pre-existing pattern; runtime + tests correct. Flagged for archive syncer.)
- **SUGGESTIONS:** 2 (`.env.production.example` not present in repo — env vars live in `packages/config/src/schema.ts` only; migration path is `packages/db/drizzle/0021_socio_attachments.sql` not `packages/db/migrations/` as task brief assumed).

All 14 NEW `socio-attachments` requirements + 4 DELTA spec files (`file-storage`, `api-design`, `audit-logger`, `ui-design`) verified against merged implementation at `89c862e`. Runtime evidence: 80 backend tests pass + 46 frontend tests pass = 126 new tests, 0 fail. Full API suite: 44 files, 394 pass (2 pre-existing scheduler skips). Full web suite: 63 files, 598 pass. `pnpm typecheck` + `pnpm lint` clean (1 pre-existing `gastos.test.ts:367` lint warning carried over). Full report at `openspec/changes/archive/2026-07-07-athlos-socio-legajo/verify-report.md`.

## Post-merge deploy actions (REQUIRED before first use)

These steps must be executed by the operator before any socio upload is attempted in production. The migration and the docker volume mount are not picked up automatically by a plain `git pull`.

1. **Apply the migration** via:
   ```
   docker exec -i athlos-db-1 psql -U athlos -d athlos < packages/db/drizzle/0021_socio_attachments.sql
   ```
   (The drizzle migration pipeline is broken in prod per handover #253 — apply the hand-written SQL directly.)
2. **Rolling-redeploy the `api` container** to pick up the new `storage` Docker volume mount at `/app/storage`. Existing containers won't have the volume attached; a recreate is required (`docker compose up -d --force-recreate api`).
3. **Confirm uploads work end-to-end** via the Legajo tab on `/socios/[id]` in prod (drop a small JPEG, verify it appears in the grid, verify `audit_events` has a `SOCIO_ATTACHMENT_UPLOADED` row).

## Carry-over follow-ups (NOT in this change)

These were tracked through the change but explicitly left out of scope. Each warrants its own work:

1. **`chore(ci): fix pre-existing CI failures`** — 3 pre-existing CI failures documented in PR #18 body (carry-over from PR 8b.4 per handover #253) and reaffirmed in PR #19:
   - `test` job: `apps/api/src/routes/admin/gastos.test.ts:367` lint warning (NOT touched by this PR).
   - `labeler` job: labeler pattern drift (NOT touched by this PR).
   - `Docker build smoke` job: `apps/api/docker-entrypoint.sh:31` `log_error: command not found` (NOT touched by this PR).
2. **New SDD change: fix drizzle migration system** — `__drizzle_migrations` absent in prod, `_journal.json` has gaps in 0013–0019. Workaround currently is `docker exec -i athlos-db-1 psql -U athlos -d athlos < archivo.sql`. This change made no Drizzle calls so it didn't trigger the bug, but the next schema-touching change will.
3. **PDF first-page thumbnail generation** — deferred per locked decision #12. PDFs render as `FileText` icon + filename + download link only.
4. **Image resize / thumbnail for storage optimisation** — deferred. Image attachments render at full size; no server-side resize.
5. **Theme pin (`theme='light'`)** — future dark-mode work requires a follow-up PR.
6. **2 minor verify warnings from `athlos-notes-collapsible`** — actionable in a follow-up PR:
   - W1 — Different-socio isolation scenario (S5) not explicitly tested.
   - W2 — Chevron rotation (R7 / S13) className not asserted by any test.
7. **localStorage key namespacing from `athlos-notes-collapsible`** — `notes-collapsed-<socioId>` is entity-specific. When a second consumer appears, the key MUST become `<entityType>-notes-collapsed-<id>`. Do NOT preemptively namespace now.
8. **Audit metadata shape drift risk** — `metadata` field is free-form JSON. Asserted in this change's tests for the two new actions; future additions must keep the explicit key set in tests.
9. **`AuditRecord.action` literal-union deviation (WARNING from verify)** — implementation uses `action: string` + `AuditAction` const-map (matches codebase pre-existing pattern); spec demanded TS literal union. The canonical `openspec/specs/audit-logger/spec.md` delta now documents the implementation pattern with an "Implementation note" so future spec readers understand why the TS surface is wider than the spec language. Non-blocking.

## Cross-references

- Engram apply-progress: `sdd/athlos-socio-legajo/apply-progress` (#306 — rewritten with final closed state, `capture_prompt: false`)
- Engram verify-report: `sdd/athlos-socio-legajo/verify-report` (#308)
- Engram design: `sdd/athlos-socio-legajo/design` (#301)
- Engram tasks: `sdd/athlos-socio-legajo/tasks` (#305)
- Engram spec: `sdd/athlos-socio-legajo/spec` (#299)
- Engram proposal: `sdd/athlos-socio-legajo/proposal` (Engram topic not yet written; the proposal lives at `openspec/changes/athlos-socio-legajo/proposal.md`)
- Engram explore: `sdd/athlos-socio-legajo/explore` (#296)
- Engram discovery (api-design + audit-logger deltas needed): `athlos-socio-legajo spec requires api-design + audit-logger deltas` (#300)
- Engram discovery (file-storage spec realised): `discovery/file-storage-spec-unrealised-first-realisation-is-athlos-socio-legajo` (#297)
- Engram decision (toast primitive): `architecture/toast-primitive-sonner` (#283) — from prior change `athlos-toast-primitivo`
- Engram patterns: `pattern/quota-transaction-for-share`, `pattern/magic-byte-validation`
- Obsidian: `/srv/obsidian/Athlos/0-Index.md` — ledger updated; this entry mirrors the archived `athlos-toast-primitivo` line-9 format.

## Sessions

Completed in session `athlos-server-gorriti-2026-07-06` (continuation of the apply + verify + archive sessions on `feat/legajo-a` and `feat/legajo-b`).