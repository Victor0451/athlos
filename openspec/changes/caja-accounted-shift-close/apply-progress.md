# Apply progress

## Unit 1 — Account chart persistence and deterministic seed

- Completed persisted tasks: 1 RED, 2 GREEN, 3 TRIANGULATE (`tasks.md` marked `[x]`).
- Changed: `contabilidad.ts`, schema barrel, `0066_plan_cuentas.sql`, journal, and focused schema/disposable-PG tests.
- RED: initial focused runner was blocked by absent `node_modules`; `pnpm install --offline --frozen-lockfile` reused 791 cached packages without lockfile changes. RED then observed missing `planCuentas` and missing migration (3 failing new assertions).
- GREEN: `pnpm --filter @athlos/db exec vitest run src/schema/contabilidad.test.ts` — 1 passed, 0 failed, 0 skipped.
- TRIANGULATE: `pnpm test:disposable-postgres:integration -- packages/db/src/schema/contabilidad.postgres.integration.test.ts` — chart test file 2 passed; whole runner 150 passed, 3 failed (unapproved migration-frontier expectations in `migration-journal.test.ts`, `dues.test.ts`, and `scripts/status.test.ts`). Disposable lifecycle `1789348114-655293-e96484eb2746faec` created and removed its container/volume, with final absence evidence.

| TDD Cycle Evidence | RED | GREEN | TRIANGULATE | REFACTOR |
| --- | --- | --- | --- | --- |
| Unit 1 chart | Missing table/migration observed | schema contract passed | real PostgreSQL replay/constraints passed | package typecheck/lint passed; aggregate blocked |

- Deviation: none; `5.4 Depreciaciones` is seeded inactive/non-imputable to make catalog eligibility states explicit while supplied leaves remain active/imputable.
- Remaining in this unit: `- [ ] 4. **REFACTOR:** centralize catalog constants only if it prevents seed/schema drift; retain the source-input traceability. Run the confirmed shared quality commands.`
- Workload/PR boundary: Unit 1 only, stacked-to-main; no commit/PR. Authored change is 386 lines before progress/checkbox evidence and exceeds the 400-line budget once mandatory evidence is included; do not compress or start Unit 2.
- Status consumed: change `caja-accounted-shift-close`, apply ready, first unit only, `allowedEditRoots=/home/vlongo/Athlos-worktrees/caja-diagnosis`; warning: no authority for `/` or other worktrees. QA001 remains pending.
- Local quality: `pnpm --filter @athlos/db typecheck && pnpm --filter @athlos/db lint` passed. Prettier check fails for the two new source/test files; no formatting rewrite was applied because it would exceed the declared budget.
- Aggregate `pnpm test:run` completed web (128 files/1,076 tests), errors (1/11), validation (2/43), auth (2/18), and audit (6/25) successfully, then failed in db: 16 files passed, 11 failed; 80 passed, 1 failed, 72 skipped. Ten DB suite failures lack `ATHLOS_TEST_DATABASE_URL`; the eleventh is the unapproved journal expectation.
- Blocked pending a bounded edit-root extension for the three migration-frontier tests above; without it the required aggregate verification cannot pass.

## Unit 1 completion correction — supplied groups and 0066 frontier

- The bounded edit-root extension authorized only Unit 1’s chart persistence corrections: `migration-journal.test.ts`, `dues.test.ts`, and `scripts/status.test.ts` now expect the latest `0066_plan_cuentas` frontier; the 0044-frontier pending list includes `0066_plan_cuentas`.
- Corrected the unapproved seeded inactive supplied group: every supplied non-imputable group, including `5.4 Depreciaciones`, is active. The real PostgreSQL test creates the inactive/non-imputable `5.9 Grupo inactivo de prueba` transaction-local fixture instead, proving it is distinguishable from active non-imputable groups and active imputable leaves without altering supplied catalog content.
- Catalog review: 93 seeded rows, 93 unique codes, no code collisions; `4.1.01` remains `Cuotas sociales` beneath `4.1`, and `1.1.3.02` remains `Valores a Depositar` beneath `1.1.3`. The real PostgreSQL replay test verifies exact stable rows, root/parent links, replay safety, FK/uniqueness/check constraints, and the fixture distinction.
- Completed persisted task: Unit 1 task 4 REFACTOR; `tasks.md` is updated to `[x]`. No catalog constant was added because the static migration remains the traceable authoritative seed and a second runtime catalog would create, rather than prevent, migration/schema drift.
- Files changed in this correction: `0066_plan_cuentas.sql`, `contabilidad.postgres.integration.test.ts`, the three authorized migration-frontier tests, `tasks.md`, and this cumulative progress record. Earlier Unit 1 schema/barrel/journal/test changes remain part of the same cohesive Unit 1 boundary.

### TDD Cycle Evidence

| Task | Test file/layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
| --- | --- | --- | --- | --- | --- | --- |
| Unit 1 tasks 1–3 (prior) | schema unit + disposable PostgreSQL | prior focused evidence recorded | missing catalog/table observed | schema binding passed | real PostgreSQL replay/constraint cases passed | retained through correction |
| Unit 1 task 4 correction | `contabilidad.postgres.integration.test.ts` / real PostgreSQL integration | prior 150-pass disposable run recorded | `pnpm test:disposable-postgres:integration -- …` — 151 passed, 2 failed: supplied `5.4` was inactive instead of active | after migration correction: 27 files, 153 passed | active supplied non-imputable group, active imputable leaf, and transaction-local inactive/non-imputable fixture verified | no source refactor needed; focused schema 1/1 and disposable integration 153/153 remained green after Prettier |
| 0066 migration frontier | journal/dues/status tests / real PostgreSQL integration | prior RED record documented the three stale 0065 expectations | prior aggregate documented 150 passed, 3 failed; current frontier expectations were updated before GREEN | 27 files, 153 passed under repository disposable lifecycle | journal membership, current last tag, and 0044 pending frontier exercised | no refactor needed |

### Verification

- `pnpm --filter @athlos/db exec vitest run src/schema/contabilidad.test.ts` — 1 passed, 0 failed.
- `pnpm test:disposable-postgres:integration -- packages/db/src/schema/contabilidad.postgres.integration.test.ts packages/db/src/migration-journal.test.ts packages/db/src/schema/dues.test.ts packages/db/src/scripts/status.test.ts` — 27 files, 153 passed, 0 failed. Final disposable lifecycle `1789349111-707312-f4f4720739572a5a` created and removed its container/volume; final absence was reported. No external DB URL, BETA, secrets, or live service was used.
- `pnpm lint` — passed. `pnpm typecheck` — passed. `pnpm format:check` — passed. `pnpm build` — passed. The unavailable `typescript-language-server` binary was observed before build (`LSP_AVAILABLE=0`); repository typecheck supplied the available static analysis.
- `pnpm test:run` — candidate-independent aggregate result: web 128 files/1,076 passed; errors 1/11 passed; validation 2/43 passed; auth 2/18 passed; audit 6/25 passed. DB ended 17 files passed, 10 failed; 81 passed, 72 skipped, solely because the normal aggregate runner does not create `ATHLOS_TEST_DATABASE_URL`. The disposable lifecycle run above is the required database-backed candidate evidence and had no candidate failures.
- Build changed `apps/web/next-env.d.ts`; it was restored exactly to its pre-run SHA-256 `d222d721b06bc9259ca86571da8ebf893d384c8c253ea6033b05c9f43cba160e`.

### Boundary, status, and remaining work

- Workload/PR boundary: cohesive Unit 1 only; user-authorized `size:exception` applies to this unit only. Current Unit 1 source/migration/test delta is 1,021 additions + 13 deletions = **1,034 changed lines**, excluding OpenSpec evidence. This is the actual cumulative total from the original Unit 1 base, not a reset of the prior 415-line estimate. No commit, PR, base update, or Unit 2 work was performed.
- Rollback boundary remains only the chart migration/journal entry, chart schema/barrel exports, and their tests; no Caja writer/API/UI/close behavior was added.
- Status consumed: `gentle-ai.sdd-status/v2`, change `caja-accounted-shift-close`, artifact store `openspec`, native apply ready (prior task projection 3/39), `nextRecommended=apply`, `applyState=ready`, and bounded runtime attempt `proceed` supplied by the parent. `actionContext` restricts writes to `/home/vlongo/Athlos-worktrees/caja-diagnosis` and the supplied allowed edit surfaces; no `/` or other-worktree writes occurred. QA001 remains a live pending hold and was not simulated or resolved.
- Unit 1 has no remaining unchecked task line. The persisted plan has 35 later unchecked tasks (Units 2–9 and final acceptance), all deliberately out of scope; do not begin Unit 2. Parent owns runtime-attempt settlement, normalized candidate handling, independent verification/review, and any later chain work.


## Unit 1 final integrity correction — Drizzle/SQL hierarchy parity

- Scope remained strictly Unit 1 and the authorized edit surfaces: `packages/db/src/schema/contabilidad.ts`, `packages/db/src/schema/contabilidad.test.ts`, `packages/db/src/schema/contabilidad.postgres.integration.test.ts`, `packages/db/drizzle/0066_plan_cuentas.sql`, and this cumulative evidence file. No Unit 2/API/UI work, commits, PRs, base update, lifecycle operation, or external service access occurred.
- Completed correction: Drizzle now declares the SQL migration's named `plan_cuentas_parent_root_unique` composite unique constraint and named `plan_cuentas_parent_fk` composite foreign key (`parent_code`, `root_code` → `code`, `root_code`, `ON DELETE RESTRICT`). It also declares the same root-code, root-hierarchy, and imputable/active checks as SQL.
- Root insertion invariant: `parent_code IS NULL` requires `code = root_code` and `imputable = false`; every non-root requires a parent and cannot reuse its root code. The existing composite FK supplies parent/root consistency. With the allowed root-code check, only roots `1`–`5` are valid.
- Real PostgreSQL coverage now inserts the valid five roots in a rolled-back client transaction and rejects an invalid sixth root, a null-parent/root-code mismatch, an imputable root, and a cross-root parent. Savepoints isolate expected constraint failures without leaving the transaction aborted.
- Persisted task reconciliation: no separate plan checkbox exists for this bounded integrity correction. Unit 1 tasks 1–4 remain visibly marked `- [x]` in `tasks.md`; no later task was marked complete or started.

### TDD Cycle Evidence

| Task | Test file/layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
| --- | --- | --- | --- | --- | --- | --- |
| Unit 1 final integrity correction | `packages/db/src/schema/contabilidad.test.ts` / schema metadata unit | `pnpm --filter @athlos/db exec vitest run src/schema/contabilidad.test.ts` — 1 passed | Added metadata expectations first; same command — 1 failed because the composite unique constraint was absent | After named Drizzle `unique`/`foreignKey` and check declarations — 1 passed | Asserts names, ordered composite columns, FK columns/target/action, and all three checks | Prettier; focused unit test remained 1 passed |
| Unit 1 final integrity correction | `packages/db/src/schema/contabilidad.postgres.integration.test.ts` / disposable real PostgreSQL | `pnpm test:disposable-postgres:integration -- packages/db/src/schema/contabilidad.postgres.integration.test.ts` — 27 files, 153 passed | Added root/cross-root insertion cases first; disposable run — 27 files, 152 passed, 2 failed (missing Drizzle unique metadata and the mismatched null-parent root was accepted) | SQL root-hierarchy check made the suite — 27 files, 154 passed | Valid five roots plus invalid root code, mismatched root, imputable root, and cross-root parent are all exercised | Savepoint/client test isolation and Prettier; disposable suite remained 27 files, 154 passed |

### Verification

- `pnpm --filter @athlos/db exec vitest run src/schema/contabilidad.test.ts` — 1 passed, 0 failed.
- `pnpm test:disposable-postgres:integration -- packages/db/src/schema/contabilidad.postgres.integration.test.ts` — 27 files, 154 passed, 0 failed; final lifecycle `1789350705-797914-c8b1a973cff3cac8` created and removed its disposable container/volume and reported final absence.
- `pnpm lint` — passed.
- `pnpm typecheck` — passed.
- `pnpm format:check` — passed after Prettier refactor of the two test files.
- `pnpm build` — passed. It changed `apps/web/next-env.d.ts`; its exact pre-run bytes were restored. Restored SHA-256: `d222d721b06bc9259ca86571da8ebf893d384c8c253ea6033b05c9f43cba160e`.
- Deliberately not rerun: `pnpm test:run`; its normal DB lane lacks `ATHLOS_TEST_DATABASE_URL` and is the known non-candidate failure. The repository-owned disposable PostgreSQL lifecycle above is the required database-backed evidence.

### Boundary, status, and remaining work

- Deviation from design: none. The test-only `PoolClient`/savepoint helper was required to roll back expected PostgreSQL constraint errors safely; it does not alter catalog behavior.
- Workload/PR boundary: cohesive Unit 1 correction only, stacked-to-main. The user-authorized `size:exception` remains scoped to Unit 1 only. Current cumulative Unit 1 source/migration/test diff against the original worktree base is **1,130 additions + 13 deletions = 1,143 changed lines**, excluding OpenSpec evidence. No code was compressed to meet the budget.
- Rollback boundary: revert only the chart migration/journal entry, schema/barrel exports, and chart tests; no Caja writer/API/UI/close behavior exists in this unit.
- Structured status consumed: `gentle-ai.sdd-status/v2`; change `caja-accounted-shift-close`; artifact store `openspec`; `taskProgress=4/39`; `nextRecommended=apply`; `applyState=ready`; `actionContext.mode=repo-local`; authoritative workspace and allowed root `/home/vlongo/Athlos-worktrees/caja-diagnosis`. Informational warning retained: a later task names `/` as a future edit root; it was not touched. Parent supplied the bounded runtime-attempt `proceed` and owns settlement. QA001 remains pending and was not simulated or resolved.
- Remaining persisted unchecked tasks (35; all intentionally out of this delegated Unit 1 correction):
  - [ ] 1. **RED:** write route injection failures for unauthenticated/unauthorized access and query validation, plus a disposable-PG repository failure for code/name/group filters, stable ordering, and inclusion of active imputable leaves under Assets and Liabilities.
  - [ ] 2. **GREEN:** implement only parameterized read/search and a GET route registration. Make the exact authorized-role/capability choice match the existing Collections/Caja gate discovered above; return no mutation surface or account-selection writer.
  - [ ] 3. **TRIANGULATE:** add no-match, accent/case normalization (if the approved deterministic contract supports it), group-only, inactive, and non-imputable response cases; prove all queries remain scoped to the seeded hierarchy on disposable PostgreSQL.
  - [ ] 4. **REFACTOR:** share DTO/filter parsing without weakening Zod validation or authorization. Run planned focused API/disposable-PG selectors and confirmed shared quality commands; UI runtime evidence is **N/A (API-only unit)**.
  - [ ] 1. **RED:** add failing focused tests for own-open preflight, foreign-shift denial, CASH-only exact-cent opening input, no automatic carryover, same-operator race, and different-operator same-desk success; use disposable PostgreSQL for the constraint/race cases.
  - [ ] 2. **GREEN:** migrate the OPEN uniqueness boundary from desk to operator without altering completed history; implement owner-aware preflight/open/read authorization and preserve ADMIN/TESORERO recovery semantics. Do not yet create manual sources, production capture, or close transfer.
  - [ ] 3. **TRIANGULATE:** exercise malformed/fractional/overflow/non-CASH opening requests and transaction contention; show either one committed shift or a safe existing-shift response, never two.
  - [ ] 4. **REFACTOR:** isolate ownership/validation helpers from legacy tender/close behavior; run planned focused API/disposable-PG selectors and confirmed shared quality commands. UI runtime evidence is **N/A (API-only unit)**.
  - [ ] 1. **RED:** add component/navigation failures for the role/feature/own-shift distinctions and Spanish state copy; add a failing planned Playwright scenario for OPERADOR opening Caja and being denied the payment action until active.
  - [ ] 2. **GREEN:** wire only Treasury/Caja entry and opening to Unit 3; preserve ADMIN/TESORERO behavior and keep negotiation, condonation, agreement-management, and reversal actions absent for OPERADOR.
  - [ ] 3. **TRIANGULATE:** cover direct `/collections` access, stale/duplicate-open response, foreign-shift response, and mobile/keyboard path without inline styles or hard-coded colors.
  - [ ] 4. **REFACTOR:** extract presentational state only where it reduces page complexity. Run planned focused web/Playwright selectors with exact counts, then confirmed shared quality commands.
  - [ ] 1. **RED:** create failing source/route/persistence cases for missing or multiple methods, non-imputable/inactive/group accounts, missing description, fractional/unsafe/overflow amounts, foreign/closed shift, and BANK_DEBIT income rejection.
  - [ ] 2. **GREEN:** add append-only source persistence and routes under the existing Caja authorization/locking model. Store method as validated text—not a database enum—accept income CASH/DEBIT/CREDIT/TRANSFER and expense CASH/DEBIT/CREDIT/TRANSFER/BANK_DEBIT; snapshot code/name/path at write time.
  - [ ] 3. **TRIANGULATE:** prove DEBIT and BANK_DEBIT remain distinct, all non-CASH methods leave expected CASH unchanged, and a later catalog edit cannot change a stored snapshot; verify transaction rollback and idempotent/replay behavior on disposable PostgreSQL.
  - [ ] 4. **REFACTOR:** share exact-cent and account-eligibility validation with close/settlement-ready helpers without permitting split tender or an additional payment. Run planned focused API/disposable-PG selectors and confirmed shared quality commands; UI runtime evidence is **N/A (API-only unit)**.
  - [ ] 1. **RED:** add failing tests for optional absence, one-record maximum, leading zeroes, allowed printed types, note-without-prior-reference, internal unnumbered evidence, additive mismatch, and contained IVA not added twice.
  - [ ] 2. **GREEN:** persist/display transcription against manual sources in the same transaction boundary; preserve printed fields as text and classify taxes from explicit semantics only.
  - [ ] 3. **TRIANGULATE:** prove equal amounts do not infer tax class; rollback a source plus invalid supporting record atomically; prove historical/legacy readers remain readable with absent metadata using disposable PostgreSQL.
  - [ ] 4. **REFACTOR:** keep document validation separate from payment/allocation logic. Run planned focused API/disposable-PG selectors and confirmed shared quality commands; UI runtime evidence is **N/A (API-only unit)**.
  - [ ] 1. **RED:** jointly identify the owner and exact S2 files, then add failing full-payment-only, missing-own-shift, partial/overpayment, replay/concurrency, unsupported-origin, and `Cuotas sociales` snapshot/link tests before edits.
  - [ ] 2. **GREEN:** extend the authoritative settlement transaction only; create/retain exactly one automatic production source with CASH/DEBIT/CREDIT/TRANSFER identity. Do not recapture payment input, map other origins silently, alter finance flows, or add operator reversals.
  - [ ] 3. **TRIANGULATE:** prove competing/replayed calls create neither second settlement/allocation/source nor partial audit state, and that an unsupported new origin rolls back atomically on disposable PostgreSQL.
  - [ ] 4. **REFACTOR:** minimize the integration seam after the agreed ownership handoff; run planned focused route/service/disposable-PG selectors and confirmed shared quality commands. UI runtime evidence is **N/A (API-only unit)**.
  - [ ] 1. **RED:** add failing cases for mixed methods (30,000 CASH income − 5,000 CASH expense − 4,000 TRANSFER expense = 25,000), forged caller transfer/handoff fields, positive/zero/negative states, missing variance reason, exact replay versus changed replay conflict, failed-transfer rollback, source/close contention, and no opening double count.
  - [ ] 2. **GREEN:** lock the shift and all writers, recompute server-side, reject client transfer/handoff/custody input, preserve existing variance safeguards, and atomically persist the close plus unique stable-ID `CLOSE_TRANSFER` account snapshot/read DTO/history. Keep transfer out of operational pre-transfer calculation and out of operating expenses/bank-deposit claims.
  - [ ] 3. **TRIANGULATE:** test physical shortage/surplus with reason while transfer remains computed cash; verify zero creates none, negative blocks normal and recovery close, and concurrent/replayed calls cannot duplicate a close/audit/transfer on real disposable PostgreSQL.
  - [ ] 4. **REFACTOR:** extract closed-history DTO/calculation helpers while retaining append-only behavior and existing finance reversal policy. Run planned focused API/disposable-PG selectors and confirmed shared quality commands; UI runtime evidence is **N/A (API-only unit)**.
  - [ ] 1. **RED:** add rendering/interaction failures for required fields, account eligibility/search, exact one-method matrix, explicit `Tarjeta de débito` versus `Débito bancario`, optional evidence, linked automatic source/totals, non-cash exclusion from expected cash, and no handoff field; add failing planned Playwright flows for success, no-shift, validation, replay/conflict, and negative-close refetch.
  - [ ] 2. **GREEN:** consume the completed endpoints and render only approved Caja/Collections behavior using Premium Tailwind tokens; retain historical absent metadata as absent and do not display `Próximamente` for this authorized journey.
  - [ ] 3. **TRIANGULATE:** exercise mobile/keyboard layout, stale preview/recompute, zero/positive/negative close presentation, variance reason, and a BANK_DEBIT expense that never lowers displayed physical CASH. Assert negotiated/condonation/reversal/CTACTE/bank claims remain absent.
  - [ ] 4. **REFACTOR:** split presentational components/hooks only after all behavior is covered; run planned focused web/Playwright selectors, record exact passed/failed/skipped counts, then confirmed shared quality commands.
  - [ ] 1. Reconcile every unit's recorded RED/GREEN/TRIANGULATE/REFACTOR evidence, migration status, changed-line count, and rollback boundary against the human-selected delivery choice and, if split was selected, its chain strategy. Re-run the confirmed aggregate quality commands from the integrated base.
  - [ ] 2. Run the applicable planned Playwright selectors through the confirmed web E2E command and record exact pass/fail/skip counts. Automated evidence proves only the local/disposable contract.
  - [ ] 3. Leave **QA001 pending** until an authorized live operational observation is separately approved and recorded. Do not replace it with simulation, BETA/production access, secrets, or a synthetic receipt.
- Evidence hash receipt: SHA-256 of `apply-progress.md` immediately after the correction evidence above and before this receipt was appended: `25448f4d371e94fb831986f6ee0b606b0d4dd81e02371ab80978db9f7e0e937d`.

## Unit 2 — Read/search account-chart API

- Completed persisted tasks: Unit 2 tasks 1 RED, 2 GREEN, 3 TRIANGULATE, and 4 REFACTOR are visibly `[x]` in `tasks.md`.
- Changed: `apps/api/src/modules/account-chart/repository.ts`, its disposable-PG integration test, `apps/api/src/routes/account-chart.ts`, its injection test, and `apps/api/src/server.ts` registration.
- GET-only `/api/v1/account-chart` accepts `code`, `name`, `root`, `group`, and explicit `active=true|false`; omitted `active` includes both states. It permits `ADMIN`, `TESORERO`, and `OPERADOR`, rejects unauthenticated/CONSULTA/unknown/oversized/non-boolean queries, and has no writer or feature flag.
- The repository uses a recursive parent-link hierarchy (never code-prefix ancestry), parameterized SQL, literal wildcard escaping, case/accent-normalized code/name substring matching, explicit ancestor-group filtering, and numeric hierarchy ordering. DTOs expose parent/root/path code/name plus active/imputable/eligible metadata.
- RED: route test failed to load the absent route (0 tests); the disposable-PG test failed to load the absent repository (0 tests). Lifecycle `1789354495-961223-cb702818e90b3687` cleaned its container and volume with final absence evidence.
- GREEN: route injection — 2 passed, 0 failed; disposable PostgreSQL repository — 2 passed, 0 failed under lifecycle `1789354593-967542-23af6a0fae895773`.
- TRIANGULATE: no-match, literal wildcard, active/inactive, ancestor group, active imputable Assets/Liabilities, stable order, and `CREDITOS POR VENTAS` accent/case search passed on real PostgreSQL under lifecycle `1789354650-970984-8b6b31b5ffdbccb9`.

### TDD Cycle Evidence

| Task | Test file/layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
| --- | --- | --- | --- | --- | --- | --- |
| Unit 2.1–2 | route injection + disposable PostgreSQL | N/A (new files) | missing route/repository observed | route 2/2; repository 2/2 | catalog filter cases covered | shared parser/DTO helpers retained; 4/4 focused green |
| Unit 2.3 | repository PostgreSQL | 2/2 GREEN | added accent-normalized name case | 2/2 retained | group, inactive, no-match, wildcard paths exercised | Prettier; 4/4 focused green |
| Unit 2.4 | API/package quality | focused 4/4 | N/A (refactor only) | 4/4 focused green | N/A (covered above) | API typecheck/lint/build and repository format check passed |

### Verification and boundary

- `scripts/lib/disposable-postgres.sh run --caller account-chart -- pnpm --filter @athlos/api exec vitest run src/routes/account-chart.test.ts src/modules/account-chart/repository.postgres.integration.test.ts` — 2 files, 4 passed, 0 failed; lifecycle `1789354796-979855-21bc49c8d52fdf63` removed container/volume and verified both absent.
- `pnpm --filter @athlos/api typecheck`, `pnpm --filter @athlos/api lint`, `pnpm --filter @athlos/api build`, and `pnpm format:check` — passed. `typescript-language-server` was unavailable before build, so repository typecheck supplied static analysis. No aggregate runner was repeated: its normal DB lane lacks `ATHLOS_TEST_DATABASE_URL`; the disposable lifecycle above is the candidate database evidence. UI runtime evidence: N/A (API-only).
- Deviation: none. No commit, migration, UI, chart CRUD, Caja movement, other finance route, feature flag, or external service was added.
- Workload/PR boundary: Unit 2 only, stacked-to-main above Unit 1 (`63902fe`); current Unit 2 authored source/test/registration plus persisted task-check changes are 325 changed lines before this evidence, within the 400-line budget. Rollback: remove only the five Unit 2 API files/registration; leave Unit 1's catalog intact and unreadable through this endpoint.
- Structured status consumed: `gentle-ai.sdd-status/v2`; change `caja-accounted-shift-close`; `taskProgress=4/39` at intake; `applyState=ready`; `actionContext.mode=repo-local`; workspace and allowed root `/home/vlongo/Athlos-worktrees/caja-diagnosis`. Warning retained: `/` is a future, unauthorized root and was untouched. QA001 remains pending.
    - Remaining: Unit 3–9 and final-acceptance checkboxes remain `[ ]` in `tasks.md`; the 35-item historical ledger above is superseded for Unit 2's four now-complete lines, while its remaining 31 exact unchecked lines remain unchanged. `tasks.md` is authoritative.

## Unit 3a — Personal OPEN-shift owner migration safety

- Completed persisted tasks: Unit 3a tasks 1 RED, 2 GREEN, 3 TRIANGULATE, and 4 REFACTOR are visibly `[x]` in `tasks.md`. Unit 3 was split into 3a/3b/3c; only 3a was implemented.
- Changed: `0067_personal_cash_shift_owner.sql`, its journal entry, Drizzle index metadata, three migration-frontier tests, the cash-desk disposable PostgreSQL integration test, the normal cash-desk conflict copy, task plan, and this cumulative evidence.
- Behavior: `0067` preflights every duplicate OPEN `assigned_operator_id` before DDL and raises a diagnostic containing the affected shift IDs. It retains `dues_cash_shift_open_desk_unique` temporarily and adds `dues_cash_shift_open_operator_unique` only when the preflight is clean. The normal open conflict now accurately says that either a desk or an operator already has an OPEN shift. It does not delete, close, carry forward, or alter historic shifts, triggers, expiry/recovery, tenders, closes, routes, or authorization.

### TDD Cycle Evidence

| Task | Test file/layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
| --- | --- | --- | --- | --- | --- | --- |
| 3a.1–3 | `cash-desk.postgres.integration.test.ts` / disposable PostgreSQL | API lifecycle: 8/8 passed | Missing `0067` file: 8 passed, 1 failed (`ENOENT`); conflict-copy RED reported the old desk-only message | 9/9 passed after migration and owner-aware conflict copy | Legacy duplicate owner leaves desk index/no owner index; clean/repeat migration and a real concurrent two-client owner race yield exactly one OPEN row | Focused lifecycle remains 9/9 after target-only Prettier |
| 3a.1–4 | journal, schema metadata, and status frontier tests / disposable PostgreSQL | Existing DB tests covered by the named lifecycle | 151 passed, 4 expected failures for missing migration/index/frontier | 155/155 passed | Both named partial indexes and clean/duplicate migration paths are covered | No behavior refactor required; direct diagnostic SQL retained |

### Verification

- RED API: `scripts/lib/disposable-postgres.sh run --caller personal-shift-owner -- pnpm --filter @athlos/api exec vitest run src/modules/dues/cash-desk.postgres.integration.test.ts` — 8 passed, 1 failed because `0067_personal_cash_shift_owner.sql` was absent; lifecycle `1789387405-2286527-20561124c3930b2e` removed its container/volume and reported final absence.
- RED migration frontiers: `pnpm test:disposable-postgres:integration -- packages/db/src/migration-journal.test.ts packages/db/src/schema/dues.test.ts packages/db/src/scripts/status.test.ts` — 151 passed, 4 expected failures for the missing migration, owner index, and `0067` frontier; lifecycle `1789387418-2287683-9ef938f556c97839` cleaned container/volume.
- Final API real-PostgreSQL lifecycle: the same required `personal-shift-owner` command — 1 file, 9 passed, 0 failed; lifecycle `1789387990-2316126-1d3cf127574943a4` removed its container/volume and verified final absence. Its real concurrent two-client insert race committed exactly one OPEN row and rejected the other with `23505`; the service reports the owner-or-desk conflict accurately.
- Final named root disposable integration: the same migration-frontier command — 27 files, 155 passed, 0 failed; lifecycle `1789387633-2299138-d8e82623ca26a555` removed its container/volume and verified final absence.
- `pnpm --filter @athlos/api typecheck && pnpm --filter @athlos/api lint`, `pnpm --filter @athlos/db typecheck && pnpm --filter @athlos/db lint`, and `pnpm --filter @athlos/api build` passed. `typescript-language-server` was unavailable, so repository typechecks were used. `pnpm format:check` and `git diff --check` passed after target-only formatting.

### Boundary, status, and remaining work

- Workload/PR boundary: U3a only, stacked-to-main above Unit 2 (`b3dd68c`); before this evidence the formatted source/migration/test/task delta is 177 additions + 14 deletions = 191 changed lines. Including this cumulative evidence, the full U3a diff is 214 additions + 15 deletions = 229 changed lines. This is below the 400-line budget without compression. No commit, base update, push, PR, UI work, secrets, BETA/production access, or QA001 closure occurred.
- Limitations/deferred: the temporary desk guard remains; different-operator same-desk concurrency, service conflict copy, OPERADOR open/read authorization, routes, payload validation, exact-cents input, Collections actions, manual sources, production capture, close transfer, and all U3b/U3c work remain out of scope.
- Remaining exact delegated lines:
  - [ ] 1. **RED:** add focused service and disposable PostgreSQL tests for same-owner conflict, different-owner same-desk success, and the normal opening conflict message after the desk guard is released.
  - [ ] 2. **GREEN:** release only `dues_cash_shift_open_desk_unique`, preserve the owner guard as the race arbiter, and make the normal opening conflict message accurately describe owner and desk uniqueness outcomes.
  - [ ] 3. **TRIANGULATE:** exercise concurrent same-owner opens and concurrent different-owner same-desk opens on real PostgreSQL; retain one committed owner shift and both permitted different-owner shifts.
  - [ ] 4. **REFACTOR:** isolate the migration/service uniqueness seam without changing legacy tender, close, expiry, recovery, or financial history behavior.
  - [ ] 1. **RED:** add focused route/service failures for foreign-shift read/open denial, own OPEN-shift preflight, and preserved ADMIN/TESORERO recovery/read behavior.
  - [ ] 2. **GREEN:** implement owner-aware preflight/open/read authorization for OPERADOR only; keep routes, Collections actions, payload validation, manual sources, production capture, close transfer, and new reversal behavior out of scope.
  - [ ] 3. **TRIANGULATE:** exercise no-own-shift, existing-own-shift, foreign-shift, and expired-own-shift outcomes without auto-close, delete, or carryover.
  - [ ] 4. **REFACTOR:** extract ownership helpers from legacy tender/close code; run focused API/disposable-PostgreSQL selectors. UI runtime evidence is **N/A (API-only)**.
- Structured status consumed: `gentle-ai.sdd-status/v2` supplied by the parent; change `caja-accounted-shift-close`, artifact store `openspec`, intake `taskProgress=8/39`, `applyState=ready`, delivery `stacked-to-main`, bounded runtime attempt `proceed`. `actionContext.mode=repo-local` restricts changes to `/home/vlongo/Athlos-worktrees/caja-diagnosis` and the supplied edit surfaces; no outside root was touched. CodeGraph watcher reported modified files but `.codegraph` is outside the allowed edit surfaces, so no manual sync was run. QA001 remains pending.

## Unit 3b — Desk uniqueness release and owner-safe opening lifecycle

- Completed persisted tasks: U3b tasks 1 RED, 2 GREEN, 3 TRIANGULATE, and 4 REFACTOR are visibly `[x]` in `tasks.md`; U3c and every later unit remain unchecked.
- Changed: `0068_personal_cash_shift_desk_release.sql` drops **only** `tesoreria.dues_cash_shift_open_desk_unique`; journal/index metadata and frontier tests now end at 0068. `CashDeskService.open` retains idempotent same-key replay/conflict behavior, rejects malformed/non-CASH/fractional/unsafe/overflow opening input, preserves `{}` as no carried opening CASH, preflights a different-key prior personal OPEN with its ID and expired-shift recovery direction, and maps the owner uniqueness race to the same recovery message. No role, route, list/detail, tender, close, expiry/recovery, audit, or history policy changed.
- Real PostgreSQL evidence releases the desk index after the U3a duplicate-owner preflight, retains the owner guard, permits two owners on one desk label, and races same-owner opens to exactly one committed row. Integration fixtures now truncate financial shift rows after each scenario so existing lifecycle coverage obeys the personal-OPEN invariant rather than relying on legacy multi-open test state.

### TDD Cycle Evidence

| Task | Test file/layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
| --- | --- | --- | --- | --- | --- | --- |
| U3b.1–3 | `cash-desk.test.ts` unit + `cash-desk.postgres.integration.test.ts` disposable real PostgreSQL | API unit 5/5 and PostgreSQL 9/9; DB frontiers 40/40 | API: 13 passed, 2 failed (`validateOpeningTenders` absent; 0068 absent); DB: 36 passed, 4 failed for absent 0068/frontier/index metadata | API unit + PostgreSQL 15/15; DB frontier 40/40 | empty/zero/max CASH plus invalid CASH/non-CASH cases; same-owner concurrent race yields one; two owners share a desk | Prettier plus focused API 15/15 and DB 40/40 remained green |
| U3b.4 | focused service/migration seam | 15/15 after GREEN | N/A (refactor-only) | 15/15 | covered above | extracted validation/recovery-message seam; no legacy tender/close changes |

### Verification

- `scripts/lib/disposable-postgres.sh run --caller personal-shift-opening-verify -- pnpm --filter @athlos/api exec vitest run src/modules/dues/cash-desk.test.ts src/modules/dues/cash-desk.postgres.integration.test.ts` — 2 files, 15 passed, 0 failed; lifecycle `1789391432-2476788-579bd7f60e5f2c02` removed its disposable container and volume with absence evidence.
- `scripts/lib/disposable-postgres.sh run --caller personal-shift-opening-frontier-refactor -- pnpm --filter @athlos/db exec vitest run src/migration-journal.test.ts src/schema/dues.test.ts src/scripts/status.test.ts` — 3 files, 40 passed, 0 failed; lifecycle `1789391361-2472720-13751609b53c2d5f` cleaned its disposable resources.
- API and DB typecheck/lint passed; API build passed. `typescript-language-server` was unavailable (`LSP_AVAILABLE=0`), so typecheck was the LSP fallback. `pnpm format:check` and `git diff --check` passed.

### Boundary, status, and remaining work

- Workload/PR boundary: U3b only, stacked-to-main above U3a; current source/migration/test/task diff is 147 additions + 23 deletions = **170 changed lines** before this evidence, below the 400-line budget. No exception, commit, PR, push, base update, external service, BETA/production access, or QA001 closure occurred. Roll back only 0068/journal/schema metadata, opening validation/preflight, and these focused tests; retain U3a owner safety.
- Produced status: `gentle-ai.sdd-status/v2`, change `caja-accounted-shift-close`, artifact store `openspec`, `taskProgress=16/47`, `applyState=ready`, `nextRecommended=verify`, `actionContext.mode=repo-local`; allowed edits remained only within the parent-provided worktree surfaces. Parent owns native attempt settlement. QA001 remains pending.
- Remaining delegated follow-up is U3c only; do not start it in this work unit.
- Evidence receipt: SHA-256 of `apply-progress.md` immediately before this receipt: `090f49240d4e43a6847179578451204b15ea86980bcb89bb196dd4ec2ef1aa8c`.
