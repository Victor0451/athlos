# Dues Pricing Assessment Specification

## Purpose

Expose existing native pricing and monthly assessment commands safely to Web operators.

## Requirements

### Requirement: ADMIN Pricing Administration

The system MUST allow only ADMIN to create, review, and revoke effective-dated base or sport prices. It MUST surface loading, empty, conflict, error, and success states and MUST NOT let the client override server authorization.

#### Scenario: Overlapping price is rejected
- GIVEN an ADMIN submits a conflicting effective period
- WHEN the server rejects it
- THEN the UI SHALL retain input and explain the conflict

#### Scenario: Non-ADMIN attempts pricing
- GIVEN a TESORERO submits a pricing request
- WHEN the API evaluates it
- THEN the API SHALL deny the request

### Requirement: Idempotent Monthly Generation

The system MUST allow only ADMIN or TESORERO to generate one selected period using a stable idempotency key. After an ambiguous retry it MUST reuse that key and distinguish created, replayed, zero-obligation, conflict, error, and success results.

#### Scenario: Ambiguous retry
- GIVEN generation timed out after submission
- WHEN the operator retries
- THEN the original idempotency key SHALL be sent and the outcome SHALL be created or replayed, not duplicated
