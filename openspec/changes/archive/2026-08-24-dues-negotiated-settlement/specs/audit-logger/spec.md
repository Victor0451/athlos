# Delta for Audit Logger

## ADDED Requirements

### Requirement: Negotiated Dues Action Audit Completeness

The system MUST append an immutable audit record atomically with each successful agreement creation, agreement revision, accepted community-work evidence record, non-cash settlement, and allocation. Each record MUST include the actor identity, timestamp, action, affected obligation and agreement or settlement identity, reason, authorization evidence sufficient to establish the actor's `ADMIN` or `TESORERO` authority, request identity or request fingerprint, and the relevant agreed details, evidence, or before/after revision linkage.

#### Scenario: Agreement revision is fully auditable

- GIVEN an `ADMIN` or `TESORERO` revises an active agreement
- WHEN the revision succeeds
- THEN immutable audit records MUST identify the actor, timestamp, reason, authorization evidence, request identity, predecessor, successor, and changed agreement details

#### Scenario: Community-work settlement is fully auditable

- GIVEN an authorized operator records accepted community-work evidence that produces a non-cash allocation
- WHEN the transaction succeeds
- THEN immutable audit records MUST identify the actor, timestamp, reason, authorization evidence, request identity, evidence, approved value, obligation, settlement, and allocation

### Requirement: Rejected Negotiated Dues Commands Do Not Produce Financial Audit Facts

The system MUST NOT append a successful agreement, settlement, or allocation audit fact when authorization, validation, idempotency mismatch, over-allocation, or concurrency validation rejects the command. A replay that returns an existing completed result MUST NOT append duplicate audit facts.

#### Scenario: Conflict leaves no successful audit fact

- GIVEN a stale community-work command conflicts with a concurrent allocation
- WHEN the command is rejected
- THEN no successful settlement or allocation audit record MUST be appended for the rejected command
- AND the pre-existing audit history MUST remain unchanged
