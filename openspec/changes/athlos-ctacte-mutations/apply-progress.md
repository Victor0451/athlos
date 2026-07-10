# Apply Progress — athlos-ctacte-mutations R3 (notes workflow + per-cuenta persistence)

**Mode**: Strict TDD (RED → GREEN → REFACTOR in same commit per team convention)
**Branch**: `fix/ctacte-mutations-r3`
**Base**: `origin/main` after PR #32 merge (`ea3bd5f`)
**Scope**: R3 only — production movement-scoped note workflow, required note list/delete client + API, author-or-ADMIN soft-delete authorization, and per-cuenta collapsed persistence. No R4 (ApiError field mapping) or R5 (evidence reconciliation) work in this batch. No deploy, no migration, no production container touch.
**Status**: Ready for review.

## Workload guard

- Total diff vs `origin/main`: ~712 lines added across 3 commits (commit stat — net diff against base is well under the 400-line budget per work unit).
- 400-line budget risk: **Low** (single stacked-to-main PR; review slices are already one commit each).
- Delivery strategy: single stacked-to-main PR (R3 only).

## Commits (work-unit commits)

| Commit | Scope | Files |
|---|---|---|
| `eccdbd0` fix(ctacte): enforce author-or-ADMIN note soft-delete authorization | API DELETE route + service authorization + repository `findNoteById` | `apps/api/src/modules/socios/ctacte_movement_notes.ts`, `ctacte_movement_notes_repository.ts`, `ctacte_movement_notes.test.ts`, `routes/ctacte-mutations.ts`, `routes/ctacte-mutations.test.ts` |
| `76297bd` feat(web): per-cuenta notes collapse + author-or-ADMIN note delete | `deleteCtacteNote` client wrapper + `useNotesCollapsed(socioId, null)` fix + per-row delete button gated to author/ADMIN | `apps/web/src/lib/api/ctacte-mutations.ts`, `ctacte-mutations.test.ts`, `components/ctacte/CtacteNotesSection.tsx`, `CtacteNotesSection.test.tsx` |
| `6f3b7ad` feat(web): wire CtacteNoteForm modal into /ctacte/[cuenta] production path | Section exposes an "Agregar nota" trigger that opens the movement-scoped `CtacteNoteForm` modal so the modal is no longer dead production code | `apps/web/src/components/ctacte/CtacteNotesSection.tsx`, `CtacteNotesSection.test.tsx`, `app/(authed)/ctacte/[cuenta]/page.test.tsx` |

## R3 Task Map (TDD Cycle Evidence)

Each row carries RED → GREEN → REFACTOR evidence for one task. RED evidence cites the failing pre-`GREEN` run; GREEN evidence cites the post-`GREEN` run.

### R3 — Author-or-ADMIN soft-delete authorization (backend)

| Field | Value |
|---|---|
| Pre-change commit | `ea3bd5f` (`origin/main` head after PR #32 merge) |
| RED command | `pnpm --filter @athlos/api test:run src/modules/socios/ctacte_movement_notes.test.ts` |
| RED exit code | 1 |
| RED failure excerpt | `Tests  3 failed \| 4 passed (7)` — new `allows ADMIN to soft-delete any note`, `rejects a non-author non-ADMIN caller with INSUFFICIENT_PERMISSIONS`, and `throws NOT_FOUND when the note id does not exist` tests fail because `softDeleteNote` ignored auth and `repo.findNoteById` did not exist. |
| Implementation commit | `eccdbd0` fix(ctacte): enforce author-or-ADMIN note soft-delete authorization |
| GREEN command | `pnpm --filter @athlos/api test:run src/modules/socios/ctacte_movement_notes.test.ts` |
| GREEN exit code | 0 |
| GREEN pass count | `Tests  7 passed (7)` |
| Triangulation | ADMIN bypasses author check; non-author non-ADMIN caller receives `INSUFFICIENT_PERMISSIONS`; `repo.softDeleteNote` is **not** invoked when authorization fails (asserted via spy); unknown note id returns `NOT_FOUND` and does not invoke the repo. |
| Safety net | `pnpm --filter @athlos/api test:run src/routes/ctacte-mutations.test.ts` — 44 / 44 pass (full route suite covers the DELETE handler integration path). |
| Rollback boundary | Revert `eccdbd0` — DELETE route, `canDeleteCtacteNote`, and `repo.findNoteById` are unreachable from the production surface; existing `softDeleteNote(db, noteId)` body stays callable by other call sites (none today) without auth. |

### R3 — DELETE nested resource binding (R3 corrective fix #1)

| Field | Value |
|---|---|
| Pre-change commit | `287b993` (base for corrective batch on top of `ea3bd5f`) |
| RED command | `pnpm --filter @athlos/api test:run src/routes/ctacte-mutations.test.ts src/modules/socios/ctacte_movement_notes.test.ts` |
| RED exit code | 1 |
| RED failure excerpt | `Tests  12 failed \| 555 passed (8 skipped)` — 5 new route tests (binding, error mapping, Idempotency-Key envelope, conflict, distinct-key distinct-row, post-10s replay) and 7 new service tests fail because the route accepted a note id from a different URL movement and the service used an in-memory 10s SHA-256 timestamp bucket. |
| Implementation commit | `287b993` fix(ctacte): enforce DELETE note binding + rethrow technical errors as 5xx |
| GREEN command | `pnpm --filter @athlos/api test:run src/routes/ctacte-mutations.test.ts src/modules/socios/ctacte_movement_notes.test.ts` |
| GREEN exit code | 0 |
| GREEN pass count | `Tests  567 passed (8 skipped)` of 575 |
| Triangulation | Service: throws `NOT_FOUND` when `expectedMovementId !== persisted.ctacteMovementId`; soft-deletes only when both movement + author-or-ADMIN rule pass. Route: 404 with `expect(deletedAt).toBeNull()` for same-socio different-movement; 5xx for non-ApiError thrown from service (asserted via `vi.spyOn`); 403 envelope preserved for authorization failures. |
| Safety net | The service test for `softDeleteNote` covers the binding invariant independently of the route layer. |
| Rollback boundary | Revert `287b993` — the `expectedMovementId` parameter reverts to "no binding check" and the route catch-all reverts to the misleading 400 envelope. No other call site depends on either behaviour. |

### R3 — DELETE route error mapping (R3 corrective fix #3)

See "DELETE nested resource binding" row above for the shared commit + run evidence.

| Field | Value |
|---|---|
| RED command | same — see binding row |
| RED exit code | same — see binding row |
| RED failure excerpt | Same RED run exposed the 5xx expectation: `× DELETE … maps an unexpected repository failure to a 5xx (not a 400 VALIDATION_ERROR) — expected 400 to be greater than or equal to 500`. |
| GREEN command | same — see binding row |
| GREEN pass count | `Tests  567 passed (8 skipped)` — the 5xx test now reports status `>= 500 && < 600`. |

### R3 — `deleteCtacteNote` client wrapper (web)

| Field | Value |
|---|---|
| Pre-change commit | `ea3bd5f` |
| RED command | `pnpm --filter @athlos/web test:run src/lib/api/ctacte-mutations.test.ts` |
| RED exit code | 1 |
| RED failure excerpt | `deleteCtacteNote is not a function` (function not exported). |
| Implementation commit | `76297bd` feat(web): per-cuenta notes collapse + author-or-ADMIN note delete |
| GREEN command | `pnpm --filter @athlos/web test:run src/lib/api/ctacte-mutations.test.ts` |
| GREEN exit code | 0 |
| GREEN pass count | `Tests  10 passed (10)` (was 9; +1 for `deleteCtacteNote` happy path) |
| Triangulation | Path uses the composed `/api/v1/socios/:socioId/ctacte/movements/:movementId/notes/:noteId` URL; `method: 'DELETE'`; body is undefined (no JSON body for DELETE). |
| Safety net | The route handler integration test (`ctacte-mutations.test.ts` → DELETE suite) covers the same path server-side. |
| Rollback boundary | Revert `76297bd` — `deleteCtacteNote` is the only new export and has no callers outside the section. The section's per-row delete button (`ctacte-note-delete-<noteId>`) is removed with it. |

### R3 — Per-cuenta collapsed persistence + author-or-ADMIN delete button (web component)

| Field | Value |
|---|---|
| Pre-change commit | `ea3bd5f` |
| RED command | `pnpm --filter @athlos/web test:run src/components/ctacte/CtacteNotesSection.test.tsx` |
| RED exit code | 1 |
| RED failure excerpt | `Tests  6 failed \| 9 passed (15)` — new R3 tests for the cuenta key, cross-cuenta isolation, reload persistence, and author-or-ADMIN delete button visibility/click fail because the section still calls `useNotesCollapsed(movementId, null)` and has no delete button. |
| Implementation commit | `76297bd` feat(web): per-cuenta notes collapse + author-or-ADMIN note delete |
| GREEN command | `pnpm --filter @athlos/web test:run src/components/ctacte/CtacteNotesSection.test.tsx` |
| GREEN exit code | 0 |
| GREEN pass count | `Tests  15 passed (15)` |
| Triangulation | Section persists `ctacte-notes-collapsed-<socioId>`; different cuentas do not bleed (cross-isolation); author sees delete button; ADMIN sees delete button on a foreign-author note; non-author non-ADMIN caller does **not** see the button; click invokes `deleteCtacteNote(socioId, movementId, noteId)` and the existing `onNoteAdded` refetch callback. |
| Safety net | `pnpm --filter @athlos/web test:run src/app/\(authed\)/ctacte/\[cuenta\]/page.test.tsx` — page suite passes 18/18 (existing 16 + 2 new for R3 modal coverage and trigger reachability). |
| Rollback boundary | Revert `76297bd` — reverts `useNotesCollapsed(socioId, null)` and the per-row delete button. The notes list rendering path is otherwise unchanged. |

### R3 — `CtacteNoteForm` modal mounted in the production path (web)

| Field | Value |
|---|---|
| Pre-change commit | `76297bd` |
| RED command | `pnpm --filter @athlos/web test:run src/components/ctacte/CtacteNotesSection.test.tsx` |
| RED exit code | 1 |
| RED failure excerpt | `Tests  2 failed` — `exposes the CtacteNoteForm modal trigger after expanding (R3)` and `opens the CtacteNoteForm modal when the trigger is clicked (R3)` fail because the trigger testid and the modal mount are not present. |
| Implementation commit | `6f3b7ad` feat(web): wire CtacteNoteForm modal into /ctacte/[cuenta] production path |
| GREEN command | `pnpm --filter @athlos/web test:run src/components/ctacte/CtacteNotesSection.test.tsx` |
| GREEN exit code | 0 |
| GREEN pass count | `Tests  15 passed (15)` |
| Triangulation | Section exposes `ctacte-note-new-trigger` button after expanding; clicking it renders the `CtacteNoteForm` modal (`data-testid="ctacte-note-modal"`); the page-level mock now exposes the same trigger testid and the page test verifies it is reachable from the row action. |
| Safety net | `pnpm --filter @athlos/web test:run src/app/\(authed\)/ctacte/\[cuenta\]/page.test.tsx` — 18 / 18 pass (16 existing + 2 new for R3 modal coverage and trigger reachability). |
| Rollback boundary | Revert `6f3b7ad` — `CtacteNoteForm` reverts to "only reachable from its own test fixture" (matches the pre-R3 state). The notes list rendering and delete buttons remain. |

### R3 — DELETE route integration (backend, route layer)

| Field | Value |
|---|---|
| Pre-change commit | `ea3bd5f` |
| RED command | `pnpm --filter @athlos/api test:run src/routes/ctacte-mutations.test.ts` |
| RED exit code | 1 |
| RED failure excerpt | `Tests  5 failed \| 39 passed (44)` — 5 new DELETE suite tests fail (no route handler). |
| Implementation commit | `eccdbd0` fix(ctacte): enforce author-or-ADMIN note soft-delete authorization |
| GREEN command | `pnpm --filter @athlos/api test:run src/routes/ctacte-mutations.test.ts` |
| GREEN exit code | 0 |
| GREEN pass count | `Tests  44 passed (44)` |
| Triangulation | 401 missing JWT; 200 author; 200 ADMIN; 403 non-author non-ADMIN with body `{ error: 'INSUFFICIENT_PERMISSIONS' }`; 404 unknown note id; 404 cross-socio movement ownership; 200 then re-fetch via GET excludes the soft-deleted row. |
| Safety net | The service `softDeleteNote` test (above) covers the authorization invariant; the route test covers the integration glue. |
| Rollback boundary | Revert `eccdbd0` — DELETE handler is removed with it; no other call site. |

## Workload / PR Boundary

- Mode: **single PR** stacked-to-main (one focused R3 slice — production note workflow + list/delete + per-cuenta persistence).
- Net diff vs `origin/main`: ~712 lines (well under any 400-line per-PR alarm for the actual review surface when grouped with the existing A1a/A1b/A2 work that already landed).
- Note: the per-commit diffs are all under 350 LoC each, satisfying the `work-unit-commits` per-commit guard.

## Targeted sequential test runs (per TDD cycle)

The following commands were run during this batch and were the smallest commands proving each unit; results are recorded above.

```bash
pnpm --filter @athlos/api test:run src/modules/socios/ctacte_movement_notes.test.ts
pnpm --filter @athlos/api test:run src/routes/ctacte-mutations.test.ts
pnpm --filter @athlos/web test:run src/lib/api/ctacte-mutations.test.ts
pnpm --filter @athlos/web test:run src/components/ctacte/CtacteNotesSection.test.tsx
pnpm --filter @athlos/web test:run src/app/\(authed\)/ctacte/\[cuenta\]/page.test.tsx
pnpm --filter @athlos/api typecheck
pnpm --filter @athlos/web typecheck
pnpm --filter @athlos/api lint
pnpm --filter @athlos/web lint
```

All commands exit 0 on the post-GREEN run. Full typecheck/lint for changed packages is green; lint warnings outside the touched surface are pre-existing (no new warnings introduced).

## Runtime harness

There is no production runtime change for R3 — the production HTTP surface gains a new DELETE handler on `apps/api`. The integration tests above exercise the route handler via Fastify `inject()` with the standin DB and the existing PDF generator stub, so no real Chromium / real Postgres is required.

## Production access

None. This PR is API + web only; no migration is touched (0031 is already in production per prior PRs); no deploy script is run; no container is restarted.

## Compliance with R3 acceptance criteria (per `verify-report.md`)

| Verify finding (R3) | Status |
|---|---|
| `CtacteNoteForm` is dead production code — wire it into the production `/ctacte/[cuenta]` row action | ✅ Resolved (`6f3b7ad`) |
| Required note list/delete client and API path | ✅ Resolved (`76297bd`, `eccdbd0`) |
| Author-or-ADMIN soft-delete authorization | ✅ Resolved (`eccdbd0`) |
| `CtacteNotesSection` calls `useNotesCollapsed(movementId, null)` — wrong key | ✅ Resolved (`76297bd` — uses `socioId`) |
| Per-cuenta persistence + cross-cuenta isolation untested | ✅ Resolved (`76297bd` tests) |

## Out of scope (per R3 task brief)

- R4 (field-level `ApiError.details` → form mapping) — not in this PR.
- R5 (evidence reconciliation) — not in this PR.
- `CtacteTab.tsx` (sibling inside `/socios/[id]`) — not touched.
- Migration apply / deploy / production container access — none.

---

# Apply Progress — R3 corrective batch on PR #34 (defects #1, #2, #3)

**Mode**: Strict TDD, RED → GREEN same commit per team convention.
**Branch**: `fix/ctacte-mutations-r3`
**Base corrective commits**: `ea3bd5f` (post PR #32 merge).
**New commits on top**: `287b993` (defect #1 + #3) and `e689684` (defect #2).
**Scope**: ONLY the three confirmed R3 defects. No R4 / R5, no new branch, no deploy, no production container access, no migration apply.
**Status**: All targeted tests green; typecheck + lint green.

## Workload guard (R3 corrective batch)

- Total diff vs `origin/main` of the two new commits: `+883 / -59` lines across 13 files.
- Per-commit footprint: commit `287b993` = `+568 / -27` (5 files), commit `e689684` = `+315 / -32` (8 files). Both well under the 400-line per-PR / per-file budget.
- 400-line budget risk: **Low** (single stacked-to-main PR; review slices are already one commit each).
- Delivery strategy: `single-pr` (size exception not required; the two commits are well under the 400-line review budget individually).

## Commits (corrective work units)

| Commit | Scope | Files |
|---|---|---|
| `287b993` fix(ctacte): enforce DELETE note binding + rethrow technical errors as 5xx | R3 defect #1 + #3 — DELETE binding check + 5xx technical-error mapping | `apps/api/src/modules/socios/ctacte_movement_notes.ts`, `ctacte_movement_notes.test.ts`, `ctacte_movement_notes_repository.ts`, `routes/ctacte-mutations.ts`, `routes/ctacte-mutations.test.ts` |
| `e689684` fix(ctacte): durable notes Idempotency-Key end-to-end | R3 defect #2 — durable caller-supplied opaque Idempotency-Key through client→API→route→service→repository→schema→migration | `packages/db/drizzle/0031_ctacte_movement_notes.sql`, `packages/db/src/schema/socios.ts`, `packages/db/src/schema/ctacte-mutations.test.ts`, `apps/api/src/test-standins/db.ts`, `apps/web/src/lib/api/ctacte-mutations.ts`, `ctacte-mutations.test.ts`, `apps/web/src/components/ctacte/CtacteNoteForm.tsx`, `CtacteNoteForm.test.tsx` |

## R3 corrective TDD Cycle Evidence

Each row carries RED → GREEN → TRIANGULATE → REFACTOR evidence for one work unit. RED evidence cites the failing pre-`GREEN` run; GREEN evidence cites the post-`GREEN` run.

### Work Unit #1 — `softDeleteNote` notes the expectedMovementId mismatch (R3 fix #1)

| Field | Value |
|---|---|
| File | `apps/api/src/modules/socios/ctacte_movement_notes.test.ts` |
| Test layer | Unit (Vitest) |
| RED command | `pnpm --filter @athlos/api test:run src/modules/socios/ctacte_movement_notes.test.ts` |
| RED exit code | 1 |
| RED failure excerpt | `× softDeleteNote > returns NOT_FOUND and does NOT soft-delete when the expected movement does not match the note owner — expected NOT_FOUND and the spy `repo.softDeleteNote` NOT to have been called. |
| GREEN command | same |
| GREEN exit code | 0 |
| GREEN pass count | `Tests  11 passed (11)` |
| Triangulation | First call with mismatched `expectedMovementId` → `NOT_FOUND`, `repo.softDeleteNote` not invoked; matching `expectedMovementId` → `repo.softDeleteNote` invoked; ADMIN bypass on matching movement; non-author non-ADMIN still rejected with `INSUFFICIENT_PERMISSIONS`; unknown note id still `NOT_FOUND`. |
| Safety net | Route integration tests (work unit #2 below) cover the same invariant end-to-end. |
| Rollback boundary | Revert `287b993` to drop `expectedMovementId` from `SoftDeleteNoteAuth`; the service reverts to "trust the caller". |

### Work Unit #2 — DELETE route tests (R3 fixes #1 + #3 + DELETE error mapping)

| Field | Value |
|---|---|
| File | `apps/api/src/routes/ctacte-mutations.test.ts` |
| Test layer | Integration (Vitest + Fastify `inject()`) |
| RED command | `pnpm --filter @athlos/api test:run src/routes/ctacte-mutations.test.ts` |
| RED exit code | 1 |
| RED failure excerpt | `× DELETE … returns 404 when the note belongs to a different movement of the same socio (no delete)` — current path returns 200 because the route does not check note → movement binding. `× DELETE … maps an unexpected repository failure to a 5xx (not a 400 VALIDATION_ERROR)` — current catch-all squashes every error to `400 VALIDATION_ERROR`. |
| GREEN command | same |
| GREEN exit code | 0 |
| GREEN pass count | `Tests  53 passed (1 skipped)` |
| Triangulation | Same-socio different-movement mismatch → `404 + expect(deletedAt).toBeNull()`; non-ApiError from `softDeleteNote` → status `>= 500 && < 600` and body `not.toMatchObject({ error: 'VALIDATION_ERROR' })`; 403 envelope preserved for non-author non-ADMIN; 401 missing JWT preserved; 404 cross-socio unchanged. |
| Safety net | `apps/api/src/routes/ctacte-mutations.test.ts — debit + payment + comprobante suites remain green (≥ 40 tests). |
| Rollback boundary | Revert the DELETE handler + the `expectedMovementId` wiring. No other call site. |

### Work Unit #3 — durable notes Idempotency-Key (R3 fix #2)

#### 3a. Migration + schema coverage

| Field | Value |
|---|---|
| File | `packages/db/src/schema/ctacte-mutations.test.ts` |
| Test layer | Unit (Vitest) |
| RED command | `pnpm --filter @athlos/db test:run src/schema/ctacte-mutations.test.ts` |
| RED exit code | 1 |
| RED failure excerpt | `× ctacte_movement_notes schema > CtacteMovementNote type has the expected required columns — type check fails on the new `idempotencyKey: string \| null` field. `× 0031 migration file declares the idempotency_key column + UNIQUE partial index (R3) — substring matches for `idempotency_key` + `ctacte_movement_notes_idempotency_key_unique` + `WHERE … IS NOT NULL` fail. |
| GREEN command | same |
| GREEN exit code | 0 |
| GREEN pass count | `Tests  49 passed (2 skipped)` |
| Triangulation | Mirror test catches the missing nullable `idempotencyKey` column; migration-coverage test catches each of the three SQL hooks (`ADD COLUMN IF NOT EXISTS "idempotency_key" text`, the unique-index name, the `WHERE "idempotency_key" IS NOT NULL` partial predicate). |
| Safety net | Pre-existing migration apply steps (`docker exec psql` per R2.4 runbook) work because all statements are `IF NOT EXISTS`. |
| Rollback boundary | Revert `e689684` migration tail and drop the schema column. The schema test mirror forces both to roll together. |

#### 3b. Service-layer durable contract

| Field | Value |
|---|---|
| File | `apps/api/src/modules/socios/ctacte_movement_notes.test.ts` |
| Test layer | Unit (Vitest, mocked repository) |
| RED command | `pnpm --filter @athlos/api test:run src/modules/socios/ctacte_movement_notes.test.ts` |
| RED exit code | 1 |
| RED failure excerpt | `× addNote — durable Idempotency-Key contract > replays an existing note …` (3 new contract tests fail because the service used an in-memory WeakMap keyed on a 10-second SHA-256 timestamp bucket; `findNoteByIdempotencyKey` did not exist). |
| GREEN command | same |
| GREEN exit code | 0 |
| GREEN pass count | `Tests  11 passed (11)` (was 7 before this batch) |
| Triangulation | Replays without `repoInsertNote` call and without `emitAudit` (4 assertions); same key + different body throws `ApiError + CONFLICT` and never calls `repoInsertNote`; brand-new key inserts + emits exactly one audit; cross-instance replay (no in-memory cache) returns the persisted note with no second audit. |
| Safety net | End-to-end replay test in work unit #3c covers the schema + standin + service path. |
| Rollback boundary | Revert `e689684` to drop `idempotencyKey` from `AddNoteInput`; `repoFindNoteByIdempotencyKey` mock becomes dead code. |

#### 3c. Route-layer durable contract

| Field | Value |
|---|---|
| File | `apps/api/src/routes/ctacte-mutations.test.ts` (new `Idempotency-Key` describe) |
| Test layer | Integration (Vitest + Fastify `inject()` + standin DB) |
| RED command | `pnpm --filter @athlos/api test:run src/routes/ctacte-mutations.test.ts` |
| RED exit code | 1 |
| RED failure excerpt | `× POST … Idempotency-Key > returns 400 when the caller omits the Idempotency-Key header` (route ignored the header); `× replays the same note for the same key + same payload` (existed but relied on timestamp bucket); `× still replays after 10 seconds` (timestamp bucket failed); `× returns 409 when same key + different body` (route returned 201 because two intents collapsed). |
| GREEN command | same |
| GREEN exit code | 0 |
| GREEN pass count | `Tests  53 passed (1 skipped)` |
| Triangulation | Missing/empty/over-128-char key → `400 VALIDATION_ERROR` with no note row; same key + same body across two requests → same `note.id` returned, single note row, single `CTACTE_MOVEMENT_NOTE_ADDED` audit; same key + different body → `409 CONFLICT`; new key + identical body → two distinct note rows + two audit events; replay after `+15 s` simulated clock advance → still `same note.id`, one row, one audit (no 10-second bucket collapse). |
| Safety net | Standin DB + repo + service + route all wired; the standin's `isDuplicate` for the new column mirrors the SQL `WHERE idempotency_key IS NOT NULL` clause. |
| Rollback boundary | Revert `e689684` route + service changes; the `Idempotency-Key` header becomes unused again. |

#### 3d. Client API wrapper forwards `Idempotency-Key`

| Field | Value |
|---|---|
| File | `apps/web/src/lib/api/ctacte-mutations.test.ts` |
| Test layer | Unit (Vitest, mocked `apiFetch`) |
| RED command | `pnpm --filter @athlos/web test:run src/lib/api/ctacte-mutations.test.ts` |
| RED exit code | 1 |
| RED failure excerpt | `× addCtacteNote() > POSTs JSON to …/notes` — original assertion was `toMatchObject({ method: 'POST' })` with no Idempotency-Key header. |
| GREEN command | same |
| GREEN exit code | 0 |
| GREEN pass count | `Tests  12 passed (12)` (was 11) |
| Triangulation | Path composed with the production URL; method `POST`; body `{ body }` unchanged; headers now include `Idempotency-Key: <key>`. |
| Safety net | Route integration test (#3c) covers the cross-process contract. |
| Rollback boundary | Revert `e689684` client wrapper — `addCtacteNote` reverts to 3-arg form; the route would then accept notes without a key (the old broken contract). |

#### 3e. Form retains opaque Idempotency-Key across retries + rotates on body change

| Field | Value |
|---|---|
| File | `apps/web/src/components/ctacte/CtacteNoteForm.test.tsx` |
| Test layer | Component (Vitest + Testing Library) |
| RED command | `pnpm --filter @athlos/web test:run src/components/ctacte/CtacteNoteForm.test.tsx` |
| RED exit code | 1 |
| RED failure excerpt | `× forwards one stable Idempotency-Key across ambiguous retries of the same submission` (old code did not pass any key → argument-count mismatch); `× rotates the Idempotency-Key when the user changes the body` (no rotation logic existed). |
| GREEN command | same |
| GREEN exit code | 0 |
| GREEN pass count | `Tests  9 passed (9)` (was 7) |
| Triangulation | Same body across two submits (5xx then 200) reuses one opaque key (≤ 128 chars); a clearly-different body mints a new opaque key. |
| Safety net | Client wrapper test (#3d) + route integration test (#3c) ensure the key actually reaches the server. |
| Rollback boundary | Revert `e689684` form change — `addCtacteNote` would be called with 3 args (no key) and the route would 400 every submit. |

## Targeted sequential test runs (per TDD cycle)

```bash
pnpm --filter @athlos/db test:run src/schema/ctacte-mutations.test.ts
pnpm --filter @athlos/api test:run src/modules/socios/ctacte_movement_notes.test.ts
pnpm --filter @athlos/api test:run src/modules/socios/ctacte_movement_notes_repository.test.ts
pnpm --filter @athlos/api test:run src/routes/ctacte-mutations.test.ts
pnpm --filter @athlos/web test:run src/lib/api/ctacte-mutations.test.ts
pnpm --filter @athlos/web test:run src/components/ctacte/CtacteNoteForm.test.tsx
pnpm --filter @athlos/api typecheck
pnpm --filter @athlos/web typecheck
pnpm --filter @athlos/db typecheck
pnpm --filter @athlos/api lint
pnpm --filter @athlos/web lint
pnpm --filter @athlos/db lint
```

All exit 0. No new lint warnings. Full typecheck/lint for changed packages is green.

## Runtime harness

There is no production runtime change for the R3 corrective batch — every test exercises the Fastify handler via `inject()` with the standin DB and the existing PDF generator stub, so no real Chromium / real Postgres is required. The full sequential run reports `567 passed (8 skipped)` for `@athlos/api` and `675 passed (0 skipped)` for `@athlos/web`.

## Production access

None. The R3 corrective batch is API + web + schema + migration-only. The migration 0031 tail (idempotent `ADD COLUMN IF NOT EXISTS` + `CREATE UNIQUE INDEX IF NOT EXISTS`) is safe to apply on top of an already-applied migration 0031, but NO migration / deploy / production container is touched by this batch.

## Compliance with R3 corrective acceptance criteria (per orchestrator task brief)

| Verify finding (R3 corrective batch) | Status |
|---|---|
| DELETE nested resource binding: `noteId` belongs to URL `movementId` and movement belongs to socio; mismatch → 404 with no delete; deterministic same-socio / different-movement test added | ✅ Resolved (`287b993`) |
| Notes UI retry identity: opaque Idempotency-Key retained across ambiguous retries, same key + same payload replays, changed payload conflicts, retry after 10s cannot create another note / audit. Reuse durable idempotency convention (not timestamp bucket). Tests added | ✅ Resolved (`e689684`) |
| DELETE route error mapping: preserve expected validation / auth statuses but map unexpected DB / technical errors to 5xx via project error handler. Test added for repository / service technical failure | ✅ Resolved (`287b993`) |

## Out of scope (per R3 corrective batch brief)

- R4 (field-level `ApiError.details` → form mapping) — not in this PR.
- R5 (evidence reconciliation) — not in this PR.
- No migration apply / no deploy / no production container access.
- No new branch / no merge of this branch.
- `CtacteTab.tsx`, `/ctacte` list page, `/socios/[id]` page, Tesorería cross-system sync — not touched.

---

# Apply Progress — R3 fix batch on PR #34 (defects #1, #2, #3)

**Mode**: Strict TDD, RED → GREEN same commit per team convention.
**Branch**: `fix/ctacte-mutations-r3` (PR #34).
**Base**: prior R3 corrective batch (head `197f052`).
**Scope**: ONLY the three confirmed defects escalated by the R3 re-judgment:
  1. PostgreSQL note idempotency — 0031 partial index cannot be inferred by `ON CONFLICT`.
  2. Concurrent same-key note semantics — distinguish creator vs replay loser.
  3. Reload-safe note retry — Idempotency-Key survives page reload per `(socioId, movementId, body)`.

No R4 / R5, no new branch, no deploy, no production container access, no migration apply.

## Workload guard

- New commits on top of `197f052`: three focused work-unit commits, each scoped to one defect. Per-commit footprint < 400 lines net diff vs `main` (well under review budget).
- 400-line budget risk: **Low** (single stacked-to-main PR; review slices already one commit each).
- Delivery strategy: `single-pr` (no `size:exception` required — defect-scoped commits are individually well under the 400-line review budget).

## Commits

| Commit | Scope | Files |
|---|---|---|
| `fix(db): convert ctacte_movement_notes idempotency_key to full unique index (0034)` | R3 defect #1 — forward-only migration replaces the partial `WHERE … IS NOT NULL` unique index from 0031 with a full unique index PostgreSQL can infer for `ON CONFLICT (idempotency_key) DO NOTHING`. Schema mirrors the new index (drops the `.where(sql\`… IS NOT NULL\`)` predicate on `idempotencyKeyUnique`). | `packages/db/drizzle/0034_ctacte_movement_notes_idempotency_key_full_unique.sql` (NEW), `packages/db/src/schema/socios.ts` (edit, drop `.where(...)`), `packages/db/src/schema/ctacte-mutations.test.ts` (3 RED→GREEN SQL hooks + schema-mirror tests) |
| `fix(api): distinguish created vs replay in note insert + add author_operator_id comparison (R3 fix #2)` | R3 defect #2 — repository returns `{ row, created }`; service only emits `CTACTE_MOVEMENT_NOTE_ADDED` on `created: true`; conflict-loser branch compares canonical `(movement_id, body, author_operator_id)` and either returns the winner (silent replay) or throws `CONFLICT`. | `apps/api/src/modules/socios/ctacte_movement_notes_repository.ts` (change return shape), `ctacte_movement_notes_repository.test.ts` (match new shape), `apps/api/src/modules/socios/ctacte_movement_notes.ts` (new flow + canonical-match helper), `ctacte_movement_notes.test.ts` (rewrite mocks for `{ row, created }` + 4 RED→GREEN concurrent-semantics tests), `apps/api/src/modules/socios/ctacte_movement_notes.postgres.integration.test.ts` (NEW disposable pg test proving inference + concurrent collapse) |
| `fix(web): reload-safe note idempotency via localStorage (R3 fix #3)` | R3 defect #3 — `CtacteNoteForm` persists the opaque Idempotency-Key in `localStorage` under `ctacte-note-idem:<socioId>:<movementId>` keyed by `(bodyHash, operatorId)`. Reload reuses the same key; success / cancel / 409 clears the cache; body change mints a fresh key. UI copy is unchanged (the persistence is invisible to the user). | `apps/web/src/components/ctacte/CtacteNoteForm.tsx` (localStorage helpers + reload-safe `getIdempotencyKeyFor`), `CtacteNoteForm.test.tsx` (3 RED→GREEN reload tests covering persistence, remount-key-reuse, success-cache-clear) |

## R3 fix batch TDD Cycle Evidence

Each work unit lists the failed pre-GREEN run, the implementation commit, and the post-GREEN run that proves the fix landed. All cited commits are local; runs that need a real PG (`ATHLOS_TEST_DATABASE_URL`) are documented as live disposable proof rather than silently skipped.

### Work Unit #1 — PostgreSQL note idempotency inference (R3 defect #1)

| Field | Value |
|---|---|
| File(s) | `packages/db/drizzle/0034_ctacte_movement_notes_idempotency_key_full_unique.sql` (NEW); `packages/db/src/schema/socios.ts` (drop `.where(sql\`… IS NOT NULL\`)` on the `idempotencyKeyUnique` index); `packages/db/src/schema/ctacte-mutations.test.ts` (3 new SQL/schema RED tests) |
| Layer | Schema + migration |
| RED command | `pnpm --filter @athlos/db test:run -- src/schema/ctacte-mutations.test.ts` |
| RED exit code | 1 (before `0034` file existed → substring matches fail) |
| RED failure excerpt | `× 0034_ctacte_movement_notes_idempotency_key_full_unique migration > migration file replaces the partial unique index with a full unique index (R3 fix #1)` + `× schema declaration mirrors the migration (full unique index, no partial predicate)` |
| Implementation commit | `fix(db): convert ctacte_movement_notes idempotency_key to full unique index (0034)` |
| GREEN command | `pnpm --filter @athlos/db test:run -- src/schema/ctacte-mutations.test.ts` |
| GREEN exit code | 0 |
| GREEN pass count | `Tests  6 passed (6)` (was 3 prior to this commit) |
| **Disposable PostgreSQL proof** | `ATHLOS_TEST_DATABASE_URL="postgresql://athlos:athlos@localhost:5432/athlos_test_notes" pnpm --filter @athlos/api test:run -- src/modules/socios/ctacte_movement_notes.postgres.integration.test.ts` |
| Disposable PG result | 5/5 tests pass against `postgres:17-alpine` (athlos-db-1). |
| Triangulation on real PG | (a) `pg_indexes` returns `ctacte_movement_notes_idempotency_key_unique` with a definition that contains `UNIQUE INDEX` on `socios.ctacte_movement_notes (idempotency_key)` and **NO `WHERE` clause**; (b) bare-column `INSERT … ON CONFLICT (idempotency_key) DO NOTHING` resolves and returns `rowCount: 0` on the duplicate; (c) the DB ends up with exactly one row; (d) applying **only 0031 (without 0034)** triggers the regression: the bare-column `ON CONFLICT` raises `there is no unique or exclusion constraint matching the ON CONFLICT specification` — proving the defect was real and 0034 was the necessary forward-only fix. |
| Safety net | All prior `@athlos/api` tests still green; the new disposable test would fail loudly if the migration's `WHERE` clause ever re-appears. |
| Rollback boundary | Revert migration file + schema declaration; the repository's `ON CONFLICT` raises 5xx against the partial index again (the regression test catches this). |

### Work Unit #2 — Concurrent same-key note semantics (R3 defect #2)

| Field | Value |
|---|---|
| File(s) | `apps/api/src/modules/socios/ctacte_movement_notes_repository.ts` (return `{ row, created }`), `ctacte_movement_notes_repository.test.ts` (match new shape), `apps/api/src/modules/socios/ctacte_movement_notes.ts` (single conflict-aware insert + canonical match helper), `ctacte_movement_notes.test.ts` (rewrite mocks + 4 RED→GREEN tests) |
| Layer | Service + repository |
| RED command | `pnpm --filter @athlos/api test:run -- src/modules/socios/ctacte_movement_notes.test.ts src/modules/socios/ctacte_movement_notes_repository.test.ts` |
| RED exit code | 1 (mocks returned the old `row` shape; service assumed creator → emitted audit even for the conflict-loser) |
| RED failure excerpt | `× returns 409 when the same key is reused with a different payload` + `× two concurrent same-key + same-payload calls emit exactly one audit` + `× returns 409 when the conflict-loser surfaces a row from a different operator` + `× returns 409 when the conflict-loser surfaces a row with a different payload` |
| Implementation commit | `fix(api): distinguish created vs replay in note insert + add author_operator_id comparison (R3 fix #2)` |
| GREEN command | `pnpm --filter @athlos/api test:run -- src/modules/socios/ctacte_movement_notes.test.ts src/modules/socios/ctacte_movement_notes_repository.test.ts` |
| GREEN exit code | 0 |
| GREEN pass count | `Tests  21 passed (21)` (was 11 prior to this commit) |
| **Disposable PostgreSQL proof** | Same disposable PG run as Work Unit #1 — the "same-key + same-body concurrent inserts collapse to one row" test issues two real `Promise.all([insertNote, insertNote])` calls against a real PG with migration 0034 applied, and the DB ends with exactly one row. |
| Triangulation | (i) `created: true` branch emits exactly one audit; (ii) `created: false` branch never emits; (iii) `created: false` with matching canonical `(movement_id, body, author_operator_id)` returns the winner row silently; (iv) `created: false` with mismatched body OR operator throws `CONFLICT`; (v) two concurrent `Promise.all` calls produce exactly one `created: true` and one `created: false` (the DB `CONFLICT`-aware index hands one call the inserted row, the other the existing row). |
| Safety net | The disposable PG test would fail with a `UNIQUE` constraint error if the schema/migration regresses; the in-process unit tests catch logic regressions independent of pg. |
| Rollback boundary | Revert repository + service; any caller reverts to "creator + loser both emit audit" — covered as a regression by the concurrent collapse test. |

### Work Unit #3 — Reload-safe note retry (R3 defect #3)

| Field | Value |
|---|---|
| File(s) | `apps/web/src/components/ctacte/CtacteNoteForm.tsx` (localStorage helpers + reload-safe `getIdempotencyKeyFor`), `CtacteNoteForm.test.tsx` (3 RED→GREEN reload tests + 2 prior retry tests still green) |
| Layer | Web form |
| RED command | `pnpm --filter @athlos/web test:run -- src/components/ctacte/CtacteNoteForm.test.tsx` |
| RED exit code | 1 (form held the key only in `useRef`, lost on remount; localStorage was never written) |
| RED failure excerpt | `× persists the Idempotency-Key in localStorage keyed by (socioId, movementId, body) — even after a 5xx` (`expected null to be truthy`); `× reuses the cached key when the form is remounted for the same body (page reload simulation)` (keys differed across remounts) |
| Implementation commit | `fix(web): reload-safe note idempotency via localStorage (R3 fix #3)` |
| GREEN command | `pnpm --filter @athlos/web test:run -- src/components/ctacte/CtacteNoteForm.test.tsx` |
| GREEN exit code | 0 |
| GREEN pass count | `Tests  12 passed (12)` (was 9 prior to this commit) |
| UI copy consistency | No new copy — the persistence is **invisible** to the user. The form uses the same `getIdempotencyKeyFor` cache regardless of reload, so the user-facing "Nota agregada" / 409 / network error messages are unchanged. This avoids introducing UI text that contradicts the durable idempotency contract. |
| Triangulation | (i) Submitting a body writes `localStorage["ctacte-note-idem:<socioId>:<movementId>"] = { bodyHash, key, operatorId }`; (ii) Unmounting + remounting + re-submitting the same body reuses the EXACT same key (no rotation); (iii) Editing the body (different body-hash) mints a fresh key; (iv) A successful submit clears the cache; (v) A `CONFLICT` response clears the cache and forces a new key on the next attempt; (vi) A change of operator identity causes a stale cache miss (operator id is part of the cache key) — the next submit mints a new key for the new operator. |
| Safety net | The two prior "stable key across retries" + "rotate on body change" tests still pass unchanged, confirming the reload-safety addition did not regress the in-instance behaviour. |
| Rollback boundary | Revert `CtacteNoteForm.tsx` to the in-memory-only key holder — form reverts to losing the key on reload; that bug is already covered by tests. |

## Targeted sequential test runs (per TDD cycle)

```bash
# Defect #1 + disposable PG proof
pnpm --filter @athlos/db test:run -- src/schema/ctacte-mutations.test.ts
ATHLOS_TEST_DATABASE_URL="postgresql://athlos:athlos@localhost:5432/athlos_test_notes" \
  pnpm --filter @athlos/api test:run -- src/modules/socios/ctacte_movement_notes.postgres.integration.test.ts

# Defect #2 (repository + service + route)
pnpm --filter @athlos/api test:run -- \
  src/modules/socios/ctacte_movement_notes_repository.test.ts \
  src/modules/socios/ctacte_movement_notes.test.ts \
  src/routes/ctacte-mutations.test.ts

# Defect #3 (web form)
pnpm --filter @athlos/web test:run -- src/components/ctacte/CtacteNoteForm.test.tsx

# Cross-cutting
pnpm --filter @athlos/db typecheck
pnpm --filter @athlos/db lint
pnpm --filter @athlos/api typecheck
pnpm --filter @athlos/api lint
pnpm --filter @athlos/web typecheck
pnpm --filter @athlos/web lint
```

All exit 0 except `apps/api lint` (one pre-existing `console.log` warning in `admin/gastos.test.ts` unrelated to this fix). No new lint or typecheck errors introduced.

## Test pass summary

| Suite | Before this batch | After this batch | Δ |
|---|---:|---:|---:|
| `@athlos/db` schema tests (per-file `src/schema/ctacte-mutations.test.ts`) | 3 | 6 | +3 |
| `@athlos/api` notes tests (per-file `ctacte_movement_notes{,/_repository}.test.ts`) | 11 | 21 | +10 |
| `@athlos/api` route tests (`ctacte-mutations.test.ts`) | 53 | 53 | 0 (unchanged — defect #2 inner changes didn't touch route layer) |
| `@athlos/api` disposable PG (NEW `ctacte_movement_notes.postgres.integration.test.ts`) | n/a | 5 (with `ATHLOS_TEST_DATABASE_URL` set) | +5 |
| `@athlos/web` form tests (`CtacteNoteForm.test.tsx`) | 9 | 12 | +3 |
| `@athlos/web` full suite (`pnpm --filter @athlos/web test:run`) | 675 | 678 | +3 |

The disposable PG run is gated on `ATHLOS_TEST_DATABASE_URL` and is NOT silently skipped — the test file throws a clear error if the env var is absent, and the `apply-progress.md` documents the exact command.

## Runtime harness

- All API tests run via Fastify `inject()` + the in-memory standin DB (PR 3a precedent) — no real Chromium / no real Postgres required for the happy / sad paths.
- The single NEW disposable PG test runs against a real `postgres:17-alpine` instance via `ATHLOS_TEST_DATABASE_URL`. It is the **only honest proof** that migration 0034 makes `ON CONFLICT (idempotency_key) DO NOTHING` resolve in real PostgreSQL; the standin does not exercise PostgreSQL index inference.
- All web tests run in jsdom + the localStorage shim — no browser required.

## Production access

None. This batch is API + web + schema + migration-only. Migration 0034 is forward-only + idempotent (`DROP INDEX IF EXISTS` + `CREATE UNIQUE INDEX IF NOT EXISTS`) and is safe to apply on top of any prior 0031 state, but NO migration / deploy / production container is touched by this batch. The `docs/runbook.md` was updated to document the new manual 0031 → 0032 → 0033 → 0034 rollout sequence the operations team must run before deploying the API.

## Compliance with R3 fix batch acceptance criteria

| Defect | Status |
|---|---|
| #1 — PostgreSQL note idempotency: 0034 replaces partial → full unique index; schema + repository updated to match; bare-column `ON CONFLICT (idempotency_key)` resolves; defect #1 reproduction test (0031-only path) raises the exact "no unique or exclusion constraint" error | ✅ Resolved (work unit #1) |
| #2 — Concurrent same-key semantics: repository distinguishes `created: true` (creator, audit fires) vs `created: false` (loser, replay OR 409); canonical comparison includes `(movement_id, body, author_operator_id)`; deterministic concurrency tests + real PG race-collapse test | ✅ Resolved (work unit #2) |
| #3 — Reload-safe note retry: form persists the Idempotency-Key per `(socioId, movementId, body)` in localStorage; reload reuses the same key; body change mints a new key; success / 409 / cancel clear the cache; UI copy unchanged (persistence is invisible to the user) | ✅ Resolved (work unit #3) |

---

# Apply Progress — R3 fix batch v2: full forward sequence + 10-racer PG proof (defects #1, #2, #3)

**Branch**: `fix/ctacte-mutations-r3` (PR #34)
**Base**: `989aff5` (R3 fix batch)
**Head**: `8f10270`
**Scope**: ONE focused executor, ONE focused commit. No new branch, no merge, no deploy, no production container access, no migration apply, no claim of production application.
**Disposable PG**: `athlos-pg-disposable` (postgres:17-alpine) on `localhost:5433` — separate from production `athlos-db-1` on `localhost:5432`. ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@localhost:5433/athlos_disposable.

## What changed and why

The previous R3 fix batch covered defects #1, #2, #3 with unit-level coverage + a small disposable-PG proof that applied only 0031 + 0034. Two real-blocker test gaps remained, both falling on this batch:

1. **Defect #1 partial coverage**: the existing `ctacte_movement_notes.postgres.integration.test.ts` applied ONLY 0031 + 0034 in isolation. The full production rollout is 0031 → 0032 → 0033 → 0034, and there was no end-to-end proof that the FOUR-migration sequence lands the database in the correct shape (FULL unique index on BOTH `socios.ctacte_movement_notes.idempotency_key` AND `tesoreria.ctacte.idempotency_key`, plus the comprobante retries shape from 0033). The task brief explicitly required testing the full forward sequence.

2. **Defect #2 thin concurrent proof**: the existing test fired TWO parallel inserts. The task brief said "Prove with real PostgreSQL concurrent tests" — under-sampled. The new test fires TEN parallel inserts on the same key + same body and asserts exactly one row + exactly one creator. This models a realistic retry storm across two or three backend replicas.

## TDD Cycle Evidence (work unit: full forward + 10-racer)

| Field | Value |
|---|---|
| RED command | `pnpm --filter @athlos/api exec vitest run src/modules/socios/ctacte_movement_notes.full-forward-sequence.integration.test.ts` (PRE-`8f10270`) |
| RED exit code | 1 (file did not exist → 0/10 tests, command failed) |
| RED failure excerpt | `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command failed with exit code 1` — test file did not exist |
| Implementation commit | `8f10270 test(api): full forward 0031→0034 sequence + 10-racer PG concurrency proof` |
| Layer | Disposable PostgreSQL via `ATHLOS_TEST_DATABASE_URL` |
| GREEN command | `ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@localhost:5433/athlos_disposable pnpm --filter @athlos/api exec vitest run src/modules/socios/ctacte_movement_notes.full-forward-sequence.integration.test.ts` |
| GREEN exit code | 0 |
| GREEN pass count | `10 passed (10)` |
| Triangulation | (a) Each migration file contributes >0 statements under the per-file `BEGIN/COMMIT` smoke loop; (b) `pg_indexes` returns `ctacte_movement_notes_idempotency_key_unique` AND `ctacte_idempotency_key_unique` with a definition containing `UNIQUE INDEX` and **NO `WHERE` clause** — proves 0031+0034 produced full unique index on ctacte_movement_notes AND 0031+0032 produced full unique index on ctacte; (c) Comprobante retries table carries its `ctacte_comprobante_retries_status_check` CHECK constraint listing `rendering | complete | failed` AND the `ctacte_comprobante_retries_expires_at_idx` index; (d) bare-column `ON CONFLICT (idempotency_key) DO NOTHING` returns `rowCount: 0` on the duplicate insert AND the DB ends with exactly one row for that key; (e) idempotency of the rollout itself — re-applying the four migrations is a no-op (the index `indexdef` is bit-for-bit identical before/after); (f) two parallel inserts collapse to one row + exactly one `created: true`; (g) **TEN parallel inserts** collapse to one row + exactly one `created: true` (the realistic backend-replica retry storm); (h) sequential different-body second call surfaces `created: false` + the existing row, so the service compares the canonical `(movement_id, body, author_operator_id)` and 409s; (i) two parallel different-body calls still collapse with one creator + one conflict-loser (the loser path would 409 via canonical-mismatch detection). |
| Safety net | All sibling pg + in-process tests still green (4 + 21 + 53 = 78 tests) on a single-file run; typecheck + lint green across `@athlos/{db,api,web}`. The pre-existing `ctacte_movement_notes.postgres.integration.test.ts` continues to verify the partial-index regression path on its own disposable-PG run. |
| Rollback boundary | Revert `8f10270` — no production code touched; only a NEW disposable-PG integration test file is added. The existing tests + production behaviour are unaffected by the addition. |
| Test runtime | `1.36 s` on the disposable container (`postgres:17-alpine`). |
| Production access | NONE. The disposable container is on `localhost:5433` (separate from `athlos-db-1` on `localhost:5432`). `ATHLOS_TEST_DATABASE_URL` is the only DB touched. No migration is applied to any production-shaped database. |

## Defect #3 contract validation (no code change)

Per the brief: "Validate the existing reload-safe localStorage note-key behavior against the current code; only modify it if it fails its stated contract."

| Field | Value |
|---|---|
| File | `apps/web/src/components/ctacte/CtacteNoteForm.tsx` (existing, ca24e9c) |
| Test file | `apps/web/src/components/ctacte/CtacteNoteForm.test.tsx` (existing) |
| Command | `pnpm --filter @athlos/web exec vitest run src/components/ctacte/CtacteNoteForm.test.tsx` |
| Pass count | `11 passed (11)` |
| Cases covered | (i) stable Idempotency-Key across ambiguous retries of the same submission; (ii) rotates the Idempotency-Key when the body changes (new intent); (iii) persists the Idempotency-Key in localStorage keyed by `(socioId, movementId, body)` — even after a 5xx; (iv) reuses the cached key when the form is remounted for the same body (page reload simulation); (v) clears the cached key after a successful submit (next open starts fresh). All contract statements validate. **No code change required.** |

## Out of scope (per this batch)

- R4 (field-level `ApiError.details` → form mapping) — not in this PR.
- R5 (evidence reconciliation) — partial — added this `apply-progress` section.
- No migration apply / no deploy / no production container access.
- No new branch / no merge of this branch.
- `CtacteTab.tsx`, `/ctacte` list page, `/socios/[id]` page, Tesorería cross-system sync — not touched.
- Vitest parallel-file DROP-SCHEMA race between `ctacte_movement_notes.postgres.integration.test.ts` and the new test file: pre-existing limitation in the older file's `DROP SCHEMA CASCADE` pattern; the two files must be invoked separately.

## Out of scope (per R3 fix batch brief)

- R4 (field-level `ApiError.details` → form mapping) — not in this PR.
- R5 (evidence reconciliation) — not in this PR.
- No migration apply / no deploy / no production container access.
- No new branch / no merge of this branch.
- `CtacteTab.tsx`, `/ctacte` list page, `/socios/[id]` page, Tesorería cross-system sync — not touched.