# Debt Allocation Settlement Specification

## Purpose

Define native debt settlement. This is a subsequent slice, not part of the first slice.

## Requirements

### Requirement: Explicit Debt Settlement

The system MUST present total debt and obligation aging from active native obligations. An authorized settlement MUST explicitly identify allocation amounts and target obligations; it MUST NOT force oldest-debt allocation. Monetary payments and non-cash settlements MUST be distinct records and MUST be idempotent.

#### Scenario: Operator chooses a newer obligation

- GIVEN a member has two unpaid obligations
- WHEN an authorized operator allocates a payment to the newer obligation
- THEN only that obligation's outstanding balance MUST decrease

#### Scenario: Community work is non-cash

- GIVEN approved community-work evidence with a debt value
- WHEN it is allocated to an obligation
- THEN debt MUST decrease and cash income MUST NOT increase

### Requirement: Append-Only Reversal and Compensation

The system MUST reverse or correct settlements through authorized, reasoned compensations. It MUST NOT delete settlements, allocations, or recalculate their historical allocation.

#### Scenario: Incorrect allocation is corrected

- GIVEN a posted allocation was made to the wrong obligation
- WHEN an authorized operator reverses it with a reason
- THEN the original allocation MUST remain visible and a compensating allocation MUST restore debt
