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
