# Delta for Scheduler and Jobs

## ADDED Requirements

### Requirement: Dynamic Safe Scheduler Reads

Scheduler reads MUST derive jobs from the runtime registry, never a fixed list. They MUST represent `pending`, `running`, `succeeded`, `completed_with_review`, `failed`, `dead_letter`, and `cancelled`. All reads MUST share an allowlisted reason-code/safe-message projection; raw errors and metadata MUST NOT be returned.

#### Scenario: Newly registered job appears
- GIVEN a job is registered
- WHEN an ADMIN reads health, list, or detail
- THEN it MUST be represented without a hard-coded list

#### Scenario: Review completion is safe
- GIVEN a run is `completed_with_review`
- WHEN it is read by an ADMIN endpoint
- THEN status and projected reason MAY return but metadata MUST NOT
