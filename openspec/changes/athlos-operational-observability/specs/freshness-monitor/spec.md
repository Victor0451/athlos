# Delta for Freshness Monitor

## MODIFIED Requirements

### Requirement: Freshness Status Display

The UI MUST display `lastImportAt`, `recordCount`, `status`, and `ageDisplay`. `status` MUST be `current`, `stale`, or `unknown`. Dashboard responses MUST use camelCase, never snake_case.
(Previously: snake_case fields.)

#### Scenario: Current data
- GIVEN a domain is within its threshold
- WHEN freshness is returned
- THEN it MUST use camelCase and `status: "current"`

#### Scenario: Unknown data
- GIVEN no domain data exists
- WHEN freshness is returned
- THEN it MUST include `lastImportAt: null`, `recordCount: 0`, and `status: "unknown"`
