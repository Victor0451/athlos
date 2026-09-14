# Implementation plan: accounted personal Caja

The user approved the revised proposal/design and selected progressive, review-sized integration (`stacked-to-main`) after reviewing this plan's forecast. The delivery-size gate is resolved by splitting, not by a size exception. Before implementation, resolve native apply authority and the bounded unit's prerequisites. No task is complete from this plan; commits, PRs, merges, and base updates require separate authorization.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 3,120–4,310 total (sum of the nine unit ranges); 180–600 per work unit |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | Account chart persistence → chart read/search API → personal shifts → Caja/Collections UI → manual sources → supporting records → automatic dues production → computed close → close UI |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main (explicit user selection) |

Decision needed before apply: No (delivery choice resolved; unit prerequisites still apply)
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

**Recorded delivery decision:** The user selected reviewable stages with `stacked-to-main`: progressively integrate separately reviewed units, starting with chart persistence and then its read/search API. No `size:exception` was accepted. This selection authorizes neither publishing nor commits/merges. Re-estimate each unit from the actual base; if it exceeds 400 changed lines, use a safe candidate boundary below or pause for a fresh decision—never omit migration, test, UI, or documentation evidence to fit.

## Candidate safe split boundaries for over-budget units

These are candidates for the human split decision, not an automatic chain. Each slice keeps its migration (when applicable), production behavior, and focused tests together; it must leave the integrated base coherent and must not expose a half-working default feature.

| Unit | Candidate slice A | Candidate slice B | Boundary / verification kept with slice |
|---|---|---|---|
| 3 | Owner-specific OPEN-shift persistence invariant, compatible migration, and disposable-PG lifecycle tests | Owner-aware preflight/open/read API and route tests | A changes no newly exposed UI/API journey; B exposes the complete owner-safe opening journey. |
| 4 | Treasury navigation plus no-shift/personal-shift opening UI, component tests, and opening-flow E2E | Collections payment-action gate/state UI, component tests, and gated-flow E2E | Each slice has a usable route state; no payment action is enabled before the API gate exists. |
| 5 | Append-only manual-source schema/repository validation with disposable-PG tests | Authorized Treasury routes and route tests over the completed writer | A exposes no partial UI; B is the complete authorized API surface. |
| 6 | Optional-record schema/transcription validation and disposable-PG tests | Treasury read/write route integration and route tests | A is additive and source-compatible; B exposes the complete record contract. |
| 7 | Additive automatic-production source-link persistence invariant and disposable-PG tests, after S2 handoff | Authoritative settlement transaction/route integration with its route and replay tests | No settlement behavior changes in A; B is atomic end-to-end. If either honest slice still exceeds budget, pause for `size:exception`. |
| 8 | Additive close-transfer/history persistence invariant and disposable-PG tests | Locked server-computed close service/route behavior with route and concurrency tests | A creates no close command; B exposes only the complete computed-close contract. |
| 9 | Manual-source/catalog/production presentation with component and E2E tests | Computed-close/variance presentation with component and E2E tests | Both consume completed APIs and are independently navigable user journeys. |

## Shared implementation rules

- Strict TDD is mandatory: observe the named focused test fail (**RED**) before production/migration code; make it pass (**GREEN**); add the named boundary/replay/negative case (**TRIANGULATE**); then simplify without behavior change (**REFACTOR**). Record commands and exact pass/fail/skip counts in `apply-progress.md` when apply is authorized.
- **Confirmed package-script commands:** database-backed work uses repository-owned disposable PostgreSQL only: `pnpm test:disposable-postgres:integration -- <planned focused test selector>`; UI work uses `pnpm --filter @athlos/web test:e2e -- <planned spec selector>` (Playwright defaults to headless). `pnpm test:run`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, and `pnpm build` are also confirmed root scripts. The angle-bracket selectors and named future test files in this plan are planned targets, not commands verified by execution in this planning-only pass.
- No in-memory/simulated persistence evidence. API-only units have runtime UI evidence **N/A**; Fastify injection is not a substitute for DB evidence where persistence changes. UI runs record exact passed/failed/skipped counts.
- Each unit finishes with applicable focused tests, then the confirmed shared quality commands above. Generated Drizzle migration artifacts and their journal entry stay with the schema unit.
- Do not update the worktree base, copy/cherry-pick the condonation probe, or treat peer-reported PR #510 (`main` commit `0ba6b3f5a4675866d9eeda383015d7dc4b61424e`) as locally verified. Reconcile it only when an integrator intentionally updates the base.
- Preserve approved boundaries: no chart CRUD or general ledger; no calculated rendition/method changes; validated-text `BANK_DEBIT` is expense-only and distinct from card `DEBIT`; close transfer remains a logical server-computed transfer independent of physical count; no treasury acceptance, bank integration, or new reversals.

## Coordination and blockers

| Item | Type | Required disposition before affected unit |
|---|---|---|
| Current migration number/journal and any adopted #510 changes | Implementation prerequisite | Inspect `packages/db/drizzle/meta/_journal.json`, `packages/db/drizzle/`, and current base; use the next available migration name, never overwrite or recreate another unit's migration. |
| S2 reservation: `apps/api/src/modules/dues/settlement-detail*`, `apps/api/src/routes/dues.ts`, `apps/api/src/routes/dues-routes.test.ts`, and the settlement PostgreSQL test target | Coordination blocker for Unit 7 | Obtain file/behavior ownership and a rebased integration point. This plan makes no claim that the overlap is clear. |
| Role/capability gate for chart read and operator Caja entry | Implementation prerequisite, not a product blocker | Pin it through existing feature/role policy in RED tests; do not invent a new authorization model. |
| QA001 live operational hold | Critical release/product blocker | Remains pending after automated work. It requires its own approved live observation and cannot be closed by disposable PostgreSQL, Fastify, or Playwright. |

## Unit 1 — Account-chart persistence and deterministic seed (first-slice subunit A)

**Estimate:** 300–390 changed lines. **Depends on:** risk-gate decision and migration-base inspection. **Spec:** `specs/account-chart/spec.md` — Seeded Accounting Chart; Approved Dues Production Account (catalog presence only).  
**Start / finish:** start with the approved `account-catalog-input.md` and current journal; finish when one migration creates and seeds the complete five-root hierarchy, including the non-imputable group `4.1` `Ingresos Operativos`, its proposed deterministic active/imputable leaf `4.1.01` `Cuotas sociales`, and `Valores a Depositar`, and a real disposable PostgreSQL query proves parent links and deterministic rows.  
**Files:** `packages/db/src/schema/contabilidad.ts`, `packages/db/src/schema/index.ts`, new `packages/db/src/schema/contabilidad.test.ts`, new `packages/db/src/schema/contabilidad.postgres.integration.test.ts`, new `packages/db/drizzle/<next-index>_plan_cuentas.sql`, `packages/db/drizzle/meta/_journal.json`; source input `openspec/changes/caja-accounted-shift-close/account-catalog-input.md`.

- [x] 1. **RED:** add schema/migration-contract and disposable-PG tests that fail for absent `contabilidad.plan_cuentas`, the five roots, every supplied group/leaf, parent-link hierarchy (not dotted-code parsing), immutable stable code/name/root/active/imputable fields, the non-imputable group `4.1` `Ingresos Operativos`, its proposed deterministic active/imputable leaf `4.1.01` `Cuotas sociales`, and `Valores a Depositar`. Run planned focused Vitest and disposable-PG selectors.
- [x] 2. **GREEN:** define and export the read-only table in `contabilidad.ts`/barrel; create the next available migration after inspecting the journal. It must create appropriate parent/code integrity and seed the complete approved Spanish hierarchy idempotently/deterministically, without CRUD, source records, or GL tables.
- [x] 3. **TRIANGULATE:** prove duplicate migration/seed application does not duplicate rows and prove a group and an inactive/non-imputable row are distinguishable from an active imputable leaf on real PostgreSQL.
- [x] 4. **REFACTOR:** centralize catalog constants only if it prevents seed/schema drift; retain the source-input traceability. Run the confirmed shared quality commands.

**Rollback boundary:** revert only the new plan-cuentas migration/journal entry, `contabilidad.ts` table exports, and its tests; it removes no Caja behavior because no writer exists yet.

## Unit 2 — Read/search account-chart API (first-slice subunit B)

**Estimate:** 180–280 changed lines. **Depends on:** Unit 1. **Spec:** `specs/account-chart/spec.md` — Seeded Accounting Chart; Searchable Valid Movement Accounts (read/filter portion only).  
**Start / finish:** start from the seeded catalog; finish with a GET-only, role/capability-protected catalog endpoint that deterministically filters by code, Spanish name, or root group and returns hierarchy/active/imputable metadata. No selector UI and no chart CRUD.
**Files:** new `apps/api/src/modules/account-chart/repository.ts`, new `apps/api/src/modules/account-chart/repository.postgres.integration.test.ts`, new `apps/api/src/routes/account-chart.ts`, new `apps/api/src/routes/account-chart.test.ts`, `apps/api/src/server.ts`; discovery target for established auth/capability convention: `apps/api/src/routes/treasury.ts` and `apps/api/src/routes/dues.ts`.

- [x] 1. **RED:** write route injection failures for unauthenticated/unauthorized access and query validation, plus a disposable-PG repository failure for code/name/group filters, stable ordering, and inclusion of active imputable leaves under Assets and Liabilities.
- [x] 2. **GREEN:** implement only parameterized read/search and a GET route registration. Make the exact authorized-role/capability choice match the existing Collections/Caja gate discovered above; return no mutation surface or account-selection writer.
- [x] 3. **TRIANGULATE:** add no-match, accent/case normalization (if the approved deterministic contract supports it), group-only, inactive, and non-imputable response cases; prove all queries remain scoped to the seeded hierarchy on disposable PostgreSQL.
- [x] 4. **REFACTOR:** share DTO/filter parsing without weakening Zod validation or authorization. Run planned focused API/disposable-PG selectors and confirmed shared quality commands; UI runtime evidence is **N/A (API-only unit)**.

**Rollback boundary:** revert account-chart repository/route/registration/tests only; Unit 1's seeded catalog remains harmless and unreadable through this endpoint.

## Unit 3a — Personal OPEN-shift owner migration safety

**Estimate:** 240–340 changed lines. **Depends on:** Units 1–2 and migration-base inspection. **Spec:** `specs/accounted-personal-shifts/spec.md` — Personal Shift Ownership and Concurrent Operation.
**Start / finish:** add only the additive owner-specific OPEN uniqueness guard after a non-destructive duplicate-owner preflight. Retain the existing desk OPEN guard until Unit 3b. No service, route, authorization, opening-payload, same-desk-concurrency, history, expiry-trigger, close, carryover, or recovery behavior changes.
**Files:** `packages/db/src/schema/dues-cash.ts`, new `packages/db/drizzle/0067_personal_cash_shift_owner.sql`, `packages/db/drizzle/meta/_journal.json`, `packages/db/src/migration-journal.test.ts`, `packages/db/src/schema/dues.test.ts`, `packages/db/src/scripts/status.test.ts`, and `apps/api/src/modules/dues/cash-desk.postgres.integration.test.ts`.

- [x] 1. **RED:** add failing Drizzle metadata, migration-frontier, and disposable real-PostgreSQL tests for the missing `0067` migration and owner index; fixture two legacy OPEN shifts for one assigned operator on different desks and require a diagnostic that identifies both shift IDs before DDL.
- [x] 2. **GREEN:** add `0067_personal_cash_shift_owner.sql` and its journal entry. The migration SHALL preflight duplicate OPEN `assigned_operator_id` rows before DDL, preserve all rows/triggers/history, retain `dues_cash_shift_open_desk_unique`, and add only `dues_cash_shift_open_operator_unique`; declare both partial indexes under the same SQL names in Drizzle.
- [x] 3. **TRIANGULATE:** prove on disposable PostgreSQL that duplicate legacy owners leave the old desk index intact and no owner index, while a clean migration is repeat-safe and rejects a new same-owner OPEN duplicate across different desks.
- [x] 4. **REFACTOR:** retain the direct, diagnostic migration and focused real-PostgreSQL fixtures without broadening runtime behavior; run the focused API and migration-frontier disposable lifecycles. UI runtime evidence is **N/A (migration-only)**.

**Rollback boundary:** revert only `0067`, its journal entry, the matching Drizzle index declaration, and the focused migration/frontier tests. Do not delete or auto-close historical shifts.

## Unit 3b — Release desk uniqueness and owner-safe lifecycle service

**Estimate:** 260–370 changed lines. **Depends on:** Unit 3a. **Spec:** `specs/accounted-personal-shifts/spec.md` — Personal Shift Ownership and Concurrent Operation.
**Start / finish:** remove the temporary desk OPEN guard only after owner-safe service behavior and real-PostgreSQL concurrency evidence are ready; different operators may then share a desk label while one owner remains limited to one OPEN shift.

- [x] 1. **RED:** add focused service and disposable PostgreSQL tests for same-owner conflict, different-owner same-desk success, and the normal opening conflict message after the desk guard is released.
- [x] 2. **GREEN:** release only `dues_cash_shift_open_desk_unique`, preserve the owner guard as the race arbiter, and make the normal opening conflict message accurately describe owner and desk uniqueness outcomes.
- [x] 3. **TRIANGULATE:** exercise concurrent same-owner opens and concurrent different-owner same-desk opens on real PostgreSQL; retain one committed owner shift and both permitted different-owner shifts.
- [x] 4. **REFACTOR:** isolate the migration/service uniqueness seam without changing legacy tender, close, expiry, recovery, or financial history behavior.

**Rollback boundary:** revert only the desk-index-release migration/service/tests as one reviewed unit; retain Unit 3a's safe owner preflight and constraint.

## Unit 3c — OPERADOR personal Caja open/read boundary

**Estimate:** 250–360 changed lines. **Depends on:** Unit 3b. **Spec:** `specs/accounted-personal-shifts/spec.md` — Shift Authorization Boundaries.
**Start / finish:** permit an OPERADOR to open and read only that operator's personal Caja shift; preserve ADMIN/TESORERO recovery and visibility semantics without introducing a global finance gate or Collections-payment changes.

- [x] 1. **RED:** add focused route/service failures for foreign-shift read/open denial, own OPEN-shift preflight, and preserved ADMIN/TESORERO recovery/read behavior.
- [x] 2. **GREEN:** implement owner-aware preflight/open/read authorization for OPERADOR only; keep routes, Collections actions, payload validation, manual sources, production capture, close transfer, and new reversal behavior out of scope.
- [x] 3. **TRIANGULATE:** exercise no-own-shift, existing-own-shift, foreign-shift, and expired-own-shift outcomes without auto-close, delete, or carryover.
- [x] 4. **REFACTOR:** extract ownership helpers from legacy tender/close code; run focused API/disposable-PostgreSQL selectors. UI runtime evidence is **N/A (API-only)**.

**Rollback boundary:** revert only Unit 3c authorization/preflight/open/read code and tests; retain the owner uniqueness migration and all prior financial history.

## Unit 4a — Caja-first OPERADOR entry, opening, and own-read UI

**Estimate:** 280–390 changed lines. **Depends on:** Unit 3c. **Spec:** `specs/native-collections-web/spec.md` — Authorized Personal Caja Collections Journey; `specs/web-frontend/spec.md` — Capability-Aware Collections Navigation and Protected Routing.
**User-selected slice:** Caja first. OPERADOR receives feature-gated Treasury navigation, entry, opening, and own OPEN-shift read without an active-shift prerequisite. This slice does not change Collections, payment authorization, tender/expense/close/recovery actions, or closed-history component access.
**Files:** `apps/web/src/app/(authed)/tesoreria/page.tsx`, `apps/web/src/app/(authed)/tesoreria/page.test.tsx`, `apps/web/src/lib/navigation.ts`, `apps/web/src/lib/navigation.test.ts`, and new `apps/web/e2e/operator-caja-entry.spec.ts`.

- [x] 1. **RED:** add component/navigation failures for the OPERADOR feature/no-shift/own-shift/foreign distinctions and Spanish stale-duplicate/expired-recovery copy; add the isolated Playwright OPERADOR Caja opening scenario.
- [x] 2. **GREEN:** allow feature-gated Treasury/Caja entry and opening through Unit 3c only. Preserve ADMIN/TESORERO behavior; hide finance-only tender, expense, close, recovery, and closed-history actions from OPERADOR.
- [x] 3. **TRIANGULATE:** cover own-empty/open, stale duplicate, foreign data, command error, and mobile keyboard opening. Do not claim a payment is available merely because Caja is open.
- [x] 4. **REFACTOR:** retain the local presentational role boundary and run focused Vitest plus isolated headless Playwright with exact counts.

**Rollback boundary:** revert only these Treasury/navigation/e2e changes; Unit 3c API remains independently usable by approved callers.

## Unit 4b — Deferred Collections full-payment action gate

**Depends on:** a separately authorized payment API/S2 integration point. Collections changes remain out of scope for the Caja-first slice. An active Caja alone SHALL NOT be presented as payment authorization.

- [ ] 1. **RED:** after S2 ownership is resolved, add focused Collections tests for no-own-active-shift denial and a separately authorized full-payment path.
- [ ] 2. **GREEN:** consume only the completed payment API gate; do not recapture tender, grant finance actions, or claim Caja opening authorizes payment.
- [ ] 3. **TRIANGULATE:** exercise direct Collections access, stale active-shift state, conflict/replay, and mobile keyboard behavior.
- [ ] 4. **REFACTOR:** keep the payment gate isolated from Caja entry and record focused web/Playwright evidence.

**Rollback boundary:** revert only the future Collections payment-gate UI/tests; keep U4a Caja access intact.

## Unit 4c — OPERADOR own closed-history presentation

**Estimate:** 180–290 changed lines. **Depends on:** Unit 3c. **Spec:** `specs/accounted-personal-shifts/spec.md` — Shift Authorization Boundaries; `specs/web-frontend/spec.md` — Capability-Aware Collections Navigation and Protected Routing.
**Start / finish:** expose only an OPERADOR's own CLOSED shift history through the existing GET detail contract. ADMIN/TESORERO retain their current history. Foreign cached rows, role changes, and actor changes MUST neither render a history action nor fetch detail. No Collections, finance writes, payment enablement, or API change is included.
**Files:** `apps/web/src/components/treasury/CashCloseHistoryDetail.tsx`, `apps/web/src/components/treasury/CashCloseHistoryDetail.test.tsx`, `apps/web/src/app/(authed)/tesoreria/page.tsx`, `apps/web/src/app/(authed)/tesoreria/page.test.tsx`, and `apps/web/e2e/operator-caja-entry.spec.ts`.

- [x] 1. **RED:** add focused component/page and isolated headless UI failures for an OPERADOR's own CLOSED history, foreign-row absence, and the existing no-history state; run the named focused Vitest command.
- [x] 2. **GREEN:** permit `ADMIN`/`TESORERO` history as before and an `OPERADOR` only when `shift.assigned_operator_id === actorId`; render only own CLOSED history with the existing GET-on-demand detail, without finance controls or payment actions.
- [x] 3. **TRIANGULATE:** prove foreign cached rows and actor/role transitions neither render nor fetch detail, while own CLOSED history remains readable and cache keys retain actor, role, and shift identity.
- [x] 4. **REFACTOR:** retain the smallest local read-only authorization seam; run the named focused Vitest and isolated headless Playwright commands with exact counts.

**Rollback boundary:** revert only the Unit 4c Treasury history component/page/tests/E2E changes; retain the U3c server owner filter and all U4a opening behavior.

## Unit 5 — Account-linked manual Caja sources and method matrix

**Estimate:** 380–520 changed lines. **Depends on:** Units 1–3. **Spec:** `specs/cash-supporting-records/spec.md` — Account-Linked Manual Sources With One Mandatory Method; BANK_DEBIT Representation Compatibility; `specs/account-chart/spec.md` — Searchable Valid Movement Accounts (writer validation).  
**Start / finish:** start from active imputable account lookup and personal shift lock; finish when append-only manual income/expense accepts one active imputable account, description, positive exact-cent amount, and exactly one validated-text method, saving immutable account snapshots. Supporting-document data is explicitly deferred to Unit 6.
**Files:** `packages/db/src/schema/dues-cash.ts`, `packages/db/src/schema/index.ts`, new `packages/db/drizzle/<next-index>_cash_manual_sources.sql`, journal, new `apps/api/src/modules/dues/cash-sources.ts`, new `apps/api/src/modules/dues/cash-sources.test.ts`, new `apps/api/src/modules/dues/cash-sources.postgres.integration.test.ts`, `apps/api/src/routes/treasury.ts`, `apps/api/src/routes/treasury-routes.test.ts`; discovery target: `apps/api/src/modules/dues/cash-desk.ts` locking/idempotency patterns.

- [ ] 1. **RED:** create failing source/route/persistence cases for missing or multiple methods, non-imputable/inactive/group accounts, missing description, fractional/unsafe/overflow amounts, foreign/closed shift, and BANK_DEBIT income rejection.
- [ ] 2. **GREEN:** add append-only source persistence and routes under the existing Caja authorization/locking model. Store method as validated text—not a database enum—accept income CASH/DEBIT/CREDIT/TRANSFER and expense CASH/DEBIT/CREDIT/TRANSFER/BANK_DEBIT; snapshot code/name/path at write time.
- [ ] 3. **TRIANGULATE:** prove DEBIT and BANK_DEBIT remain distinct, all non-CASH methods leave expected CASH unchanged, and a later catalog edit cannot change a stored snapshot; verify transaction rollback and idempotent/replay behavior on disposable PostgreSQL.
- [ ] 4. **REFACTOR:** share exact-cent and account-eligibility validation with close/settlement-ready helpers without permitting split tender or an additional payment. Run planned focused API/disposable-PG selectors and confirmed shared quality commands; UI runtime evidence is **N/A (API-only unit)**.

**Rollback boundary:** remove only manual-source schema/migration, writer/routes, and their tests; do not remove chart, shift, or legacy tender records.

## Unit 6 — Optional supporting-record transcription

**Estimate:** 360–500 changed lines. **Depends on:** Unit 5. **Spec:** `specs/cash-supporting-records/spec.md` — External Supporting-Document Transcription; Types and Correlation; Internal Supporting Evidence; Optional Tax-Breakdown Transcription.  
**Start / finish:** start from a persisted manual source; finish with zero-or-one optional internal/external supporting record, leading-zero text references, required credit/debit-note correlation, and explicit additive-versus-contained tax semantics. No fiscal issuance, validation, calculation, or new payment.
**Files:** `packages/db/src/schema/dues-cash.ts`, `packages/db/src/schema/index.ts`, new `packages/db/drizzle/<next-index>_cash_supporting_records.sql`, journal, `apps/api/src/modules/dues/cash-sources.ts`, its test/integration targets, `apps/api/src/routes/treasury.ts`, `apps/api/src/routes/treasury-routes.test.ts`.

- [ ] 1. **RED:** add failing tests for optional absence, one-record maximum, leading zeroes, allowed printed types, note-without-prior-reference, internal unnumbered evidence, additive mismatch, and contained IVA not added twice.
- [ ] 2. **GREEN:** persist/display transcription against manual sources in the same transaction boundary; preserve printed fields as text and classify taxes from explicit semantics only.
- [ ] 3. **TRIANGULATE:** prove equal amounts do not infer tax class; rollback a source plus invalid supporting record atomically; prove historical/legacy readers remain readable with absent metadata using disposable PostgreSQL.
- [ ] 4. **REFACTOR:** keep document validation separate from payment/allocation logic. Run planned focused API/disposable-PG selectors and confirmed shared quality commands; UI runtime evidence is **N/A (API-only unit)**.

**Rollback boundary:** revert supporting-record tables/routes/tests only; manual source behavior from Unit 5 remains valid without a document.

## Unit 7 — Atomic automatic dues production

**Estimate:** 380–520 changed lines. **Depends on:** Units 1–3 and **S2 overlap resolution**. **Spec:** `specs/debt-allocation-settlement/spec.md` — Operator Full-Payment Collections Boundary; Linked Automatic Dues Production; `specs/accounted-personal-shifts/spec.md` — Single-Production Collections Capture.  
**Start / finish:** start only after written coordination for the reserved settlement surfaces; finish when an own-active-shift OPERADOR can complete only the existing authoritative full dues payment and its allocation/production/source link/audit commit once, atomically, to the `Cuotas sociales` snapshot with receipt-method totals.
**Files:** reserved/discovery targets `apps/api/src/modules/dues/settlement-detail*`, `apps/api/src/routes/dues.ts`, `apps/api/src/routes/dues-routes.test.ts`, and settlement PostgreSQL test target; expected integration files `apps/api/src/modules/dues/settlements.ts`, `packages/db/src/schema/dues-settlements.ts`, `packages/db/src/schema/dues-cash.ts`, and a next migration/journal entry if the approved source link needs storage.

- [ ] 1. **RED:** jointly identify the owner and exact S2 files, then add failing full-payment-only, missing-own-shift, partial/overpayment, replay/concurrency, unsupported-origin, and `Cuotas sociales` snapshot/link tests before edits.
- [ ] 2. **GREEN:** extend the authoritative settlement transaction only; create/retain exactly one automatic production source with CASH/DEBIT/CREDIT/TRANSFER identity. Do not recapture payment input, map other origins silently, alter finance flows, or add operator reversals.
- [ ] 3. **TRIANGULATE:** prove competing/replayed calls create neither second settlement/allocation/source nor partial audit state, and that an unsupported new origin rolls back atomically on disposable PostgreSQL.
- [ ] 4. **REFACTOR:** minimize the integration seam after the agreed ownership handoff; run planned focused route/service/disposable-PG selectors and confirmed shared quality commands. UI runtime evidence is **N/A (API-only unit)**.

**Rollback boundary:** revert only the agreed settlement-production seam, related migration, and tests as one transaction; preserve prior settlement semantics and Units 1–6.

## Unit 8 — Server-computed close transfer and immutable history

**Estimate:** 430–560 changed lines. **Depends on:** Units 3, 5, and 7. **Spec:** `specs/accounted-personal-shifts/spec.md` — Cash Expectation and Tender Separation; Accountable Positive, Zero, and Negative Close; Physical Count Variance Is Independent of Close Transfer; Atomic, Idempotent, and Immutable Close History.  
**Start / finish:** start from all operational source writers; finish with a locked, idempotent close that recomputes `opening CASH + CASH income − CASH expense`, preserves independent CASH-only count/variance/reason controls, creates exactly one positive immutable `CLOSE_TRANSFER` snapshot to `Valores a Depositar`, creates none at zero, and rejects negative close/refetches with a breakdown.
**Files:** `packages/db/src/schema/dues-cash.ts`, `packages/db/src/schema/index.ts`, new `packages/db/drizzle/<next-index>_cash_computed_close_transfer.sql`, journal, `apps/api/src/modules/dues/cash-desk.ts`, its focused/unit/disposable-PG tests, `apps/api/src/routes/treasury.ts`, `apps/api/src/routes/treasury-routes.test.ts`; discovery target: existing close/recovery test targets and `packages/db/src/schema/contabilidad.ts` account lookup.

- [ ] 1. **RED:** add failing cases for mixed methods (30,000 CASH income − 5,000 CASH expense − 4,000 TRANSFER expense = 25,000), forged caller transfer/handoff fields, positive/zero/negative states, missing variance reason, exact replay versus changed replay conflict, failed-transfer rollback, source/close contention, and no opening double count.
- [ ] 2. **GREEN:** lock the shift and all writers, recompute server-side, reject client transfer/handoff/custody input, preserve existing variance safeguards, and atomically persist the close plus unique stable-ID `CLOSE_TRANSFER` account snapshot/read DTO/history. Keep transfer out of operational pre-transfer calculation and out of operating expenses/bank-deposit claims.
- [ ] 3. **TRIANGULATE:** test physical shortage/surplus with reason while transfer remains computed cash; verify zero creates none, negative blocks normal and recovery close, and concurrent/replayed calls cannot duplicate a close/audit/transfer on real disposable PostgreSQL.
- [ ] 4. **REFACTOR:** extract closed-history DTO/calculation helpers while retaining append-only behavior and existing finance reversal policy. Run planned focused API/disposable-PG selectors and confirmed shared quality commands; UI runtime evidence is **N/A (API-only unit)**.

**Rollback boundary:** revert the computed-close transfer migration/code/routes/tests as one atomic unit; do not delete completed historical close/variance records outside a reviewed rollback migration.

## Unit 9 — Manual-source, production, and computed-close UI

**Estimate:** 430–600 changed lines. **Depends on:** Units 4–8. **Spec:** `specs/native-collections-web/spec.md` — Linked Production Is Recognizable; `specs/web-frontend/spec.md` — Computed-Close and Manual-Method Presentation; Design System and Deferred Features.  
**Start / finish:** start from completed APIs; finish with Spanish manual income/expense forms, catalog search/selection, optional supporting-record UX, separate linked production totals, and an informational computed close display with CASH-only count/variance/reason controls. It must never render/send declared handoff, custody declaration, treasurer approval, or caller-selected transfer.
**Files:** `apps/web/src/app/(authed)/tesoreria/page.tsx`, `apps/web/src/app/(authed)/tesoreria/page.test.tsx`, `apps/web/src/app/(authed)/collections/page.tsx`, its existing test target, new or extracted components under `apps/web/src/components/collections/`, `apps/web/src/components/collections/useCollectionsPayments.tsx`, its test target, `apps/web/e2e/collections-cash-workflow.spec.ts`, `apps/web/e2e/collections.spec.ts`; discovery target: `apps/web/src/components/collections/CollectionPrimitives.ts` and current API client patterns.

- [ ] 1. **RED:** add rendering/interaction failures for required fields, account eligibility/search, exact one-method matrix, explicit `Tarjeta de débito` versus `Débito bancario`, optional evidence, linked automatic source/totals, non-cash exclusion from expected cash, and no handoff field; add failing planned Playwright flows for success, no-shift, validation, replay/conflict, and negative-close refetch.
- [ ] 2. **GREEN:** consume the completed endpoints and render only approved Caja/Collections behavior using Premium Tailwind tokens; retain historical absent metadata as absent and do not display `Próximamente` for this authorized journey.
- [ ] 3. **TRIANGULATE:** exercise mobile/keyboard layout, stale preview/recompute, zero/positive/negative close presentation, variance reason, and a BANK_DEBIT expense that never lowers displayed physical CASH. Assert negotiated/condonation/reversal/CTACTE/bank claims remain absent.
- [ ] 4. **REFACTOR:** split presentational components/hooks only after all behavior is covered; run planned focused web/Playwright selectors, record exact passed/failed/skipped counts, then confirmed shared quality commands.

**Rollback boundary:** revert UI/hooks/e2e tests only; API history and financial behavior remain intact and no UI rollback mutates financial records.

## Final acceptance and release hold

- [ ] 1. Reconcile every unit's recorded RED/GREEN/TRIANGULATE/REFACTOR evidence, migration status, changed-line count, and rollback boundary against the human-selected delivery choice and, if split was selected, its chain strategy. Re-run the confirmed aggregate quality commands from the integrated base.
- [ ] 2. Run the applicable planned Playwright selectors through the confirmed web E2E command and record exact pass/fail/skip counts. Automated evidence proves only the local/disposable contract.
- [ ] 3. Leave **QA001 pending** until an authorized live operational observation is separately approved and recorded. Do not replace it with simulation, BETA/production access, secrets, or a synthetic receipt.
