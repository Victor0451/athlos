# Drift Detector Specification

## Purpose

Reconciliation jobs that detect drift between legacy source data and Athlos projections, alerting operators without auto-correcting.

## Requirements

### Requirement: Drift Detection Jobs

The system MUST run reconciliation jobs that compare current legacy data against Athlos projections.

Drift is defined as: a legacy record exists with content that differs from what Athlos last imported. The detector MUST compare the latest `raw_events.content_hash` for each `(source_table, source_key)` (resolved by `entity_id` UUID per lineage-tracker spec) against the most recent `drift_snapshots.last_hash` for the same entity.

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

The alert MUST (a) insert exactly one row into the `audit_events` table via the DIRECT write path (see ADDED requirement below) and (b) trigger a `drift_alert` notification to every operator whose role is `DATA_STEWARD`.

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

### Requirement: Drift Report

The system SHOULD generate a drift report listing all discrepancies found.

#### Scenario: Drift report generation

- GIVEN reconciliation ran for "socios" domain
- WHEN drift report is requested
- THEN report MUST include: total records checked, drift count, per-record details (key, field, expected value, actual value)

### Requirement: Scheduled Reconciliation

The system SHOULD support scheduled reconciliation runs (e.g., nightly).

#### Scenario: Scheduled run

- GIVEN reconciliation job is configured to run daily at 02:00
- WHEN 02:00 arrives
- THEN job executes against all domains
- AND results are logged and alerts sent if drift found

### Requirement: Direct Audit Write Path for System Events

The `drift` package MUST write drift alert records to the `audit_events` table by direct SQL (Drizzle insert), NOT by calling the `@athlos/audit` API.

Rationale: there are two distinct write paths to the same table. The `@athlos/audit` package handles **operator-initiated** events (created by Fastify hooks, attributed to a JWT operator). The `drift` package emits **system-generated** events (no operator, triggered by a cron or job run). The two paths MUST remain separate so that (1) the operator attribution field is never spuriously populated for system events and (2) a future change to the operator hook does not silently re-route system events through it.

The `drift` package MAY import the `audit_events` table definition from `@athlos/db` but MUST NOT import from `@athlos/audit`.

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

## Success Criteria

- Reconciliation jobs detect simulated drift and report accurately
- Alerts are emitted for any drift found
- Drift is never auto-corrected
- Reports are available for operator review