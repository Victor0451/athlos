# Delta for scheduler-jobs: athlos-async-scheduler

> **ADDITIVE-ONLY DELTA.** This delta adds 2 NEW requirements below. No
> existing requirement is modified, removed, or rewritten. Closes the
> deferred async-promotion scope from E2 (sync-only) by adding 3 admin
> endpoints to manage registered jobs (manual trigger / single-job detail /
> enable-disable toggle) plus a `setEnabled` interface method for the
> `JobScheduler` interface (swap-friendly for future BullMQ adapter).

## ADDED Requirements

### Requirement: Admin Scheduler Endpoints (NEW in athlos-async-scheduler)

The system SHALL expose 3 ADMIN-gated endpoints under `/api/v1/scheduler/jobs`
for operator-controlled manual trigger, status read, and enable/disable of
registered jobs. All endpoints MUST be protected by `requireRole('ADMIN')`.
The `POST /run-now` endpoint SHALL be rate-limited to 1 request per 60
seconds per operator via `@fastify/rate-limit`'s `keyGenerator` extracting
`request.operator.sub`. The endpoints SHALL be implemented in a NEW file
`apps/api/src/routes/admin/scheduler.ts` (NOT modifying existing
`apps/api/src/routes/admin/jobs.ts` beyond removing the stale
"Reserved for future PR 7" comment).

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

The system SHALL add `setEnabled(jobName: string, enabled: boolean): void`
to the `JobScheduler` interface (`packages/scheduler/src/types.ts`). The
method SHALL be idempotent: when transitioning disabled→enabled with a
`cronExpr`, the node-cron task is (re)created; when transitioning
enabled→disabled, the existing task is stopped (no further ticks fire,
but `runNow` continues to work). Unknown job names SHALL throw an error
(matching `runNow` semantics). The interface change is forward-only and
swap-friendly for the BullMQ adapter deferred to E5+.

#### Scenario: setEnabled preserves BullMQ swap-in compatibility

- GIVEN a future BullMQ-based `JobScheduler` adapter is implemented (deferred to E5+)
- WHEN the adapter implements the `setEnabled(jobName, enabled)` method
- THEN the adapter SHALL map the call to a queue enable/disable flag on the BullMQ queue (or `repeatableJob.remove()`)
- AND existing call sites (`PATCH /api/v1/scheduler/jobs/:name`) SHALL work without modification
- AND the contract SHALL remain: `runNow(jobName)` is unaffected by `enabled=false`
- AND 3 NEW test cases SHALL exist in `packages/scheduler/src/scheduler.test.ts` covering: happy-path toggle, unknown-job throws, idempotent re-toggle