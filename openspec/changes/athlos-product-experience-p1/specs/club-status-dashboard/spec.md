# Club Status Dashboard Specification

## Purpose

Provide an authenticated, role-projected club-status overview without exposing technical ADMIN operations.

## Requirements

### Requirement: Authorized Server Projection

`GET /api/v1/club-status` MUST require authentication and derive the projection exclusively from the server-validated role. ADMIN and TESORERO MAY receive aggregate amounts, trend values, delinquency, and debt; OPERADOR MUST receive only non-monetary regularization workload; CONSULTA MUST receive only non-sensitive institutional status. Unauthorized fields MUST be omitted from JSON, not represented as zero, null, masked, or client-hidden values. The endpoint MUST NOT expose scheduler execution, evidence resolution, delegated stewardship, or ADMIN technical-operation controls.

#### Scenario: Financial projection is role-gated
- GIVEN an OPERADOR or CONSULTA token
- WHEN it requests club status
- THEN monetary, debt, and trend fields SHALL be absent from the response

#### Scenario: Financial projection is authorized
- GIVEN an ADMIN or TESORERO token
- WHEN it requests club status
- THEN authorized aggregate financial fields MAY be returned without individual member data

### Requirement: Periods and Current-State Stability

The endpoint MUST accept only `current-month` (default), `last-60-days`, or `last-90-days`. The selected period MUST affect finance and period-activity metrics only. Current membership, delinquency, data-quality, and system-state metrics MUST remain current-state values across all three selections.

#### Scenario: Period changes only period-bound metrics
- GIVEN a dashboard response for `current-month`
- WHEN the same role requests `last-90-days`
- THEN current-state fields SHALL remain unchanged for unchanged source data
- AND period-bound fields SHALL use the selected range

### Requirement: Metric Semantics and Unknown States

Financial aggregates MUST use non-annulled CTACTE movements and the repository convention `debe - haber`; debits populate `debe` and credits populate `haber`. The response MUST label currency only when an authoritative configured currency exists. Calendar-month boundaries MUST use `America/Argentina/Buenos_Aires`, which is the repository scheduler timezone. Trend baseline, period activity source, debt/delinquency predicates, and data-quality definitions MUST be explicitly documented by implementation from existing domain policy; until resolved, their fields MUST be omitted with a machine-readable `unavailable` state, never zero. Freshness MUST use the existing domain freshness status and last-import timestamp; unavailable data MUST be displayed as unavailable, never as zero.

#### Scenario: Annulled movements do not affect totals
- GIVEN a CTACTE movement marked `anulado=true`
- WHEN a financial aggregate is computed
- THEN that movement SHALL not contribute to the aggregate

#### Scenario: Unknown metric policy does not become a false zero
- GIVEN a requested metric has no resolved domain definition or source data
- WHEN club status is returned
- THEN the metric SHALL be omitted or marked unavailable and the UI SHALL not render `0`
