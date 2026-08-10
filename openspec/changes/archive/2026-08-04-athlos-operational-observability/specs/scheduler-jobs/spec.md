# Delta for Scheduler and Jobs

## ADDED Requirements

### Requirement: Dynamic Safe Scheduler Reads

For the operational snapshot and dynamic scheduler surfaces (`GET /api/v1/admin/operations/snapshot`, `GET /api/v1/admin/jobs/health`, `GET /api/v1/scheduler/jobs`, and `GET /api/v1/scheduler/jobs/:name`), job reads MUST derive jobs from the runtime registry, never a fixed list. These surfaces MUST represent `pending`, `running`, `succeeded`, `completed_with_review`, `failed`, `dead_letter`, and `cancelled`, and their run DTOs MUST share an allowlisted reason-code/safe-message projection; raw errors and metadata MUST NOT be returned. The legacy paginated `GET /api/v1/admin/jobs/runs` history contract remains governed by the existing Job Run History requirement, including its distinct historical fields.

#### Scenario: Newly registered job appears
- GIVEN a job is registered
- WHEN an ADMIN reads operational snapshot, job health, scheduler list, or scheduler detail
- THEN it MUST be represented without a hard-coded list

#### Scenario: Review completion is safe
- GIVEN a run is `completed_with_review`
- WHEN it is read by an operational snapshot or dynamic scheduler endpoint
- THEN status and projected reason MAY return but metadata MUST NOT
