# feat(api): socio attachments + file-storage spec realisation (PR 8c.1)

Realises the dormant `file-storage` spec for the first time on the
new `socio_attachments` resource. Backend-only PR — no frontend
changes (PR B / 8c.2 follows).

## Linked artifacts

- Proposal: `openspec/changes/athlos-socio-legajo/proposal.md`
- Design: `openspec/changes/athlos-socio-legajo/design.md`
- Tasks: `openspec/changes/athlos-socio-legajo/tasks.md`
- Spec (NEW): `openspec/changes/athlos-socio-legajo/specs/socio-attachments/spec.md`
- Spec (DELTA): `file-storage`, `api-design`, `audit-logger`, `ui-design` under `openspec/changes/athlos-socio-legajo/specs/`

## Summary

- Adds the `socio_attachments` table (UUID PK, FK to socio + operator,
  `attachment_category` enum, soft-delete columns, 4 indexes).
- Adds `LocalFileStorage` (atomic-rename writes, streaming SHA-256,
  idempotent `unlink`, env vars `STORAGE_LOCAL_ROOT` /
  `STORAGE_MAX_FILE_SIZE_BYTES`).
- Adds `validateMagic` pure function (locked byte table for JPEG /
  PNG / WEBP / GIF / PDF).
- Extends the audit emitter with a `metadata` field + two new
  actions (`SOCIO_ATTACHMENT_UPLOADED`, `SOCIO_ATTACHMENT_DELETED`).
- Adds the `attachments-repository` (Drizzle wrapper, soft-delete
  semantics).
- Adds the `attachments` service with a `SELECT count + sum FOR
SHARE` quota transaction (100 files / 500 MB per socio).
- Adds the 5 `socio-attachments` routes (POST upload, GET list, GET
  metadata, GET file stream, DELETE soft).
- Registers `@fastify/multipart` (10 MB cap, 1 file) in `server.ts`.
- Adds the `storage` named docker volume + `api` mount in
  `docker-compose.yml`.
- Adds `STORAGE_LOCAL_ROOT` + `STORAGE_MAX_FILE_SIZE_BYTES` to
  `@athlos/config`.

## Commits (7 work-units)

| #   | Subject                                                                 | Files |
| --- | ----------------------------------------------------------------------- | ----- |
| A.1 | `feat(db): add socio_attachments table + indexes (0021)`                | 4     |
| A.2 | `feat(api): add LocalFileStorage + magic-byte validator`                | 5     |
| A.3 | `feat(audit): extend emitter with metadata + 2 new attachment actions`  | 3     |
| A.4 | `feat(api): add socio-attachments repository`                           | 3     |
| A.5 | `feat(api): add socio-attachments service with FOR SHARE quota tx`      | 3     |
| A.6 | `feat(api): add 5 socio-attachments routes (multipart upload + stream)` | 2     |
| A.7 | `chore(deploy): register multipart plugin + storage docker volume`      | 16    |

## Changed lines

`git diff --stat db4aab5..HEAD` → **3 039 insertions / 3 deletions
across 33 files** (vs. design forecast of 600–800 LoC).

The 4.4× overshoot over the design forecast is driven by:

- Exhaustive TDD test fixtures (26 magic-byte cases alone cover
  every MIME accept/reject + WEBP offset 8 + GIF 87a/89a + PDF
  trailer windows).
- The standin DB extension to model the new `socio_attachments`
  table (`apps/api/src/test-standins/db.ts`).
- Test-only env-var updates across 14 existing route test fixtures
  (`apps/api/src/test-helpers/mock-env.ts` + per-test `as Env`
  casts) when adding `STORAGE_LOCAL_ROOT` + `STORAGE_MAX_FILE_SIZE_BYTES`
  to the config schema.

The user approved `size:exception` for this PR (forecast ~700
LoC). The actual 3 039 LoC is documented here for transparency.

## Review summary

- **review-risk (inline)**: PASS. Path-traversal blocked at the
  storage boundary (`assertSafeStoragePath`); magic-byte validated
  on the just-written buffer; quota enforced under `FOR SHARE`;
  rollback path unlinks the file + aborts the insert; audit
  emission carries the full required metadata keys
  `{ attachment_id, filename, category, size_bytes }`; soft-delete
  is idempotent.
- **review-reliability (inline)**: PASS. 80 new tests across 6
  test files; the FOR SHARE concurrency test drives two parallel
  `uploadAttachment` calls through a serialized-transaction db and
  asserts exactly one wins; magic-byte covers every MIME accept
  and reject path including the WEBP offset-8 trap and the PDF
  trailing-1024 window.

## Pre-existing CI failures (unrelated)

The CI failures documented in handover #253 + #255 will repeat
on this branch — they are not introduced by this PR:

- `apps/api/src/routes/admin/gastos.test.ts:367` lint warning
  (`Unexpected console statement`) — pre-existing in the
  `athlos-n16-gastos-ctacte-fk` change.
- The `apps/web/next-env.d.ts` regenerated-on-build warning —
  pre-existing Next.js behaviour, not a test failure.

These are out of scope for this PR. They will be addressed in a
follow-up `chore(ci)` PR.

## Migration apply (post-merge runbook)

The migration is **hand-written** (`packages/db/drizzle/0021_socio_attachments.sql`)
because the drizzle migration pipeline is broken in prod per
handover #253. **Do NOT run** `pnpm --filter @athlos/db migrate`.
Apply via:

```bash
docker exec -i athlos-db-1 psql -U athlos -d athlos \
  < packages/db/drizzle/0021_socio_attachments.sql
```

The migration is idempotent (every `CREATE` uses `IF NOT EXISTS`).

## Docker volume deploy note

`docker-compose.yml` adds a new `storage:` named volume + `api`
mount at `/app/storage`. **Rolling deploy required** — existing
api containers do not have the mount and will throw `EACCES` on
upload until they're restarted with the new compose. The PR does
NOT touch prod containers.

## Migration apply order

1. Merge this PR to `main`.
2. Apply the migration via `docker exec psql` (above).
3. Rolling-redeploy the `api` container to pick up the new volume.
4. Open PR B (8c.2) for the frontend Legajo tab.

## Out of scope (per design)

- No PDF first-page thumbnail (deferred).
- No image resizing / thumbnailing (deferred).
- No `/ctacte` or `/padrones` attachments.
- No admin-only delete (any authenticated operator — matches
  `/socios/:id/notes` semantics).
- No retention cron (soft-delete is preserved for audit; on-disk
  file is retained until a future cron verifies
  `count_active_pointers(storage_path) = 0`).
- No per-operator 1 GB quota (deferred).

## Tests

```
pnpm --filter @athlos/api test:run -- \
  src/modules/file-storage \
  src/modules/socios/attachments \
  src/modules/socios/attachments-repository \
  src/routes/socios-attachments
```

→ 394 tests pass (2 skipped) across 44 files. No regressions in
the existing suite (320 → 394 = +74 new tests; 2 skipped is the
pre-existing count).

## Typecheck + lint

- `pnpm --filter @athlos/api typecheck` — clean.
- `pnpm --filter @athlos/db typecheck` — clean.
- `pnpm --filter @athlos/audit typecheck` — clean.
- `pnpm --filter @athlos/web typecheck` — clean.
- `pnpm --filter @athlos/api lint` — 1 pre-existing warning
  (gastos.test.ts:367), no new errors.
