# Ctacte Compatibility Specification

## Purpose

Define optional legacy projection. This is a subsequent slice, not part of the first slice.

## Requirements

### Requirement: Optional One-Way Projection

The system MUST feature-gate `ctacte` compatibility. Native obligations and settlements MUST function while the gate is disabled. When enabled, projection MUST be one-way from native records and MUST NOT grant `ctacte` source-of-truth authority or alter existing manual-ledger behavior.

#### Scenario: Native operation with compatibility disabled

- GIVEN the compatibility gate is disabled
- WHEN an authorized native dues command completes
- THEN native records MUST be created and no `ctacte` row MUST be required

### Requirement: Idempotent Reconciled Projection

The system MUST authorize, audit, and idempotently project each eligible native record. It MUST prevent duplicate projections and expose a minimized reconciliation result identifying missing or divergent projections without disclosing unrelated member debt.

#### Scenario: Projection retry

- GIVEN a native record was successfully projected
- WHEN its projection is retried with the same identity
- THEN exactly one corresponding `ctacte` projection MUST exist
