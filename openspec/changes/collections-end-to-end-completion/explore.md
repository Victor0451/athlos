# Collections End-to-End Completion

## 1. Outcome-first executive summary

The collections module is not BETA-complete. The next change must prove one coherent, production-shaped path from active enrollment and pricing through obligation assessment, full-installment payment, atomic tender recording, Treasury reconciliation, and approved treatments. Existing work established isolated contracts, but the live BETA case QA-001 still has no obligations, payments, or agreements.

This exploration locks a forward-only migration repair, bounded assessment semantics, full-selection tendered payments, atomic Treasury integration, exact reversal, unified Spanish responsive UI, and approval-backed condonation. Work is split into nine vertical slices, each at or below 400 authored lines including tests. No other module is in scope until QA-001 is accepted.

The next phase is **proposal**. It must turn these established decisions into a dependency-ordered implementation and acceptance plan without reopening the product decisions below.

## 2. Verified live evidence

| Evidence                 | Observed fact                                                                              | Consequence                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| QA-001 member            | Natación is active and enrolled since `2026-07-25`                                         | The acceptance path starts from a real enrolled member, not a synthetic empty fixture.                                                |
| QA-001 financial state   | No obligations, payments, or agreements exist; debt is `0`                                 | The current system does not demonstrate end-to-end collection completion.                                                             |
| Base pricing             | `BASE` is `ARS 100`, `FULL_MONTH`, effective `2026-08-01`                                  | Assessment must support the base alta bounds and effective-period behavior.                                                           |
| Sport pricing            | `NATACION` is `ARS 25`, `FULL_MONTH`, effective `2026-08-24`                               | Assessment must support sport alta/baja bounds and first/last-period proration.                                                       |
| Enrollment schema        | `deportes.inscripciones.fecha_baja` is absent                                              | The live schema is incompatible with code that requires the baja date; this is a migration-lineage defect, not a UI-only defect.      |
| Drizzle migration ledger | Live ledger begins at `0044`, then continues through `0048`–`0058`; older `0036` is absent | Historical replay is unsafe. Compatibility must be repaired with a new guarded forward migration and a deploy-time baseline verifier. |
| BETA gate                | QA-001 is mandatory BETA acceptance                                                        | Module completion is blocked until the live scenario passes user acceptance.                                                          |

## 3. Prior artifact inventory and drift

| Prior change                          | What it established                         | Drift or proof gap                                                                                                                                              |
| ------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `native-collections-web`              | An isolated collections web contract        | It did not prove that live enrollment, assessment, settlement, and Treasury behavior compose into BETA acceptance.                                              |
| `club-dues-collection-and-daily-cash` | Isolated club-dues and daily-cash contracts | It did not close the missing live obligation/payment path or demonstrate the required atomic tender flow.                                                       |
| `dues-negotiated-settlement`          | An isolated negotiated-settlement contract  | Its flexible allocation direction conflicts with the locked full-outstanding, no-manual-allocation payment contract. It did not prove the complete QA-001 path. |

The drift is systemic rather than a missing final screen: migration history and live schema diverge; assessment is command-shaped instead of complete-period-shaped; settlement permits allocation choices that the product contract does not allow; and UI surfaces are fragmented and unstyled. The new change must integrate or narrow these seams rather than add another parallel collection flow.

## 4. Root-cause clusters and correction boundaries

| Root-cause cluster                    | Evidence                                                                                      | Correction boundary                                                                                                                                                                                             |
| ------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration lineage divergence          | Live Drizzle starts at `0044` and skips `0036`; `fecha_baja` is absent while code requires it | Add one guarded forward compatibility migration at the current head, plus a deploy baseline verifier. Do not replay `0036` or rewrite historical lineage.                                                       |
| Incomplete assessment model           | The current path is monthly-command-only; live pricing has base and sport effective dates     | Add a read-only range planner/preview, explicit base/sport alta and baja bounds, daily first/last proration, inclusive through-period cutoff, future-period rejection, and idempotent missing-period execution. |
| Non-contractual settlement allocation | Existing direction permits partial/manual amounts and does not establish tender atomicity     | Payment selects one or more obligations and settles their full outstanding amounts only. A single operation has exactly one tender: `CASH`, `DEBIT`, `CREDIT`, or `TRANSFER`.                                   |
| Treasury integration gap              | Collection and cash behavior are not proven as one financial transaction                      | Reuse the CashDesk `SETTLEMENT` tender ledger. Settlement, allocation, and tender recording commit in one database transaction; cash is physical and electronic tenders are non-physical.                       |
| Approval and treatment fragmentation  | Existing approval decision route is a stub and approval linking excludes `OPERADOR`           | Extend the existing `approval_tokens` seam. Keep payment, community work, agreement, and condonation as separate atomic operations in one visual workflow.                                                      |
| Presentation fragmentation            | Existing slices do not provide one complete styled responsive workflow                        | Every vertical slice includes its Gorriti Premium Spanish responsive, accessible states; this is not deferred to a cosmetic pass.                                                                               |

A slice may cross clusters only where the table explicitly joins them. No new parallel state machine, approval store, settlement representation, or implicit projection is authorized.

## 5. Current domain/system boundary map

```text
Enrollment facts
  deportes.inscripciones (active/enrolled dates, including required fecha_baja)
          |
          v
Pricing facts -------------> Assessment planner/preview
 BASE and sport rates        bounds, proration, period cutoff
          |                         |
          v                         v
                 Obligations / installments
                          |
              select one or more; full outstanding only
                          |
                          v
                 Collection settlement
        allocation + tender in one database transaction
                          |
                          v
              CashDesk SETTLEMENT tender ledger
          CASH = physical; electronic = non-physical
                          |
                          v
                       Treasury

Separate treatment operations from the same workflow:
 payment | community work | agreement | condonation
                                             |
                                             v
                              approval_tokens
                    OPERADOR requests; Treasury approves/rejects
```

Boundary rules:

- Enrollment and pricing supply facts; they do not silently create a payment.
- Assessment creates missing obligations idempotently and exposes a preview before mutation.
- Settlement owns the full-outstanding selection and exact reversal contract.
- CashDesk/Treasury owns tender ledger semantics; collections must reuse that ledger rather than create a second cash truth.
- Condonation is a request until Treasury approval. A request has no financial effect; approval performs the financial action.
- Agreement alone does not reduce debt.
- CTActe remains explicit and disabled. No implicit CTActe projection is part of this change.

## 6. Locked product decisions

### Assessment

- Provide a range preview before mutation.
- Enforce member alta base bounds and sport alta/baja bounds.
- Apply daily proration to the first and last applicable periods.
- Use an inclusive through-period cutoff.
- Reject future periods.
- Execute missing periods idempotently; rerunning must not duplicate obligations.

### Payments and tender

- Allow selecting one or more obligations.
- Collect the full outstanding amount for every selected obligation.
- Reject manual and partial allocations.
- Permit exactly one tender per atomic operation: `CASH`, `DEBIT`, `CREDIT`, or `TRANSFER`.
- Support exact reversal of the settled operation.

### Treasury and treatments

- Reuse the CashDesk `SETTLEMENT` tender ledger.
- Treat `CASH` as physical and electronic tenders as non-physical.
- Commit settlement, allocation, and tender recording in one database transaction.
- Present one visual workflow with separate atomic operations for payment, community work, agreement, and condonation.
- For condonation, `OPERADOR` requests full selected installments through existing `approval_tokens`; Treasury approves or rejects; approval executes; requester and approver are audited.
- A condonation request has no financial effect before approval.
- Agreement alone does not reduce debt.

### Delivery and acceptance

- Repair compatibility forward from the current migration head; never replay historical migration `0036`.
- Include complete Gorriti Premium Spanish responsive and accessible states in every UI slice.
- Keep CTActe explicit and disabled.
- Treat QA-001 as the mandatory live BETA acceptance gate.
- Keep this module P0-exclusive: no other module proceeds until QA-001 is accepted.

## 7. Reuse seams and known defects

### Approvals: `approval_tokens`

The existing approval-token seam is the integration point for condonation. It already provides the intended approval boundary and audit vocabulary, so a parallel condonation state or approval store would duplicate truth.

Known defects to correct at that seam:

1. The approval decision route is currently a stub that consumes every token as approved. It must distinguish approval from rejection and execute financial effects only for an actual approval.
2. Approval link creation currently excludes `OPERADOR`. The requester role must be able to create the request while Treasury remains the approver.
3. The request must record requester and approver identity for auditability.

The correction must preserve the rule that request creation has no financial effect. Only the approved request executes the selected full-installment condonation.

### CashDesk/Treasury: `SETTLEMENT` tender ledger

CashDesk already provides the ledger seam that collections should reuse. The collection flow must record the tender there, with physicality determined by tender type: `CASH` is physical; `DEBIT`, `CREDIT`, and `TRANSFER` are electronic and non-physical.

Known integration defect: the current work does not prove that settlement allocation and tender recording are one atomic database operation. The Treasury slice must make that transaction boundary explicit and test rollback so no partial financial truth remains.

## 8. Rejected approaches

| Rejected approach                                            | Why it is rejected                                                                                                                                             |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Replay migration `0036` or repair historical migration order | The live ledger does not contain that historical entry; replay risks diverging deployments and corrupting lineage.                                             |
| Keep monthly commands as the assessment model                | It cannot explain the base alta, sport alta/baja, daily proration, inclusive cutoff, future-period rejection, or idempotent range behavior required by QA-001. |
| Preserve negotiated/manual/partial allocation                | It conflicts with the locked full-outstanding payment contract and creates ambiguous debt and tender outcomes.                                                 |
| Create a parallel approval state for condonation             | `approval_tokens` is the existing seam; parallel state would duplicate approval truth and audit behavior.                                                      |
| Make agreement implicitly reduce debt                        | It violates the explicit treatment decision and hides a financial effect behind a non-payment operation.                                                       |
| Add implicit CTActe projection                               | CTActe is explicitly disabled and must remain an opt-in boundary.                                                                                              |
| Defer styling and accessibility until the end                | BETA acceptance includes a usable, responsive, accessible workflow; a cosmetic pass cannot repair fragmented interaction states safely.                        |
| Build one broad cross-module change                          | QA-001 is the exclusive P0 gate. Slices must stay reviewable and complete within the 400-line authored budget.                                                 |

## 9. Nine vertical slices and review budget

Each slice is independently reviewable, includes its behavior-level tests, and targets no more than 400 authored lines including tests. Slices execute in order; later slices do not substitute for acceptance of earlier contracts.

|   # | Slice                                      | Contract and proof boundary                                                                                                                                                            |               Budget |
| --: | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------: |
|   1 | Forward schema repair and verifier         | Add the guarded current-head compatibility migration for `fecha_baja` and a deploy baseline verifier. Prove both fresh-forward and already-at-head behavior without historical replay. | <=400 authored lines |
|   2 | Read-only range planner and preview        | Plan assessment over a requested range, expose bounds and proration, reject future periods, and show the exact pending result before mutation.                                         | <=400 authored lines |
|   3 | Idempotent cutoff backfill                 | Execute missing obligations through the inclusive cutoff, with daily first/last proration and no duplicates on repeat execution.                                                       | <=400 authored lines |
|   4 | Full-selection payment and tender contract | Select one or more obligations, require full outstanding amounts, reject manual/partial amounts, and enforce one supported tender per atomic operation.                                | <=400 authored lines |
|   5 | Atomic Treasury integration                | Reuse CashDesk `SETTLEMENT`; commit allocation and tender together; verify rollback and physical/non-physical tender semantics.                                                        | <=400 authored lines |
|   6 | Exact reversal                             | Reverse the exact settled operation without creating a new allocation ambiguity or leaving Treasury and collections inconsistent.                                                      | <=400 authored lines |
|   7 | Styled payment and debt UI                 | Deliver the responsive, accessible Gorriti Premium Spanish payment/debt states over the proven contracts, including empty, preview, success, failure, and reversal states.             | <=400 authored lines |
|   8 | Unified treatments and approvals UI        | One visual workflow with separate payment, community-work, agreement, and condonation operations; wire `OPERADOR` request and Treasury approve/reject behavior with audit states.      | <=400 authored lines |
|   9 | BETA QA-001 acceptance                     | Run the real end-to-end acceptance path against the live BETA case, including user acceptance. Record the evidence needed to declare module completion or retain the block.            | <=400 authored lines |

The 400-line limit is a review budget, not permission to omit tests or move behavior into an unreviewed helper. A slice that cannot fit must be split at a domain boundary before implementation. QA-001 remains the terminal acceptance evidence for this change.

## 10. Risks and acceptance gate

| Risk                                                     | Containment                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Forward migration differs across environments            | Guard the migration and run a deploy baseline verifier against the live ledger shape before application startup proceeds. |
| Missing or incorrect enrollment dates distort assessment | Treat `fecha_baja` as a compatibility prerequisite and test alta/baja bounds before backfill.                             |
| Repeated assessment creates duplicate debt               | Make missing-period execution idempotent and verify repeated range execution.                                             |
| Partial financial writes remain after a failure          | Keep settlement, allocation, and tender recording in one transaction and test rollback.                                   |
| Condonation is applied before approval                   | Make request creation side-effect free and execute only after Treasury approval.                                          |
| Approval rejection is silently treated as approval       | Replace the decision stub at the existing approval seam and test both outcomes.                                           |
| UI hides contract failures or inaccessible states        | Include complete responsive, accessible Spanish states in slices 7 and 8, not as postscript work.                         |
| Isolated tests pass while BETA remains incomplete        | Make QA-001 live acceptance mandatory and block module completion on user acceptance.                                     |

### Completion gate

The module is complete only when all of the following are true:

- [ ] The live schema is compatible with the code through the guarded forward migration and verifier.
- [ ] QA-001 produces the expected obligations from its real enrollment and pricing facts, with correct bounds, proration, cutoff, and idempotency.
- [ ] QA-001 can settle selected obligations only at full outstanding value with one supported tender.
- [ ] Collections and CashDesk/Treasury agree atomically, including exact reversal.
- [ ] Payment, community work, agreement, and condonation are separate operations in one usable workflow.
- [ ] Condonation requests, approvals/rejections, execution, and requester/approver audit behavior are proven.
- [ ] CTActe remains explicit and disabled.
- [ ] Responsive and accessible Gorriti Premium Spanish states are present for the completed workflows.
- [ ] QA-001 passes live BETA acceptance and user acceptance.

Until the final checkbox is satisfied, this module remains incomplete and no other module is authorized to proceed under the exclusive P0 boundary.

## 11. Next recommendation: proposal

Proceed to the **proposal** phase for `collections-end-to-end-completion`.

The proposal should preserve the locked decisions in this exploration, define the acceptance evidence for each slice, and establish the dependency order from migration compatibility through QA-001. It should explicitly carry forward the two known reuse-seam defects—approval decision semantics and `OPERADOR` request linking—and the requirement that CashDesk/Treasury atomicity be proven rather than assumed.

The proposal should not reopen settled product questions or create a parallel collection, approval, Treasury, or CTActe representation.
