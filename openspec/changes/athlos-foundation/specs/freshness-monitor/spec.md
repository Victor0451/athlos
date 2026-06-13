# Freshness Monitor Specification

## Purpose

UI indicators showing sync status and import age per domain, giving operators visibility into data freshness.

## Requirements

### Requirement: Freshness Status Display

The UI MUST display freshness status per domain showing: domain name, last import timestamp, record count, and status (current/stale/unknown).

#### Scenario: Current data

- GIVEN domain "CTACTE" was imported at 2024-06-11 14:30 with 50,000 records
- WHEN freshness dashboard is displayed
- THEN CTACTE row shows: last_import="2024-06-11 14:30", record_count=50000, status="current"

#### Scenario: Stale data

- GIVEN domain "socios" last import was 48 hours ago
- WHEN freshness dashboard is displayed
- THEN socios row shows: status="stale" with warning indicator

### Requirement: Import Age Indicator

The system SHOULD display import age as human-readable duration (e.g., "2 hours ago", "3 days ago").

#### Scenario: Recent import

- GIVEN CTACTE import completed 15 minutes ago
- WHEN freshness indicator is rendered
- THEN display shows "15 minutes ago"

#### Scenario: Old import

- GIVEN paramet import completed 5 days ago
- WHEN freshness indicator is rendered
- THEN display shows "5 days ago"

### Requirement: Domain-Level Status Rollup

If any domain within a business domain group is stale, the group status SHOULD reflect the worst condition.

#### Scenario: Mixed domain status

- GIVEN CTACTE (current), CTACTE1 (stale), CONTABLE (current)
- WHEN "Accountant" domain group status is displayed
- THEN group status shows "stale" with CTACTE1 as the reason

### Requirement: Manual Refresh Trigger

The UI MAY provide a manual refresh button to trigger immediate import for a domain.

#### Scenario: Manual refresh requested

- GIVEN user clicks refresh icon for "socios" domain
- WHEN refresh is confirmed
- THEN import pipeline is triggered for socios table
- AND freshness indicator shows "refreshing..." state

## Success Criteria

- Freshness dashboard shows status for all 14 imported domains
- Import age is displayed as human-readable duration
- Stale domains are visually distinguished
- Manual refresh trigger initiates import workflow