# Delta for Audit Logger

## ADDED Requirements

### Requirement: Atomic CTACTE Mutation Audit and Caller Identity

Each covered payment, debit, or note mutation MUST commit with exactly one matching audit event in the same atomic outcome. A failed audit write MUST roll back the mutation; warnings, counters, and best-effort fallback MUST NOT substitute. Caller-key retries MUST use a durable caller-supplied key, scoped to the actor and operation, rather than a time bucket.

#### Scenario: Successful mutation is atomically audited
- GIVEN an authorized actor submits a payment with a new caller key
- WHEN the mutation succeeds
- THEN its financial record and exactly one matching audit event MUST commit

#### Scenario: Audit or duplicate-key failure
- GIVEN an audit write fails, or the caller key was already completed
- WHEN the mutation is processed
- THEN no new mutation MAY commit; the completed result MUST be returned for the duplicate

## MODIFIED Requirements

### Requirement: Idempotency Window

`emitAudit(record)` MUST use a durable caller-supplied idempotency key for covered CTACTE operations; the key MUST be scoped to the actor and operation and MUST NOT include time. It MUST look up the persisted key before insert and return `{ inserted: false, deduped: true }` for the same completed request. Other audit operations MAY use their defined semantics.
(Previously: CTACTE caller audit deduplication used a SHA-256 key containing a 10-second time bucket.)

#### Scenario: Same caller key is deduped
- GIVEN a covered operation already completed for an actor and caller key
- WHEN the actor retries with that key after any delay
- THEN no additional audit row MUST be inserted

#### Scenario: Different caller key is distinct
- GIVEN a covered operation completed for an actor
- WHEN that actor submits a distinct operation with a new key
- THEN one new audit row MUST be inserted

#### Scenario: Actor scope is enforced
- GIVEN a caller key completed for actor A
- WHEN actor B submits that key
- THEN it MUST NOT receive actor A's completed result
