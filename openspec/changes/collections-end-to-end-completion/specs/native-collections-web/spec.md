# Delta for Native Collections Web

## ADDED Requirements

### Requirement: Gorriti Premium Spanish Collections Journey

The Collections workspace MUST present the range preview, itemized debt, full-outstanding selection, single-tender payment, exact reversal, and separate payment, community-work, agreement, and condonation operations using Gorriti Premium visual rules and Spanish operator copy. It MUST provide distinct loading, empty, unavailable-price, validation, permission-denied, conflict, stale-data, pending, rejected, approved, transactional-error, replayed, reversal, and success states without presenting stale or partial data as current financial truth.

#### Scenario: Preview and empty debt states are actionable

- GIVEN an operator opens a member with no pending assessment or no open debt
- WHEN preview or debt data loads
- THEN the workspace MUST show a Spanish empty state that distinguishes no applicable charge, zero pricing, missing pricing, and already-generated periods
- AND it MUST not imply that missing data is a zero balance

#### Scenario: Full-outstanding payment review prevents unsupported input

- GIVEN an operator selects one or more same-currency open obligations
- WHEN payment review is displayed
- THEN the workspace MUST itemize every full outstanding amount and the derived total
- AND it MUST offer exactly one tender choice from `CASH`, `DEBIT`, `CREDIT`, or `TRANSFER`
- AND it MUST not offer partial amounts, manual allocations, or mixed-currency confirmation

#### Scenario: Failure and success reflect committed truth

- GIVEN a payment or reversal is submitted
- WHEN the server reports validation failure, no open cash shift, conflict, rollback, replay, or success
- THEN the workspace MUST render the corresponding actionable Spanish state
- AND it MUST show success only after the complete Collections and CashDesk operation is confirmed

#### Scenario: Stale financial data requires refresh

- GIVEN an obligation, payment, approval, or reversal state changed concurrently
- WHEN the operator acts on stale UI data
- THEN the workspace MUST block confirmation, announce the conflict in Spanish, and require refresh and review
- AND it MUST not optimistically retain a financial success state

### Requirement: Accessible Responsive Treatment and Approval Lifecycle

The Collections workspace MUST preserve all debt, payment, reversal, treatment, and approval information and actions at narrow and wide viewports. Controls MUST have accessible names and keyboard operation; status changes and errors MUST be announced; focus MUST move to recoverable errors or completed results; and status MUST not rely on color alone. The condonation lifecycle MUST visibly distinguish request, pending Treasury review, rejected, approved-and-executed, stale, expired, and replayed outcomes and MUST identify requester and approver where authorized.

#### Scenario: Narrow-screen treatment workflow remains complete

- GIVEN the workflow is displayed at a narrow viewport
- WHEN an operator navigates by keyboard or assistive technology
- THEN every treatment choice, selected installment, amount, tender, decision status, and available action MUST remain perceivable and operable without horizontal information loss

#### Scenario: Approval lifecycle is not confused with payment

- GIVEN an `OPERADOR` submits a condonation request
- WHEN the request is pending, rejected, or approved
- THEN the workspace MUST announce and display the matching Spanish lifecycle state
- AND pending or rejected states MUST continue to show unchanged debt
- AND only confirmed approved execution MAY show the condoned installments as no longer outstanding

### Requirement: Explicit Disabled CTActe Collections Boundary

The workspace MUST keep `CTActe` explicit and disabled. It MUST NOT render, invoke, infer, or claim a `CTActe` projection, dual-write, control, or reconciliation for assessment, payment, reversal, community work, agreement, or condonation.

#### Scenario: Completed operation has no CTActe projection

- GIVEN any supported Collections operation completes
- WHEN its result is displayed
- THEN no `CTActe` control, request, projection, dual-write, or reconciliation claim MUST be present

## MODIFIED Requirements

### Requirement: First-Slice Scope Boundary

The workspace MUST add bounded assessment, explicit full-outstanding payment, CashDesk `SETTLEMENT` tender evidence, exact reversal, and approval-backed condonation only in their relevant Collections contexts. It MUST add agreement and accepted community-work evidence actions only in the relevant obligation context and only while their existing feature gates remain enabled: agreement actions MUST require `NATIVE_COLLECTIONS_WEB_ENABLED` and `DUES_AGREEMENTS_ENABLED`, and accepted community-work actions MUST require the existing Collections negotiation and community-work gates and authorization. It MUST NOT add cash-shift opening or closing, manual monetary allocation, partial monetary payment, implicit obligation selection, mixed-tender payment, benefits, family, Padrones, arrears dashboards, ledger redesign, financial-history mutation or deletion, implicit reconciliation, or any `CTActe` UI, projection, or dual-write. It MUST NOT render, invoke, or claim `CTActe` projection, dual-write, or reconciliation. CashDesk integration MUST remain limited to the existing open-shift requirement plus supported tender and reversal evidence; Treasury approval MUST remain limited to the existing scoped approval seam. The workspace MUST preserve existing agreement, accepted community-work, and unrelated reversal behavior, while conflicting partial/manual monetary allocation behavior is replaced only by explicit full-outstanding selection.

(Previously: The workspace feature-gated agreement and accepted community-work actions, excluded Treasury tender and authorization behavior, and preserved partial/manual monetary allocation.)

#### Scenario: Negotiation gates remain required

- GIVEN an agreement or accepted community-work feature gate is disabled
- WHEN an operator views the relevant obligation
- THEN the gated action MUST remain unavailable
- AND the workspace MUST NOT infer or perform that treatment through payment or condonation

#### Scenario: Collections exposes only supported Treasury seams

- GIVEN an operator completes a payment, reversal, agreement, community-work action, or condonation lifecycle step
- WHEN the result is reviewed
- THEN the workspace MAY show the supported CashDesk shift/tender or Treasury approval evidence for that operation
- AND it MUST NOT offer cash-shift opening or closing, implicit reconciliation, parallel Treasury state, or a `CTActe` action or claim
