# Scheduler and Jobs Specification

## Purpose

Defines the job scheduling subsystem for Athlos — how periodic and one-time background work is defined, executed, monitored, and recovered. Covers the drift detector, freshness monitor, token cleanup, optional scheduled import, and manual operator-triggered jobs.

Phase 1 runs on a single-node deployment, so this spec favors an in-process scheduler with durable execution state. The system MUST remain ready to migrate to a distributed queue (BullMQ + Redis) in later phases without changing job definitions.

## Requirements

### Requirement: Scheduler Library Choice

The system MUST use an in-process scheduler with persistent job-run state in the database for Phase 1. The chosen scheduler SHALL expose a declarative cron-style API and SHALL survive process restarts by reading scheduled jobs from the database on boot.

The system SHOULD isolate the scheduler behind a `JobScheduler` interface so the underlying implementation MAY be swapped (e.g., to BullMQ + Redis) without modifying job definitions.

#### Scenario: Single-node in-process scheduling

- GIVEN the Athlos API process starts
- WHEN the application boots
- THEN the scheduler MUST load all registered job definitions and their schedules from the database
- AND it MUST schedule the next run for each enabled job based on its cron expression

#### Scenario: Scheduler survives process restart

- GIVEN a drift-detection job was scheduled to run every 5 minutes
- WHEN the API process is killed and restarted
- THEN on boot the job MUST be rescheduled and its next run computed from "now + cron interval" (not from the missed run time)

#### Scenario: Interface isolation for future migration

- GIVEN job code calls `JobScheduler.schedule("drift-detection", cronExpr, handler)`
- WHEN a future phase replaces the in-process scheduler with BullMQ + Redis
- THEN the same call site MUST work without modification (only the adapter changes)

### Requirement: Job Types

The system MUST support the following job categories:

| Job | Type | Trigger | Default Schedule |
|-----|------|---------|------------------|
| `drift-detection` | Periodic | Cron | Every 15 minutes |
| `freshness-refresh` | Periodic | Cron | Every 5 minutes |
| `token-cleanup` | Periodic | Cron | Daily at 03:00 |
| `import-batch` | One-time | Manual API call | On demand |
| `reconciliation` | Periodic | Cron (optional) | Daily at 02:00 |

The system MAY allow additional job types to be registered via configuration without code changes.

#### Scenario: All default jobs registered

- GIVEN the scheduler boots on a fresh database
- WHEN startup completes
- THEN the system MUST have registered: drift-detection, freshness-refresh, token-cleanup
- AND import-batch and reconciliation MUST be available as callable jobs (manual trigger)

#### Scenario: Manual import job is callable

- GIVEN an admin calls `POST /api/v1/admin/jobs/import-batch` with body `{ "domain": "CTACTE" }`
- WHEN the request is authorized
- THEN a `import-batch` job run MUST be enqueued for domain `CTACTE` and return the `job_run_id`

### Requirement: Job Lifecycle

The system MUST model job state as a finite state machine with the following states: `pending`, `running`, `succeeded`, `failed`, `dead_letter`.

Each state transition MUST be persisted to a `job_runs` table with: job name, scheduled time, start time, end time, status, attempt number, error message, and metadata.

#### Scenario: Job lifecycle happy path

- GIVEN a `freshness-refresh` job is scheduled
- WHEN its cron tick fires
- THEN the system MUST create a `job_runs` row with status=`pending`, increment to `running` on handler start, then to `succeeded` on handler return

#### Scenario: Job lifecycle failure path

- GIVEN a `drift-detection` job is running
- WHEN its handler throws an exception
- THEN the `job_runs` row MUST transition to `failed` with the error message captured
- AND if the retry policy is exhausted, the row MUST transition to `dead_letter`

#### Scenario: Concurrent execution guard

- GIVEN a `freshness-refresh` job is currently `running`
- WHEN its next scheduled tick fires before the current run finishes
- THEN the scheduler MUST NOT start a second concurrent run for the same job name (skip the tick and log "skipped: previous run still in progress")

### Requirement: Job Retry Policy

The system MUST retry a failed job up to 3 times with exponential backoff: 30 seconds, 2 minutes, 10 minutes. After 3 failed attempts, the job run MUST be moved to `dead_letter` status and an alert MUST be emitted.

The system SHOULD use jitter (random delay within ±20% of base) to avoid thundering-herd retries when many jobs fail simultaneously.

#### Scenario: Transient failure retried

- GIVEN a `token-cleanup` job fails on its first attempt with a database connection error
- WHEN 30 seconds elapse
- THEN the scheduler MUST retry the job (attempt 2)

#### Scenario: Exhausted retries move to dead letter

- GIVEN a `drift-detection` job has failed 3 times
- WHEN the 3rd retry also fails
- THEN the `job_runs` row MUST be marked `dead_letter`
- AND an alert MUST be emitted (per the api-security + audit-logger specs)

#### Scenario: Successful retry clears failure state

- GIVEN a `freshness-refresh` job failed on attempt 1 but succeeds on attempt 2
- WHEN the success is recorded
- THEN the `job_runs` row MUST be marked `succeeded` and the alert is NOT emitted

### Requirement: Drift Detection Schedule

The `drift-detection` job MUST run every 15 minutes by default. The cron expression SHALL be configurable via the `DRIFT_DETECTION_CRON` environment variable.

Each tick MUST run the comparison logic defined in the `drift-detector` spec against all enabled domains. When drift is detected, the job MUST emit alerts per the `api-security` and `audit-logger` specs.

#### Scenario: Default 15-minute cadence

- GIVEN `DRIFT_DETECTION_CRON` is not set
- WHEN the scheduler boots
- THEN the `drift-detection` job MUST be registered with a default cron of `*/15 * * * *`

#### Scenario: Custom cron via env

- GIVEN `DRIFT_DETECTION_CRON="*/5 * * * *"`
- WHEN the scheduler boots
- THEN the `drift-detection` job MUST be registered with that 5-minute cadence

#### Scenario: Drift detected triggers alert

- GIVEN the drift detector finds 5 modified records in `CTACTE`
- WHEN the reconciliation completes
- THEN the job MUST write an `audit_events` row with action=`DRIFT_DETECTED`, entity_type=`CTACTE`, and details containing drift count and affected keys
- AND an operational alert MUST be emitted (per alert delivery in api-security)

#### Scenario: No drift does not alert

- GIVEN the drift detector finds 0 modified records
- WHEN the reconciliation completes
- THEN the job MUST record a `succeeded` run with `drift_count: 0` and MUST NOT emit a drift alert

### Requirement: Freshness Refresh Schedule

The `freshness-refresh` job MUST run every 5 minutes by default. The cron expression SHALL be configurable via the `FRESHNESS_REFRESH_CRON` environment variable.

Each tick MUST recompute the `freshness_status` rows (last_import_at, record_count, status) for all 14 imported domains from the most recent `import_batches` and `raw_events` tables.

The `freshness-refresh` job MUST also run immediately after each `import-batch` job completes successfully, regardless of the cron schedule.

#### Scenario: Default 5-minute cadence

- GIVEN `FRESHNESS_REFRESH_CRON` is not set
- WHEN the scheduler boots
- THEN the `freshness-refresh` job MUST be registered with `*/5 * * * *`

#### Scenario: Post-import immediate refresh

- GIVEN an `import-batch` job for domain `socios` completes with status `succeeded`
- WHEN the import handler returns
- THEN the system MUST trigger a `freshness-refresh` job run for the `socios` domain within 5 seconds
- AND the freshness dashboard MUST reflect the new last_import_at

#### Scenario: Periodic refresh from raw data

- GIVEN the last `freshness-refresh` ran 5 minutes ago
- WHEN the cron tick fires
- THEN the job MUST recompute freshness for all 14 domains and update the `freshness_status` table atomically

### Requirement: Token Cleanup

The `token-cleanup` job MUST run daily at 03:00 (configurable via `TOKEN_CLEANUP_CRON`). It MUST delete:

1. Expired refresh tokens where `expires_at < now() - 7 days`
2. Expired approval tokens where `expires_at < now() - 30 days`
3. Refresh tokens belonging to operators that have been soft-deleted

The system MUST keep the most recent 90 days of `audit_events` for security queries. Audit events older than 90 days MAY be archived to cold storage (out of scope for Phase 1) or deleted. The retention window SHALL be configurable via `AUDIT_RETENTION_DAYS`.

#### Scenario: Expired refresh token deleted

- GIVEN a refresh_token row with `expires_at` = 2024-06-01 (more than 7 days ago)
- WHEN the `token-cleanup` job runs at 03:00
- THEN that row MUST be deleted
- AND an audit event with action=`TOKEN_CLEANUP` MUST be recorded with count of rows deleted

#### Scenario: Expired approval token deleted

- GIVEN an approval_token row with `expires_at` = 2024-01-01 (more than 30 days ago)
- WHEN the `token-cleanup` job runs
- THEN that row MUST be deleted

#### Scenario: Recent refresh token preserved

- GIVEN a refresh_token row with `expires_at` = yesterday (1 day ago, within 7-day grace period)
- WHEN the `token-cleanup` job runs
- THEN the row MUST NOT be deleted

#### Scenario: Audit retention applied

- GIVEN `AUDIT_RETENTION_DAYS=90`
- WHEN the `token-cleanup` job runs
- THEN audit_events older than 90 days MAY be deleted or archived
- AND events within 90 days MUST be preserved

#### Scenario: Token cleanup failure alerts

- GIVEN the `token-cleanup` job fails (e.g., DB unavailable)
- WHEN the retry policy is exhausted
- THEN a `dead_letter` row MUST be created and an alert MUST be emitted (auth-login security context)

### Requirement: Job Run History

The system MUST persist every job run to a `job_runs` table:

```sql
CREATE TABLE job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed','dead_letter')),
  attempt INT NOT NULL DEFAULT 1,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  triggered_by TEXT NOT NULL DEFAULT 'scheduler' -- 'scheduler' | 'manual' | 'post-import'
);
CREATE INDEX idx_job_runs_job_name_started ON job_runs (job_name, started_at DESC);
CREATE INDEX idx_job_runs_status ON job_runs (status) WHERE status IN ('running','failed','dead_letter');
```

The system MUST provide a paginated admin-only endpoint `GET /api/v1/admin/jobs/runs` that returns job run history filtered by job_name, status, and date range. The endpoint MUST require the `ADMIN` role.

#### Scenario: Job run history endpoint

- GIVEN an admin calls `GET /api/v1/admin/jobs/runs?job_name=drift-detection&status=succeeded&limit=20`
- WHEN the request is authorized
- THEN the response MUST return the 20 most recent successful drift-detection runs with: id, job_name, started_at, finished_at, duration_ms, metadata

#### Scenario: Non-admin denied

- GIVEN an operator with role=OPERADOR calls `GET /api/v1/admin/jobs/runs`
- WHEN the request is processed
- THEN the response MUST be 403 Forbidden (per user-management-rbac spec)

#### Scenario: Failed runs queryable

- GIVEN a drift-detection run is in `dead_letter` status from yesterday
- WHEN admin queries `GET /api/v1/admin/jobs/runs?status=dead_letter&start_date=<yesterday>`
- THEN the response MUST include that run with its error_message

### Requirement: Manual Job Trigger

The system MUST allow admins to trigger a one-time job run via `POST /api/v1/admin/jobs/{job_name}/run`. The endpoint MUST require the `ADMIN` role and MUST persist the run with `triggered_by='manual'`.

The `import-batch` and `reconciliation` jobs MUST be triggerable manually. The `token-cleanup` and `freshness-refresh` jobs SHOULD be triggerable manually for debugging.

#### Scenario: Admin triggers drift detection

- GIVEN an admin calls `POST /api/v1/admin/jobs/drift-detection/run`
- WHEN the request is authorized
- THEN a new `job_runs` row MUST be created with `triggered_by='manual'`, status=`running`
- AND the response MUST return the new `job_run_id`

#### Scenario: Manual run does not disrupt schedule

- GIVEN drift-detection is scheduled every 15 minutes
- WHEN an admin manually triggers a run at minute 7 (between scheduled ticks)
- THEN the manual run MUST execute
- AND the next scheduled tick at minute 15 MUST still fire normally (manual runs do not shift the schedule)

#### Scenario: Manual trigger of unknown job rejected

- GIVEN an admin calls `POST /api/v1/admin/jobs/unknown-job/run`
- WHEN the request is processed
- THEN the response MUST be 404 Not Found with `{"error":"JOB_NOT_FOUND"}`

### Requirement: Job Monitoring and Health

The system MUST expose a `GET /api/v1/admin/jobs/health` endpoint that returns the health of each registered job: last run status, last successful run timestamp, and a `healthy` boolean flag.

A job is `healthy` when its last successful run is within `2 × cron_interval` of now. For the drift-detection job (15 min interval), a job is unhealthy if its last successful run is more than 30 minutes ago.

#### Scenario: Healthy drift detection

- GIVEN drift-detection's last successful run was 10 minutes ago
- WHEN an admin calls `GET /api/v1/admin/jobs/health`
- THEN drift-detection MUST be reported as `healthy: true`

#### Scenario: Unhealthy freshness refresh

- GIVEN freshness-refresh's last successful run was 2 hours ago
- WHEN an admin calls `GET /api/v1/admin/jobs/health`
- THEN freshness-refresh MUST be reported as `healthy: false` with reason "last successful run exceeded 2× interval"

#### Scenario: Health endpoint accessible only to admins

- GIVEN an operator with role=CONSULTA calls `GET /api/v1/admin/jobs/health`
- WHEN the request is processed
- THEN the response MUST be 403 Forbidden

### Requirement: Job Failure Handling

When a job moves to `dead_letter` status, the system MUST:

1. Persist the run with status=`dead_letter`, attempt=3, error_message, and full failure metadata
2. Emit an `audit_events` row with action=`JOB_DEAD_LETTER`, job_name, error_message
3. Make the failed run visible in the admin job run history endpoint
4. Continue scheduling future ticks (a dead-letter run does not pause the job)

The system MUST NOT silently drop failed jobs.

#### Scenario: Drift detection dead letter

- GIVEN a `drift-detection` job has failed 3 consecutive runs with the same database connection error
- WHEN the 3rd attempt fails
- THEN a `job_runs` row MUST be created with status=`dead_letter`
- AND an audit event MUST be recorded with action=`JOB_DEAD_LETTER`
- AND the job MUST still be scheduled for its next tick

#### Scenario: Operator reviews dead letter runs

- GIVEN two jobs are in `dead_letter` status
- WHEN admin queries `GET /api/v1/admin/jobs/runs?status=dead_letter`
- THEN both runs MUST be returned with their error messages

### Requirement: Scheduler Boot and Shutdown

On application boot, the scheduler MUST:

1. Mark any `job_runs` left in `running` status from a previous process as `failed` with error_message="process terminated unexpectedly"
2. Load job definitions from configuration
3. Schedule the next tick for each enabled job

On graceful shutdown (SIGTERM), the scheduler MUST:

1. Stop accepting new ticks
2. Wait up to 30 seconds for in-flight jobs to complete
3. Mark any still-running jobs as `failed` with error_message="process shutdown"

#### Scenario: Crash recovery on boot

- GIVEN the API process was killed while a `drift-detection` job was `running`
- WHEN the process restarts
- THEN that orphaned run MUST be marked `failed` with "process terminated unexpectedly"
- AND a new run MUST be scheduled normally

#### Scenario: Graceful shutdown waits for in-flight job

- GIVEN a `freshness-refresh` job is `running`
- WHEN the process receives SIGTERM
- THEN the scheduler MUST allow up to 30 seconds for the job to finish
- AND if the job finishes, it MUST be marked `succeeded`
- AND if 30 seconds elapse, the job MUST be marked `failed` with "process shutdown"

### Requirement: Admin Scheduler Endpoints (NEW in athlos-async-scheduler)

The system SHALL expose 3 ADMIN-gated endpoints under `/api/v1/scheduler/jobs` for operator-controlled manual trigger, status read, and enable/disable of registered jobs. All endpoints MUST be protected by `requireRole('ADMIN')`. The `POST /run-now` endpoint SHALL be rate-limited to 1 request per 60 seconds per operator via `@fastify/rate-limit`'s `keyGenerator` extracting `request.operator.sub`. The endpoints SHALL be implemented in a NEW file `apps/api/src/routes/admin/scheduler.ts` (NOT modifying existing `apps/api/src/routes/admin/jobs.ts` beyond removing the stale "Reserved for future PR 7" comment).

#### Scenario: POST /api/v1/scheduler/jobs/:name/run-now (ADMIN, rate-limited 1/min)

- GIVEN an operator with `role: 'ADMIN'` is authenticated via JWT
- WHEN they POST `/api/v1/scheduler/jobs/scheduled-promotion/run-now`
- THEN the API SHALL call `scheduler.runNow('scheduled-promotion')` and return HTTP 200 with `{ jobRunId, status }`
- AND a `job_runs` row SHALL be inserted with `triggered_by='manual'`
- AND 1 `audit_events` row SHALL be inserted with `action: 'PROMOTE_TRIGGER'`
- AND a 2nd POST within 60 seconds from the same operator SHALL return HTTP 429 with `Retry-After`

#### Scenario: GET /api/v1/scheduler/jobs returns last 20 runs from job_runs

- GIVEN an ADMIN operator is authenticated
- WHEN they GET `/api/v1/scheduler/jobs`
- THEN the API SHALL return HTTP 200 with the last 20 rows from `job_runs`, ordered by `started_at DESC`
- AND each entry SHALL include `{ jobName, status, startedAt, finishedAt, durationMs, attempt, errorMessage?, totals? }`

#### Scenario: GET /api/v1/scheduler/jobs/:name returns single job status + recent runs

- GIVEN `scheduled-promotion` is registered in the scheduler
- AND an ADMIN operator GETs `/api/v1/scheduler/jobs/scheduled-promotion`
- THEN the response SHALL be HTTP 200 with `{ name, cronExpr, timezone, cadenceMinutes, enabled, healthy, reason, lastRuns: JobRunDTO[≤5] }`
- AND a GET for an unknown job name SHALL return HTTP 404 `{ error: 'JOB_NOT_FOUND' }`

#### Scenario: PATCH /api/v1/scheduler/jobs/:name with {enabled: false} stops future cron runs

- GIVEN `scheduled-promotion` is registered with `cronExpr='0 */6 * * *'`
- WHEN an ADMIN operator PATCHes `/api/v1/scheduler/jobs/scheduled-promotion` with body `{ "enabled": false }`
- THEN `scheduler.setEnabled('scheduled-promotion', false)` SHALL be called
- AND the underlying node-cron task SHALL be stopped (no future ticks fire)
- AND the response SHALL be HTTP 200 with the updated definition
- AND 1 `audit_events` row SHALL be inserted with `action: 'PROMOTE_TRIGGER'` and `metadata.enabled=false`
- AND any in-flight job SHALL complete normally (disable does NOT abort in-flight)
- AND a subsequent PATCH with `{ enabled: true }` SHALL re-create the node-cron task

### Requirement: JobScheduler.setEnabled Interface Method (NEW in athlos-async-scheduler)

The system SHALL add `setEnabled(jobName: string, enabled: boolean): void` to the `JobScheduler` interface (`packages/scheduler/src/types.ts`). The method SHALL be idempotent: when transitioning disabled→enabled with a `cronExpr`, the node-cron task is (re)created; when transitioning enabled→disabled, the existing task is stopped (no further ticks fire, but `runNow` continues to work). Unknown job names SHALL throw an error (matching `runNow` semantics). The interface change is forward-only and swap-friendly for the BullMQ adapter deferred to E5+.

#### Scenario: setEnabled preserves BullMQ swap-in compatibility

- GIVEN a future BullMQ-based `JobScheduler` adapter is implemented (deferred to E5+)
- WHEN the adapter implements the `setEnabled(jobName, enabled)` method
- THEN the adapter SHALL map the call to a queue enable/disable flag on the BullMQ queue (or `repeatableJob.remove()`)
- AND existing call sites (`PATCH /api/v1/scheduler/jobs/:name`) SHALL work without modification
- AND the contract SHALL remain: `runNow(jobName)` is unaffected by `enabled=false`
- AND 3 NEW test cases SHALL exist in `packages/scheduler/src/scheduler.test.ts` covering: happy-path toggle, unknown-job throws, idempotent re-toggle

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

## Success Criteria

- All five default jobs (drift-detection, freshness-refresh, token-cleanup, import-batch, reconciliation) are registered and runnable
- Drift detection runs every 15 minutes by default and emits alerts on detected drift
- Freshness refresh runs every 5 minutes by default and also runs immediately after each import-batch completion
- Expired refresh tokens (>7 days past expiry) and approval tokens (>30 days past expiry) are cleaned up daily
- Job runs are persisted with full state machine transitions
- Failed jobs retry up to 3 times with exponential backoff and then move to `dead_letter`
- Admins can query job run history, trigger manual runs, and check job health via dedicated endpoints
- Concurrent execution of the same job is prevented (no overlapping runs)
- The scheduler survives process restarts and recovers orphaned `running` jobs
- The `JobScheduler` interface allows future migration to BullMQ + Redis without changing job call sites
