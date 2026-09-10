# Collections End-to-End Completion — Executable Tasks

## Review Workload Forecast

| Field                   | Value                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| Estimated changed lines | 4,890 total authored lines (2,340 production + 2,550 tests)                                                  |
| 400-line budget risk    | High                                                                                                         |
| Chained PRs recommended | Yes                                                                                                          |
| Suggested split         | PR 1 → PR 2 → PR 3 → PR 4 → PR 5 → PR 6 → PR 7 → PR 8 → PR 9 → PR 10 → PR 11 → PR 12 → PR 13 → PR 14 → PR 15 |
| Delivery strategy       | auto-chain                                                                                                   |
| Chain strategy          | feature-branch-chain                                                                                         |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

**Budget rule:** each unit is one focused child PR/work-unit candidate and MUST stay at or below 400 authored additions + deletions, including its tests and behavior-facing documentation. Re-estimate from the actual diff before apply; split at the stated rollback boundary if it exceeds budget. No `size:exception` is authorized.

## Chain topology and acceptance map

No Git/GitHub state is created by this plan. At apply time, create one draft/no-merge tracker/integration branch and PR targeting `main`; each child PR targets its immediate parent child branch. Only the tracker merges to `main`, and only after QA-001 BETA evidence and explicit user sign-off.

```text
main
└─ tracker/collections-end-to-end-completion (draft/no-merge integration PR)
   └─ child/01-unit-1
      └─ child/02-unit-2a
         └─ child/03-unit-2b
            └─ child/04-unit-3
               └─ child/05-unit-4
                  └─ child/06-unit-5a
                     └─ child/07-unit-5b
                        └─ child/08-unit-6a
                           └─ child/09-unit-6b
                              └─ child/10-unit-7a
                                 └─ child/11-unit-7b
                                    └─ child/12-unit-8a
                                       └─ child/13-unit-8b
                                          └─ child/14-unit-8c
                                             └─ child/15-unit-9
```

| Acceptance stage                                  | Delivery work units |
| ------------------------------------------------- | ------------------- |
| 1. Forward schema repair and verifier             | 1                   |
| 2. Read-only range planner and preview            | 2A, 2B              |
| 3. Idempotent cutoff backfill                     | 3                   |
| 4. Full-selection payment contract                | 4                   |
| 5. Atomic Treasury integration and public payment | 5A, 5B              |
| 6. Exact reversal                                 | 6A, 6B              |
| 7. Styled payment and debt UI                     | 7A, 7B              |
| 8. Unified treatments and approvals UI            | 8A, 8B, 8C          |
| 9. QA-001 live BETA acceptance                    | 9                   |

**Dependency diagram:** `1 → 2A → 2B → 3 → 4 → 5A → 5B → 6A → 6B → 7A → 7B → 8A → 8B → 8C → 9`.

Each child PR must state its parent, current unit, focused verification result, runtime evidence, rollback boundary, and that it excludes unrelated work. A polluted child diff is a base error: retarget/rebase before review; do not mix chain strategies.

## Global execution constraints

- Strict TDD is mandatory: record a failing focused test before production implementation, then GREEN, triangulation, and refactor evidence for every unit.
- Keep tests and behavior/docs in the same unit; do not create a tests-later, styling-later, or accessibility-later unit.
- Preserve unrelated application and OpenSpec changes. Do not replay/edit/insert historical migration `0036`, rewrite migration history, create parallel Treasury/approval/condonation state, or enable/claim CTActe.
- 5A exposes **no** payment route, client, or UI. 5B exposes only the atomic strict backend payment API. 8A is financially inert; 8B alone executes approved condonation; 8C is presentation only.
- The exclusive Collections P0 block remains in force through units 1–8C. Unit 9 may release it only after every QA-001 criterion passes **and** the accepting user explicitly signs off.
- Before synchronizing/archiving this change: reconcile its explicit deltas first; preserve unrelated active deltas; never restore superseded partial/manual monetary allocation, `NEXT_PERIOD` postponement across lifecycle bounds, approve-only token consumption, or allocation-level reversal.

## Work units

### 1. Stage 1 — Guarded compatibility migration and exact baseline verifier (400 lines actual: 247 prod / 153 test)

**Final Unit 1 count:** 400 authored changes (tracked additions + deletions plus complete lines of new Unit 1 source/test files). This is the inclusive work-unit limit, not a size exception.

**Depends on:** none. **Likely files:** `packages/db/drizzle/0059_collections_inscription_compatibility.sql`, `packages/db/drizzle/meta/_journal.json`, `packages/db/src/scripts/collections-baseline.ts`, `packages/db/src/scripts/collections-baseline.test.ts`, `packages/db/src/migration-journal.test.ts`, `scripts/deploy/server-gate.sh`, `scripts/tests/deploy-server-gate.test.bats`.

- [x] **RED:** add failing journal, baseline-classifier, and deploy-preflight tests for exact contiguous and sparse BETA ledgers, exact sparse/compatible schemas, and unsupported hash/timestamp/schema predicates.
- [x] **GREEN:** append one current-head `0059` migration and read-only verifier; accept only exact supported ledgers and exact sparse/compatible states; guard sparse transformation/compatible no-op; run verifier before migration and post-check before startup.
- [x] **TRIANGULATE:** prove no `0036` replay/ledger insertion, partial/unvalidated/wrong-type states fail closed, and unsupported baselines mutate neither schema nor lineage.
- [x] **REFACTOR:** centralize canonical ledger/schema predicate reporting without weakening generic status checks; keep actionable Spanish operator/deploy diagnostics where surfaced.
- [x] Record focused evidence: `pnpm exec vitest run packages/db/src/migration-journal.test.ts packages/db/src/scripts/collections-baseline.test.ts && bats scripts/tests/deploy-server-gate.test.bats` — exact result required.
- [x] Runtime harness: preflight fixtures for contiguous, sparse BETA, compatible, and mismatch states; record classifications and no-mutation result.
- [x] Rollback boundary: revert verifier/deploy wiring and application image only; retain additive `0059` schema/head and correct forward with a later guarded migration if needed.

### 2A. Stage 2 — Price-interval resolver and aggregate math (345 lines: 155 prod / 190 test)

**Depends on:** 1. **Likely files:** `apps/api/src/modules/dues/calculator.ts`, `apps/api/src/modules/dues/range-planner.ts`, `apps/api/src/modules/dues/calculator.test.ts`, `apps/api/src/modules/dues/range-planner.test.ts`.

- [x] **RED:** specify failing pure tests for `[alta,baja)`, same-day zero eligibility, actual-month denominators, boundary override of `FULL_MONTH`, `NEXT_PERIOD` conflict, gaps/overlaps, explicit zero prices, multi-version numerator aggregation, half-up rounding, and QA-001 uncovered NATACION days.
- [x] **GREEN:** implement pure interval segmentation and one-rounding component calculation with ordered segment snapshots and complete-range issues.
- [x] **TRIANGULATE:** add leap/month-length, successive-price, exact-half, overflow, and no-backcharge cases; prove invalid component-days make the full plan non-executable.
- [x] **REFACTOR:** isolate canonical interval/rounding helpers and preserve integer-cent semantics; no API or mutable execution exposure.
- [x] Record focused evidence: `pnpm exec vitest run apps/api/src/modules/dues/calculator.test.ts apps/api/src/modules/dues/range-planner.test.ts` — exact result required.
- [x] Runtime harness: **N/A** — pure domain/fixture boundary; PostgreSQL overlap behavior is owned by 2B.
- [x] Rollback boundary: remove resolver/calculator seam before preview exposure.

### 2B. Stage 2 — Planner repository and read-only preview API (365 lines: 180 prod / 185 test)

**Depends on:** 1, 2A. **Likely files:** `apps/api/src/modules/dues/repository.ts`, `apps/api/src/modules/dues/service.ts`, `apps/api/src/routes/dues.ts`, `apps/api/src/modules/dues/repository.test.ts`, `apps/api/src/routes/dues-assessments.test.ts`.

- [x] **RED:** add failing repository/route tests for interval-overlap candidates, inclusive non-future ranges, complete itemized preview/fingerprint, existing-obligation status, and preview zero mutation.
- [x] **GREEN:** add member-scoped fact queries and authenticated `POST /api/v1/dues/assessments/preview`; return complete plan/issues/fingerprint without obligation writes.
- [x] **TRIANGULATE:** seed covered, zero, uncovered, overlapping, already-generated, inverted, and future cases; assert every issue is retained and no partial subrange is offered.
- [x] **REFACTOR:** keep planner ownership in service and routes DTO-only; preserve finance authorization and Spanish diagnostics contract where returned to operators.
- [x] Record focused evidence: `pnpm exec vitest run apps/api/src/modules/dues/repository.test.ts apps/api/src/routes/dues-assessments.test.ts` — exact result required.
- [x] Runtime harness: authenticated seeded preview for zero/covered/uncovered/overlapping prices; capture response and confirm no obligation rows (typed unavailable: `ATHLOS_TEST_DATABASE_URL` is not configured in this executor).
- [x] Rollback boundary: remove preview route/service adapter; data remains unchanged.

### 3. Stage 3 — Atomic idempotent range backfill (365 lines: 170 prod / 195 test)

**Depends on:** 2B. **Likely files:** `apps/api/src/modules/dues/service.ts`, `apps/api/src/modules/dues/repository.ts`, `apps/api/src/routes/dues.ts`, `apps/api/src/modules/dues/range-execution.test.ts`, `apps/api/src/modules/dues/service.test.ts`.

- [x] **RED:** add failing tests for reviewed fingerprint parity, inclusive missing-period insertion, ordered segment snapshots, same-key replay, changed facts, concurrent execution, zero/already-generated results, and mid-range failure rollback.
- [x] **GREEN:** implement authenticated range execute with idempotency claim, deterministic locks, source re-read/fingerprint comparison, transaction-aware insertion, receipt/audit, and all-or-nothing creation.
- [x] **TRIANGULATE:** execute a seeded multi-period plan twice, vary enrollment/pricing/existing facts, and force each persistence failure; assert zero partial obligations.
- [x] **REFACTOR:** expose `insertObligationInTransaction` and retain only safe standalone wrapper use; prevent nested transactions.
- [x] Record focused evidence: `pnpm exec vitest run apps/api/src/modules/dues/service.test.ts apps/api/src/modules/dues/range-execution.test.ts` — exact result required.
- [x] Runtime harness: isolated local PostgreSQL 16 executes seeded multi-period range twice; record created set, exact replay, overlap conflict-safety, and zero-row rollback after audit failure.
- [x] Rollback boundary: remove execution route/orchestrator; preserve previously valid obligations and preview.

### 4. Stage 4 — Internal full-payment contract and legacy public withdrawal (335 lines: 150 prod / 185 test)

**Depends on:** 3. **Likely files:** `apps/api/src/modules/dues/allocations.ts`, `apps/api/src/modules/dues/settlements.ts`, `apps/api/src/routes/dues.ts`, `apps/api/src/modules/dues/selection.test.ts`, `apps/api/src/routes/settlement-routes.test.ts`.

- [x] **RED:** write failing internal tests for explicit non-empty unique IDs, one currency, open positive balances, server-derived full amounts, stable selection fingerprint, and stale/racing rejection; add route-registration absence tests.
- [x] **GREEN:** implement locked `selectFullOutstanding` and internal command without caller amounts; withdraw legacy public monetary registration/reject it unavailable while preserving non-cash community work.
- [x] **TRIANGULATE:** cover paid, mixed-currency, duplicate, implicit, manual/partial/over-allocation, and concurrent selections; assert no financial mutation.
- [x] **REFACTOR:** isolate selection validation from future transaction ownership; do not add client/UI replacement here.
- [x] Record focused evidence: `pnpm exec vitest run apps/api/src/modules/dues/selection.test.ts apps/api/src/routes/settlement-routes.test.ts` — exact result required.
- [x] Runtime harness: authenticated legacy/new monetary requests remain unavailable; internal integration alone derives full balances.
- [x] Rollback boundary: remove internal seam only; never restore a non-atomic public payment route.

### 5A. Stage 5 — CashDesk transaction-aware settlement tender seam (300 lines: 140 prod / 160 test)

**Depends on:** 4. **Likely files:** `apps/api/src/modules/dues/cash-desk.ts`, `apps/api/src/modules/dues/cash-desk.test.ts`, `apps/api/src/modules/dues/cash-desk-transaction.test.ts`.

- [x] **RED:** add failing seam tests proving caller-owned transaction use, open-shift requirement for every tender, physical CASH, non-physical DEBIT/CREDIT/TRANSFER, and forced seam failure.
- [x] **GREEN:** implement `recordSettlementTenderInTransaction(db, input)` with closed tender/physicality mapping and `SETTLEMENT` correlation; it MUST NOT start a nested transaction.
- [x] **TRIANGULATE:** test all four tenders, invalid tender, closed/missing shift, reconciliation totals, and injected failure with no persisted tender.
- [x] **REFACTOR:** retain Treasury-owned wrapper compatibility while making Collections consume only the in-transaction seam.
- [x] Record focused evidence: `pnpm exec vitest run apps/api/src/modules/dues/cash-desk.test.ts apps/api/src/modules/dues/cash-desk-transaction.test.ts` — exact result required.
- [x] Runtime harness: seeded open-shift seam for all tenders plus forced failure; **no payment route, Web client, or UI may exist/expose in this unit**.
- [x] Rollback boundary: remove only transaction-aware seam/tests; public payment remains unavailable.

### 5B. Stage 5 — Atomic payment orchestrator and strict backend API (395 lines: 190 prod / 205 test)

**Depends on:** 4, 5A. **Likely files:** `apps/api/src/modules/dues/settlements.ts`, `apps/api/src/modules/dues/allocations.ts`, `apps/api/src/routes/dues.ts`, `apps/api/src/modules/dues/settlements.test.ts`, `apps/api/src/routes/dues-settlements.test.ts`.

- [ ] **RED:** add failing transaction/route tests for strict DTO rejection, open-shift enforcement, every tender, atomic settlement/allocation/tender/audit writes, idempotency, stale concurrency, and forced failures at each write.
- [ ] **GREEN:** make `SettlementService.create` the single transaction owner; invoke 5A seam, register only the strict backend payment API, and derive all amounts server-side.
- [ ] **TRIANGULATE:** prove CASH changes expected physical balance while electronic tender facts do not; test replay/conflicting idempotency keys and zero partial rows/audits after failure.
- [ ] **REFACTOR:** share transaction-aware repository interfaces; reject `amount_cents`, `allocations`, `currency`, `kind`, multiple tenders, and unknown DTO fields.
- [ ] Record focused evidence: `pnpm exec vitest run apps/api/src/modules/dues/settlements.test.ts apps/api/src/routes/dues-settlements.test.ts` — exact result required.
- [ ] Runtime harness: authenticated payments on open shifts for all four tenders plus forced rollback; **Web client/UI is N/A and must not be added here**.
- [ ] Rollback boundary: remove route/orchestrator together; reverse already committed payments through the supported reversal flow, never row edits.

### 6A. Stage 6 — Reversal domain and Treasury correlation (365 lines: 170 prod / 195 test)

**Depends on:** 5B. **Likely files:** `apps/api/src/modules/dues/settlements.ts`, `apps/api/src/modules/dues/allocations.ts`, `packages/db/src/schema/dues-settlements.ts`, `apps/api/src/modules/dues/reversal.test.ts`, `apps/api/src/modules/dues/reversal-correlation.test.ts`.

- [ ] **RED:** add failing domain/integration tests for one whole-operation reversal, exact allocations/tender correlation, uniqueness, duplicate/concurrent handling, and reversal failure preserving original posting.
- [ ] **GREEN:** lock original settlement, allocations, and correlated `SETTLEMENT` tender; create one compensating settlement, allocations, tender, and append-only audit in one transaction.
- [ ] **TRIANGULATE:** cover missing/mixed/incomplete/non-monetary/already-reversed sources and multi-allocation payments; assert no allocation choice is accepted.
- [ ] **REFACTOR:** add only necessary source/reversal uniqueness constraints/indexes and retain immutable ledger semantics.
- [ ] Record focused evidence: `pnpm exec vitest run apps/api/src/modules/dues/reversal.test.ts apps/api/src/modules/dues/reversal-correlation.test.ts` — exact result required.
- [ ] Runtime harness: service-level reversal of seeded multi-obligation payment; record restored debt and compensating tender correlation.
- [ ] Rollback boundary: remove unexposed reversal service/schema adapter; retain append-only posted facts.

### 6B. Stage 6 — Reversal API and idempotency contract (325 lines: 145 prod / 180 test)

**Depends on:** 6A. **Likely files:** `apps/api/src/routes/dues.ts`, `apps/web/src/lib/api/dues.ts`, `apps/api/src/routes/dues-reversal.test.ts`, `apps/web/src/lib/api/dues.test.ts`.

- [ ] **RED:** add failing route/client contract tests for `POST /api/v1/dues/settlements/:id/reverse`, mandatory non-empty reason/idempotency, no allocation/tender selection, replay, and auth failures.
- [ ] **GREEN:** expose exact reversal API and typed client decoder only; return original/reversal correlation and committed outcomes.
- [ ] **TRIANGULATE:** test conflict, retry, already-reversed, malformed DTO, and forced rollback outcomes without false success.
- [ ] **REFACTOR:** centralize result mapping; retain no styled action UI until 7B.
- [ ] Record focused evidence: `pnpm exec vitest run apps/api/src/routes/dues-reversal.test.ts apps/web/src/lib/api/dues.test.ts` — exact result required.
- [ ] Runtime harness: authenticated original-payment review and exact reversal API journey; styled UI remains deferred to 7B.
- [ ] Rollback boundary: remove reversal route/client contract together; committed reversals remain append-only.

### 7A. Stage 7 — Gorriti Premium styled preview and itemized debt shell (335 lines: 155 prod / 180 test)

**Depends on:** 2B, 3, 6B. **Likely files:** `apps/web/src/app/(authed)/collections/page.tsx`, `apps/web/src/components/collections/GenerationPanel.tsx`, `apps/web/src/components/collections/DebtPanel.tsx`, related component tests, `apps/web/e2e/collections.spec.ts`.

- [ ] **RED:** add failing component/accessibility tests for Spanish loading, empty/no-charge/zero/missing-price/already-generated/preview/stale/error states; narrow/wide semantic equivalence and no CTActe controls.
- [ ] **GREEN:** deliver presentational range preview and itemized debt shell with Gorriti Premium primitives, responsive table/card equivalence, labels, keyboard order, visible focus, and `aria-live` status.
- [ ] **TRIANGULATE:** exercise narrow and wide screens, screen-reader names, focus to recoverable errors/results, and stale refresh behavior; retain all period/component calculations.
- [ ] **REFACTOR:** keep `CollectionsPage` as typed state container and presenters free of financial derivation/fetching.
- [ ] Record focused evidence: `pnpm exec vitest run apps/web/src/components/collections/GenerationPanel.test.tsx apps/web/src/components/collections/DebtPanel.test.tsx` — exact result required.
- [ ] Runtime harness: Playwright narrow/wide preview and debt-read journey; capture accessibility/state evidence.
- [ ] Rollback boundary: remove new presenters/container wiring; proven backend contracts remain available.

### 7B. Stage 7 — Gorriti Premium payment, confirmation, and reversal UI (345 lines: 155 prod / 190 test)

**Depends on:** 5B, 6B, 7A. **Likely files:** `apps/web/src/app/(authed)/collections/page.tsx`, `apps/web/src/lib/api/dues.ts`, `apps/web/src/components/collections/SettlementActions.tsx`, reversal presenters/tests, `apps/web/e2e/collections.spec.ts`.

- [ ] **RED:** add failing UI/accessibility tests for same-currency checkbox selection, read-only full balances/derived total, exactly-one tender radio group, confirmation/reversal reason, open-shift/stale/rollback/replay/success states, and focus management.
- [ ] **GREEN:** wire styled Spanish payment and reversal presenters to 5B/6B contracts; show success only after committed refresh; expose no amount inputs, manual allocations, cash-shift controls, or CTActe claims.
- [ ] **TRIANGULATE:** test all tender labels, mixed-currency prevention, keyboard/narrow viewport operation, concurrent stale refresh, and exact original settlement/tender display.
- [ ] **REFACTOR:** keep financial state server-derived and confirmation/reversal dialogs on shared accessible primitives.
- [ ] Record focused evidence: `pnpm exec vitest run "apps/web/src/app/(authed)/collections/page.test.tsx" apps/web/src/components/collections/SettlementActions.test.tsx` — exact result required.
- [ ] Runtime harness: Playwright payment/reversal journey over atomic APIs, including decoder failure/replay states.
- [ ] Rollback boundary: remove action presenters/client wiring together; financial records remain authoritative.

### 8A. Stage 8 — Scoped approval decision and OPERADOR request authorization (265 lines: 120 prod / 145 test)

**Depends on:** 7B and existing `approval_tokens` seam. **Likely files:** `packages/db/src/schema/approval-tokens.ts`, `packages/approval/src/service.ts`, `apps/api/src/routes/approval.ts`, `apps/api/src/routes/dues.ts`, `packages/approval/src/service.test.ts`, `apps/api/src/routes/approval.test.ts`.

- [ ] **RED:** add failing tests for authenticated OPERADOR request eligibility/snapshot/expiry, requester separation, authenticated Treasury explicit approve/reject, expired/used/concurrent denial, and request/rejection audit metadata.
- [ ] **GREEN:** extend existing tokens (not a new table/state machine) with scoped snapshot, explicit decision actor/reason/evidence, requester identity, deterministic execution identity, and authenticated routes.
- [ ] **TRIANGULATE:** prove unauthorized requests, self-decision, token access, invalid lifecycle, and decision races do not approve/execute; prove approval/rejection outcomes are durable and auditable.
- [ ] **REFACTOR:** replace approve-only consumption/business-action stub without changing unrelated token actions; redact secret token data from DTOs.
- [ ] Record focused evidence: `pnpm exec vitest run packages/approval/src/service.test.ts apps/api/src/routes/approval.test.ts` — exact result required.
- [ ] Runtime harness: authenticated OPERADOR request and Treasury approve/reject against PostgreSQL; verify **no** settlement, allocation, condonation, or CashDesk rows. This unit is financially inert.
- [ ] Rollback boundary: remove scoped request/decision wiring; pending/rejected requests remain inert.

### 8B. Stage 8 — Approved condonation execution, audit, and recovery (345 lines: 155 prod / 190 test)

**Depends on:** 3, 6A, 8A. **Likely files:** `apps/api/src/modules/dues/condonation-execution.ts`, `apps/api/src/modules/dues/allocations.ts`, `packages/audit/src/emitter.ts`, `apps/api/src/routes/audit.ts`, execution/audit tests.

- [ ] **RED:** add failing tests for approved snapshot revalidation, full same-currency atomic condonation, stale/paid/missing/mixed denial, forced no-effect failure, exact-once replay/concurrency, and recovery under one execution identity.
- [ ] **GREEN:** execute only a locked approved decision; revalidate every snapshot balance, apply the explicit non-cash condonation atomically, and commit successful financial/audit evidence together.
- [ ] **TRIANGULATE:** prove rejection/request remain inert, stale blocks the full selection, failure leaves no partial financial facts, recovery returns one lineage, and no CashDesk tender is created.
- [ ] **REFACTOR:** preserve token-owned state and append-only audit links for requester, approver, decision, evidence, revalidation, execution, failure, replay, and recovery.
- [ ] Record focused evidence: `pnpm exec vitest run apps/api/src/modules/dues/condonation-execution.test.ts packages/audit/src/emitter.test.ts` — exact result required.
- [ ] Runtime harness: PostgreSQL approved execution, stale rejection, injected failure, and same-identity recovery; capture audit/financial correlation.
- [ ] Rollback boundary: remove execution/recovery adapter; committed condonations remain append-only and are never directly edited.

### 8C. Stage 8 — Gorriti Premium unified treatments presentation (335 lines: 150 prod / 185 test)

**Depends on:** 7B, 8B. **Likely files:** `apps/web/src/app/(authed)/collections/page.tsx`, `apps/web/src/components/collections/TreatmentWorkspace.tsx`, `apps/web/src/components/collections/CondonationLifecycle.tsx`, treatment tests, `apps/web/e2e/collections.spec.ts`.

- [ ] **RED:** add failing Spanish UI/accessibility tests for four separately named treatments, gates, agreement debt neutrality, pending/rejected unchanged debt, approved-executed refresh, requester/approver visibility, and stale/expired/replayed/recovery states.
- [ ] **GREEN:** present payment, community work, agreement, and condonation lifecycle with complete responsive/accessibility states using proven APIs only.
- [ ] **TRIANGULATE:** cover narrow/wide keyboard journeys, denied gates, status announcements, focus recovery, and no implicit treatment/CTActe action.
- [ ] **REFACTOR:** retain container/presenter separation and shared Gorriti Premium primitives; do not authorize, execute, or audit financial effects in this unit.
- [ ] Record focused evidence: `pnpm exec vitest run apps/web/src/components/collections/TreatmentWorkspace.test.tsx apps/web/src/components/collections/CondonationLifecycle.test.tsx` — exact result required.
- [ ] Runtime harness: Playwright pending/rejected/approved/stale treatment journey; confirm this unit is presentation only.
- [ ] Rollback boundary: remove treatment workspace wiring; preserve existing gated agreement/community-work behavior and backend truths.

### 9. Stage 9 — QA-001 live BETA acceptance evidence and terminal gate (100 lines: 60 prod / 40 test)

**Depends on:** 1–8C. **Likely files:** `apps/api/src/modules/dues/qa-001-smoke.test.ts`, `openspec/changes/collections-end-to-end-completion/qa-001-evidence.md`, existing safe operational/runbook locations if discovered during apply.

- [ ] **RED:** add a failing smoke/gate test proving completion cannot be recorded without complete QA-001 evidence and explicit accepting-user sign-off.
- [ ] **GREEN:** add privacy-safe evidence template/gate support recording revision, baseline/post-check, range expected/actuals, idempotent replay, payment/tender physicality, reversal, treatment/approval results, and sign-off status.
- [ ] **TRIANGULATE:** execute QA-001 against live BETA facts: real Natación enrollment; effective BASE/NATACION prices; bounded/prorated obligations/no duplicates; one full tendered payment with CashDesk evidence; exact reversal; separate treatment behavior; inert request/rejection; approved exact-once condonation.
- [ ] **REFACTOR:** ensure evidence excludes raw approval tokens and unnecessary member PII and clearly distinguishes automated support from live acceptance.
- [ ] Record focused evidence: `pnpm exec vitest run apps/api/src/modules/dues/qa-001-smoke.test.ts` — exact result required.
- [ ] Runtime harness: mandatory live QA-001 BETA run; record all expected/actual evidence in `qa-001-evidence.md`.
- [ ] **Acceptance hold:** obtain explicit accepting-user sign-off. Until it is recorded, retain evidence, keep Collections incomplete, and keep the exclusive P0 block; no task may release it earlier.
- [ ] Rollback boundary: retain failed evidence/P0 hold; financial correction uses exact reversal only, never direct ledger edits.

## Scoped OpenSpec reconciliation and sync order

- [ ] Before apply, read active artifacts only to identify explicit overlap; preserve unrelated deltas and application changes.
- [ ] During apply, this change supersedes only conflicting monetary partial/manual allocation, lifecycle-label postponement, approve-only decision behavior, and allocation-level reversal contracts listed in proposal/design.
- [ ] After unit evidence is complete, reconcile this change's specs/design/tasks against `club-dues-collection-and-daily-cash`, `native-collections-web`, `dues-negotiated-settlement`, `auth-login`, `debt-allocation-settlement`, `audit-logger`, and `deployment-devops` only at the named seams.
- [ ] Sync in dependency order: compatibility/deploy → assessment → payment/Treasury/reversal → approval/audit → Web presentation → QA-001 evidence. Do not restore conflicting active deltas while syncing.
- [ ] Before archive, verify no reconciliation reintroduced partial/manual payment, `NEXT_PERIOD` postponement, approve-only consumption, allocation-level reversal, parallel state, or CTActe behavior; retain unrelated agreements, accepted community-work gates, shifts/expenses/close, generic audit, and deployment controls.
