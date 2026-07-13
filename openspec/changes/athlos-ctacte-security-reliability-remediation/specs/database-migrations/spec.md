# Delta for Database Migrations

## ADDED Requirements

### Requirement: CTACTE Remediation Migration Integrity

The remediation MUST ship ordered migrations `0031 → 0032 → 0033 → 0034`; `0034` MUST be included only with its predecessors and provide integrity evidence for the complete sequence. Each of five independently rollbackable slices (`S0` contracts, `S1` authorization/validation, `S2` audit/idempotency, `S3` attachment/replay, `S4` timeout/observability) MUST remain at or below 400 changed lines.

#### Scenario: Complete ordered rollout
- GIVEN a fresh remediation migration run
- WHEN migrations are applied
- THEN `0031` through `0034` MUST apply in numeric order with recorded integrity evidence

#### Scenario: Incomplete rollout
- GIVEN `0034` is present without a predecessor or integrity evidence
- WHEN validation runs
- THEN rollout validation MUST fail before application
