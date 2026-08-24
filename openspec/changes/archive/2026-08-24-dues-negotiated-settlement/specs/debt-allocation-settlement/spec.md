# Delta for Debt Allocation Settlement

## ADDED Requirements

### Requirement: Accepted Community-Work Non-Cash Settlement

The system MUST allow only an `ADMIN` or `TESORERO` to record accepted community-work evidence as a non-cash settlement with an explicit positive club-approved monetary value, a non-empty reason, supporting evidence, one target obligation, and a request identity. It MUST use the existing non-cash settlement and allocation path. The evidence MUST NOT reduce debt unless the resulting allocation is valid.

#### Scenario: Accepted community work reduces debt once

- GIVEN an open obligation has sufficient outstanding debt
- AND an authorized operator has accepted community-work evidence with a club-approved value
- WHEN the operator submits the non-cash settlement with a unique request identity
- THEN the system MUST create exactly one non-cash settlement and allocation for that obligation
- AND the outstanding debt MUST decrease by exactly the approved allocated value

### Requirement: Non-Cash Allocation Safety and Replay

The system MUST reject a non-cash community-work allocation that exceeds the target obligation's outstanding balance or is stale due to a concurrent balance change. A repeat of the same completed request identity and equivalent request MUST return the original result without creating another settlement, allocation, debt reduction, or audit event. Reuse of a request identity with different material request data MUST be rejected.

#### Scenario: Over-allocation is rejected

- GIVEN an obligation has an outstanding balance lower than the submitted approved value
- WHEN an authorized operator submits community-work evidence
- THEN the system MUST reject the allocation
- AND the debt and settlement history MUST remain unchanged

#### Scenario: Replay is idempotent

- GIVEN a community-work settlement request completed successfully
- WHEN the same request identity and equivalent request are replayed
- THEN the system MUST return the original settlement result
- AND the obligation MUST have only one allocation for that request

#### Scenario: Concurrent settlement causes a conflict

- GIVEN a concurrent settlement consumes enough balance to make a submitted community-work allocation invalid
- WHEN the stale request is processed
- THEN the system MUST reject it as a conflict
- AND it MUST NOT create a partial financial state

### Requirement: Settlement Boundary Preservation

The negotiated settlement capability MUST NOT link dues settlements or allocations to `CTActe`, introduce Treasury cash or tender handling into Collections, or alter existing monetary settlement or reversal behavior. Other negotiated actions MUST remain agreement content until an explicitly supported settlement event validates and allocates them.

#### Scenario: Unfulfilled agreement action does not settle debt

- GIVEN an agreement describes an action other than accepted community work
- WHEN no supported settlement allocation has been recorded
- THEN the obligation's debt MUST remain unchanged
- AND no Treasury or `CTActe` side effect MUST occur
