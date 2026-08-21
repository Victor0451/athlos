# Debt Allocation Settlement Specification

## Purpose

Explain native debt and record explicit, immutable settlement operations.

## Requirements

### Requirement: Safe Debt Explanation

The system MUST reuse the existing Socios lookup for first-slice member selection. For ADMIN/TESORERO debt detail, its DTO MUST contain only obligation period, original/outstanding amounts, financial components, applied benefits, settlement/allocation links, reversal-selection eligibility, identifiers, currency, and status; it MUST NOT contain raw audit or authorization evidence, or unrelated member data.

#### Scenario: Authorized debt detail
- GIVEN an ADMIN or TESORERO selects a known Socio
- WHEN debt detail loads
- THEN it SHALL show explanation fields or an explicit unavailable/not-found state without inferred history

#### Scenario: Non-authorized debt read
- GIVEN an unauthorized operator requests debt detail
- WHEN the API evaluates it
- THEN the API SHALL deny the request

### Requirement: Explicit Settlement Allocation

The system MUST allow ADMIN/TESORERO to submit a positive monetary settlement with explicit unique allocations across one or more obligations. It MUST block implicit allocation, over-allocation, and stale/racing balances; conflicts MUST require refresh and review.

#### Scenario: Partial multi-obligation settlement
- GIVEN allocations reconcile to no more than the payment total
- WHEN the operator confirms
- THEN the server SHALL persist exactly the submitted allocations

#### Scenario: Concurrent over-allocation
- GIVEN another settlement consumes an obligation balance first
- WHEN this operator submits stale allocations
- THEN the server SHALL reject them and the UI SHALL offer refresh-and-review

### Requirement: Append-Only Reversal

The system MUST allow ADMIN/TESORERO to select a posted allocation, review its original settlement, obligation, and amount, and submit a non-empty reason. It MUST create only a compensating reversal; edit, delete, and duplicate reversal actions are prohibited.

#### Scenario: Already reversed allocation
- GIVEN the selected allocation was reversed concurrently
- WHEN reversal is submitted
- THEN the server SHALL reject it as a conflict and the UI SHALL refresh history
