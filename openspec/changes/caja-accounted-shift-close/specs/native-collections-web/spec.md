# Delta for Native Collections Web

## ADDED Requirements

### Requirement: Authorized Personal Caja Collections Journey

Treasury/Caja entry and personal-shift opening MUST be available to an OPERADOR without an active shift. The Collections full-payment action alone MUST be exposed to an OPERADOR only in that operator's own active personal shift, and to ADMIN or TESORERO according to their existing permissions. The workspace MUST display actionable Spanish states for no active own shift, existing-own-shift duplicate preflight, foreign-shift denial, payment validation, conflict, replay, and success. An OPERADOR MUST NOT be offered or allowed negotiation approval, agreement-management, or new reversal actions.

#### Scenario: Operator without an active shift is guided safely

- GIVEN an OPERADOR opens Collections without an active personal shift
- WHEN the full-payment action is requested
- THEN the workspace SHALL show a Spanish no-active-shift payment state and an available Treasury/Caja opening path
- AND it SHALL not submit a payment

#### Scenario: Operator cannot approve a negotiation

- GIVEN an OPERADOR views an obligation in Collections
- WHEN the workspace renders available actions
- THEN it MUST NOT render a negotiation-approval or agreement-management action

### Requirement: Linked Production Is Recognizable

The personal Caja view MUST show daily automatic Collections production separately from manual income. Each automatic item MUST expose its source link and payment-method identity, and totals MUST be broken down as CASH, DEBIT, CREDIT, and TRANSFER. A replayed payment MUST remain one linked production item rather than appearing as another manual or automatic income.

#### Scenario: Production breakdown is shown without recapture

- GIVEN an operator has linked CASH and DEBIT Collections payments in an active own shift
- WHEN the operator views production
- THEN the workspace SHALL show the linked sources and separate CASH and DEBIT totals
- AND it SHALL not ask the operator to re-enter either payment

## MODIFIED Requirements

### Requirement: First-Slice Scope Boundary

The workspace MUST add the authorized Treasury/Caja entry and shift-opening journey in the relevant operator context, including without an active shift; full-payment, automatic-production, manual cash-source, and computed-close journeys apply only in the relevant active own-shift context. It MUST add feature-gated agreement and accepted community-work evidence actions only in the relevant obligation context for ADMIN or TESORERO. It MUST NOT add benefits, family, Padrones, arrears dashboards, CTACTE UI/projection/dual-write, ledger redesign, implicit allocation, financial-history mutation/deletion, or changes to existing ADMIN/TESORERO authorization semantics. It MUST NOT render, invoke, or claim CTACTE projection, dual-write, reconciliation, treasury acceptance, bank-ledger integration, or bank-deposit confirmation, and it MUST preserve existing monetary allocation and reversal journeys.

(Previously: The workspace excluded cash shift, close, tender, and reconciliation alongside other first-slice scope.)

#### Scenario: Negotiation remains outside Treasury and CTACTE

- GIVEN an ADMIN or TESORERO records an agreement or accepted community-work evidence
- WHEN the operator reviews the Collections result
- THEN the workspace MUST NOT offer Treasury cash/tender, cash-shift, or reconciliation actions
- AND it MUST NOT present a CTACTE control, request, or reconciliation claim

#### Scenario: Personal Caja remains outside negotiation

- GIVEN an OPERADOR is in the authorized personal Caja journey
- WHEN the workspace renders the available actions
- THEN it SHALL expose only the permitted shift and full-payment actions
- AND it MUST NOT expose agreement or negotiation-approval actions
