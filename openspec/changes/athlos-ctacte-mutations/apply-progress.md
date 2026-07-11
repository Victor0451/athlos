# Apply Progress — athlos-ctacte-mutations R3 (canonical evidence)

**Branch**: `fix/ctacte-mutations-r3` (PR #34)
**Base**: `ea3bd5f` (`origin/main` head after PR #32 merge)
**Head**: `d0937ff`
**Scope (git diff --stat `ea3bd5f..HEAD`, code + tests + docs, excluding openspec/)**:
20 non-doc files changed, `+3320 / -172`; openspec/changes/athlos-ctacte-mutations/apply-progress.md rewritten in this commit.

R3 work in this branch covers three slices — original R3, R3 corrective, R3 fix batch (defects #1/#2/#3) — plus two test-harness attempts (v2, v3) on top. **R3 code work is complete.** R4 (field-level `ApiError.details` → form mapping) is not in this branch. **R5 (evidence reconciliation) is pending — see "R5 evidence reconciliation status" below.**

## Immutable scope (from git diff vs `origin/main`)

Production code / test files touched (paths verified via `git diff --name-only ea3bd5f..HEAD`):

- `apps/api/src/modules/socios/ctacte_movement_notes.ts` (+ service tests)
- `apps/api/src/modules/socios/ctacte_movement_notes_repository.ts` (+ repository tests)
- `apps/api/src/modules/socios/ctacte_movement_notes.postgres.integration.test.ts` (NEW)
- `apps/api/src/modules/socios/ctacte_movement_notes.full-forward-sequence.integration.test.ts` (NEW)
- `apps/api/src/routes/ctacte-mutations.ts` (+ route tests)
- `apps/api/src/test-standins/db.ts`
- `apps/web/src/components/ctacte/CtacteNoteForm.tsx` (+ form tests)
- `apps/web/src/components/ctacte/CtacteNotesSection.tsx` (+ section tests)
- `apps/web/src/lib/api/ctacte-mutations.ts` (+ client wrapper tests)
- `apps/web/src/app/(authed)/ctacte/[cuenta]/page.test.tsx` (page coverage extension)
- `packages/db/drizzle/0031_ctacte_movement_notes.sql` (tail amendment)
- `packages/db/drizzle/0034_ctacte_movement_notes_idempotency_key_full_unique.sql` (NEW, forward-only)
- `packages/db/src/schema/socios.ts` (drop `.where(sql\`... IS NOT NULL\`)` on `idempotencyKeyUnique`)
- `packages/db/src/schema/ctacte-mutations.test.ts` (schema + migration coverage)
- `docs/runbook.md` (manual rollout sequence documentation)

Not touched in this branch: `CtacteTab.tsx` (sibling inside `/socios/[id]`), `/ctacte` list page, `/socios/[id]` page, Tesorería cross-system sync, deploy workflow, `check-destructive.yml`, `deploy.yml`.

No migration applied by this branch. No deploy. No production container access recorded by this document.

## Commits (immutable git refs)

| Commit | Subject | Slice |
|---|---|---|
| `eccdbd0` | fix(ctacte): enforce author-or-ADMIN note soft-delete authorization | original R3 — backend |
| `76297bd` | feat(web): per-cuenta notes collapse + author-or-ADMIN note delete | original R3 — web |
| `6f3b7ad` | feat(web): wire CtacteNoteForm modal into /ctacte/[cuenta] production path | original R3 — web |
| `287b993` | fix(ctacte): enforce DELETE note binding + rethrow technical errors as 5xx | R3 corrective — defects #1 + #3 |
| `e689684` | fix(ctacte): durable notes Idempotency-Key end-to-end | R3 corrective — defect #2 |
| `198e5d8` | fix(db): convert ctacte_movement_notes idempotency_key to full unique index (0034) | R3 fix batch — defect #1 |
| `2d43a24` | fix(api): distinguish created vs replay in note insert + add author_operator_id comparison | R3 fix batch — defect #2 |
| `ca24e9c` | fix(web): reload-safe note idempotency via localStorage | R3 fix batch — defect #3 |
| `8f10270` | test(api): full forward 0031→0034 sequence + 10-racer PG concurrency proof | R3 fix batch — test-harness attempt v2 |
| `61a810c` | fix(test): isolate full-forward-sequence PG proof from sibling DROP-SCHEMA race + CI fresh-DB audit setup | R3 fix batch — test-harness attempt v3 |
| `b6e4c48` | docs(sdd): record R3 strict-TDD evidence and per-cuenta notes persistence | docs |
| `197f052` | docs(sdd): record R3 corrective-batch strict-TDD evidence + workload guard | docs |
| `989aff5` | docs(sdd): record R3 fix batch strict-TDD evidence + runbook rollout | docs |
| `04eda01` | docs(sdd): record R3 fix batch v2 strict-TDD evidence + disposable-PG commands | docs (superseded) |
| `01864fa` | docs(sdd): record R3 fix batch v3 strict-TDD evidence + CI-compatible command set | docs (superseded) |
| `fce97d2` | docs(sdd): retract destructive-reproduction evidence under no-production-access boundary | docs (retraction) |
| `d0937ff` | docs(sdd): retract v2 localhost:5433 disposable-PG evidence under no-production-access boundary | docs (retraction) |

## Verifiable CI evidence (PR #34 GitHub Actions)

The `test` workflow at `.github/workflows/test.yml` provisions `postgres:16-alpine` on `localhost:5432` and exports `ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@localhost:5432/athlos`. The `check-destructive` workflow scans migration files for `DROP TABLE|TRUNCATE|DELETE FROM`. Both fire on PR `push` events.

Each row below is the single CI run whose `head_sha` equals the listed commit. The `test` job conclusion is the only test-evidence claim retained; other jobs (`Docker build smoke`, `labeler`, `drift-check`, `check-destructive`) are non-test infrastructure and are recorded only where they matter. `backup-bats` requires a labelled USB device and fails with `failure` on every run in this branch — that failure is unrelated to R3 work and is not cited as test evidence.

| Tree head (commit) | Run ID | Test job ID | Test conclusion | Notes |
|---|---|---|---|---|
| `b6e4c48` (R3 docs) | 29124944790 | 86468369748 | **success** | original R3 code (`eccdbd0` + `76297bd` + `6f3b7ad`) tested GREEN at this head |
| `197f052` (R3 corrective docs) | 29126449069 | 86472962739 | **success** | R3 corrective code (`287b993` + `e689684`) tested GREEN at this head |
| `989aff5` (R3 fix batch docs) | 29128096424 | 86477863625 | **success** | R3 fix batch code (`198e5d8` + `2d43a24` + `ca24e9c`) tested GREEN at this head |
| `8f10270` (R3 v2 test) | 29130326003 | 86484303316 | **failure** | v2 attempt: new file `ctacte_movement_notes.full-forward-sequence.integration.test.ts` triggered DROP-SCHEMA race against the sibling file |
| `04eda01` (R3 v2 docs) | 29130348331 | 86484371404 | **failure** | tree identical to `8f10270` (docs-only commit); RED inherited from `8f10270` |
| `61a810c` (R3 v3 test) | — | — | **MISSING** | no GitHub Actions run is on record for this exact SHA (no run found via `gh api repos/Victor0451/athlos/actions/runs` for `61a810cd39359b1cce3d93cc1ac1f311941cb9d6`) |
| `01864fa` (R3 v3 docs) | 29132238452 | 86489623768 | **success** | tree contains `61a810c`; test job GREEN — the v3 test-harness commit's isolated-schema + Proxy rewrite + `addColumnIfMissing` approach passed CI when run in this tree |
| `fce97d2` (retraction docs) | 29132917216 | 86491643393 | **success** | tree identical to `d0937ff` minus the latest docs commit; test job GREEN |
| `d0937ff` (current head) | 29133082673 | 86492127664 | **success** | current branch head; test job GREEN |

CI service runs only fire on branch-tip `push` events, so per-commit RED/GREEN rows for the eight intermediate work-unit commits (`eccdbd0`, `76297bd`, `6f3b7ad`, `287b993`, `e689684`, `198e5d8`, `2d43a24`, `ca24e9c`) are not independently recorded. The branch-tip GREEN at `989aff5` is the strongest cumulative GREEN for the R3 fix batch code; the branch-tip GREEN at `197f052` covers the R3 corrective code; the branch-tip GREEN at `b6e4c48` covers the original R3 code. Earlier commits are subsumed by their later branch-tip GREEN.

## Strict-TDD evidence status by work unit

Strict TDD requires a RED run before the implementation commit and a GREEN run after it. With force-pushes and branch-tip-only CI, those per-commit RED/GREEN runs are **not independently on record** for most work units. The strict-TDD cycle evidence for each R3 work unit is therefore reported as:

| Work unit (commits) | RED evidence | GREEN evidence |
|---|---|---|
| Original R3 backend — author-or-ADMIN soft-delete authorization (`eccdbd0`) | MISSING (no per-commit CI RED recorded) | cumulative GREEN at branch tip `b6e4c48` (run 29124944790, test job 86468369748) |
| Original R3 web — per-cuenta collapse + author-or-ADMIN delete (`76297bd`) | MISSING | cumulative GREEN at branch tip `b6e4c48` |
| Original R3 web — `CtacteNoteForm` mounted in production (`6f3b7ad`) | MISSING | cumulative GREEN at branch tip `b6e4c48` |
| R3 corrective — DELETE binding + 5xx mapping (`287b993`) | MISSING | cumulative GREEN at branch tip `197f052` (run 29126449069, test job 86472962739) |
| R3 corrective — durable Idempotency-Key end-to-end (`e689684`) | MISSING | cumulative GREEN at branch tip `197f052` |
| R3 fix batch defect #1 — 0034 full unique index (`198e5d8`) | MISSING | cumulative GREEN at branch tip `989aff5` (run 29128096424, test job 86477863625) |
| R3 fix batch defect #2 — created vs replay + operator identity (`2d43a24`) | MISSING | cumulative GREEN at branch tip `989aff5` |
| R3 fix batch defect #3 — reload-safe localStorage key (`ca24e9c`) | MISSING | cumulative GREEN at branch tip `989aff5` |
| R3 v2 attempt — full forward + 10-racer PG (`8f10270`) | CI RED at branch tip `8f10270` (run 29130326003, test job 86484303316) — `column "socio_id" of relation "ctacte" does not exist` | MISSING (v2 was not the landed fix) |
| R3 v3 attempt — schema isolation + Proxy + audit setup (`61a810c`) | MISSING (no CI run on record for this SHA) | CI GREEN at branch tip `01864fa` (run 29132238452, test job 86489623768) and at `d0937ff` (run 29133082673, test job 86492127664) — both trees include `61a810c` |

In-process test counts, PASS totals, and runtimes recorded in earlier versions of this document are **not cited as evidence**: per-suite counts depend on the executor and cannot be cross-verified without a re-run.

## Local / production database access

**No local or production database run is cited as evidence by this document.** Specifically:

- Local runs against `postgresql://athlos:athlos@localhost:5432/athlos` are **not** cited as evidence. That URL pattern is what CI provisions (`postgres:16-alpine` service), but a local execution of the same string is not independently verifiable as the CI service and the affected integration test files use `DROP SCHEMA "socios" CASCADE` / `DROP SCHEMA "tesoreria" CASCADE` in setup, which would be destructive against any production-shaped database.
- Local runs against `postgresql://athlos:athlos@localhost:5433/athlos_disposable` are **not** cited as evidence. That port is not provisioned by `.github/workflows/test.yml`; no record confirms a verified disposable PostgreSQL instance was listening locally on port 5433 at the time any GREEN count was recorded.
- Any "5/5 disposable PG tests pass" or similar pass-total claim from prior versions of this file is removed.

Whether the production database was accessed during this work is **not assessed by this record.** This document does not assert that production was never touched; it only states that no such access is documented here as evidence.

## R5 evidence reconciliation status

R5 (per `openspec/changes/athlos-ctacte-mutations/tasks.md`) is "Reconcile `sdd/athlos-ctacte-mutations/apply-progress` against real commits and test records, adding a Strict TDD Cycle Evidence table only for evidence that can be cited; explicitly leave uncited RED/GREEN, triangulation, or safety-net entries unrecorded rather than fabricating them."

- **Per-work-unit RED/GREEN rows that are not independently supported** are recorded as `MISSING` in the table above rather than fabricated from local-run commands.
- **Compliance assertions** that depended on local `localhost:5432` or `localhost:5433` runs have been removed. The remaining compliance claim in this document is "CI test job GREEN at the branch-tip SHA that subsumes each R3 work-unit commit," which is verifiable via `gh api repos/Victor0451/athlos/actions/runs/<id>/jobs`.
- **R5 is pending unverified completion** for two reasons: (a) per-commit strict-TDD RED/GREEN pairs are MISSING for most work units — only the branch-tip cumulative GREEN is on record; (b) R5 should be closed in a follow-up commit that records the per-commit evidence or formally accepts the branch-tip cumulative GREEN as the closing record. Either closure path requires fresh CI runs (per-commit RED before GREEN, then per-commit GREEN) that are not in `gh api` today.

## Out of scope (truthful, this branch)

- R4 (field-level `ApiError.details` → form mapping) — not in this branch.
- R5 closure commit — not in this branch; see "R5 evidence reconciliation status" above.
- Deploy / migration apply / production container access — not in this branch; not assessed by this record.
- `CtacteTab.tsx`, `/ctacte` list page, `/socios/[id]` page, Tesorería cross-system sync — not touched.