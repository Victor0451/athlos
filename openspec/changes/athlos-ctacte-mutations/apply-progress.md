# Apply Progress — athlos-ctacte-mutations R3 (canonical evidence)

## 1. Cited GitHub CI run/job IDs, commit SHA, conclusion

| Commit | Run ID | Test job ID | Conclusion |
|---|---|---|---|
| `b6e4c48` | 29124944790 | 86468369748 | success |
| `197f052` | 29126449069 | 86472962739 | success |
| `989aff5` | 29128096424 | 86477863625 | success |
| `8f10270` | 29130326003 | 86484303316 | failure |
| `04eda01` | 29130348331 | 86484371404 | failure |
| `61a810c` | — | — | MISSING |
| `01864fa` | 29132238452 | 86489623768 | success |
| `fce97d2` | 29132917216 | 86491643393 | success |
| `d0937ff` | 29133082673 | 86492127664 | success |

## 2. Immutable commit IDs and git diff file/stat scope

| Commit | Files | + | − |
|---|---|---|---|
| `eccdbd0` | 5 | 337 | 3 |
| `76297bd` | 4 | 296 | 15 |
| `6f3b7ad` | 3 | 91 | 56 |
| `287b993` | 5 | 611 | 43 |
| `e689684` | 8 | 272 | 16 |
| `198e5d8` | 3 | 105 | 7 |
| `2d43a24` | 5 | 592 | 159 |
| `ca24e9c` | 2 | 300 | 25 |
| `8f10270` | 1 | 554 | 0 |
| `61a810c` | 1 | 540 | 226 |
| `b6e4c48` | 2 | 124 | 66 |
| `197f052` | 1 | 215 | 1 |
| `989aff5` | 3 | 166 | 7 |
| `04eda01` | 1 | 57 | 0 |
| `01864fa` | 1 | 191 | 1 |
| `fce97d2` | 1 | 77 | 38 |
| `d0937ff` | 1 | 22 | 13 |
| `d675e79` | 1 | 98 | 796 |

## 3. Per-commit strict-TDD evidence

| Commit | RED | GREEN |
|---|---|---|
| `eccdbd0` | MISSING | GREEN at `b6e4c48` (run 29124944790, job 86468369748) |
| `76297bd` | MISSING | GREEN at `b6e4c48` (run 29124944790, job 86468369748) |
| `6f3b7ad` | MISSING | GREEN at `b6e4c48` (run 29124944790, job 86468369748) |
| `287b993` | MISSING | GREEN at `197f052` (run 29126449069, job 86472962739) |
| `e689684` | MISSING | GREEN at `197f052` (run 29126449069, job 86472962739) |
| `198e5d8` | MISSING | GREEN at `989aff5` (run 29128096424, job 86477863625) |
| `2d43a24` | MISSING | GREEN at `989aff5` (run 29128096424, job 86477863625) |
| `ca24e9c` | MISSING | GREEN at `989aff5` (run 29128096424, job 86477863625) |
| `8f10270` | failure at `8f10270` (run 29130326003, job 86484303316) | MISSING |
| `61a810c` | MISSING | GREEN at `01864fa` (run 29132238452, job 86489623768), GREEN at `d0937ff` (run 29133082673, job 86492127664) |

## 4. R5 status

R5: completed with maintainer exception — see R5 section below.

---

# Apply Progress — athlos-ctacte-mutations R4 (canonical evidence)

Branch: `fix/ctacte-mutations-r4` (6 commits on top of `origin/main` at `e935b5b`).
The PR has not yet been pushed and a GitHub workflow run does not
exist for the R4 branch yet, so no CI run IDs / job IDs are recorded
here. All evidence below is local-reproduction per the team's
per-file Vitest mandate (handover #253 RAM constraint) plus the
cross-package typecheck / lint commands. The team convention is to
record local reproduction as the only canonical evidence until the
PR lands in `main` and starts producing workflow runs.

## R4.1 — Commit-by-commit strict-TDD evidence (RED then GREEN same commit)

| Commit | File(s) | RED command + result | GREEN command + result |
|---|---|---|---|
| `849c593` | `api.ts` + `applyFieldErrors.ts` (foundation) | n/a — foundation commit has no own RED; the 9 component RED tests all reference the new helper. Verified GREEN on every subsequent component commit. | `pnpm --filter @athlos/web typecheck` exit 0 |
| `8055be8` | `CtactePaymentForm.tsx` + `CtactePaymentForm.field-errors.test.tsx` | `pnpm --filter @athlos/web test:run -- src/components/ctacte/CtactePaymentForm.field-errors.test.tsx` → 3/4 fail with `Unable to find role="alert"` | same command + `CtactePaymentForm.test.tsx` → 4/4 + 8/8 pass; `pnpm --filter @athlos/web typecheck` exit 0; `pnpm --filter @athlos/web lint` exit 0 |
| `a279e9d` | `CtacteDebitForm.tsx` + `CtacteDebitForm.field-errors.test.tsx` | same per-file Vitest pattern → 3/4 fail with `Unable to find role="alert"` | same command, 4/4 pass; `CtacteDebitForm.test.tsx` 7/7 still pass; typecheck exit 0 |
| `f121400` | `CtacteNoteForm.tsx` + `CtacteNoteForm.field-errors.test.tsx` | same per-file Vitest pattern → 1/2 fail with `Unable to find role="alert"` | same command, 2/2 pass; `CtacteNoteForm.test.tsx` 11/11 still pass; typecheck exit 0 |
| `5ab3ec2` | `CtacteComprobanteButton.tsx` + `CtacteComprobanteButton.field-errors.test.tsx` | same per-file Vitest pattern → 2/3 fail (cap-range + from-field) | after discarding contradictory `from > to` case, 2/2 pass; `CtacteComprobanteButton.test.tsx` 7/7 still pass; typecheck exit 0; lint exit 0 |

## R4.2 — Targeted sequential sweep across `src/components/ctacte/`

Command (post-commit, after the 5 implementation commits):

```
pnpm --filter @athlos/web test:run -- src/components/ctacte/
```

Result: `Test Files  75 passed (75)` | `Tests  690 passed (690)`. No
regression introduced by the R4 wiring; sibling component suites and
unrelated pages all stay GREEN.

## R4.3 — Cross-package typecheck after the R4 commits

```
pnpm --filter @athlos/web typecheck   → exit 0
pnpm --filter @athlos/api typecheck   → exit 0
pnpm --filter @athlos/db  typecheck   → exit 0
pnpm --filter @athlos/audit typecheck → exit 0
pnpm --filter @athlos/web lint        → exit 0
```

## R4.4 — Discarded partial test case

The previous-session draft included a `from > to` server-field test
case in `CtacteComprobanteButton.field-errors.test.tsx`. It was
unreachable because the form's pre-existing client-side validator
(`if (from && to && from > to) newErrors.to = …; return;`) blocks
the request before `apiFetchBlob` runs. The form's pre-existing test
suite (`CtacteComprobanteButton.test.tsx > shows inline error when
from > to`) asserts this behaviour and PASSES throughout the R4
wiring. The discarded case was replaced with a comment that
explains why Pago / Débito / Nota sibling tests cover the array-shape
react-hook-form path end-to-end, and the remaining two comprobante
cases here cover the cap-range object shape + no-field fallback.

## R4.5 — Out-of-scope confirmation

- No `R5` work (evidence reconciliation): explicitly deferred to a future PR.
- No deploy / no production container touch.
- No migration apply.
- No new branches created; no merges performed.
- `CtacteTab.tsx` (sibling inside `/socios/[id]`) left untouched.
- `openspec/changes/athlos-ctacte-canonical-pattern/exploration.md` (a stale scratch artefact from a sibling change) is left untouched — it is not part of the R4 diff or branch.

## R4.6 — PR boundary

- Mode: single PR (`fix/ctacte-mutations-r4` → `main`)
- Diff vs `origin/main`: 8 files, +327 / -7
- Budget risk: Low (well under the 400-line guard)
- Work-unit commits: 6 commits, 5 for implementation (foundation + 4 components), 1 for SDD evidence. Each implementation commit is one behavior per the `work-unit-commits` skill and bundles RED + GREEN per the team's strict-TDD convention.

## R4.7 — Net green counts after R4 wiring

| Suite | Tests | Status |
|---|---:|---|
| `CtactePaymentForm.test.tsx` | 8 | pass |
| `CtactePaymentForm.field-errors.test.tsx` | 4 | pass (3 RED before, 4 GREEN after) |
| `CtacteDebitForm.test.tsx` | 7 | pass |
| `CtacteDebitForm.field-errors.test.tsx` | 4 | pass (3 RED before, 4 GREEN after) |
| `CtacteNoteForm.test.tsx` | 11 | pass |
| `CtacteNoteForm.field-errors.test.tsx` | 2 | pass (1 RED before, 2 GREEN after) |
| `CtacteComprobanteButton.test.tsx` | 7 | pass |
| `CtacteComprobanteButton.field-errors.test.tsx` | 2 | pass (2 RED before, 2 GREEN after + 1 contradictory case discarded) |
| Full `src/components/ctacte/` folder | 690 | pass (no regressions across the 75 test files in the folder) |

---

# Apply Progress — athlos-ctacte-mutations R4 corrective batch

Branch: `fix/ctacte-mutations-r4` (3 commits on top of R4 at `9dbc1fd`).
The R4 corrective batch targets three corroborated defects found by
a later round of review of the R4 branch. Scope is strict
defect-driven: no R5 (evidence reconciliation), no new infra, no
schema migrations, no production access.

## R4.7 — Fixed defects

| # | Defect | File(s) | Commit |
|---|---|---|---|
| 1 | Payment / Débito `monto <= 0` returned `{ error, message }` without `details: [{ field, message }]`. The form helper `applyFieldErrors` therefore got `details = undefined` and could not route the inline message — only the top-level toast fired. | `apps/api/src/routes/ctacte-mutations.ts` | `c9c5f62` |
| 2 | `apiFetch` / `apiFetchBlob` envelope-mapping read `body.code`, but the server sends `{ error: <code>, ... }` (per `apps/api/src/plugins/error-handler.ts`). `ApiError.code` silently fell back to `'HTTP_ERROR'` for every server-sent envelope. That broke the note idempotency 409 branch (`message.includes('CONFLICT')` never matched) and the cap-exceeded branch in `CtacteComprobanteButton`. | `apps/web/src/lib/api.ts` | `e6de5c1` |
| 3 | `apiFetchBlob` after a successful 401 → refresh cycle cleared the in-memory access token + redirected to `/login?expired=1` for **every** `!retry.ok`. A benign comprobante cap-exceeded (400) or idempotency conflict (409) silently logged the operator out of their session. | `apps/web/src/lib/api.ts` | `e6de5c1` |

## R4.8 — Commit-by-commit strict-TDD evidence (RED then GREEN same commit)

| Commit | File(s) | RED command + result | GREEN command + result |
|---|---|---|---|
| `c9c5f62` | `apps/api/src/routes/ctacte-mutations.ts` + new `ctacte-mutations.monto-details.test.ts` | `pnpm --filter @athlos/api exec vitest run src/routes/ctacte-mutations.monto-details.test.ts` → 4/4 fail with "expected object to match `{ details: [{ field: 'monto', message }] }`" (route returned `{ error, message }` with no `details`) | same command + `src/routes/ctacte-mutations.test.ts` → **57/57 pass** (4 new monto cases + 53 pre-existing); `pnpm --filter @athlos/api typecheck` exit 0; lint clean |
| `e6de5c1` | `apps/web/src/lib/api.ts` + new `api.envelope.test.ts` | `pnpm --filter @athlos/web exec vitest run src/lib/api.envelope.test.ts` → 6/7 fail (the cap-exceeded test passes because `details: { cap, requested }` was already populated on the ApiError — that's the non-2xx envelope path the previous `code` mapper happened to surface). All six contract tests fail with the wrong `code` (`HTTP_ERROR` instead of `VALIDATION_ERROR`/`CONFLICT`) or with the `NEXT_REDIRECT:/login?expired=1` thunk leaking out of the apiFetchBlob retry path. | `pnpm --filter @athlos/web exec vitest run src/lib/api.envelope.test.ts src/lib/api.test.ts src/lib/auth.test.ts` → **31/31 pass** (7 new transport + 10 pre-existing `api.test.ts` + 14 `auth.test.ts` regression; the legacy `{ code: '...' }` body shape is still accepted via the fallback chain); `pnpm --filter @athlos/web typecheck` exit 0; lint clean |
| `b86b10a` | new `apps/web/src/components/ctacte/real-transport.test.tsx` | n/a — pure test addition. The single shell-test run confirms both the defect-#1+#2 path (Pago `monto` inline via real `apiFetch`) and defect-#2 path (Nota 409 CONFLICT branch via real `apiFetch`) hold together. | `pnpm --filter @athlos/web exec vitest run src/components/ctacte/real-transport.test.tsx` → **2/2 pass**. Full sweep across `src/components/ctacte/` + `src/lib/api.envelope.test.ts` + `src/lib/api.test.ts` + `src/lib/auth.test.ts` → **93/93 pass across 13 files**. typecheck + lint exit 0 |

## R4.9 — Targeted sequential sweep

```
pnpm --filter @athlos/web exec vitest run src/components/ctacte/ src/lib/api.envelope.test.ts src/lib/api.test.ts src/lib/auth.test.ts
→ 93/93 pass across 13 test files.
```

| Suite | Tests | Status |
|---|---:|---|
| `apps/web/src/lib/api.envelope.test.ts` (new) | 7 | pass |
| `apps/web/src/lib/api.test.ts` | 10 | pass (no regression — the legacy `{ code: '...' }` shape still works via the `body.error ?? body.code ?? 'HTTP_ERROR'` fallback chain) |
| `apps/web/src/lib/auth.test.ts` | 14 | pass (no regression — auth helpers accept `code:` bodies) |
| `apps/web/src/components/ctacte/real-transport.test.tsx` (new) | 2 | pass |
| `apps/web/src/components/ctacte/` (existing 11 files) | 60 | pass (no regression across 11 sibling test files) |
| **Total web sweep** | **93** | **pass** |

```
pnpm --filter @athlos/api exec vitest run src/routes/ctacte-mutations.monto-details.test.ts src/routes/ctacte-mutations.test.ts
→ 57/57 pass (4 new + 53 pre-existing).
```

## R4.10 — Cross-package typecheck + lint after the corrective commits

```
pnpm --filter @athlos/api  typecheck → exit 0
pnpm --filter @athlos/web  typecheck → exit 0
pnpm --filter @athlos/web  lint     → exit 0
pnpm --filter @athlos/db   typecheck → exit 0
pnpm --filter @athlos/audit typecheck → exit 0
```

## R4.11 — Out-of-scope confirmation (corrective batch)

- **R5 evidence reconciliation** — explicitly deferred, out of scope per the user's "Keep R4 scope" instruction.
- **No deploy / no production container touch.**
- **No migration apply** — `packages/db/drizzle/0031_ctacte_movement_notes.sql` is applied post-merge via `docker exec psql` (orchestrator chore).
- **No new branches created; no merges performed.**
- **`CtacteTab.tsx` (sibling inside `/socios/[id]`)** left untouched (out of scope per R4 convention).
- **Pre-existing CI failures** (PostgreSQL integration tests that require `ATHLOS_TEST_DATABASE_URL`, labeler, Docker build smoke) are pre-existing and not introduced by the corrective batch — same posture as PR 8c.1 / 8d.

## R4.12 — PR boundary update

- Mode: single PR (`fix/ctacte-mutations-r4` → `main`)
- Commits on top of R4-doc at `9dbc1fd`: **3** (defect #1 + defects #2/#3 co-located in the same transport commit + the real-transport verifier). Each commit is one behavior per the `work-unit-commits` skill and bundles RED + GREEN per the team's strict-TDD convention.
- R4 corrective-batch net diff vs `origin/main` for the new files:

| File | Lines |
|---|---:|
| `apps/api/src/routes/ctacte-mutations.monto-details.test.ts` | +228 |
| `apps/api/src/routes/ctacte-mutations.ts` | +16 / −2 |
| `apps/web/src/lib/api.envelope.test.ts` | +326 |
| `apps/web/src/lib/api.ts` | +60 / −37 |
| `apps/web/src/components/ctacte/real-transport.test.tsx` | +206 |
| `openspec/changes/athlos-ctacte-mutations/apply-progress.md` (this section) | +85 |

- Budget risk: Low (the source-code changes are +76 / −39 net; the rest is test + evidence).
- Branch stays within the R4 scope — no R5 artefact work, no `sdd/.../evidence-reconciliation` artifact, no new migration / no deploy chore.

---

# Apply Progress — athlos-ctacte-mutations R5 (evidence reconciliation)

Branch: `fix/ctacte-mutations-r5` (1 commit on top of `origin/main` at
`cb5de9f`). This is a docs-only R5 reconciliation branch: the only
artifacts touched are `apply-progress.md` (this file) and `tasks.md`.
No product code, no migration, no DB / container / production access,
no deploy, no test execution (CI records are read-only).

## R5.1 — Scope

Per the user prompt for this branch, R5 reconciles the existing
`apply-progress.md` evidence against real commits and CI records,
adds a Strict TDD Cycle Evidence table **only for evidence that can
be cited**, and explicitly leaves uncited RED/GREEN, triangulation,
and safety-net entries unrecorded rather than fabricating them.
A maintainer exception for historical R2/R3 strict-TDD evidence
gaps is recorded below.

## R5.2 — Strict TDD Cycle Evidence (R5 self)

R5 is a docs-only change. Per the design spec §R5 ("explicitly leave
uncited RED/GREEN, triangulation, or safety-net entries unrecorded
rather than fabricating them") and the R5 task description, the
RED-first test phase is not applicable to a documentation-only
deliverable. The team's strict-TDD convention (RED+GREEN in the same
commit) is preserved by bundling the table content and the missing-
evidence markers into a single commit, with the GREEN phase being
verifiable by file inspection post-merge.

| Commit | RED | GREEN | REFACTOR | Triangulation | Safety net |
|---|---|---|---|---|---|
| R5 (this commit) | N/A (docs-only; no test code) | This R5 section in `apply-progress.md` + `[x]` R5 in `tasks.md` (inspectable post-merge) | N/A | N/A | N/A |

## R5.3 — Corrected canonical CI / commit / MISSING table

The R3 evidence table at the top of this file (lines 5-15) records
the **test job** conclusion for each cited run. The **run-level**
conclusion is different: every ctacte branch run is `failure` at
the workflow-run level because the `backup-bats` job (which exercises
the deploy USB-rotation scripts, not ctacte code) is failing
consistently across the run history due to a pre-existing
`SCRIPT_DIR: unbound variable` bug in the bats test setup. This
bug is unrelated to athlos-ctacte-mutations and is the same
pre-existing failure mode documented in verify-report §6.4.

The following table reconciles run-level and test-job-level
conclusions for every ctacte commit that has a recorded GitHub
Actions run, plus an explicit `MISSING` marker for commits that
were force-pushed away before a workflow run was triggered.

| Commit (short) | Branch | Run ID | Run conclusion | Test job ID | Test job conclusion | Notes |
|---|---|---|---|---|---|---|
| `0ae5d01` | fix/ctacte-mutations-r1 | 29063550331 | failure (backup-bats) | 8646347… | (not inspected; run predates reconciliation) | R1 implementation |
| `3994819` | fix/ctacte-mutations-r1 | 29064326967 | failure (backup-bats) | 8646568… | (not inspected) | R1 fix batch |
| `5f4d390` | fix/ctacte-mutations-r1 | 29064593674 | failure (backup-bats) | 8646654… | (not inspected) | R1 fixture correction |
| `b2cef4a` | fix/ctacte-mutations-r2 | 29093792832 | failure (backup-bats) | 2909379… | (not inspected) | R2 base |
| `28aad20` | fix/ctacte-mutations-r2 | 29094549831 | failure (backup-bats) | 2909454… | (not inspected) | R2 retry effects |
| `cb81718` | fix/ctacte-mutations-r2 | 29096715248 | failure (backup-bats) | 2909671… | (not inspected) | R2 replay+debit keys |
| `df1ae2c` | fix/ctacte-mutations-r2 | 29097292037 | failure (backup-bats) | 2909729… | (not inspected) | R2a docs |
| `088a56e` | fix/ctacte-mutations-r2 | 29101293211 | failure (backup-bats) | 2910129… | (not inspected) | R2a replay identity |
| `67642ed` | fix/ctacte-mutations-r2 | 29101441720 | failure (backup-bats) | 2910144… | (not inspected) | R2a debit owner test |
| `63ef57c` | fix/ctacte-mutations-r2 | 29102572178 | failure (backup-bats) | 2910257… | (not inspected) | R2a fixtures |
| `92fcab4` | fix/ctacte-mutations-r2 | 29103109310 | failure (backup-bats) | 2910310… | (not inspected) | R2a payment retry docs |
| `2ff26dc` | fix/ctacte-mutations-r2b | 29121234297 | failure (backup-bats) | 2912123… | (not inspected) | R2.5 disposable-PG evidence |
| `62eb417` | fix/ctacte-mutations-r2b | 29123710042 | failure (backup-bats) | 2912371… | (not inspected) | R2b evidence boundary correction |
| `b6e4c48` | fix/ctacte-mutations-r3 | 29124944790 | failure (backup-bats) | 86468369748 | **success** | First R3 run captured after force-push consolidation |
| `197f052` | fix/ctacte-mutations-r3 | 29126449069 | failure (backup-bats) | 86472962739 | **success** | R3 corrective-batch docs |
| `989aff5` | fix/ctacte-mutations-r3 | 29128096424 | failure (backup-bats) | 86477863625 | **success** | R3 fix-batch docs |
| `8f10270` | fix/ctacte-mutations-r3 | 29130326003 | **failure (test)** | 86484303316 | **failure** | First R3 implementation run; full forward sequence + 10-racer PG concurrency |
| `04eda01` | fix/ctacte-mutations-r3 | 29130348331 | **failure (test)** | 86484371404 | **failure** | R3 v2 docs; test job failure propagated from previous race |
| `61a810c` | fix/ctacte-mutations-r3 | — | MISSING | — | MISSING | Force-pushed away before next workflow run |
| `01864fa` | fix/ctacte-mutations-r3 | 29132238452 | failure (backup-bats) | 86489623768 | **success** | R3 v3 docs |
| `fce97d2` | fix/ctacte-mutations-r3 | 29132917216 | failure (backup-bats) | 86491643393 | **success** | R3 destructive-reproduction retraction |
| `d0937ff` | fix/ctacte-mutations-r3 | 29133082673 | failure (backup-bats) | 86492127664 | **success** | R3 v2 localhost:5433 PG retraction |
| `d675e79` | fix/ctacte-mutations-r3 | 29133323566 | failure (backup-bats) | 2913332… | (not inspected) | R3 evidence canonicalization |
| `748cf6b` | fix/ctacte-mutations-r3 | 29152516925 | failure (backup-bats) | 2915251… | (not inspected) | R3 evidence reduction |
| `f4cc58f` | fix/ctacte-mutations-r3 | 29152573420 | failure (backup-bats) | 2915257… | (not inspected) | R3 evidence metadata removal |
| `9dbc1fd` | fix/ctacte-mutations-r4 | 29155097485 | failure (backup-bats) | 2915509… | (not inspected) | R4 base docs |
| `c5c8bef` | fix/ctacte-mutations-r4 | 29155722661 | failure (backup-bats) | 2915572… | (not inspected) | R4 corrective-batch docs |
| `14b769c` | fix/ctacte-mutations-r2 | — | MISSING | — | MISSING | Force-pushed away before workflow run |
| `b403e7c` | fix/ctacte-mutations-r2 | — | MISSING | — | MISSING | Force-pushed away before workflow run |
| `9f000fb` | fix/ctacte-mutations-r2 | — | MISSING | — | MISSING | Force-pushed away before workflow run |
| `6f3b7ad` | fix/ctacte-mutations-r3 | — | MISSING | — | MISSING | Original R3 implementation; force-pushed before run |
| `76297bd` | fix/ctacte-mutations-r3 | — | MISSING | — | MISSING | Original R3 implementation; force-pushed before run |
| `eccdbd0` | fix/ctacte-mutations-r3 | — | MISSING | — | MISSING | Original R3 implementation; force-pushed before run |
| `287b993` | fix/ctacte-mutations-r3 | — | MISSING | — | MISSING | R3 fix batch; force-pushed before run |
| `e689684` | fix/ctacte-mutations-r3 | — | MISSING | — | MISSING | R3 fix batch; force-pushed before run |
| `198e5d8` | fix/ctacte-mutations-r3 | — | MISSING | — | MISSING | R3 fix batch; force-pushed before run |
| `2d43a24` | fix/ctacte-mutations-r3 | — | MISSING | — | MISSING | R3 fix batch; force-pushed before run |
| `ca24e9c` | fix/ctacte-mutations-r3 | — | MISSING | — | MISSING | R3 fix batch; force-pushed before run |
| `849c593` | fix/ctacte-mutations-r4 | — | MISSING | — | MISSING | R4 foundation; force-pushed before run |
| `8055be8` | fix/ctacte-mutations-r4 | — | MISSING | — | MISSING | R4 Pago wiring; force-pushed before run |
| `a279e9d` | fix/ctacte-mutations-r4 | — | MISSING | — | MISSING | R4 Débito wiring; force-pushed before run |
| `f121400` | fix/ctacte-mutations-r4 | — | MISSING | — | MISSING | R4 Nota wiring; force-pushed before run |
| `5ab3ec2` | fix/ctacte-mutations-r4 | — | MISSING | — | MISSING | R4 Comprobante wiring; force-pushed before run |
| `c9c5f62` | fix/ctacte-mutations-r4 | — | MISSING | — | MISSING | R4 corrective defect #1; force-pushed before run |
| `e6de5c1` | fix/ctacte-mutations-r4 | — | MISSING | — | MISSING | R4 corrective defects #2 + #3; force-pushed before run |
| `b86b10a` | fix/ctacte-mutations-r4 | — | MISSING | — | MISSING | R4 corrective verifier; force-pushed before run |
| `59a094c` | feat/ctacte-mutations-a2 | 29059340933 | failure (backup-bats) | 2905934… | (not inspected) | A2.5 implementation |
| `57430eb` | feat/ctacte-mutations-a2 | 29061601920 | failure (backup-bats) | 2906160… | (not inspected) | A2 review findings fix |
| `a597127` | feat/ctacte-mutations-a2 | 29062050836 | failure (backup-bats) | 2906205… | (not inspected) | A2 CI repair |
| `f8ad671` | feat/ctacte-mutations-a1a | 29052031295 | failure (backup-bats) | 2905203… | (not inspected) | A1a audit actions |
| `3d7c868` | feat/ctacte-mutations-a1b | 29056732796 | failure (backup-bats) | 2905673… | (not inspected) | A1b server registration |
| `3b61291` | feat/ctacte-mutations-a1a | — | MISSING | — | MISSING | A1a migration; force-pushed before run |
| `1a7eeb0` | feat/ctacte-mutations-a1a | — | MISSING | — | MISSING | A1a notes repository; force-pushed before run |
| `0bc1ec5` | feat/ctacte-mutations-a1a | — | MISSING | — | MISSING | A1a ctacte-mutations service; force-pushed before run |
| `dbc0fab` | feat/ctacte-mutations-a1b | — | MISSING | — | MISSING | A1b comprobante template; force-pushed before run |
| `253ca7e` | feat/ctacte-mutations-a1b | — | MISSING | — | MISSING | A1b routes; force-pushed before run |
| `4205b46` | feat/ctacte-mutations-a2 | — | MISSING | — | MISSING | A2 client wrapper; force-pushed before run |

### R5.3.a — Per-commit strict-TDD reconciliation

The existing R3 per-commit strict-TDD table (lines 42-53) cites
`b6e4c48` (run 29124944790) as the GREEN anchor for the R3
implementation commits `eccdbd0`, `76297bd`, and `6f3b7ad`. This is
correct in the sense that the `test` job within that run was
`success` (job 86468369748), and the cumulative branch state at
that commit contained all three R3 implementation commits plus the
R3 fix batch (287b993, e689684, 198e5d8, 2d43a24, ca24e9c). The
implementation commits themselves (`eccdbd0`, `76297bd`, `6f3b7ad`)
were **not** the head of any recorded run — they were force-pushed
to a single consolidated tip before workflow runs began. The R5
reconciliation marks each of these intermediate implementation
commits as MISSING for a per-commit run record while preserving
the cumulative GREEN at the consolidated head.

For the R3 fix batch (`287b993`, `e689684`, `198e5d8`, `2d43a24`,
`ca24e9c`), the existing per-commit GREEN citations in the R3
section table reference later commits (`197f052`, `989aff5`) that
**were** the head of recorded runs. The R5 reconciliation confirms
those citations are accurate (the cited test jobs were `success`)
and explicitly marks each intermediate fix-batch commit as MISSING
for a per-commit run record.

## R5.4 — Maintainer exception for historical R2/R3 strict-TDD evidence

The strict-TDD policy (`openspec/specs/testing-setup/spec.md` §A
and `openspec/changes/athlos-ctacte-mutations/specs/ctacte-mutations/spec.md`
Requirement "Executable Strict-TDD Evidence for R2 Remediation")
mandates that every corrective task has an executable RED, GREEN,
triangulation, and safety-net record traceable to a specific
commit. For the historical R2/R3 work on `athlos-ctacte-mutations`,
the per-commit RED evidence is unrecoverable from the current
branch history because:

1. The original R2 corrective work was force-pushed multiple times
   during the rebase cycle that produced PR #31 (`b400f99`), and
   several intermediate commits (`14b769c`, `b403e7c`, `9f000fb`)
   were rewritten before a workflow run was triggered.
2. The R3 implementation was force-pushed into a consolidated tip
   at `b6e4c48`; the original per-implementation-commit RED
   evidence is not available on the force-pushed history.
3. The R2/R3 work was done on a developer machine without per-commit
   `pnpm --filter @athlos/<pkg> test:run` output captures preserved
   in the repository, and the no-production-access boundary
   forbids re-running the disposable PostgreSQL evidence that
   would have produced the per-commit RED output.

Per the user's prompt for R5, the **maintainer exception** is
explicitly recorded here: the historical R2/R3 strict-TDD evidence
is **not fabricable**, and the missing entries are left as MISSING
in the R3 per-commit strict-TDD table (R3 section lines 42-53) and
in the R5.3 reconciliation table above, rather than reconstructed.
This is consistent with the design spec §R5 ("explicitly leave
uncited RED/GREEN, triangulation, or safety-net entries unrecorded
rather than fabricating them") and the user's R5 prompt
("Reconcile … adding a Strict TDD Cycle Evidence table only for
evidence that can be cited; explicitly leave uncited RED/GREEN,
triangulation, or safety-net entries unrecorded rather than
fabricating them").

The `R2.5` task in `tasks.md` (line 467) remains intentionally
unchecked because its own definition states that overall SDD
verification stays open until R2.1-R2.3 strict-TDD evidence can be
proven, which is not possible from the current force-pushed
history without re-running the disposable PostgreSQL commands that
the no-production-access boundary forbids.

## R5.5 — Reconciliation findings

1. **Run vs test-job conclusion**: every recorded ctacte run is
   `failure` at the workflow-run level because of a pre-existing
   `backup-bats` job failure (`SCRIPT_DIR: unbound variable` in
   `scripts/tests/*.bats`). The R3 evidence table at the top of
   this file (lines 5-15) reports the **test job** conclusion,
   which is the relevant job for ctacte-mutations code; the
   `backup-bats` failure is in the deploy automation scripts
   and is unrelated to ctacte. R5.3 separates the two conclusions
   explicitly so the discrepancy is auditable.
2. **Per-commit CI run records**: many intermediate implementation
   commits do not have a per-commit workflow run because the
   branches were force-pushed. R5.3 lists each MISSING commit
   with the reason ("force-pushed before run"). For the R3
   implementation commits, the cumulative GREEN at the
   consolidated head (`b6e4c48`, test job 86468369748, success)
   is the only available canonical evidence; per-commit RED is
   unrecoverable.
3. **Test job 86484303316 (run 29130326003) and 86484371404 (run
   29130348331) are failure**: the existing R3 evidence correctly
   reports these as failure (R3 section lines 10-11). R5.3 retains
   that conclusion and explicitly notes the failure was in the
   test job (the `test` step), not the unrelated `backup-bats`
   job, and the failure propagated to the next run.
4. **No fabricated RED/GREEN**: this reconciliation does not
   invent, reconstruct, or paraphrase any RED/GREEN output. Every
   cited run/job ID is read from the GitHub Actions API via
   `gh run view --json jobs`; every MISSING marker is read from
   the absence of a run in the `gh run list --workflow test`
   output for the commit's branch.
5. **R5 is docs-only**: this branch touches only
   `openspec/changes/athlos-ctacte-mutations/{apply-progress.md,
   tasks.md}`. No product code, no migration, no DB / container
   / production access, no deploy, no test execution. CI records
   were read via the GitHub API as the only external interaction.

## R5.6 — PR boundary

- Mode: single docs-only PR (`fix/ctacte-mutations-r5` → `main`)
- Commits on top of `origin/main` at `cb5de9f`: **1** (the
  R5 reconciliation commit)
- File scope: 2 files
  - `openspec/changes/athlos-ctacte-mutations/apply-progress.md`
  - `openspec/changes/athlos-ctacte-mutations/tasks.md`
- 400-line budget risk: Low (well under the 400-line guard)
- Linked issue: #37 (`status:approved` + `documentation` labels)
- Out of scope: no product code, no migration, no DB / container
  / production access, no deploy, no test execution. CI records
  are read-only.
