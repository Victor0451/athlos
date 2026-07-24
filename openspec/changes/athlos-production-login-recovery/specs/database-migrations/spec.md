# Delta for Database Migrations

## ADDED Requirements

### Requirement: Recovery Preflight and Clone Rehearsal

Recovery SHALL inventory database identity, schema, auth/scheduler relations, counts, extensions, and history read-only; evidence MUST redact secrets. It MUST verify backup integrity, restore an isolated clone, and rehearse restore-or-repair while preserving `audit_events` before mutation authorization.

#### Scenario: Evidence and rehearsal succeed
- GIVEN read access, backup storage, and an isolated clone
- WHEN preflight and rehearsal run
- THEN the decision record contains redacted inventory, integrity, restore, count/hash, and audit evidence

#### Scenario: Preflight evidence is unsafe or inconsistent
- GIVEN identity/history is uncertain, integrity fails, or rehearsal mismatches
- WHEN the recovery gate evaluates the evidence
- THEN it MUST abort without a production write

### Requirement: Schema Completeness Gate

Migration history SHALL not prove schema; recovery and readiness MUST detect `operators`, `refresh_tokens`, and `job_runs`.

#### Scenario: Required relation is absent
- GIVEN one required relation is absent
- WHEN the gate runs
- THEN it MUST fail closed and identify only the missing relation

### Requirement: Safe Versioned Recovery Execution

Recovery steps SHALL be versioned, prerequisite-checked, idempotent, and non-destructive. They MUST NOT reset, truncate, or replace a database, and MUST stop absent prerequisites or authorization.

#### Scenario: Re-run after a successful rehearsal
- GIVEN prerequisites and authorization are recorded
- WHEN the same recovery step is re-run on the clone
- THEN it MUST produce no destructive reset or duplicate effect
