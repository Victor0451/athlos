# Delta for drift-detector

> Source: TASK-057 (`packages/drift/src/{detect,alert}.ts`) + Decision 1 (DATA_STEWARD role for alerts). Drift writes DIRECTLY to `audit_events` (system event path), NOT through the `@athlos/audit` API (operator event path) — see ADDED requirement.

## MODIFIED Requirements

### Requirement: Drift Detection Jobs

The system MUST run reconciliation jobs that compare current legacy data against Athlos projections.

Drift is defined as: a legacy record exists with content that differs from what Athlos last imported. The detector MUST compare the latest `raw_events.content_hash` for each `(source_table, source_key)` (resolved by `entity_id` UUID per lineage-tracker delta) against the most recent `drift_snapshots.last_hash` for the same entity.
(Previously: detector described drift conceptually; no explicit snapshot table comparison.)

#### Scenario: No drift detected

- GIVEN CTACTE record `<uuid>` has `raw_events.content_hash` matching `drift_snapshots.last_hash`
- WHEN `drift.detect({ domain: "ctacte" })` runs
- THEN result MUST have `drift_count: 0` for the `ctacte` domain

#### Scenario: Drift detected

- GIVEN CTACTE record `<uuid>` was modified since last import (hash mismatch)
- WHEN `drift.detect({ domain: "ctacte" })` runs
- THEN result MUST include a drift entry for `<uuid>` with `old_hash`, `new_hash`, and `last_imported_at`

### Requirement: Alert on Drift

The system MUST emit an alert when drift is detected. The system MUST NOT auto-correct drift.

The alert MUST (a) insert exactly one row into the `audit_events` table via the DIRECT write path (see ADDED requirement below) and (b) trigger a `drift_alert` notification to every operator whose role is `DATA_STEWARD` (Decision 1 — distinct from ADMIN).
(Previously: alert was emitted but routing was unspecified — PR 6b's notifications spec assumed ADMIN.)

#### Scenario: Drift triggers DATA_STEWARD alert

- GIVEN drift is detected in `ctacte` (5 records changed)
- AND operators `steward1` (DATA_STEWARD), `steward2` (DATA_STEWARD), `admin1` (ADMIN) all have `email` and `in_app` enabled for `drift_alert`
- WHEN `drift.emitDriftAlert(report)` completes
- THEN `steward1` and `steward2` MUST each receive one `drift_alert` email and one in-app row
- AND `admin1` MUST NOT receive any drift alert
- AND exactly one row MUST be inserted into `audit_events` for the alert

#### Scenario: Drift is never auto-corrected

- GIVEN drift is detected
- WHEN the alert path completes
- THEN no Athlos projection row MAY be mutated by the alert path

## ADDED Requirements

### Requirement: Direct Audit Write Path for System Events

The `drift` package MUST write drift alert records to the `audit_events` table by direct SQL (Drizzle insert), NOT by calling the `@athlos/audit` API.

Rationale: there are two distinct write paths to the same table. The `@athlos/audit` package handles **operator-initiated** events (created by Fastify hooks, attributed to a JWT operator). The `drift` package emits **system-generated** events (no operator, triggered by a cron or job run). The two paths MUST remain separate so that (1) the operator attribution field is never spuriously populated for system events and (2) a future change to the operator hook does not silently re-route system events through it.

The `drift` package MAY import the `audit_events` table definition from `@athlos/db` but MUST NOT import from `@athlos/audit`.
(Decision: drift → direct table write. Carries the lesson from PR 6b's failure-logging spec, which audits notification outcomes via `audit_events` directly for the same reason.)

#### Scenario: Drift alert writes one audit_events row directly

- GIVEN the `@athlos/audit` package is mocked to throw if any of its functions are called
- WHEN `drift.emitDriftAlert(report)` runs
- THEN exactly one row is inserted into `audit_events` with `operator_id: null`, `action: "DRIFT_DETECTED"`, `entity_type: "domain"`, `entity_id: "<domain-name>"`, and `metadata` containing the drift count
- AND the `@athlos/audit` mock is never invoked

#### Scenario: System events are not attributed to an operator

- GIVEN a drift alert is emitted during a cron run with no JWT in context
- WHEN the audit row is inserted
- THEN `operator_id` MUST be `null`
- AND `source_ip` MUST be `null`
