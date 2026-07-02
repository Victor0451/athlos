# Delta for deployment-devops: athlos-async-scheduler

> **ADDITIVE-ONLY DELTA.** This delta adds 1 NEW requirement below. No
> existing requirement is modified, removed, or rewritten. The change
> wires `@athlos/scheduler` (already shipped in v0.5.7) to automatically
> run `promoteAll(db)` on a cron (`PROMOTION_CRON`, default every 6h) and
> adds 3 admin endpoints for operator-controlled trigger / status /
> enable-disable.

## ADDED Requirements

### Requirement: Scheduled Promotion (NEW in athlos-async-scheduler)

The system SHALL run `promoteAll(db)` automatically every 6 hours via the
in-process `@athlos/scheduler` (node-cron + DB-persisted `job_runs` + retry +
dead-letter). The schedule SHALL be configurable via the `PROMOTION_CRON`
environment variable (default `0 */6 * * *`, UTC timezone — node-cron default).
The scheduler worker SHALL be started at API server startup. The slice also
adds 3 admin endpoints under `/api/v1/scheduler/jobs` for operator-controlled
manual trigger, status read, and enable/disable of registered jobs.

#### Scenario: scheduled promotion runs every 6 hours via PROMOTION_CRON

- GIVEN `PROMOTION_CRON=0 */6 * * *` is set in the API container env
- AND `@athlos/scheduler` is started in `apps/api/src/server.ts` after `buildScheduler(...)` returns
- WHEN the cron expression triggers (every 6h at minute 0)
- THEN the `scheduled-promotion` JobHandler SHALL execute
- AND it SHALL call `promoteAll(container.db)` synchronously inside the handler
- AND the result SHALL be persisted to `job_runs` with `status='succeeded' | 'failed'`
- AND 1 `audit_events` row SHALL be inserted with `action: 'PROMOTE_TRIGGER'`

#### Scenario: PROMOTION_CRON env var defaults to `0 */6 * * *` if unset

- GIVEN `PROMOTION_CRON` is NOT set in the API container env
- WHEN the API boots and `@athlos/config` parses `envSchema`
- THEN `env.PROMOTION_CRON` SHALL default to the string `'0 */6 * * *'`
- AND `validateCronExpression(env.PROMOTION_CRON)` SHALL pass at boot
- AND the scheduler SHALL register `scheduled-promotion` with that cron

#### Scenario: scheduler worker starts at API server startup

- GIVEN the API container starts and `apps/api/src/server.ts` boots
- WHEN `buildScheduler(...)` returns AND `app.listen()` is called
- THEN `app.scheduler.start()` SHALL have been called (registers all node-cron tasks)
- AND `GET /api/v1/admin/jobs/health` SHALL include `scheduled-promotion` with `scheduled: true`
- AND the registered job list SHALL contain 6 jobs (5 existing + 1 NEW `scheduled-promotion`)

#### Scenario: SIGTERM mid-promotion aborts cleanly (handler respects ctx.signal)

- GIVEN the API process receives SIGTERM mid-promotion (during a 60-90s `promoteAll` call)
- WHEN the scheduler's 30-second graceful shutdown window starts
- THEN the handler SHALL observe `ctx.signal.aborted === true` at the next domain boundary
- AND the in-flight `job_runs` row SHALL be marked `failed` with `error_message='process shutdown'`
- AND no orphaned `running` rows SHALL remain after the process exits
- AND the next boot SHALL call `reconcileOrphanedRuns()` to verify no leftover `running` rows