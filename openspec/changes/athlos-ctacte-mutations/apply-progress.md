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