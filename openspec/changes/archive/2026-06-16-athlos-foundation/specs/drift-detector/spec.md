# Drift Detector Specification

## Purpose

Reconciliation jobs that detect drift between legacy source data and Athlos projections, alerting operators without auto-correcting.

## Requirements

### Requirement: Drift Detection Jobs

The system MUST run reconciliation jobs that compare current legacy data against Athlos projections.

Drift is defined as: a legacy record exists with content that differs from what Athlos last imported.

#### Scenario: No drift detected

- GIVEN legacy CTACTE record "CTA-001" hash matches last imported hash
- WHEN reconciliation job runs
- THEN job reports "0 drift detected" for CTACTE domain

#### Scenario: Drift detected

- GIVEN legacy CTACTE record "CTA-001" was modified since last import (hash mismatch)
- WHEN reconciliation job runs
- THEN job MUST report drift for CTA-001 with old hash, new hash, and last import timestamp

### Requirement: Alert on Drift

The system MUST emit an alert when drift is detected. The system MUST NOT auto-correct drift.

#### Scenario: Alert emitted

- GIVEN drift is detected in CTACTE domain (5 records changed)
- WHEN reconciliation completes
- THEN system MUST emit alert with: domain, drift count, list of affected keys
- AND system MUST NOT modify any Athlos data

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

## Success Criteria

- Reconciliation jobs detect simulated drift and report accurately
- Alerts are emitted for any drift found
- Drift is never auto-corrected
- Reports are available for operator review