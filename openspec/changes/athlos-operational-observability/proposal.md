# Proposal: ADMIN Operational Snapshot

## Intent

Give ADMIN operators a read-only view of readiness, freshness, and jobs needing attention. The dashboard reconciles inconsistent fields, incomplete jobs/statuses, and raw scheduler failures.

## Scope

### In Scope
- Add `GET /api/v1/admin/operations/snapshot`, ADMIN-gated, containing readiness, freshness, registered-job health, and at most 10 attention runs.
- Present implemented readiness only: overall, PostgreSQL `db`, and required-relation `schema`; do not claim legacy-share readiness.
- Normalize freshness to camelCase (`lastImportAt`, `recordCount`, `ageDisplay`) with `current | stale | unknown` semantics.
- Source jobs dynamically from `scheduler.list()` and support every persisted status: `pending`, `running`, `succeeded`, `completed_with_review`, `failed`, `dead_letter`, and `cancelled`.
- Project failures to an allowlisted reason code and safe message; never return raw `errorMessage`, metadata, logs, stacks, or exceptions.
- Apply that projection to existing ADMIN scheduler reads; raw-error hardening is explicitly in scope.
- Replace dashboard scheduler/freshness fan-out with one 30-second query; align `/admin/scheduler` with dynamic jobs/statuses.

### Out of Scope
- Triggers, enablement, retries, alerting, metrics/charts, excess history, or diagnostic storage.
- Production/live access, deployment, external integrations, or finance/domain behavior.

## Capabilities

### New Capabilities
- `operational-snapshot`: ADMIN authorization, bounded aggregate DTO, readiness semantics, and safe failure projection.

### Modified Capabilities
- `freshness-monitor`: canonical camelCase dashboard contract.
- `scheduler-jobs`: complete statuses, dynamic registry source, and redacted read DTOs.
- `scheduler-ui`: dynamic jobs and safe status/reason presentation.
- `web-frontend`: single-query ADMIN dashboard slice.

## Approach

Compose readiness/freshness logic, `scheduler.list()`, job health, and a capped attention query. Attention means `failed`, `dead_letter`, `cancelled`, or `completed_with_review`; other states remain in job health. Share one projector across scheduler read DTOs. Keep public probes unchanged.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `apps/api/src/routes/admin/` | New/Modified | Snapshot and safe DTOs |
| `apps/web/src/app/(authed)/dashboard/` | Modified | Snapshot slice |
| `apps/web/src/app/(authed)/admin/scheduler/` | Modified | Dynamic jobs/statuses |
| `apps/web/src/lib/api/` | Modified | Snapshot contract |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Aggregate query grows or leaks details | Medium | Fixed cap, allowlisted fields/reasons, contract tests |
| Readiness UI overstates dependencies | Medium | Label only implemented DB/schema checks |

## Rollback Plan

Remove the snapshot route/query and restore prior dashboard calls; retain independently safe error redaction.

## Dependencies

- Scheduler registry, freshness/readiness logic, and `job_runs` schema.

## Proposal question round

Auto mode: exploration locked the requirements; no product assumption remains open.

## Success Criteria

- [ ] ADMIN receives one bounded snapshot; non-ADMIN receives 403.
- [ ] UI shows DB/schema readiness, canonical freshness, every registered job, and all seven statuses.
- [ ] Snapshot and existing scheduler reads expose no raw failure or metadata content.
- [ ] No mutation, production, deployment, integration, or finance behavior changes.
