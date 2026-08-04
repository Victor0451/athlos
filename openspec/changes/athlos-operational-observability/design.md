# Design: ADMIN Operational Snapshot

## Technical Approach

Add one ADMIN-only aggregate route and keep transport, signal collection, persistence queries, and DTO projection separate. The snapshot composes shared readiness, freshness, dynamic scheduler health, and a ten-row attention query; partial signal failure still returns HTTP 200 with that signal unavailable. Existing public probes retain their paths, status codes, and response bodies.

## Architecture Decisions

| Decision | Choice and rationale | Rejected alternative |
|---|---|---|
| Boundaries | `operations.ts` owns HTTP/auth; `operational-snapshot.ts` orchestrates injected readers; scheduler owns run queries; one pure projector owns every scheduler read DTO. This keeps redaction impossible to bypass accidentally. | Aggregate logic in the handler. |
| Readiness reuse | Extract `probeReadiness(pool)` from `health.ts`. `/health/ready` maps its result back to the exact current `status/db/schema/latency_ms` body and 200/503 behavior; the snapshot calls the function directly. | HTTP self-call, which adds auth/network failure modes. |
| Failure isolation | Run readiness, freshness, job health, and attention with `Promise.allSettled`. Return successful siblings; failed freshness/jobs/attention become `{ available: false, items: [] }`. Failed readiness reports all fields `unavailable`; schema is also unavailable when DB cannot be checked. | Fail the whole snapshot. |
| Dynamic jobs | Call `fastify.scheduler.list()` per request, pass those definitions to `getJobHealth`, and make scheduler list/detail responses derive only from that registry. | `KNOWN_JOBS` or registration-file duplication. |
| Bounded attention | Add `listAttentionRuns(db, 10)`: SQL `status IN (...)`, `ORDER BY started_at DESC NULLS LAST, scheduled_at DESC, id DESC`, and `LIMIT 10`; no fetch-then-filter. | Reusing the 200-row history query. |

## Data Flow

```text
ADMIN request -> operations route -> snapshot service -> allSettled
                                      |-> probeReadiness(pool)
                                      |-> freshnessService.getFreshness()
                                      |-> scheduler.list() -> getJobHealth()
                                      `-> listAttentionRuns(db, 10)
all scheduler runs ----------------------> projectSchedulerRun() -> safe DTO
```

## Interfaces / Contracts

`OperationalSnapshot` contains `readiness: { overall, db, schema }` (`ready | unavailable`), plus `{ available, items }` envelopes for freshness, jobs, and attention. Freshness items are `{ domain, lastImportAt, recordCount, status, ageDisplay }`, with `current | stale | unknown`; missing data is null/zero/unknown. Job/run status is the closed seven-value persisted union.

`projectSchedulerRun` is the only run projector used by snapshot attention, `/api/v1/admin/jobs/runs`, `/api/v1/admin/jobs/health`, and scheduler list/detail. Output excludes `errorMessage`, `metadata`, logs, stacks, and exceptions. Closed reason codes are `REVIEW_REQUIRED`, `CANCELLED`, `RETRIES_EXHAUSTED`, `PROCESS_INTERRUPTED`, `PROCESS_SHUTDOWN`, `EXECUTION_FAILED`, and `UNCLASSIFIED_FAILURE`. Non-attention statuses return no reason. Exact known persistence messages map to process codes; all other raw failures map to `EXECUTION_FAILED` without interpolation. Unknown future terminal states use `UNCLASSIFIED_FAILURE`. Messages come only from a code-to-constant table, are capped at 160 Unicode code points, and blank/invalid/overlong generated values fall back to the `UNCLASSIFIED_FAILURE` constant; raw text is never truncated into output.

Web adds a typed `getOperationalSnapshot()` and one ADMIN TanStack query with `refetchInterval: 30_000`. Dashboard readiness, freshness, jobs, and attention components render each envelope independently. `/admin/scheduler` replaces six queries with one dynamic list query; `JobCard`/`RunList` cover all seven statuses and render only projected reason/message. Both pages retain client role gates, while API `requireRole('ADMIN')` is authoritative and returns 403.

## File Changes

| Action | Files |
|---|---|
| Create | `apps/api/src/services/readiness.ts`, `apps/api/src/services/operational-snapshot.ts`, `apps/api/src/routes/admin/operations.ts`, `apps/api/src/routes/admin/scheduler-run-projector.ts`, and focused tests; `apps/web/src/lib/api/operations.ts` |
| Modify | `apps/api/src/routes/health.ts`, `admin/jobs.ts`, `admin/scheduler.ts`, `server.ts`; `packages/scheduler/src/run-tracker.ts`; `apps/web/src/lib/api/{health,scheduler}.ts`, dashboard page/tests, scheduler list/detail tests, `JobCard.tsx`, `RunList.tsx` |
| Delete | None |

## Testing Strategy

Pure unit tests pin projector taxonomy, fallback, 160-code-point cap, and forbidden keys; readiness tests prove shared logic while preserving public probe behavior. Route tests inject independent rejected readers, assert ADMIN/403, dynamic registry inclusion, complete statuses, deterministic limit 10, and no raw/metadata leakage across every scheduler read. Web tests use mocked API/auth plus fake timers to prove one ADMIN call initially and every 30 seconds, partial rendering, dynamic jobs, safe text, and non-ADMIN suppression.

## Threat Matrix

| Boundary | Applicability | Design response / RED tests |
|---|---|---|
| Documentation-like paths | N/A: no classification/execution | None |
| Git repository selection | N/A: no VCS integration | None |
| Commit state | N/A: no VCS integration | None |
| Push state | N/A: no VCS integration | None |
| PR commands | N/A: no PR automation | None |

The HTTP routing boundary is covered by route-audit-compatible `requireRole('ADMIN')` and 401/403/200 route tests.

## Migration / Rollout

No migration required. Roll back the snapshot route/client and restore dashboard fan-out; retain the projector hardening. No feature flag is needed because the change is read-only. Monitor response latency and payload size during rollout.

## Open Questions

None.
