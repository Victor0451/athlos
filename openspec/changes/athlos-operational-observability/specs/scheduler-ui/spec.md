# Delta for Scheduler UI

## MODIFIED Requirements

### Requirement: Scheduler Job List

The ADMIN-only `/admin/scheduler` page SHALL use dynamic scheduler reads, one entry per job. It SHALL present all seven statuses and safe projected reason/message only; raw errors and metadata MUST NOT render.
(Previously: fixed six-job grid and raw errors.)

#### Scenario: Dynamic status presentation
- GIVEN a registered job is `cancelled`
- WHEN an ADMIN opens the scheduler page
- THEN it SHALL show cancelled status and safe text only

#### Scenario: Non-ADMIN denied
- GIVEN an authenticated OPERADOR
- WHEN they navigate to `/admin/scheduler`
- THEN the page SHALL deny access
