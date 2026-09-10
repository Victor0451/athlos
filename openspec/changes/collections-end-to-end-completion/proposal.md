# Complete Collections End to End for Live BETA Acceptance

## Intent

Deliver one coherent, production-shaped collections workflow from active enrollment and effective pricing through obligation assessment, full-installment payment, atomic tender recording, Treasury reconciliation, exact reversal, and approval-backed treatments. The module is complete only when the real QA-001 BETA case passes user acceptance; isolated artifacts, contracts, or tests are necessary evidence but are not sufficient completion.

This proposal preserves the locked product decisions from exploration and organizes acceptance into nine dependency-ordered product stages. Those stages are NOT the implementation/PR budget units: design and tasks pre-split them into 15 smaller reviewable delivery work units, each independently forecast and capped below 400 authored changed lines including tests. The split keeps the CashDesk transaction-aware tender seam separate from payment orchestration/public API, separates approval/request authorization from condonation execution/audit/recovery, and defers Web client/UI to later styled units rather than exposing it in backend atomicity units.

## Outcome

An operator can use a responsive, accessible Gorriti Premium Spanish workflow to:

1. Preview the obligations implied by a member's enrollment and effective pricing.
2. Create only missing obligations through an inclusive cutoff, with correct daily boundary proration.
3. Select one or more installments and settle each selected installment's full outstanding amount with exactly one supported tender.
4. Reconcile that settlement atomically through the existing CashDesk `SETTLEMENT` ledger and reverse the exact operation when required.
5. Keep payment, community work, agreement, and condonation as separate treatments in one visual workflow.
6. Request full-installment condonation as `OPERADOR`, then have Treasury approve or reject it through the existing `approval_tokens` seam with complete requester and approver audit evidence.

No other module proceeds while QA-001 remains unaccepted.

## Problem and Verified Current-State Gap

### Business problem

Collections cannot currently demonstrate that a real enrolled member can progress from enrollment facts to assessed debt, payment, Treasury reconciliation, and approved treatment. This prevents operators from relying on the module and blocks BETA completion.

QA-001 is already active in Natación, but its live financial state has no obligations, payments, or agreements and reports zero debt. That empty result is not proof of successful collection behavior; it is evidence that the end-to-end workflow has not been completed.

### Verified current state

| Area                 | Verified fact                                                                               | Product consequence                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Live member          | QA-001 has an active Natación enrollment since `2026-07-25`                                 | Acceptance must use real enrollment facts rather than an empty or synthetic-only scenario.           |
| Live financial state | QA-001 has no obligations, payments, or agreements; debt is `0`                             | There is no live proof of assessment or collection completion.                                       |
| Base pricing         | `BASE` is `ARS 100`, `FULL_MONTH`, effective `2026-08-01`                                   | Assessment must honor base alta and effective-period boundaries.                                     |
| Sport pricing        | `NATACION` is `ARS 25`, `FULL_MONTH`, effective `2026-08-24`                                | Assessment must honor sport alta/baja and first/last-period proration.                               |
| Schema compatibility | `deportes.inscripciones.fecha_baja` is absent                                               | Code and live schema are incompatible; UI work alone cannot close the gap.                           |
| Migration lineage    | The live Drizzle ledger begins at `0044`, continues through `0048`–`0058`, and omits `0036` | Historical replay is unsafe; compatibility requires a guarded forward migration at the current head. |
| BETA policy          | QA-001 is the mandatory acceptance case                                                     | Completion requires live workflow evidence and user sign-off.                                        |

### Why prior nominal completion is insufficient

Earlier changes established isolated web, club-dues, daily-cash, and negotiated-settlement contracts, but did not prove that their behavior composes in the live BETA workflow. The remaining gap is systemic:

- Migration lineage and the live schema diverge.
- Assessment is command-shaped rather than complete-period-shaped.
- Existing settlement direction permits allocation flexibility that conflicts with the locked full-outstanding contract.
- Collection allocation and Treasury tender recording are not proven to share one transaction.
- Approval decision behavior is incomplete and excludes the `OPERADOR` request path.
- Presentation remains fragmented rather than one responsive, accessible workflow.

The proposal therefore integrates and narrows existing seams instead of declaring completion from isolated artifacts or adding parallel representations.

## Artifact Relationships and Precedence

This change is a scoped reconciliation, not a blanket supersession. This change's full-outstanding selection and accrual-from-alta requirements MUST take precedence over `club-dues-collection-and-daily-cash` only where that change or its canonical result permits partial/manual monetary allocation, configurable lifecycle proration, or `NEXT_PERIOD` postponement across a member or sport lifecycle boundary. Archive or synchronization MUST NOT restore those conflicting behaviors. All unrelated completed behavior from that change, including agreement and accepted community-work feature gates, remains in force.

This change depends on and reconciles the existing scoped-approval and deployment domains: `auth-login` continues to own authorization and scoped approval-token lifecycle, `debt-allocation-settlement` owns condonation eligibility and financial execution, `audit-logger` owns immutable condonation evidence, and `deployment-devops` owns guarded forward compatibility. Those domains MUST be composed through their existing seams and MUST NOT be replaced by parallel approval, audit, financial, or migration state. Other active changes remain authoritative outside these explicit conflicts.

## Target Users and Operator Situations

| User                              | Situation                                                                | Required outcome                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Collections operator (`OPERADOR`) | A member has active enrollment and pricing facts but missing obligations | Preview the exact bounded assessment before creating debt, then create only missing periods.        |
| Collections operator (`OPERADOR`) | A member is paying one or more installments                              | Select full outstanding installments and record one supported tender without manual allocation.     |
| Collections operator (`OPERADOR`) | A settlement must be undone                                              | Reverse the exact settled operation while keeping Collections and Treasury consistent.              |
| Collections operator (`OPERADOR`) | A member requires a non-payment treatment                                | Start community work, agreement, or a full-installment condonation request as a separate operation. |
| Treasury operator                 | A payment is recorded                                                    | Observe the same atomic `SETTLEMENT` tender entry, with correct physicality semantics.              |
| Treasury approver                 | A condonation request is pending                                         | Approve or reject it explicitly, with the financial effect occurring only on approval.              |
| BETA owner and accepting user     | QA-001 reaches the terminal workflow                                     | Validate real behavior and sign off before the module or any later module proceeds.                 |

## Locked Business Rules

These decisions are non-negotiable for this change.

### Enrollment, sport accrual, proration, and backfill

- Assessment uses enrollment and pricing as source facts; neither silently creates a payment.
- A read-only range preview must precede mutation.
- Base assessment must enforce the member alta bound.
- Sport assessment must enforce sport alta and baja bounds.
- Member and sport lifecycles use `[alta, baja)`: alta is included, baja is excluded, and same-day alta/baja yields zero eligible days.
- Every lifecycle boundary month uses daily proration over the month's actual calendar days, rounded to cents with exact halves up; a fully eligible month charges the full unit price.
- Lifecycle proration overrides a legacy `FULL_MONTH` label. An effective legacy `NEXT_PERIOD` price conflicts with accrual from alta and blocks preview until pricing is corrected.
  - Missing or ambiguous applicable pricing blocks the complete preview and execution range; explicit zero pricing remains a valid zero amount.
  - A component-period may contain successive non-overlapping price versions. Intersect `[alta,baja)` with each effective interval; every eligible day must have exactly one price, and any gap or overlap blocks the whole range.
  - Segment contributions use the actual month-day denominator: sum integer numerators `unitAmountCents * eligibleDaysInSegment` across the component-period, then round once to the nearest cent with exact-half-up semantics. Snapshot every segment and its calculation inputs. QA-001 uncovered sport days are never silently backcharged.
  - The through-period cutoff is inclusive.

- Future or inverted ranges are rejected.
- Backfill creates only missing periods and is idempotent; rerunning the same range cannot duplicate obligations.
- Preview and execution are whole-range operations: conflicting reviewed facts or any invalid period blocks mutation without a partial range.
- Schema compatibility is repaired with one guarded forward migration at the current migration head and a deploy-time baseline verifier.
- The verifier accepts only an exact supported predecessor ledger—either the exact contiguous local lineage or the exact observed sparse BETA lineage—and one of two exact `deportes.inscripciones` states: the known sparse pre-state with `fecha_baja`, `baja_motivo`, `updated_at`, `inscripciones_estado_check`, and `inscripciones_baja_metadata_check` all absent; or the compatible state with `fecha_baja date NULL`, `baja_motivo text NULL`, `updated_at timestamptz NOT NULL DEFAULT now()`, a validated `inscripciones_estado_check` using `CHECK (estado IN ('activa', 'pendiente', 'baja'))`, and a validated `inscripciones_baja_metadata_check` using `CHECK (estado <> 'baja' OR (fecha_baja IS NOT NULL AND baja_motivo IS NOT NULL AND btrim(baja_motivo) <> ''))`. Any partial column/type/default/nullability/constraint/validation or ledger mismatch fails closed.
- The forward migration may transform only that exact sparse pre-state or no-op that exact compatible state; historical migration `0036` is never replayed, and historical migration lineage is not rewritten.

### Full-installment selection and tenders

- An operator may select one or more obligations.
- Every selected obligation is settled for its full outstanding amount.
- Manual allocation and partial payment are rejected.
- One atomic payment operation has exactly one tender: `CASH`, `DEBIT`, `CREDIT`, or `TRANSFER`.
- The CashDesk transaction-aware tender seam is a separate backend unit from the atomic payment orchestrator/public API; Web client/UI and styled payment controls land later in stage 7 and are never exposed in backend atomicity units.
- The settled operation supports exact reversal.

### Treasury and financial atomicity

- Collections reuses the existing CashDesk `SETTLEMENT` tender ledger; it does not create another Treasury truth.
- Every `ABONAR CUOTA` tender requires an existing open CashDesk shift.
- `CASH` is a physical tender and contributes to expected physical balance.
- `DEBIT`, `CREDIT`, and `TRANSFER` are electronic, non-physical shift and Treasury tender facts and do not affect expected physical balance.
- Settlement, allocation, and tender recording commit in one database transaction.
- A transaction failure leaves no partial settlement, allocation, or tender record.
- Exact reversal restores Collections and Treasury consistently without introducing a new allocation choice.

### Separate treatments, approvals, and agreement non-effect

- Payment, community work, agreement, and condonation are separate atomic operations presented in one visual workflow.
- Agreement alone does not reduce debt.
- Condonation applies only to full selected installments.
- `OPERADOR` creates a condonation request through the existing `approval_tokens` seam.
- Treasury explicitly approves or rejects the request.
- Request creation has no financial effect.
- Rejection has no financial effect.
- Approval performs the financial action exactly once.
- Requester and approver identities and the decision are auditable.
- The existing approval decision stub must distinguish approval from rejection; it may not consume every token as approved.
- Request/decision authorization is delivered separately from condonation financial execution, audit, and recovery; an approved decision carries the deterministic execution identity to the execution unit.
- No parallel approval store, approval state machine, or condonation representation is introduced.

### CTActe, aesthetics, and P0 exclusivity

- CTActe remains explicit and disabled; there is no implicit CTActe projection.
- Every public UI work unit includes complete Gorriti Premium Spanish responsive and accessible states. Aesthetics and accessibility are delivery requirements, not deferred cleanup.
- QA-001 is the mandatory live BETA acceptance gate.
- This module is the exclusive P0: no other module proceeds until QA-001 receives user sign-off.

## Scope

### In-scope outcomes

- Forward-only schema compatibility for `fecha_baja`, `baja_motivo`, `updated_at`, and the validated lifecycle constraints, guarded for different deployment states.
- Deploy-time verification of the expected migration baseline.
- Read-only assessment range planning and preview.
- Bounded base and sport accrual with daily first/last-period proration.
- Inclusive, future-safe, idempotent missing-period backfill.
- Full-outstanding multi-installment selection with a single supported tender.
- Atomic reuse of the CashDesk `SETTLEMENT` ledger.
- Exact settlement reversal across Collections and Treasury.
- Responsive, accessible Gorriti Premium Spanish debt, preview, payment, error, success, and reversal states.
- One visual treatment workflow with separate payment, community-work, agreement, and condonation operations.
- `OPERADOR` condonation request and Treasury approval/rejection through `approval_tokens`, including audit evidence.
- Live QA-001 execution and explicit user acceptance.

### Explicit non-goals

- Partial payment or manually allocated amounts.
- Multiple tenders in one payment operation.
- Implicit settlement or debt reduction from an agreement.
- Historical migration replay, including replay of `0036`, or migration-history rewriting.
- A parallel approval, Treasury, settlement, or CTActe representation.
- Parallel approval and Treasury state machines.
- Implicit CTActe projection or enabling CTActe.
- Cross-module expansion before QA-001 acceptance.
- Deferring responsive styling, accessibility, or Spanish workflow states to a later cosmetic pass.
- Treating unit tests, generated artifacts, or nominal feature flags as substitutes for live BETA evidence.

## Affected Areas

| Area                                          | Intended effect                                                                                                       |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Enrollment schema and deployment verification | Restore compatibility at the current migration head without replaying history.                                        |
| Assessment domain                             | Add bounded preview and idempotent range execution from enrollment and pricing facts.                                 |
| Obligation selection and settlement           | Narrow payment to full outstanding selected installments and one tender.                                              |
| CashDesk/Treasury integration                 | Reuse `SETTLEMENT` and establish one transaction boundary and exact reversal.                                         |
| Existing `approval_tokens` seam               | Support `OPERADOR` requests, explicit Treasury approve/reject decisions, execution-on-approval, and audit identities. |
| Collections UI                                | Provide one coherent Gorriti Premium Spanish responsive and accessible workflow.                                      |
| BETA operations                               | Execute QA-001 against live facts and retain the P0 block until user sign-off.                                        |

## Delivery Plan: Nine Product Acceptance Stages

These stages define product completeness and acceptance order. They are intentionally stable even when implementation requires more PRs. The design pre-splits them into 15 work units `1, 2A, 2B, 3, 4, 5A, 5B, 6A, 6B, 7A, 7B, 8A, 8B, 8C, 9`; the paired design records each unit's production/test forecast, dependencies, focused command, runtime evidence or explicit N/A, and rollback boundary below the 400-authored-line review budget. The final forecast is 2,340 production lines plus 2,550 test lines, 4,890 authored changed lines total.

| Order | Acceptance stage                               | Outcome and review evidence                                                                                                                                                                                                                                          | Depends on                                |
| ----: | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
|     1 | Forward schema repair and verifier             | Add the guarded current-head compatibility migration for `fecha_baja` and a deploy baseline verifier. Demonstrate fresh-forward and already-compatible behavior without historical replay.                                                                           | None                                      |
|     2 | Read-only range planner and preview            | Produce the exact proposed assessment from enrollment and pricing facts, expose bounds and proration, and reject future periods without mutation.                                                                                                                    | 1                                         |
|     3 | Idempotent cutoff backfill                     | Create only missing obligations through the inclusive cutoff with daily first/last-period proration; repeated execution produces no duplicates.                                                                                                                      | 2                                         |
|     4 | Full-selection payment and tender contract     | Establish and test selected full-outstanding derivation and one supported tender internally. The public payment API, client, and UI remain unavailable until backend atomicity is proven in stage 5 and the styled client/UI lands later in stage 7.                 | 3                                         |
|     5 | Atomic Treasury integration and public payment | 5A establishes the transaction-aware CashDesk tender seam and its rollback proof; 5B consumes that seam in the atomic payment orchestrator and exposes the strict backend payment API. Web client/UI remains later in stage 7; no backend atomicity unit exposes it. | 4                                         |
|     6 | Exact reversal                                 | Reverse the exact settled operation and demonstrate consistent restoration across Collections and Treasury.                                                                                                                                                          | 5                                         |
|     7 | Styled payment and debt UI                     | Deliver responsive, accessible Gorriti Premium Spanish empty, preview, debt, payment, success, failure, and reversal states over the proven contracts.                                                                                                               | 2–6                                       |
|     8 | Unified treatments and approvals UI            | 8A authorizes the authenticated `OPERADOR` request and Treasury approve/reject decision; 8B performs approved condonation execution with audit/recovery; 8C presents the separate treatment lifecycle in the styled UI with no pre-approval financial effect.        | 7 and the existing `approval_tokens` seam |
|     9 | Live BETA QA-001 acceptance                    | Run the complete production-shaped path with QA-001, capture real workflow evidence, and obtain user sign-off or retain the completion block.                                                                                                                        | 1–8                                       |

The acceptance dependency order is mandatory: `1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9`. Delivery follows the finer work-unit graph in design; no acceptance-stage label authorizes combining work units above budget. UI consumes only proven public atomic contracts, and QA-001 is the terminal gate.

## Acceptance Criteria

### Compatibility and assessment

    - [ ] A guarded forward migration at the current head supplies the exact `deportes.inscripciones` compatibility predicate without replaying `0036` or rewriting migration history.
    - [ ] The deploy baseline verifier accepts only the exact supported ledger identities and exact sparse/compatible schema states, transforms only the sparse state or no-ops the compatible state, and blocks any partial or unknown mismatch with an actionable result.

- [ ] Preview is read-only and shows the exact pending range result before mutation.
- [ ] Base accrual respects member alta; sport accrual respects sport alta and baja.
- [ ] First and last applicable periods use daily proration.
- [ ] The cutoff includes the requested through-period and rejects future periods.
- [ ] Backfill creates only missing obligations and a repeated identical execution creates no duplicates.

### Payment, tender, Treasury, and reversal

- [ ] An operator can select one or more obligations only at each obligation's full outstanding amount.
- [ ] Partial and manual allocation attempts are rejected without financial mutation.
- [ ] A payment uses exactly one of `CASH`, `DEBIT`, `CREDIT`, or `TRANSFER`.
- [ ] Settlement, allocation, and CashDesk `SETTLEMENT` tender recording commit atomically.
- [ ] A forced transaction failure leaves no partial truth in Collections or Treasury.
- [ ] `CASH` records physical tender semantics; `DEBIT`, `CREDIT`, and `TRANSFER` record non-physical semantics.
- [ ] Exact reversal identifies and reverses the original settled operation without allocation ambiguity and leaves Collections and Treasury consistent.

### Treatments and approvals

- [ ] Payment, community work, agreement, and condonation remain separate atomic operations in one visual workflow.
- [ ] Creating or maintaining an agreement alone does not reduce debt.
- [ ] An `OPERADOR` can request condonation for full selected installments through `approval_tokens`.
- [ ] Request creation and rejection produce no financial effect.
- [ ] Treasury can explicitly approve or reject rather than routing every decision as approval.
- [ ] Approval performs the condonation exactly once.
- [ ] Requester, approver, decision, and resulting action are auditable.
- [ ] No parallel approval or Treasury state is introduced.

### User experience and boundaries

- [ ] The completed workflow uses Gorriti Premium Spanish copy and is responsive and accessible across empty, preview, debt, payment, success, failure, reversal, treatment, pending-approval, approved, and rejected states.
- [ ] CTActe remains explicit and disabled with no implicit projection.
- [ ] No other module proceeds while the exclusive P0 gate remains open.

### Terminal BETA gate

- [ ] QA-001 uses its live Natación enrollment and effective `BASE` and `NATACION` pricing to produce the expected bounded, prorated obligations.
- [ ] QA-001 completes full-installment settlement with one supported tender and matching Treasury evidence.
- [ ] QA-001 demonstrates exact reversal and the separate treatment/approval behavior required for acceptance.
- [ ] The accepting user reviews the live workflow evidence and explicitly signs off.

**QA-001 live BETA execution and user sign-off are the terminal acceptance gate.** Until both are recorded, the collections module remains incomplete regardless of artifact, implementation, or automated-test status.

## Risks and Implications

| Risk or implication                                                        | Containment                                                                                                                       |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Deployment environments have different migration baselines                 | Use one guarded current-head migration and verify the baseline before application startup; never repair by replaying history.     |
| Missing or incorrect enrollment boundaries produce incorrect debt          | Make schema compatibility a prerequisite and expose alta/baja and proration in the preview before mutation.                       |
| Repeated backfill duplicates debt                                          | Execute only missing periods idempotently and verify repeat behavior.                                                             |
| Existing flexible settlement paths conflict with the full-outstanding rule | Narrow the product contract at the shared settlement boundary; do not preserve manual or partial allocation as a parallel path.   |
| A failed payment leaves Collections and Treasury divergent                 | Keep settlement, allocation, and tender recording in one transaction and prove rollback.                                          |
| Reversal creates a second interpretation of allocation                     | Bind reversal to the exact original operation and restore both ledgers consistently.                                              |
| Approval rejection is treated as approval by the existing stub             | Correct the existing decision seam and prove explicit approval and rejection outcomes.                                            |
| Condonation affects debt before authorization                              | Keep request creation side-effect free; execute only on Treasury approval and audit both actors.                                  |
| Agreement is mistaken for payment                                          | Keep it a separate operation and visibly preserve debt until an authorized financial action occurs.                               |
| UI fragmentation hides domain failures or excludes users                   | Include responsive, accessible Spanish states in the relevant public work units, not as deferred polish.                          |
| Automated checks pass while the real operator path remains broken          | Require captured QA-001 live evidence and user sign-off as the terminal gate.                                                     |
| Exclusive P0 delays unrelated work                                         | Preserve the block intentionally: proceeding elsewhere would declare progress while the mandatory BETA workflow remains unproven. |

## Rollback Principles

- Roll back by delivery work unit and at established domain boundaries; do not introduce a second implementation path as a fallback.
- Never roll back compatibility by replaying or rewriting historical migration lineage. A corrective schema action must remain forward-only and guarded.
- A failed assessment execution must leave the preview available and must not remove or duplicate previously valid obligations.
- A failed payment transaction must roll back settlement, allocation, and tender recording together.
- Reversal must use the exact supported reversal operation; direct ledger edits are not an acceptable rollback mechanism.
- A pending or rejected condonation remains financially inert. If approval execution fails, preserve the auditable decision context without applying a partial financial effect.
- If any delivery work unit fails its evidence boundary, stop dependent work units and retain the prior proven behavior.
- If QA-001 fails or user sign-off is withheld, retain the P0 block and classify the observed workflow failure; do not mark the module complete or bypass acceptance with artifact evidence.

## Success Measures

Success requires observable workflow outcomes, not only completed files or green tests:

1. **Live assessment evidence:** QA-001's real enrollment and effective pricing produce the expected base and sport obligations, with visible bounds, daily proration, inclusive cutoff, and no duplicates on rerun.
2. **Operator payment evidence:** An operator selects multiple obligations, pays their full outstanding amounts with one supported tender, and sees a coherent success state without manual allocation.
3. **Treasury consistency evidence:** The corresponding CashDesk `SETTLEMENT` entry exists in the same committed operation and reports correct physicality for the chosen tender.
4. **Failure atomicity evidence:** A deliberately failed operation leaves neither partial collection allocation nor partial Treasury tender truth.
5. **Reversal evidence:** Reversing the exact operation restores consistent financial state in Collections and Treasury.
6. **Treatment evidence:** Payment, community work, agreement, and condonation are visibly separate; agreement alone leaves debt unchanged.
7. **Approval evidence:** An `OPERADOR` request is financially inert until Treasury decides; rejection remains inert, approval executes once, and requester/approver audit data is visible.
8. **Usability evidence:** The accepting user completes the Spanish responsive workflow across relevant states without inaccessible or unstyled blockers.
9. **Terminal outcome:** The accepting user signs off on the live QA-001 BETA case. Only then is collections complete and the exclusive P0 block released.

Automated tests, migration checks, and artifact review support these measures but cannot independently satisfy measure 9.

## Next Recommendation

Proceed with **spec** and **design** from this proposal:

- The specification should define testable behavior and edge conditions for each locked rule and acceptance criterion.
- The design should map the nine acceptance stages into pre-split delivery work units over existing enrollment, assessment, settlement, CashDesk `SETTLEMENT`, `approval_tokens`, and UI seams without introducing parallel state or reopening product decisions.
