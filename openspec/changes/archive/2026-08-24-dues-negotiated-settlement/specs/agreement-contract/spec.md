# Agreement Contract Specification

## Purpose

Define a backward-compatible, open-ended negotiated dues agreement that records what a member and club agreed without classifying every possible settlement action.

## Requirements

### Requirement: Versioned Open Agreement Representation

The system MUST persist negotiated agreements in a versioned representation with a required human-readable narrative and a required reason. The representation MAY include zero or more structured commitments and evidence metadata when dates, values, or supporting details are useful. Neither the agreement nor its commitments MUST require membership in a closed settlement-category enum; structured data MUST remain optional and extensible within the versioned representation.

#### Scenario: Open-ended agreement is recorded

- GIVEN an authorized operator records an agreement concerning an open obligation
- WHEN the agreement contains a narrative and reason but no predefined settlement category
- THEN the system MUST accept and retain the narrative
- AND the system MUST permit optional structured commitments or evidence without requiring them

### Requirement: Legacy Monetary Agreement Compatibility

The system MUST continue to read existing `SIMPLE` and `INSTALLMENT` agreement records with their established monetary-plan semantics, including their amount and installment schedule constraints. The generalized representation MUST NOT reinterpret, invalidate, or erase legacy records.

#### Scenario: Existing installment agreement is viewed

- GIVEN a persisted `INSTALLMENT` agreement with its established amount and schedule
- WHEN an operator reads the agreement after the open agreement representation is available
- THEN the system MUST return the agreement with its original monetary-plan semantics intact

### Requirement: Agreement Lifecycle and Revision Lineage

The system MUST allow at most one active agreement for an obligation. An authorized revision of an active agreement MUST create a successor version, supersede the prior active version, preserve the obligation link, and retain immutable lineage to every prior version; it MUST NOT overwrite prior terms or evidence in place.

#### Scenario: Active agreement is revised

- GIVEN an obligation has one active agreement
- WHEN an authorized operator submits a valid revision with a reason
- THEN the prior agreement MUST remain auditable as superseded
- AND exactly one successor agreement MUST be active
- AND the successor MUST retain lineage to the prior agreement

#### Scenario: Competing active agreement is rejected

- GIVEN an obligation already has an active agreement
- WHEN a distinct create request attempts to add another active agreement
- THEN the system MUST reject the request as a conflict
- AND it MUST NOT create a second active agreement

### Requirement: Agreement Authorization, Idempotency, and Concurrency

The system MUST permit agreement creation and revision only to `ADMIN` or `TESORERO` operators authorized for the target member obligation. Each mutation MUST carry a request identity. An equivalent replay of a completed request MUST return its original agreement result without creating another agreement, revision, or audit record; reuse of a request identity with different material data MUST be rejected. A stale or concurrent agreement mutation MUST fail as a conflict without creating a second active agreement or a partial lineage.

#### Scenario: Agreement create replay is idempotent

- GIVEN an authorized agreement-create request completed for an open obligation
- WHEN the equivalent request is replayed with the same request identity
- THEN the system MUST return the original agreement result
- AND it MUST retain one active agreement and one creation audit fact for that request

#### Scenario: Unauthorized agreement mutation is denied

- GIVEN an operator is not an `ADMIN` or `TESORERO` authorized for the target obligation
- WHEN the operator creates or revises an agreement
- THEN the system MUST reject the mutation
- AND it MUST NOT alter agreement lineage or debt

### Requirement: Agreement Does Not Settle Debt

Creating, viewing, or revising an agreement MUST NOT change an obligation's outstanding debt, settlement history, or allocation history. Debt MUST be reduced only by a valid settlement allocation.

#### Scenario: Agreement save leaves debt open

- GIVEN an open obligation has an outstanding balance
- WHEN an authorized operator creates or revises its agreement
- THEN the outstanding balance MUST remain unchanged
- AND no settlement or allocation MUST be created
