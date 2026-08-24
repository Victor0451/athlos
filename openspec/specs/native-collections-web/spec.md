# Native Collections Web Specification

## Purpose

Provide the first accessible native Collections operator workspace without CTACTE.

## Requirements

### Requirement: Collection Workspace States and Rollout

The workspace MUST expose pricing, generation, debt, allocation, and reversal journeys with loading, empty, not-found, unavailable, conflict, replayed, and success states. It MUST remain disabled until API, role-denial, accessibility, and responsive checks pass; with CTACTE projection disabled, it MUST NOT render or invoke CTACTE projection, dual-write, or reconciliation.

#### Scenario: Operator receives a replayed result
- GIVEN an authorized operator repeats a completed command with its original key
- WHEN the server reports a replay
- THEN the workspace SHALL identify it as replayed and show the result

#### Scenario: Projection is absent
- GIVEN the Collections capability is enabled and projection is disabled
- WHEN an operator completes a native settlement
- THEN no CTACTE control, request, or reconciliation claim SHALL be present

### Requirement: Accessible Responsive Operation

The workspace MUST use labelled controls, landmarks, headings, visible focus, keyboard-operable dialogs, focus-managed status, alerts for failures, and non-color status cues. Narrow layouts MUST preserve all actions and expose tabular content through an accessible small-screen representation.

#### Scenario: Keyboard error recovery
- GIVEN a dialog submission fails
- WHEN the failure status appears
- THEN assistive technology SHALL announce it and keyboard focus SHALL reach the recoverable status

#### Scenario: Narrow allocation review
- GIVEN a narrow viewport shows allocations
- WHEN the operator reviews them
- THEN every obligation, amount, and action SHALL remain available without horizontal loss

### Requirement: First-Slice Scope Boundary

The workspace MUST add feature-gated agreement and accepted community-work evidence actions only in the relevant obligation context. It MUST NOT add cash shift, close, tender, or reconciliation; benefits, family, Padrones, arrears dashboards, CTACTE UI/projection/dual-write, ledger redesign, implicit allocation, financial-history mutation/deletion, or changes to authorization semantics. It MUST NOT render, invoke, or claim CTACTE projection, dual-write, or reconciliation, and it MUST preserve existing monetary allocation and reversal journeys.

(Previously: The workspace excluded agreements and community work alongside other first-slice scope.)

#### Scenario: Negotiation remains outside Treasury and CTACTE

- GIVEN an operator records an agreement or accepted community-work evidence
- WHEN the operator reviews the Collections result
- THEN the workspace MUST NOT offer Treasury cash/tender, cash-shift, or reconciliation actions
- AND it MUST NOT present a CTACTE control, request, or reconciliation claim

---

### Requirement: Open Negotiation Operator Workflow

When `NATIVE_COLLECTIONS_WEB_ENABLED` and `DUES_AGREEMENTS_ENABLED` are enabled, the Collections workspace MUST allow an `ADMIN` or `TESORERO` to create, view, and revise an agreement from an open obligation. The workflow MUST present all labels, guidance, validation, and status messages in Spanish. It MUST distinguish an agreement from a completed settlement and state that debt remains open until a valid settlement is recorded.

#### Scenario: Authorized operator saves an agreement

- GIVEN an `ADMIN` or `TESORERO` views an open obligation while the required Collections flags are enabled
- WHEN the operator submits an agreement with a narrative and reason
- THEN the workspace MUST display a Spanish success state
- AND it MUST show the active agreement and that the debt remains open

#### Scenario: Workflow state is communicated in Spanish

- GIVEN an operator opens, submits, or refreshes the negotiation workflow
- WHEN loading, API failure, validation failure, permission denial, active-agreement conflict, successful completion, replay, or partial agreement data occurs
- THEN the workspace MUST display an actionable Spanish loading, error, validation, permission-denied, conflict, success, replay, or partial-data state respectively
- AND it MUST NOT present incomplete data as a complete agreement

#### Scenario: Unauthorized operator is denied

- GIVEN an operator without `ADMIN` or `TESORERO` authorization opens the obligation context
- WHEN the operator attempts an agreement action
- THEN the workspace MUST show a Spanish permission-denied state
- AND it MUST NOT imply that an agreement was saved

---

### Requirement: Typed Negotiation API Client

The Web dues API client MUST provide typed operations to create, read, and revise agreements and to submit community-work settlement evidence. Mutating operations MUST accept a request identity and expose validation, authorization, conflict, replay, partial-data, and service-failure outcomes distinctly enough for the Spanish workflow to render actionable states.

#### Scenario: Client exposes a replayed agreement result

- GIVEN a completed agreement command is repeated with its original request identity
- WHEN the API reports a replay
- THEN the typed client MUST return the original agreement result as a replay outcome
- AND the workflow MUST be able to render its Spanish replay state without treating it as a new agreement

---

### Requirement: Community-Work Evidence Action

When the Collections negotiation workflow is enabled, the workspace MUST allow an authorized operator to record accepted community-work evidence and an approved value for the current obligation through the supported non-cash settlement action. The workspace MUST refresh the debt detail only after the API confirms the settlement result.

#### Scenario: Accepted community work refreshes debt

- GIVEN an authorized operator views an agreement-linked open obligation
- WHEN the operator submits accepted community-work evidence, reason, and approved value
- THEN the workspace MUST show a Spanish success state only after confirmation
- AND it MUST refresh and display the resulting outstanding debt
