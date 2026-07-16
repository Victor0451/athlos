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

### Requirement: Comprobante Failure Reason Schema Evolution

The database MUST provide a nullable persisted comprobante failure-reason field before terminal timeout behavior is enabled. The field MUST distinguish `RENDER_TIMEOUT` from the absence of a terminal reason. Its default MUST be null, existing rows including existing `failed` rows MUST remain or be backfilled to null, and null MUST preserve ordinary renderer reclaim or retry semantics. The schema MUST reject unsupported non-null failure reasons until another reason is explicitly specified.

The migration MUST be additive and ordered after `0034`. Under the forward-only migration policy, application rollback MUST leave the nullable field in place; the prior application version MUST remain compatible by ignoring it. If the schema change itself cannot be retained, recovery MUST use a new forward migration rather than editing or reversing an applied migration.

#### Scenario: Existing rows are migrated

- GIVEN comprobante rows exist before the failure-reason migration, including rows with status `failed`
- WHEN the migration is applied
- THEN every existing row MUST have a null failure reason
- AND no existing failure MUST be reclassified as `RENDER_TIMEOUT`

#### Scenario: New rows omit a failure reason

- GIVEN the failure-reason migration has been applied
- WHEN a comprobante row is created or an ordinary renderer failure is recorded without a terminal reason
- THEN the persisted failure reason MUST default to null

#### Scenario: Timeout reason is persisted

- GIVEN an active owner reaches the 30-second render deadline
- WHEN its owner-conditional failure transition succeeds
- THEN the row MUST persist `RENDER_TIMEOUT` as its failure reason

#### Scenario: Application rollback after schema rollout

- GIVEN the failure-reason migration is applied before S4 runtime behavior
- WHEN the application is rolled back to the prior version
- THEN the nullable field MUST remain in the schema
- AND the prior version MUST continue operating without requiring a down migration

### Requirement: S4 Split Delivery Boundary

S4 MUST be delivered as two stacked-to-main slices. S4a MUST establish the additive failure-reason schema and the state/replay invariants that distinguish terminal timeout from ordinary reclaimable failure. S4b MUST depend on S4a and add the 30-second owner/follower request deadlines, `504` HTTP mapping, structured logs, Prometheus counter behavior, and propagation of unexpected comprobante route failures to the global redacted 5xx handler. S4a MUST NOT enable timeout HTTP behavior before its persisted state is available, and S4b MUST NOT weaken the S4a state invariants.

#### Scenario: S4a is deployed alone

- GIVEN S4a has landed and S4b has not
- WHEN the application reads or writes comprobante state
- THEN the schema and state model MUST support distinct terminal timeout reasons
- AND existing ordinary failure, replay, conflict, and stale-takeover behavior MUST remain compatible

#### Scenario: S4b is deployed after S4a

- GIVEN S4a is present
- WHEN S4b enables deadline, HTTP, and telemetry behavior
- THEN owner and follower deadlines MUST follow the specified state-mutation boundaries
- AND timeout replay, redacted 5xx propagation, logs, and metrics MUST follow their API and observability contracts
