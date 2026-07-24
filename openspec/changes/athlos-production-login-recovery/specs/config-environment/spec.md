# Delta for Config/Environment

## ADDED Requirements

### Requirement: Production API Internal URL

Production web SHALL require valid explicit `API_INTERNAL_URL`. Startup MUST fail closed if missing/invalid; diagnostics MUST redact URL credentials.

#### Scenario: Valid explicit upstream
- GIVEN production has a valid `API_INTERNAL_URL`
- WHEN the web proxy starts
- THEN it MUST use that upstream

#### Scenario: Missing upstream
- GIVEN production lacks `API_INTERNAL_URL`
- WHEN the web proxy starts
- THEN it MUST fail without proxying to an inferred target
