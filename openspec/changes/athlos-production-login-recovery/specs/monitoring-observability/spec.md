# Delta for Monitoring & Observability

## MODIFIED Requirements

### Requirement: GET /health/ready — Readiness

The system MUST expose `GET /health/ready`. It MUST return `200` only when dependencies and `operators`, `refresh_tokens`, and `job_runs` are reachable; otherwise `503` with a non-sensitive dependency/schema indicator. `GET /health` MUST remain dependency-independent liveness.
(Previously: Readiness checked reachable dependencies but not critical schema.)

#### Scenario: Dependencies and schema are available
- GIVEN dependencies and required relations are reachable
- WHEN `GET /health/ready` is called
- THEN it MUST return 200 with dependencies marked `ok`

#### Scenario: Database dependency fails
- GIVEN PostgreSQL is unreachable within 2s
- WHEN `GET /health/ready` is called
- THEN it MUST return 503 without blocking longer than 2s

#### Scenario: Critical schema is absent
- GIVEN PostgreSQL is reachable but `job_runs` is absent
- WHEN readiness and liveness are called
- THEN readiness MUST return 503 and liveness MUST return 200
