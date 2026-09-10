# Collections apply progress

## Recovery note

The prior cumulative `apply-progress.md` was overwritten during Unit 4. Its exact historical prose is unrecoverable; this concise record is reconstructed only from verified facts. The native attempt ledger remains authoritative for detailed attempt chronology.

## Cumulative completed units

| Unit | Commit / count                | Verified evidence                                                                                                                                                                                  |
| ---- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `9363b38`, 400/400            | 10 Vitest + 15 Bats + DB static PASS; exact `0059` pre/post guard.                                                                                                                                 |
| 2A   | `70d3db4`, 308/345            | 12 tests + API static PASS; price intervals, one rounding, remainder, zero, and QA-001 coverage.                                                                                                   |
| 2B   | `858a1d4`, 349/365            | Preview, auth, fingerprint, issues, and zero writes; PostgreSQL was typed unavailable; focused/static PASS.                                                                                        |
| 3    | `ed3be6a`, 325/365            | PostgreSQL 7/7, focused 22/22, and static PASS; causal rows: 2 obligations, 1 receipt, 1 audit, 2 components; stale conflict, stable replay, rollback `[0,0,0]`, and disposable container removal. |
| 4    | Current child/05-unit-4 slice | Internal full-outstanding selection, legacy monetary route withdrawal, and PostgreSQL lock/no-selector-write proof completed below.                                                                |

## Unit 4 — full-payment contract

- `selectFullOutstanding` derives canonical full balances, currency, total, and SHA-256 fingerprint from explicit obligation IDs; it owns no payment transaction or writes.
- Legacy monetary `POST /api/v1/dues/settlements` and reverse registration remain absent (404); the separate authenticated community-work route remains available.
- PostgreSQL proof used one loopback-only disposable `postgres:16-alpine` container and the existing isolated-database fixture. It seeded owned obligations, an allocation, and a reversal/compensation; a second transaction remained blocked while the first held canonical `FOR UPDATE` locks. After release it selected current facts. A fixture-only allocation then changed the reviewed balance, and stale fingerprint rejection followed. Paid/zero, foreign, and mixed-currency selections rejected. Selector success and all rejection paths left obligation/allocation/settlement/audit counts unchanged; the only observed count delta was the explicitly labeled fixture allocation. The isolated database was dropped by the test and the container was removed after final checks.
- No Unit 5 Treasury/tender or transaction semantics were added or claimed.

## TDD cycle evidence

| Task                 | Test file                                                            | Layer                  | Safety net                              | RED                                                                                            | GREEN                                                                           | TRIANGULATE                                                                                                                      | REFACTOR                                                                   |
| -------------------- | -------------------------------------------------------------------- | ---------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Unit 4 runtime proof | `apps/api/src/modules/dues/settlements.postgres.integration.test.ts` | PostgreSQL integration | 12 focused route/selector tests passing | New proof first failed when its queue-order assumption was invalid; no production code changed | Focused integration PASS after deterministic lock/fresh-fact fixture correction | Paid/zero, foreign, mixed currency, compensated allocation, stale fingerprint, canonical ordering, and two transaction lock wait | Fixture accepts a snapshot override; selector remains production-unchanged |

## Verification

- PASS — `pnpm exec vitest run apps/api/src/modules/dues/selection.test.ts apps/api/src/routes/settlement-routes.test.ts`: 12 passed, 7 skipped.
- PASS — `ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@127.0.0.1:<ephemeral-port>/athlos_test pnpm exec vitest run apps/api/src/modules/dues/settlements.postgres.integration.test.ts -t 'locks full balances'`: 1 passed, 18 skipped.
- PASS — `pnpm --filter @athlos/api typecheck`.
- PASS — `pnpm --filter @athlos/api lint`.
- Final source normalization completed before the final readback/check set; no later source edit is planned.

## Persisted task and delivery state

- Unit 4 TRIANGULATE and runtime-harness task lines are marked `[x]` in `tasks.md` after the focused runtime and route checks passed.
- Workload / PR boundary: `auto-chain`, `feature-branch-chain`; `child/05-unit-4` / `feature/collections-04-full-payment-contract`.
- Remaining work: Unit 5A. No unchecked Unit 4 task lines remain.

## Status consumed

```yaml
schemaName: spec-driven
changeName: collections-end-to-end-completion
artifactStore: openspec (hybrid configured; OpenSpec authoritative)
applyState: ready
actionContext:
  mode: repo-local
  workspaceRoot: /run/media/vlongo/Archivos/Projectos/Athlos
  allowedEditRoots: [/run/media/vlongo/Archivos/Projectos/Athlos]
  warnings:
    - Parent retains native token.
    - No attempt command, commit, push, PR, deploy, BETA, or review was run.
delivery: auto-chain / feature-branch-chain
prBoundary: child/05-unit-4 / feature/collections-04-full-payment-contract
```

## Unit 4 correction — final evidence rehome

- Internal full-selection command remains amount-free; legacy MONETARY settlement and reversal POST routes are actively asserted unavailable (404) with representative payloads.
- The duplicate `dues-settlements-legacy.test.ts` was removed. Dedicated active `community-work.test.ts` continues to cover NON_CASH community-work behavior.
- Final Unit 4 correction: 321/335 from HEAD (236 tracked additions/deletions + 85 untracked selection-test lines); tender is exactly CASH|DEBIT|CREDIT|TRANSFER and the internal command rejects non-canonical UUID socio, obligation, and shift IDs.
- Workload / PR boundary: `auto-chain`, `feature-branch-chain`; `child/05-unit-4` / `feature/collections-04-full-payment-contract`. No production code changed by this correction.

### TDD Cycle Evidence

| Task                               | Test file                                       | RED                                                                                                              | GREEN                                                    | TRIANGULATE                                                          | REFACTOR                                                                       |
| ---------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Unit 4 route-absence deduplication | `apps/api/src/routes/settlement-routes.test.ts` | Existing frozen behavior already supplied the equivalent route-absence proof; no production change was permitted | Active 404 regression added for both withdrawn endpoints | Dedicated active community-work service coverage retained separately | Removed duplicated route/community coverage and kept one compact absence suite |

### Final correction verification

- PASS — `pnpm --filter @athlos/api exec vitest run src/routes/settlement-routes.test.ts src/modules/dues/selection.test.ts src/modules/dues/settlements.test.ts src/modules/dues/community-work.test.ts`: 4 files / 28 tests; active 404 absence coverage plus dedicated NON_CASH community-work service coverage.
- PASS — `pnpm --filter @athlos/api typecheck`; `pnpm --filter @athlos/api lint`; `pnpm exec prettier --check ...`; and `git diff --check HEAD`. No active route skip/todo exists; frozen Unit 4 production hashes matched before/after.

## Unit 5A — CashDesk transaction-aware settlement tender seam

- Completed persisted tasks: all seven Unit 5A task lines (RED, GREEN, TRIANGULATE, REFACTOR, focused evidence, runtime harness, rollback boundary) are marked `[x]` in `tasks.md`.
- Changed files: `apps/api/src/modules/dues/cash-desk.ts`, `cash-desk.test.ts`, new `cash-desk-transaction.test.ts`, and `cash-desk.postgres.integration.test.ts`; this cumulative progress file and `tasks.md` only. No route, Web/UI, schema, settlement orchestrator, reversal, or Club Dues artifact changed.
- Seam: exported `recordSettlementTenderInTransaction(db, input)` accepts only `CASH|DEBIT|CREDIT|TRANSFER`, validates ADMIN/TESORERO authorization, actor-available OPEN shift and 24-hour policy, derives amount solely from a MONETARY settlement, persists `INCOME`/`SETTLEMENT` correlation plus audit through the supplied handle, and never calls `transaction`. Equivalent replay returns the tender; a changed fingerprint conflicts. The legacy `CashDeskService.recordTender` remains transaction owner and delegates SETTLEMENT calls to the seam; manual Treasury behavior remains its existing path.
- Physicality: `reconcileTenders` now computes expected counted physical balance from opening and movement `CASH` only. DEBIT/CREDIT/TRANSFER remain persisted Treasury facts but do not contribute to expected physical cash.
- Runtime evidence: disposable loopback-only `postgres:16-alpine` containers `athlos-unit5a-1787672296-6940` (`127.0.0.1:32791`) and `athlos-unit5a-1787672515-10339` (`127.0.0.1:32793`) created unique isolated DBs per existing fixture, migrated/seeded operator, shift, and MONETARY settlement. The seam committed one row each for CASH/DEBIT/CREDIT/TRANSFER with `INCOME`, amount `12.50`, `SETTLEMENT`, and matching settlement ID. An injected post-seam outer transaction exception produced `0` tender rows for its settlement. Both containers were removed by shell traps; no shared, `.env.local`, BETA, or external database was used.

### TDD Cycle Evidence

| Task                | RED                                                                                                                                                                                                                                 | GREEN                                                                             | TRIANGULATE                                                                                                                                                                                                                           | REFACTOR                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Unit 5A tender seam | `pnpm --filter @athlos/api exec vitest run src/modules/dues/cash-desk-transaction.test.ts` initially failed 7/7: missing exported function; the pre-existing reconciliation behavior also failed the electronic-physical assertion. | Exported in-transaction seam and CASH-only expected reconciliation made 7/7 pass. | 8 focused tests cover four tenders, invalid tender, missing/closed/expired shifts, missing/NON_CASH settlements, replay/conflict, and physical totals; PostgreSQL proves all four persisted facts and outer rollback zero-row result. | Kept the legacy wrapper as transaction owner; normalized source before final checks. |

### Unit 5A verification and delivery

- PASS — `pnpm --filter @athlos/api exec vitest run src/modules/dues/cash-desk.test.ts src/modules/dues/cash-desk-transaction.test.ts`: 2 files, 13 tests.
- PASS — `ATHLOS_TEST_DATABASE_URL=postgresql://athlos:athlos@127.0.0.1:32791/athlos_test pnpm --filter @athlos/api exec vitest run src/modules/dues/cash-desk.postgres.integration.test.ts -t 'records every settlement tender'`: 1 passed, 5 skipped.
- PASS — fresh disposable PostgreSQL full CashDesk regression with `--hookTimeout 30000`: 6 passed.
- PASS — `pnpm --filter @athlos/api typecheck`; `pnpm --filter @athlos/api lint`; targeted `pnpm exec prettier --check`; `git diff --check 54f2127`.
- LSP unavailable: `pnpm exec typescript-language-server --version` returned command not found; TypeScript typecheck is the available diagnostic substitute.
- Exact authored line accounting from `54f2127`, excluding OpenSpec: `cash-desk.ts` +111/-3 (114), `cash-desk.test.ts` +3/-3 (6), `cash-desk.postgres.integration.test.ts` +17/-1 (18), new `cash-desk-transaction.test.ts` +111/-0 (111): total **249** additions+deletions, within the 300-line Unit 5A budget.
- Workload / PR boundary: `auto-chain`, `feature-branch-chain`, `feature/collections-05a-tender-seam`; this is only Unit 5A. Rollback removes the seam and its tests while leaving public payment unavailable.
- Status consumed: `collections-end-to-end-completion`, OpenSpec authoritative, `applyState: ready`, repo-local root `/run/media/vlongo/Archivos/Projectos/Athlos`, allowed root that workspace, with parent-native-token/no-stage/no-commit/no-review/no-deploy/no-BETA warnings honored.
- Remaining tasks: Unit 5B and later work units remain unchecked; no Unit 5A task remains unchecked.

### Unit 5A type-contract correction

- Replaced the suppressed unconstrained `Row` alias with an explicit CashDesk SQL projection contract. It models string IDs/statuses/tenders/amounts, nullable `closed_at`/`source_id`/`reason`, boolean `force_close`, and JSON tender totals; the `closed_at!` marker in the close-only mapper is erased TypeScript narrowing for the `NOT NULL` close projection.
- Strict TDD continuity: existing behavioral RED/GREEN/TRIANGULATE evidence remains applicable; this is a declaration-only structural correction. Safety net before the edit: focused CashDesk Unit 5A suite passed 13/13. Triangulation/refactor are not applicable because emitted JavaScript behavior is unchanged.
- No persisted task state changed: all Unit 5A task lines remain `[x]`. PostgreSQL is not rerun because the correction changes only erased TypeScript declarations; accepted disposable PostgreSQL evidence remains valid.

## Unit 5B — partial, blocked before completion

- RED (genuine): `pnpm exec vitest run apps/api/src/modules/dues/settlements.test.ts apps/api/src/routes/dues-settlements.test.ts` failed with 2 route tests: expected strict DTO rejection/auth to yield 400/403, received the prior 404 route absence. No production file had been changed before this run.
- GREEN: the same command subsequently passed `22/22`; expanded compatibility check including `settlement-routes.test.ts` passed `31/31`. API typecheck and lint passed.
- Partial implementation only: strict route DTO, canonical sorted route fingerprint, `SettlementService.create` monetary full-selection branch, early idempotency lookup, caller-owned outer transaction, shared pre-write shift validation, allocation derivation, 5A tender seam, and audits were drafted. Legacy payload regression coverage was retained and updated to assert 400 rejection.
- BLOCKED: this is not a completed Unit 5B. No Unit 5B checkbox was marked. Required service transaction-order/forced-failure coverage, PostgreSQL causal proof, and the required PRETTIER check are incomplete. `pnpm exec prettier --check ...` failed for `settlements.ts`, `cash-desk.ts`, `dues.ts`, and `dues-settlements.test.ts`; no source-mutating formatter was run after the candidate. The available PostgreSQL command ran with no configured disposable URL and skipped all 19 tests; it proves nothing.
- Exact authored accounting from `HEAD 9745f66`, excluding OpenSpec: production `allocations.ts` +2/-0 (2), `cash-desk.ts` +10/-18 (28), `settlements.ts` +26/-2 (28), `dues.ts` +10/-1 (11) = **69**; tests `settlement-routes.test.ts` +7/-7 (14), new `dues-settlements.test.ts` 52 lines = **66**; total **135/395**. No files were staged; pre-existing staged OpenSpec blobs were preserved.
- Remaining exact task lines: every unchecked Unit 5B line in `tasks.md`, beginning `- [ ] **RED:** add failing transaction/route tests...`, remains unchecked.
- Delivery boundary: `auto-chain` / `feature-branch-chain`, intended `child/07-unit-5b`; no commit, push, PR, review, deploy, BETA action, or native-attempt command was run.

## Unit 5B — final continuation blocked before unsafe test compression

- Status consumed: `changeName: collections-end-to-end-completion`, `artifactStore: hybrid` with OpenSpec authoritative, `applyState: ready`, `actionContext.mode: repo-local`, workspace and allowed root `/run/media/vlongo/Archivos/Projectos/Athlos`; parent-native-token, no-stage, no-commit, no-push, no-PR, no-review, no-deploy, and no-BETA warnings honored. Delivery remains `auto-chain` / `feature-branch-chain`, boundary `child/07-unit-5b`.
- Pre-write state was captured at `HEAD 9745f66d629c3591b724a22d91c128301609d561`. The staged OpenSpec blobs remained `f735c3da2c69a9c68e85734cb3ce6901ea3fdc1e` for `apply-progress.md` and `dff2758a2b62f3ae5d2fdbc4dde03f2a5e19e667` for `tasks.md`; neither was staged, reset, or otherwise changed in the index.
- Per the continuation instruction, the only mutating normalization was run before any final functional verification: `pnpm exec prettier --write apps/api/src/modules/dues/allocations.ts apps/api/src/modules/dues/cash-desk.ts apps/api/src/modules/dues/settlements.ts apps/api/src/routes/dues.ts apps/api/src/routes/settlement-routes.test.ts apps/api/src/routes/dues-settlements.test.ts`. It changed formatting only in `dues.ts` and `dues-settlements.test.ts`; no later source mutation occurred.
- Recomputed actual authored accounting from `9745f66` after that required normalization is already 319 lines: `allocations.ts` +2/-0 (2), `cash-desk.ts` +23/-18 (41), `settlements.ts` +123/-2 (125), `dues.ts` +37/-0 (37), `settlement-routes.test.ts` +7/-7 (14), and the complete untracked `dues-settlements.test.ts` 100 lines. This leaves only 76 lines under the 395-line whole-unit cap. The prior partial record's 135-line figure does not match the current diff from the mandated base.
- The required missing work is not safely representable in the remaining 76 lines without prohibited test compression: transaction-order and post-write/audit-failure service coverage plus the independent PostgreSQL causal harness/proof (four tenders/correlation, stable replay, changed-key conflict, stale concurrency, and zero-row rollback). Therefore no new tests, production corrections, focused RED, PostgreSQL container, functional verification, or task checkbox changes were performed in this continuation.
- Persisted task state: all seven Unit 5B task lines remain visibly unchecked (`- [ ]`), including RED, GREEN, TRIANGULATE, REFACTOR, focused evidence, runtime harness, and rollback boundary. Unit 5B is not ready for verify.
- Required resolution: reduce the current Unit 5B candidate to create a truthful test budget or explicitly re-plan/split the work unit. No size exception, reset, staging, or causal-test compression is authorized.

## Unit 5B1 — service and PostgreSQL proof continuation (blocked)

- Pre-state: `HEAD 9745f66d629c3591b724a22d91c128301609d561`; production base remains exactly 168 authored lines: `allocations.ts` 2, `cash-desk.ts` 41, `settlements.ts` 125. The staged OpenSpec blobs remain `f735c3da2c69a9c68e85734cb3ce6901ea3fdc1e` (`apply-progress.md`) and `dff2758a2b62f3ae5d2fdbc4dde03f2a5e19e667` (`tasks.md`); neither was staged or reset. Deferred 5B2 route blobs remain in CAS: `dbefb163ce0be5200990fc098154d2b08acd0d60`, `5a9ce7d91655b6fe061ff7ea070883602eb613c1`, `24edbfc6e34a10f37acaf046c77efbb0f22cfe00`.
- RED/GREEN: the cash harness allowlist test genuinely REDed because `postgres-test-database.ts` was absent, then GREENed after adding an exact `^athlos_cash_[0-9a-f]{32}$` guard and non-template SQL construction. The payment PostgreSQL proof genuinely REDed first without `ATHLOS_TEST_DATABASE_URL`, then against disposable PostgreSQL because the fixture lacked `tesoreria.gastos`; the fixture was corrected before the final GREEN run. The service call-order failure suite passed 5/5 against the already-present 5B1 implementation; it did not produce a new production RED because no additional production correction was necessary.
- Added proof: `settlements-atomic.test.ts` asserts failures at selection, claim, allocation, tender, and service audit do not reach a later mocked call. PostgreSQL proof opens a cash shift for CASH/DEBIT/CREDIT/TRANSFER, commits each `SETTLEMENT` tender, verifies stable replay and changed-fingerprint conflict, then forces the service success audit and confirms settlement/allocation/tender counts are unchanged. Existing 5A cash PostgreSQL regression passed 6/6 after the harness scanner correction.
- Harness isolation/cleanup: all PostgreSQL runs used loopback-only `postgres:16-alpine` disposable containers and isolated generated databases; no `.env.local`, BETA, shared, or external database was used. The final `athlos-5b1-*` container absence check passed after cleanup.
- Verification: PASS focused service/helper tests 6/6; PASS targeted settlement PostgreSQL 1/1 (19 skipped); PASS CashDesk PostgreSQL 6/6; PASS API typecheck and lint; PASS `git diff --check HEAD`. BLOCKED: `pnpm format:check` failed for `postgres-test-database.test.ts`, `settlements-atomic.test.ts`, and `settlements.postgres.integration.test.ts`. No formatter write was run after functional verification began.
- Accounting from `9745f66`: production remains 168. Added/changed proof and harness lines are 95 (tracked `cash-desk.postgres.integration.test.ts` 5, `settlements.postgres.integration.test.ts` 29; new files 61), for 263 total authored lines, within the 395 cap. No route, API DTO, Web/UI, schema, or deferred 5B2 file was touched.
- Persisted task state: all seven original Unit 5B task lines remain unchecked. Workload/PR boundary remains `auto-chain` / `feature-branch-chain`, `child/07-unit-5b`, authorized 5B1 slice only. Do not mark Ready for verify until formatting is resolved under a fresh authorized verification window.

### TDD Cycle Evidence

| Task                     | RED                                                                       | GREEN                                                                                 | TRIANGULATE                                                          | REFACTOR                                              |
| ------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------- |
| Cash PG identifier guard | Missing helper failed to load                                             | Guard accepts only exact random cash names and constructs SQL from allowlisted pieces | Rejects injection-shaped name                                        | Cash PG harness uses create/drop helper               |
| 5B1 proof                | Missing disposable database configuration/fixture failed PostgreSQL setup | Isolated PostgreSQL payment proof passed                                              | Four tenders, replay, changed key, and forced success-audit rollback | No production refactor; format check remains blocking |

## Status consumed

```yaml
schemaName: spec-driven
changeName: collections-end-to-end-completion
artifactStore: openspec
applyState: ready
actionContext:
  mode: repo-local
  workspaceRoot: /run/media/vlongo/Archivos/Projectos/Athlos
  allowedEditRoots: [/run/media/vlongo/Archivos/Projectos/Athlos]
  warnings:
    - Parent retains native token; no sdd-attempt, review, commit, push, or PR command ran.
    - 5B1 is the authorized auto-chain / feature-branch-chain slice; 5B2 route bytes are CAS-only.
    - Formatting is blocked: no formatter write after functional verification began.
```
