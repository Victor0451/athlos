# Freshness Monitor Specification

## Purpose

UI indicators showing sync status and import age per domain, giving operators visibility into data freshness.

## Requirements

### Requirement: Freshness Status Display

The UI MUST display `lastImportAt`, `recordCount`, `status`, and `ageDisplay`. `status` MUST be `current`, `stale`, or `unknown`. Dashboard responses MUST use camelCase, never snake_case.
(Previously: snake_case fields.)

#### Scenario: Current data

- GIVEN domain `ctacte` was imported at 2024-06-11 14:30 with 50,000 records
- AND the `ctacte` threshold in `thresholds.ts` is 1 hour
- WHEN `freshness.getFreshness({ domain: "ctacte" })` is called
- THEN it MUST use camelCase and `status: "current"`

#### Scenario: Unknown data (no raw events)

- GIVEN `raw_events` contains zero rows for source_table `caja`
- WHEN freshness is queried
- THEN it MUST include `lastImportAt: null`, `recordCount: 0`, and `status: "unknown"`

### Requirement: Import Age Indicator

The system MUST display import age as human-readable duration (e.g., "2 hours ago", "3 days ago"), derived from `last_import_at` and rendered using the same `age_display` field exposed by `getFreshness`.

#### Scenario: Recent import

- GIVEN CTACTE import completed 15 minutes ago
- WHEN freshness indicator is rendered
- THEN display shows "15 minutes ago"

#### Scenario: Old import

- GIVEN `paramet` import completed 5 days ago
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

### Requirement: Threshold Source

Per-domain staleness thresholds MUST live as a TypeScript code constant in `packages/freshness/src/thresholds.ts`, exported as `DOMAIN_THRESHOLDS: Record<Domain, { staleAfter: ISO8601 duration }>`.

The thresholds MUST NOT be loaded from the database, environment variables, or a remote config service in v1. Changing a threshold requires a code change and a redeploy.

#### Scenario: Threshold lookup is a code constant

- GIVEN `thresholds.ts` exports `DOMAIN_THRESHOLDS = { ctacte: { staleAfter: "PT1H" }, paramet: { staleAfter: "P1D" }, ... }`
- WHEN `getFreshness` evaluates the status of `ctacte`
- THEN the threshold value MUST be the literal from the file (no DB read, no env lookup)

#### Scenario: Missing threshold for a domain fails loud

- GIVEN a new source_table is added to the import order that has no entry in `DOMAIN_THRESHOLDS`
- WHEN `getFreshness` evaluates that domain
- THEN it MUST throw `BusinessError(CONFIG_MISSING)` referencing the domain name
- AND the freshness endpoint MUST return 500 (not silently report `'unknown'`)

## Success Criteria

- Freshness dashboard shows status for all 14 imported domains
- Import age is displayed as human-readable duration
- Stale domains are visually distinguished
- Manual refresh trigger initiates import workflow
