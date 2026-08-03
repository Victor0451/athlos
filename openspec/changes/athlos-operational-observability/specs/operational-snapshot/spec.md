# Operational Snapshot Specification

## Requirements

### Requirement: Authorized Bounded Snapshot

`GET /api/v1/admin/operations/snapshot` MUST require ADMIN; others MUST receive 403. It MUST return readiness, freshness, job health, and ≤10 attention runs.

#### Scenario: ADMIN reads the snapshot
- GIVEN an authenticated ADMIN
- WHEN the endpoint is requested
- THEN it MUST return HTTP 200

#### Scenario: Non-ADMIN is denied
- GIVEN an authenticated OPERADOR
- WHEN the endpoint is requested
- THEN it MUST return HTTP 403

### Requirement: Independent Operational Signals

Readiness MUST report only `overall`, PostgreSQL `db`, and required-relation `schema`, never legacy-share. Signals MUST be independent: unavailable MUST be unavailable/unknown, not suppress others or claim success.

#### Scenario: Schema unavailable
- GIVEN schema is unavailable and freshness is available
- WHEN the snapshot is built
- THEN schema MUST be unavailable and freshness MUST still be returned

### Requirement: Attention and Safe Projection

Attention MUST mean `failed`, `dead_letter`, `cancelled`, or `completed_with_review`. Scheduler reads MUST share allowlisted reason code/message; raw data MUST NOT be exposed. The endpoint MUST NOT mutate, alert, collect diagnostics, or change production, deployment, integrations, or finance/domain behavior.

#### Scenario: Failed run is projected
- GIVEN a failed run contains a raw exception
- WHEN it is returned by any scheduler read
- THEN it MUST contain only the allowed reason code and safe message
