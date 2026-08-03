# Delta for Web Frontend

## MODIFIED Requirements

### Requirement: Dashboard Cards

The ADMIN dashboard SHALL obtain readiness, canonical freshness, job health, and ≤10 attention runs through one query. It MUST poll every 30 seconds, show independent signals, identify only DB/schema readiness, and never present legacy-share or raw data.
(Previously: separate scheduler and run queries.)

#### Scenario: Single dashboard refresh
- GIVEN an ADMIN dashboard is mounted
- WHEN 30 seconds elapse
- THEN it MUST issue one snapshot query and update available signals

#### Scenario: Attention is bounded
- GIVEN more than 10 attention runs exist
- WHEN the dashboard receives a snapshot
- THEN it MUST render no more than 10 attention runs
