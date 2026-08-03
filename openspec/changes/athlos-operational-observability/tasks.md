# Tasks: ADMIN Operational Snapshot

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 1,000–1,300 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | Four slices: 1 API safety; 2 snapshot; 3 dashboard; 4 scheduler UI |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain |
| Work Unit 1 delivery | Completed on child branch `feat/operational-observability-01-api-safety` at commit `942a042` |
| Work Unit 1 source/test diff | 475 lines: 327 additions, 148 deletions |
| Work Unit 1 size exception | Maintainer-approved; applies only to Work Unit 1 |
| Integration branch | `feat/operational-observability`; the only branch that will ultimately target `main` |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
Work Unit 1 delivery: completed on child branch `feat/operational-observability-01-api-safety` at commit `942a042`
Work Unit 1 source/test diff: 475 lines (327 additions, 148 deletions)
Work Unit 1 size exception: maintainer-approved; applies only to Work Unit 1
Later slices: retain the 400-line budget
Integration branch: `feat/operational-observability`; only this branch will ultimately target `main`
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Safe API reads | PR 1 | `pnpm --filter @athlos/api test:run -- routes/admin/jobs.test.ts routes/admin/__tests__/scheduler.test.ts` | N/A — route contracts | Projector, job reads, tracker |
| 2 | Snapshot API | PR 2 | `pnpm --filter @athlos/api test:run -- routes/health.test.ts routes/admin/operations.test.ts` | N/A — injected readers | Readiness and operations route |
| 3 | Dashboard | PR 3 | `pnpm --filter @athlos/web test:run -- dashboard` | N/A — mocked API/auth | Client and dashboard slice |
| 4 | Dynamic safe scheduler UI | PR 4 | `pnpm --filter @athlos/web test:run -- JobCard.test.tsx RunList.test.tsx scheduler` | N/A — mocked API/auth | Client, page, cards, run list |

## Phase 1: API foundation

- [x] 1.1 **RED**: test status union, allowlisted codes/messages, leakage, fallback, and 160-code-point safety.
- [x] 1.2 **GREEN**: create `apps/api/src/routes/admin/scheduler-run-projector.ts`; make `admin/jobs.ts` and `admin/scheduler.ts` use it everywhere.
- [x] 1.3 **RED**: test bounded attention ordering and four attention statuses in `packages/scheduler/src/run-tracker.test.ts`.
- [x] 1.4 **GREEN**: add `listAttentionRuns(db, 10)` in `packages/scheduler/src/run-tracker.ts`; derive job reads from `scheduler.list()` and cover the closed union.
- [x] 1.5 **REFACTOR/CHECK**: remove fixed/raw DTO paths; run Unit 1 and commit `feat(operations): harden dynamic scheduler reads`.

## Phase 2: Readiness and snapshot API

- [ ] 2.1 **RED**: pin readiness 200/503 body in `health.test.ts` while schema/DB outcomes vary.
- [ ] 2.2 **GREEN**: extract `apps/api/src/services/readiness.ts#probeReadiness`; adapt `apps/api/src/routes/health.ts` without drift.
- [ ] 2.3 **RED**: test ADMIN 200/OPERADOR 403, independent rejection, dynamic registry, ≤10 attention, camelCase unknowns, and no leakage in `operations.test.ts`.
- [ ] 2.4 **GREEN**: create `services/operational-snapshot.ts` and `routes/admin/operations.ts`; register in `server.ts` with `requireRole('ADMIN')` and `Promise.allSettled` envelopes.
- [ ] 2.5 **REFACTOR/CHECK**: keep read-only; add no migration; run Unit 2 and commit `feat(operations): add bounded admin snapshot`.

## Phase 3: Snapshot web contract and dashboard

- [ ] 3.1 **RED**: test one query at mount/30 seconds, partial envelopes, DB/schema labels, and ≤10 safe attention rows.
- [ ] 3.2 **GREEN**: create `apps/web/src/lib/api/operations.ts`; update `lib/api/health.ts` and dashboard page to one ADMIN TanStack query (`refetchInterval: 30_000`).
- [ ] 3.3 **REFACTOR/CHECK**: remove dashboard fan-out only; run Unit 3 and commit `feat(dashboard): consume operational snapshot`.

## Phase 4: Dynamic scheduler UI

- [ ] 4.1 **RED**: test dynamic jobs, cancelled/review states, safe text, and OPERADOR suppression in scheduler page, `JobCard.test.tsx`, and `RunList.test.tsx`.
- [ ] 4.2 **GREEN**: update `lib/api/scheduler.ts`, scheduler list/detail, `JobCard.tsx`, and `RunList.tsx` for projected DTOs and all statuses.
- [ ] 4.3 **REFACTOR/CHECK**: remove fixed six-job assumptions; run Unit 4 plus `pnpm typecheck`; commit `feat(scheduler): render dynamic safe job status`.
