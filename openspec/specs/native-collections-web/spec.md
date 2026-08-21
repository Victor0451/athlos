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

The workspace MUST NOT add cash shift, close, tender, or reconciliation; benefits, family, agreements, community work, Padrones, arrears dashboards, CTACTE UI/projection/dual-write, ledger redesign, implicit allocation, financial-history mutation/deletion, or authorization semantics.

#### Scenario: Out-of-scope cash request
- GIVEN an operator completes a native settlement
- WHEN they review the result
- THEN it SHALL not offer cash-shift or reconciliation actions
