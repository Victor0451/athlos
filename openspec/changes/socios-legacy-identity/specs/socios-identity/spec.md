# Socios Identity Specification

## Purpose

Define additive identity records for family accounts, individual members, holder responsibility, and legacy evidence without changing the current Socio or CTACTE authority.

## Requirements

### Requirement: Immutable Person and Visible Identities

Each person MUST have an immutable internal UUID. The system MUST automatically assign a visible family-account number and a separate visible member number. Each number namespace MUST be independently unique; neither visible number nor a legacy key MUST be the person's primary identity.

#### Scenario: Create distinct account and member identities

- GIVEN a new family account and its first person
- WHEN identity records are created
- THEN the person has an immutable UUID and both visible numbers are assigned automatically
- AND the account and member numbers are unique in their respective namespaces

#### Scenario: Resolve a number collision

- GIVEN concurrent creation attempts produce the same candidate visible number
- WHEN uniqueness validation detects the collision
- THEN exactly one assignment MAY succeed and the other MUST retry or fail atomically
- AND no duplicate or manually substituted identity is persisted

### Requirement: Holder Responsibility and Effective History

A validated account MUST have exactly one current primary holder. The primary holder SHALL be the administrative responsibility for the account. The system MUST record each holder assignment and transfer with effective time, prior and succeeding holder, actor or source, and audit evidence. A review-required account MAY lack a holder pending resolution.

#### Scenario: Transfer primary responsibility

- GIVEN a validated account with a current primary holder
- WHEN responsibility is transferred effective at a specified time
- THEN the previous assignment is closed and one succeeding current assignment is recorded
- AND the audit trail identifies the transfer source or actor

#### Scenario: Reject overlapping holders

- GIVEN an account with an effective current holder assignment
- WHEN another current holder assignment would overlap it
- THEN the system MUST reject the change
- AND the existing responsibility history remains unchanged

### Requirement: Legacy Provenance and Review Lifecycle

The system MUST preserve raw legacy values, source keys, import batch lineage, anomaly reasons, and SOCCARNET plus SOCFAMILIA provenance. It MUST represent `imported`, `validated`, and `review_required` states. Legacy pairs MUST NOT establish primary identity or deduplicate records by themselves.

#### Scenario: Import unambiguous evidence

- GIVEN legacy data with source values and lineage
- WHEN it is stored as imported identity evidence
- THEN all supplied provenance is retained without replacing the internal UUID
- AND the record remains `imported` until validation is recorded

#### Scenario: Import ambiguous or duplicate legacy pairs

- GIVEN multiple records share a SOCCARNET and SOCFAMILIA pair, or the pair is incomplete
- WHEN the import is processed
- THEN each evidence record MUST be retained and marked `review_required`
- AND the system MUST NOT silently merge, assign a holder, or correct the pair

### Requirement: First-Slice Compatibility, Privacy, and Recovery

This slice MUST be additive: existing `socios.socios`, CTACTE references, endpoints, and imports SHALL remain authoritative and unchanged. The model MUST expose only a future integration boundary for an opaque digital credential; it MUST NOT define card issuance, scan, attendance, payment, fees, charges, or allocation behavior. A failed identity write or migration MUST roll back atomically; rollback MUST use a forward fix that disables or removes only additive objects.

#### Scenario: Preserve existing references

- GIVEN existing Socio and CTACTE records
- WHEN the identity schema is introduced
- THEN their keys and relationships remain valid and no ownership is reassigned
- AND no consumer is required to use the new identity records

#### Scenario: Fail an invalid additive write

- GIVEN an identity write violates a UUID, number, holder, or lifecycle invariant
- WHEN the transaction is committed
- THEN the transaction MUST fail and persist no partial identity or audit data
- AND legacy Socio and CTACTE data remain unchanged
