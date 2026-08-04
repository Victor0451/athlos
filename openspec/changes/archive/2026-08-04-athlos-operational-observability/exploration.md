## Exploration: First Repository-Only Operational Observability Slice

### Current State
The dashboard already refreshes API liveness, freshness, scheduler health, and recent runs every 30 seconds; scheduler cards are ADMIN-gated. `GET /health/ready` exists but has no web client. The freshness route forwards service items unchanged while the web wrapper renders `row_count` and `last_update`, despite the API contract using camelCase. Scheduler health is registry-backed, but `/admin/scheduler` independently hard-codes six names and therefore omits the registered `socios-evidence-runtime-closure` job. The database supports `completed_with_review` and `cancelled`, while the admin run filter and dashboard status union omit them. Both scheduler route families directly serialize `errorMessage`, which must not become an operator-visible raw failure reason.

### Affected Areas
- `apps/api/src/routes/health.ts` — readiness probe is available for a server-side ADMIN snapshot.
- `apps/api/src/routes/freshness.ts` — currently exposes service items without a stable dashboard DTO mapping.
- `apps/api/src/routes/admin/jobs.ts` — registry health and run DTO/filter need safe, complete observability semantics.
- `apps/api/src/routes/admin/scheduler.ts` — also relays raw job error text and has overlapping read DTOs.
- `apps/api/src/jobs/register.ts` — authoritative runtime registration includes seven jobs, including `socios-evidence-runtime-closure`.
- `packages/db/src/schema/job-runs.ts` and `packages/scheduler/src/types.ts` — terminal statuses include `completed_with_review` and `cancelled`.
- `apps/web/src/lib/api/health.ts`, `apps/web/src/lib/api/scheduler.ts`, and `apps/web/src/app/(authed)/dashboard/page.tsx` — current dashboard DTOs, queries, and status display need the new snapshot contract.
- `apps/web/src/app/(authed)/admin/scheduler/page.tsx` — its hard-coded six-job fan-out should not remain the source of truth.
- `apps/api/src/routes/admin/jobs.test.ts` — existing ADMIN/read-only and DTO coverage is the closest API test seam.

### Approaches
1. **Dedicated ADMIN operational snapshot endpoint** — add one read-only, ADMIN-gated API DTO that composes readiness, normalized freshness, `scheduler.list()` health, and a capped attention-run list; have the dashboard consume it.
   - Pros: one explicit contract; registry-driven jobs; server-side redaction; bounded payload; removes browser access to the unauthenticated readiness route; prevents duplicated client reconciliation.
   - Cons: introduces an aggregation DTO and endpoint.
   - Effort: Medium.

2. **Extend the dashboard with existing endpoint calls** — add a readiness client and reconcile freshness, jobs, statuses, and errors in browser components.
   - Pros: smaller API addition.
   - Cons: readiness needs a browser-accessible path; raw errors remain exposed by current APIs; duplicated contracts and hard-coded job behavior persist; client becomes responsible for safety rules.
   - Effort: Medium.

### Recommendation
Use a dedicated `GET /api/v1/admin/operations/snapshot` read-only endpoint and a single dashboard query. Its DTO should contain readiness as a short dependency-status summary, normalized camelCase freshness fields, all jobs from `scheduler.list()`, and at most a fixed small number of attention-required runs. Treat `failed`, `dead_letter`, `cancelled`, and `completed_with_review` as explicit display states. Map persisted errors to a controlled reason code/message by status/category; never return `errorMessage`, raw metadata, or logs. Keep scheduler enablement, triggers, alerting, metrics visualization, historical charts, live/deployment access, and finance data out of this slice.

### Risks
- A snapshot query must remain bounded: cap attention runs server-side and avoid unbounded metadata or history queries.
- Readiness currently reports DB/schema only, whereas the existing specification describes DB/legacy dependencies; the new UI must present the implemented contract or align it deliberately in a later change.
- Existing scheduler and admin endpoints may still expose raw errors after the snapshot is safe; scope must state whether redaction is snapshot-only or a shared DTO hardening.
- Dashboard and scheduler page tests are sparse, so API contract and role/redaction coverage should be added before relying on visual-only verification.

### Ready for Proposal
Yes — propose a repository-only, ADMIN read-only operational snapshot with explicit payload bounds and redaction rules. State that this first slice does not add control mutations, persistence for scheduler enablement, raw diagnostic data, or external observability integrations.
